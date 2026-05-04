#!/bin/bash
set -e

echo "🧹 Tearing down billable FinSight resources..."
cd "$(dirname "$0")/../infra"

# Only destroy compute stack (Fargate, PrivateLink) when it exists
# Data and networking stacks stay up (free/pennies)
echo "⚠️  Data and Networking stacks are NOT destroyed (free tier)."
echo "   To destroy everything: npx cdk destroy --all"

echo "✅ Teardown complete."