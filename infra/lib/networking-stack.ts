import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { CONFIG } from './config';

export class NetworkingStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `${CONFIG.projectName}-vpc`,
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Gateway endpoints — free, always-on
    // These route traffic to S3 and DynamoDB over AWS's internal network
    // instead of requiring internet access from private subnets
    this.vpc.addGatewayEndpoint('S3GatewayEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    this.vpc.addGatewayEndpoint('DynamoDbGatewayEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // ── Interface endpoints (PrivateLink) ──────────────────────────
    // Moved here from ComputeStack so they're created once and never
    // torn down/recreated. Eliminates DNS conflict race conditions.
    // Cost: ~$0.01/hr each — pennies when idle, and they persist
    // across compute stack deploys.

    const privateSubnets = { subnetType: ec2.SubnetType.PRIVATE_ISOLATED };

    new ec2.InterfaceVpcEndpoint(this, 'BedrockRuntimeEndpoint', {
      vpc: this.vpc,
      service: ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
      privateDnsEnabled: true,
      subnets: privateSubnets,
    });

    new ec2.InterfaceVpcEndpoint(this, 'BedrockAgentRuntimeEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(
        `com.amazonaws.${CONFIG.region}.bedrock-agent-runtime`, 443
      ),
      privateDnsEnabled: true,
      subnets: privateSubnets,
    });

    new ec2.InterfaceVpcEndpoint(this, 'BedrockAgentEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(
        `com.amazonaws.${CONFIG.region}.bedrock-agent`, 443
      ),
      privateDnsEnabled: true,
      subnets: privateSubnets,
    });

    new ec2.InterfaceVpcEndpoint(this, 'EcrDockerEndpoint', {
      vpc: this.vpc,
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      privateDnsEnabled: true,
      subnets: privateSubnets,
    });

    new ec2.InterfaceVpcEndpoint(this, 'EcrApiEndpoint', {
      vpc: this.vpc,
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      privateDnsEnabled: true,
      subnets: privateSubnets,
    });

    new ec2.InterfaceVpcEndpoint(this, 'CloudWatchLogsEndpoint', {
      vpc: this.vpc,
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      privateDnsEnabled: true,
      subnets: privateSubnets,
    });

    new ec2.InterfaceVpcEndpoint(this, 'CloudWatchMonitoringEndpoint', {
      vpc: this.vpc,
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING,
      privateDnsEnabled: true,
      subnets: privateSubnets,
    });

    new ec2.InterfaceVpcEndpoint(this, 'LambdaEndpoint', {
      vpc: this.vpc,
      service: ec2.InterfaceVpcEndpointAwsService.LAMBDA,
      privateDnsEnabled: true,
      subnets: privateSubnets,
    });
  }
}
