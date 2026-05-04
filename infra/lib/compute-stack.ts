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

    // PrivateLink endpoint for Bedrock Runtime
    // Allows Fargate tasks in private subnets to call Bedrock without internet access
    vpc.addInterfaceEndpoint('BedrockRuntimeEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
      privateDnsEnabled: true,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // ECR endpoints — required for Fargate to pull container images in private subnets
    vpc.addInterfaceEndpoint('EcrDockerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      privateDnsEnabled: true,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    vpc.addInterfaceEndpoint('EcrApiEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      privateDnsEnabled: true,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // CloudWatch Logs — required for Fargate task logging
    vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      privateDnsEnabled: true,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${CONFIG.projectName}-cluster`,
      vpc,
    });

    // IAM role for the Fargate task — scoped to Bedrock invoke only
    const taskRole = new iam.Role(this, 'TaskRole', {
      roleName: `${CONFIG.projectName}-task-role`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Scoped to invoke actions only; resource wildcard needed for inference profile ARN format
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: ['*'],
    }));

    // Task definition — 0.25 vCPU, 0.5 GB RAM (smallest Fargate size)
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      taskRole,
    });

    // Build Docker image from backend/ directory and add as container
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

    // Application Load Balancer — the only public-facing resource
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: `${CONFIG.projectName}-alb`,
      vpc,
      internetFacing: true,
    });

    // Fargate service — runs in private subnets, no public IP
    const service = new ecs.FargateService(this, 'Service', {
      serviceName: `${CONFIG.projectName}-service`,
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      minHealthyPercent: 0,
    });

    // ALB listener forwards HTTP traffic to the Fargate service
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

    // Output the ALB URL so we can test
    new cdk.CfnOutput(this, 'AlbUrl', {
      value: `http://${alb.loadBalancerDnsName}`,
      description: 'Backend ALB URL',
    });
  }
}