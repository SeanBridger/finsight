#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🧹 Tearing down billable FinSight resources..."
cd "$SCRIPT_DIR/../infra"

echo "💰 Destroying billable stacks (Compute, Frontend, Monitoring)..."
npx cdk destroy FinsightCompute FinsightFrontend FinsightMonitoring --force

echo ""
echo "💰 Deleting PrivateLink endpoints (billed hourly even when idle)..."
REGION="us-east-1"
ENDPOINT_IDS=$(aws ec2 describe-vpc-endpoints \
  --region "$REGION" \
  --filters "Name=vpc-endpoint-type,Values=Interface" \
  --query 'VpcEndpoints[?State!=`deleted`].VpcEndpointId' \
  --output text 2>/dev/null || echo "")

if [ -n "$ENDPOINT_IDS" ]; then
  echo "   Deleting: $ENDPOINT_IDS"
  aws ec2 delete-vpc-endpoints --region "$REGION" --vpc-endpoint-ids $ENDPOINT_IDS
  echo "   ✅ Endpoints deleted (CDK will recreate them on next deploy)"
else
  echo "   ✅ No interface endpoints found"
fi

echo ""
echo "🧹 Cleaning up orphaned CloudWatch log groups..."
for prefix in "/aws/lambda/Finsight" "/ecs/finsight"; do
  for lg in $(aws logs describe-log-groups \
    --region "$REGION" \
    --log-group-name-prefix "$prefix" \
    --query 'logGroups[*].logGroupName' \
    --output text 2>/dev/null); do
    echo "   Deleting: $lg"
    aws logs delete-log-group --region "$REGION" --log-group-name "$lg"
  done
done
echo "   ✅ Log groups cleaned"

echo ""
echo "⚠️  Data, Networking, Guardrail, and KnowledgeBase stacks are NOT destroyed (free/pennies)."
echo "   To destroy everything: npx cdk destroy --all --force"

echo ""
echo "🔍 Running post-teardown verification..."
"$SCRIPT_DIR/verify-teardown.sh"
