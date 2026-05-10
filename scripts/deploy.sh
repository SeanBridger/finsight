#!/bin/bash
set -e

echo "🚀 Deploying FinSight infrastructure..."
cd "$(dirname "$0")/../infra"

echo "📦 Deploying all stacks..."
npx cdk deploy --all --require-approval never "$@"

echo "✅ All stacks deployed."