#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { DataStack } from '../lib/data-stack';
import { NetworkingStack } from '../lib/networking-stack';
import { CONFIG } from '../lib/config';

const app = new cdk.App();

const env = {
  account: CONFIG.account,
  region: CONFIG.region,
};

new DataStack(app, 'FinsightData', { env });
new NetworkingStack(app, 'FinsightNetworking', { env });