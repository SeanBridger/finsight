#!/bin/bash
set -e

echo "🚀 Deploying FinSight infrastructure..."
cd "$(dirname "$0")/../infra"

echo "📦 Deploying data stack (S3, DynamoDB)..."
npx cdk deploy FinsightData --require-approval never

echo "🌐 Deploying networking stack (VPC, endpoints)..."
npx cdk deploy FinsightNetworking --require-approval never

echo "✅ All stacks deployed."