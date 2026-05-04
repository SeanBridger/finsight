#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { ComputeStack } from '../lib/compute-stack';
import { DataStack } from '../lib/data-stack';
import { NetworkingStack } from '../lib/networking-stack';
import { CONFIG } from '../lib/config';

const app = new cdk.App();

const env = {
  account: CONFIG.account,
  region: CONFIG.region,
};

const networking = new NetworkingStack(app, 'FinsightNetworking', { env });

new ComputeStack(app, 'FinsightCompute', { env, vpc: networking.vpc });
new DataStack(app, 'FinsightData', { env });