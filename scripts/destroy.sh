#!/bin/bash
set -e

echo "🧹 Tearing down billable FinSight resources..."
cd "$(dirname "$0")/../infra"

echo "💰 Destroying billable stacks (Compute, Frontend, Monitoring)..."
npx cdk destroy FinsightCompute FinsightFrontend FinsightMonitoring --force

echo "⚠️  Data, Networking, Guardrail, and KnowledgeBase stacks are NOT destroyed (free/pennies)."
echo "   To destroy everything: npx cdk destroy --all --force"

echo "✅ Teardown complete."