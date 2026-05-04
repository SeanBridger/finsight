#!/bin/bash
set -e

echo "🧹 Tearing down billable FinSight resources..."
cd "$(dirname "$0")/../infra"

echo "💰 Destroying compute stack (Fargate, ALB, PrivateLink endpoints)..."
npx cdk destroy FinsightCompute --force

echo "⚠️  Data and Networking stacks are NOT destroyed (free/pennies)."
echo "   To destroy everything: npx cdk destroy --all"

echo "✅ Teardown complete."