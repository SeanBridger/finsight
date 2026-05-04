#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { NetworkingStack } from '../lib/networking-stack';
import { CONFIG } from '../lib/config';

const app = new cdk.App();

const env = {
  account: CONFIG.account,
  region: CONFIG.region,
};

new NetworkingStack(app, 'FinsightNetworking', { env });