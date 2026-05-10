import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { CONFIG } from './config';

interface FrontendStackProps extends cdk.StackProps {
  albDnsName?: string;
}

export class FrontendStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props?: FrontendStackProps) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `${CONFIG.projectName}-frontend-${CONFIG.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const apiOrigin = new origins.HttpOrigin(
      props?.albDnsName ?? 'placeholder.example.com',
      {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        readTimeout: cdk.Duration.seconds(120),
      }
    );

    // Custom cache policy for SSE streaming routes.
    // CACHING_DISABLED enables gzip/brotli encoding which causes
    // CloudFront to buffer the entire response before forwarding.
    // Disabling compression lets chunked SSE events flow through
    // to the browser in real time.
    const streamingCachePolicy = new cloudfront.CachePolicy(this, 'StreamingCachePolicy', {
      cachePolicyName: `${CONFIG.projectName}-streaming`,
      defaultTtl: cdk.Duration.seconds(0),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.seconds(0),
      enableAcceptEncodingGzip: false,
      enableAcceptEncodingBrotli: false,
    });

    const apiDefaults = {
      origin: apiOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    };

    const streamingDefaults = {
      ...apiDefaults,
      cachePolicy: streamingCachePolicy,
    };

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      additionalBehaviors: {
        '/research': { ...apiDefaults },
        '/research/*': { ...streamingDefaults },
        '/health': { ...apiDefaults },
        '/documents/*': { ...apiDefaults },
        '/sessions/*': { ...apiDefaults },
        '/guardrail/*': { ...apiDefaults },
        '/chat': { ...apiDefaults },
        '/metrics*': { ...apiDefaults },
        '/eval/*': { ...apiDefaults },
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset('../frontend/dist')],
      destinationBucket: siteBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'SiteUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'CloudFront URL for FinSight frontend',
    });
  }
}