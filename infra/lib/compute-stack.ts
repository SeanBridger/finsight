import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { CONFIG } from './config';

interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

export class ComputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { vpc } = props;

    // PrivateLink endpoints — torn down with Fargate to save costs
    new ec2.InterfaceVpcEndpoint(this, 'BedrockRuntimeEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
      privateDnsEnabled: true,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // Knowledge Base retrieval is a separate service from model inference
    new ec2.InterfaceVpcEndpoint(this, 'BedrockAgentRuntimeEndpoint', {
      vpc,
      service: new ec2.InterfaceVpcEndpointService(
        `com.amazonaws.${CONFIG.region}.bedrock-agent-runtime`, 443
      ),
      privateDnsEnabled: true,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    new ec2.InterfaceVpcEndpoint(this, 'EcrDockerEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      privateDnsEnabled: true,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    new ec2.InterfaceVpcEndpoint(this, 'EcrApiEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      privateDnsEnabled: true,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    new ec2.InterfaceVpcEndpoint(this, 'CloudWatchLogsEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      privateDnsEnabled: true,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

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
      actions: ['bedrock:Retrieve'],
      resources: [
        `arn:aws:bedrock:${CONFIG.region}:${CONFIG.account}:knowledge-base/${CONFIG.knowledgeBaseId}`,
      ],
    }));

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
      },
      portMappings: [{ containerPort: 8000 }],
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: `${CONFIG.projectName}-alb`,
      vpc,
      internetFacing: true,
    });

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