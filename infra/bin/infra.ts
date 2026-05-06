#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { ComputeStack } from '../lib/compute-stack';
import { DataStack } from '../lib/data-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { KnowledgeBaseStack } from '../lib/knowledge-base-stack';
import { NetworkingStack } from '../lib/networking-stack';
import { CONFIG } from '../lib/config';

const app = new cdk.App();

const env = {
  account: CONFIG.account,
  region: CONFIG.region,
};

const networking = new NetworkingStack(app, 'FinsightNetworking', { env });
const data = new DataStack(app, 'FinsightData', { env });
const compute = new ComputeStack(app, 'FinsightCompute', {
  env,
  vpc: networking.vpc,
  documentsBucket: data.documentsBucket,
  documentMetadataTable: data.documentMetadataTable,
});

new KnowledgeBaseStack(app, 'FinsightKnowledgeBase', {
  env,
  documentBucket: data.documentsBucket,
});
new FrontendStack(app, 'FinsightFrontend', {
  env,
  albDnsName: compute.albDnsName,
});