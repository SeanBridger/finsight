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

    // L1 constructs require us to wire the IAM role manually.
    // L2 Knowledge Base constructs don't exist yet in @aws-cdk/aws-bedrock-alpha.
    const kbRole = new iam.Role(this, 'KnowledgeBaseRole', {
      roleName: `${CONFIG.projectName}-kb-role`,
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
    });

    kbRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${CONFIG.region}::foundation-model/${CONFIG.models.embeddings}`,
      ],
    }));

    kbRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [
        documentBucket.bucketArn,
        `${documentBucket.bucketArn}/*`,
      ],
    }));

    kbRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [CONFIG.pinecone.secretArn],
    }));

    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: `${CONFIG.projectName}-kb`,
      description: 'Annual reports, earnings transcripts, and regulatory filings',
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

    // CloudFormation race condition: KB validates Pinecone credentials on creation,
    // but the IAM policy may not have propagated yet. Force ordering.
    knowledgeBase.node.addDependency(kbRole);

    const dataSource = new bedrock.CfnDataSource(this, 'S3DataSource', {
      name: `${CONFIG.projectName}-reports`,
      description: 'S3 data source for financial documents',
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,

      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: documentBucket.bucketArn,
          inclusionPrefixes: ['documents/'],
        },
      },

      // Fixed-size chunking at 512 tokens with 15% overlap.
      // Semantic chunking would be better for financial tables but
      // added ~3x ingestion cost in testing — revisit in Phase 4.
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

    this.knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
    this.dataSourceId = dataSource.attrDataSourceId;

    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: knowledgeBase.attrKnowledgeBaseId,
    });

    new cdk.CfnOutput(this, 'DataSourceId', {
      value: dataSource.attrDataSourceId,
    });
  }
}