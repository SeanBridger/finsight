import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { CONFIG } from './config';

export class DataStack extends cdk.Stack {
  public readonly documentsBucket: s3.Bucket;
  public readonly documentMetadataTable: dynamodb.Table;
  public readonly chatHistoryTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: `${CONFIG.projectName}-documents-${CONFIG.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: [
            'https://di3wfr20hx7a2.cloudfront.net',
            'http://localhost:5173',
          ],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 300,
        },
      ],
    });

    this.documentMetadataTable = new dynamodb.Table(this, 'DocumentMetadataTable', {
      tableName: `${CONFIG.projectName}-document-metadata`,
      partitionKey: { name: 'documentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.documentMetadataTable.addGlobalSecondaryIndex({
      indexName: 'all-documents',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'uploadedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.chatHistoryTable = new dynamodb.Table(this, 'ChatHistoryTable', {
      tableName: `${CONFIG.projectName}-chat-history`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}