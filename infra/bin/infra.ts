#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { ComputeStack } from '../lib/compute-stack';
import { DataStack } from '../lib/data-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { GuardrailStack } from '../lib/guardrail-stack';
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
const guardrail = new GuardrailStack(app, 'FinsightGuardrail', { env });

const knowledgeBase = new KnowledgeBaseStack(app, 'FinsightKnowledgeBase', {
  env,
  documentBucket: data.documentsBucket,
});

const compute = new ComputeStack(app, 'FinsightCompute', {
  env,
  vpc: networking.vpc,
  documentsBucket: data.documentsBucket,
  documentMetadataTable: data.documentMetadataTable,
  chatHistoryTable: data.chatHistoryTable,
  knowledgeBaseId: knowledgeBase.knowledgeBaseId,
  dataSourceId: knowledgeBase.dataSourceId,
  guardrailId: guardrail.guardrailId,
  guardrailVersion: guardrail.guardrailVersion,
});
compute.addDependency(guardrail);
new FrontendStack(app, 'FinsightFrontend', {
  env,
  albDnsName: compute.albDnsName,
});
