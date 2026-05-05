import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { CONFIG } from './config';

interface KnowledgeBaseStackProps extends cdk.StackProps {
  documentBucket: s3.IBucket;
}

export class KnowledgeBaseStack extends cdk.Stack {
  public readonly knowledgeBaseId: string;
  public readonly dataSourceId: string;

  constructor(scope: Construct, id: string, props: KnowledgeBaseStackProps) {
    super(scope, id, props);

    const { documentBucket } = props;

    // -------------------------------------------------------
    // 1. IAM Role for the Knowledge Base
    // -------------------------------------------------------
    // Bedrock Knowledge Bases needs a role it can assume to:
    //   - Call the embedding model (Titan v2) to convert text → vectors
    //   - Read documents from S3
    //   - Read the Pinecone API key from Secrets Manager
    //
    // With L2 constructs this would be automatic. With L1 we build it ourselves.

    const kbRole = new iam.Role(this, 'KnowledgeBaseRole', {
      roleName: `${CONFIG.projectName}-kb-role`,
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: 'Role for Bedrock Knowledge Base to access embeddings, S3, and Pinecone',
    });

    // Permission to call the embedding model
    kbRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${CONFIG.region}::foundation-model/${CONFIG.models.embeddings}`,
      ],
    }));

    // Permission to read documents from our S3 bucket
    kbRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [
        documentBucket.bucketArn,
        `${documentBucket.bucketArn}/*`,
      ],
    }));

    // Permission to read the Pinecone API key from Secrets Manager
    kbRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [
        CONFIG.pinecone.secretArn,
      ],
    }));

    // -------------------------------------------------------
    // 2. The Knowledge Base itself (L1 construct)
    // -------------------------------------------------------
    // This tells Bedrock:
    //   - Which embedding model to use (Titan v2, 1024 dims)
    //   - Where to store vectors (Pinecone, with connection details)
    //   - What role to assume when doing all this
    //
    // Internally, when you later trigger a "sync", Bedrock will:
    //   1. Read each document from S3
    //   2. Parse it (extract text from PDF — tables, headers, body)
    //   3. Chunk the text according to your chunking strategy
    //   4. Send each chunk to Titan v2 → get back a 1024-dim vector
    //   5. Upsert vector + text + metadata into Pinecone

    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: `${CONFIG.projectName}-kb`,
      description: 'Investment analyst knowledge base — annual reports, earnings transcripts, regulatory filings',
      roleArn: kbRole.roleArn,

      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${CONFIG.region}::foundation-model/${CONFIG.models.embeddings}`,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: {
              dimensions: CONFIG.embeddingDimensions,
            },
          },
        },
      },

      storageConfiguration: {
        type: 'PINECONE',
        pineconeConfiguration: {
          connectionString: CONFIG.pinecone.connectionString,
          credentialsSecretArn: CONFIG.pinecone.secretArn,
          fieldMapping: {
            metadataField: 'metadata',
            textField: 'text',
          },
        },
      },
    });

    // Ensure the IAM policy is fully attached before Bedrock tries to use the role.
    // Without this, CloudFormation may create them in parallel and Bedrock fails
    // to read the Pinecone secret during validation.
    knowledgeBase.node.addDependency(kbRole);

    // -------------------------------------------------------
    // 3. Data Source — connects S3 bucket to the Knowledge Base
    // -------------------------------------------------------
    // This tells the Knowledge Base WHERE to find documents.
    // The chunking strategy is configured here, not on the KB itself.
    //
    // We're using SEMANTIC chunking — instead of splitting every N tokens,
    // it uses the embedding model to detect natural breakpoints in the text.
    // This keeps related content together (e.g., a full table row, a complete
    // paragraph about risk factors) rather than cutting mid-sentence.
    //
    // For financial documents this matters: you don't want a balance sheet
    // table split across two chunks — the numbers lose context.

    const dataSource = new bedrock.CfnDataSource(this, 'S3DataSource', {
      name: `${CONFIG.projectName}-reports`,
      description: 'Annual reports, earnings transcripts, and regulatory filings from S3',
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,

      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: documentBucket.bucketArn,
          inclusionPrefixes: ['documents/'],
        },
      },

      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: 'FIXED_SIZE',
          fixedSizeChunkingConfiguration: {
            maxTokens: 512,
            overlapPercentage: 15,
          },
        },
      },
    });

    // -------------------------------------------------------
    // 4. Outputs — we'll need these IDs in the backend
    // -------------------------------------------------------

    this.knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
    this.dataSourceId = dataSource.attrDataSourceId;

    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: knowledgeBase.attrKnowledgeBaseId,
      description: 'Bedrock Knowledge Base ID',
    });

    new cdk.CfnOutput(this, 'DataSourceId', {
      value: dataSource.attrDataSourceId,
      description: 'Knowledge Base Data Source ID',
    });
  }
}