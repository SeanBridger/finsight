import * as cdk from 'aws-cdk-lib/core';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { CONFIG } from './config';

interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  documentsBucket: s3.IBucket;
  documentMetadataTable: dynamodb.ITable;
  chatHistoryTable: dynamodb.ITable;
  knowledgeBaseId: string;
  dataSourceId: string;
  guardrailId: string;
  guardrailVersion: string;
}

export class ComputeStack extends cdk.Stack {
  public readonly albDnsName: string;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { vpc, documentsBucket, documentMetadataTable, chatHistoryTable } = props;

    // VPC endpoints now live in NetworkingStack — created once, always available.
    // No more DNS conflict race conditions on deploy/destroy cycles.

    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${CONFIG.projectName}-cluster`,
      vpc,
    });

    const taskRole = new iam.Role(this, 'TaskRole', {
      roleName: `${CONFIG.projectName}-task-role`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Model inference — scoped to specific models
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        `arn:aws:bedrock:${CONFIG.region}::foundation-model/${CONFIG.models.embeddings}`,
        `arn:aws:bedrock:${CONFIG.region}:${CONFIG.account}:inference-profile/${CONFIG.models.chat}`,
        `arn:aws:bedrock:${CONFIG.region}:${CONFIG.account}:inference-profile/${CONFIG.models.chatCheap}`,
        // Cross-region inference profiles can route to any US region
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6',
        'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
      ],
    }));

    // Knowledge Base retrieval — scoped to our specific KB
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:GetIngestionJob', 'bedrock:Retrieve'],
      resources: [
        `arn:aws:bedrock:${CONFIG.region}:${CONFIG.account}:knowledge-base/${props.knowledgeBaseId}`,
      ],
    }));

    // Guardrail invocation — applied during Converse calls
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:ApplyGuardrail'],
      resources: [
        `arn:aws:bedrock:${CONFIG.region}:${CONFIG.account}:guardrail/*`,
      ],
    }));

    // S3 — presigned upload/download URLs
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: [`${documentsBucket.bucketArn}/documents/*`],
    }));

    // DynamoDB — document metadata CRUD
    documentMetadataTable.grantReadWriteData(taskRole);
    chatHistoryTable.grantReadWriteData(taskRole);

    // Lambda log group — explicit so CDK owns it and destroys it cleanly
    const syncLogGroup = new logs.LogGroup(this, 'SyncFunctionLogGroup', {
      logGroupName: '/aws/lambda/finsight-kb-sync',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda for KB sync — runs outside VPC so Bedrock can validate Pinecone
    const syncFunction = new lambda.Function(this, 'SyncFunction', {
      functionName: `${CONFIG.projectName}-kb-sync`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import boto3
import json

bedrock_agent = boto3.client('bedrock-agent')

def handler(event, context):
    try:
        response = bedrock_agent.start_ingestion_job(
            knowledgeBaseId=event['knowledge_base_id'],
            dataSourceId=event['data_source_id'],
            description=event.get('description', 'Sync from FinSight'),
        )
        job = response['ingestionJob']
        return {
            'statusCode': 200,
            'body': json.dumps({
                'ingestion_job_id': job['ingestionJobId'],
                'status': job['status'],
            }),
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)}),
        }
`),
      timeout: cdk.Duration.seconds(30),
      logGroup: syncLogGroup,
    });

    syncFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:StartIngestionJob',
        'bedrock:AssociateThirdPartyKnowledgeBase',
      ],
      resources: [
        `arn:aws:bedrock:${CONFIG.region}:${CONFIG.account}:knowledge-base/${props.knowledgeBaseId}`,
      ],
    }));

    syncFunction.grantInvoke(taskRole);

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      taskRole,
    });

    taskDef.addContainer('BackendContainer', {
      image: ecs.ContainerImage.fromAsset('../backend'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: CONFIG.projectName,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        AWS_DEFAULT_REGION: CONFIG.region,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        DOCUMENT_METADATA_TABLE: documentMetadataTable.tableName,
        CHAT_HISTORY_TABLE: chatHistoryTable.tableName,
        KNOWLEDGE_BASE_ID: props.knowledgeBaseId,
        DATA_SOURCE_ID: props.dataSourceId,
        SYNC_FUNCTION_NAME: syncFunction.functionName,
        GUARDRAIL_ID: props.guardrailId,
        GUARDRAIL_VERSION: props.guardrailVersion,
      },
      portMappings: [{ containerPort: 8000 }],
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: `${CONFIG.projectName}-alb`,
      vpc,
      internetFacing: true,
    });

    alb.setAttribute('idle_timeout.timeout_seconds', '120');

    this.albDnsName = alb.loadBalancerDnsName;

    const service = new ecs.FargateService(this, 'Service', {
      serviceName: `${CONFIG.projectName}-service`,
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      minHealthyPercent: 0,
    });

    const listener = alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    listener.addTargets('BackendTarget', {
      port: 8000,
      targets: [service],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    new cdk.CfnOutput(this, 'AlbUrl', {
      value: `http://${alb.loadBalancerDnsName}`,
      description: 'Backend ALB URL',
    });
  }
}
