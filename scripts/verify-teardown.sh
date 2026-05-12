#!/bin/bash
# FinSight — Post-Teardown Verification Script
# Run after every `cdk destroy` to catch orphaned resources that cost money.
# Usage: ./scripts/verify-teardown.sh [region]

set -euo pipefail

REGION="${1:-us-east-1}"
BILLABLE_ISSUES=0

red()    { echo -e "\033[0;31m$1\033[0m"; }
green()  { echo -e "\033[0;32m$1\033[0m"; }
yellow() { echo -e "\033[0;33m$1\033[0m"; }
dim()    { echo -e "\033[0;90m$1\033[0m"; }

check_billable() {
  local label="$1"
  local result="$2"
  if [ -z "$result" ] || [ "$result" = "None" ]; then
    green "  ✓ $label — clean"
  else
    red "  ✗ $label — STILL RUNNING (costs money!):"
    echo "    $result"
    BILLABLE_ISSUES=$((BILLABLE_ISSUES + 1))
  fi
}

check_free() {
  local label="$1"
  local result="$2"
  if [ -z "$result" ] || [ "$result" = "None" ]; then
    green "  ✓ $label — clean"
  else
    dim "  ○ $label — exists (free/pennies, expected):"
    dim "    $result"
  fi
}

echo ""
echo "============================================"
echo " FinSight Teardown Verification"
echo " Region: $REGION"
echo " $(date)"
echo "============================================"
echo ""

# -------------------------------------------------------------------
# 💰 BILLABLE — these cost real money per hour if left running
# -------------------------------------------------------------------
yellow "━━━ BILLABLE (hourly cost) ━━━"

yellow "▸ VPC Endpoints (PrivateLink) — \$0.01/hr/endpoint/AZ"
ENDPOINTS=$(aws ec2 describe-vpc-endpoints \
  --region "$REGION" \
  --query 'VpcEndpoints[?State!=`deleted`].[VpcEndpointId,ServiceName,State]' \
  --output text 2>/dev/null || echo "")
check_billable "VPC Interface Endpoints" "$ENDPOINTS"

yellow "▸ NAT Gateways — \$0.045/hr"
NATGW=$(aws ec2 describe-nat-gateways \
  --region "$REGION" \
  --query 'NatGateways[?State!=`deleted` && State!=`failed`].[NatGatewayId,State]' \
  --output text 2>/dev/null || echo "")
check_billable "NAT Gateways" "$NATGW"

yellow "▸ Load Balancers — ~\$0.02/hr"
ALBS=$(aws elbv2 describe-load-balancers \
  --region "$REGION" \
  --query 'LoadBalancers[*].[LoadBalancerName,State.Code]' \
  --output text 2>/dev/null || echo "")
check_billable "Application/Network Load Balancers" "$ALBS"

yellow "▸ ECS Tasks (Fargate) — \$0.01+/hr"
for cluster in $(aws ecs list-clusters --region "$REGION" --query 'clusterArns[*]' --output text 2>/dev/null); do
  TASKS=$(aws ecs list-tasks --region "$REGION" --cluster "$cluster" --query 'taskArns[*]' --output text 2>/dev/null || echo "")
  check_billable "ECS Tasks in $(basename "$cluster")" "$TASKS"
done

yellow "▸ EC2 Instances"
EC2=$(aws ec2 describe-instances \
  --region "$REGION" \
  --filters "Name=instance-state-name,Values=running,stopped" \
  --query 'Reservations[*].Instances[*].[InstanceId,State.Name,InstanceType]' \
  --output text 2>/dev/null || echo "")
check_billable "EC2 Instances" "$EC2"

yellow "▸ RDS / Aurora"
RDS=$(aws rds describe-db-instances \
  --region "$REGION" \
  --query 'DBInstances[*].[DBInstanceIdentifier,DBInstanceStatus]' \
  --output text 2>/dev/null || echo "")
check_billable "RDS Instances" "$RDS"
RDS_CLUSTERS=$(aws rds describe-db-clusters \
  --region "$REGION" \
  --query 'DBClusters[*].[DBClusterIdentifier,Status]' \
  --output text 2>/dev/null || echo "")
check_billable "RDS Clusters (Aurora)" "$RDS_CLUSTERS"

yellow "▸ Elastic IPs — \$0.005/hr if unattached"
EIPS=$(aws ec2 describe-addresses \
  --region "$REGION" \
  --query 'Addresses[?AssociationId==null].[PublicIp,AllocationId]' \
  --output text 2>/dev/null || echo "")
check_billable "Unattached Elastic IPs" "$EIPS"

echo ""

# -------------------------------------------------------------------
# 🆓 FREE / PENNIES — expected to persist between sessions
# -------------------------------------------------------------------
yellow "━━━ FREE / PENNIES (expected to stay) ━━━"

check_free "VPCs (non-default)" "$(aws ec2 describe-vpcs \
  --region "$REGION" \
  --query 'Vpcs[?IsDefault==`false`].[VpcId,Tags[?Key==`Name`].Value|[0]]' \
  --output text 2>/dev/null || echo "")"

check_free "S3 Buckets" "$(aws s3api list-buckets \
  --query 'Buckets[?contains(Name,`finsight`)].Name' \
  --output text 2>/dev/null || echo "")"

check_free "DynamoDB Tables" "$(aws dynamodb list-tables \
  --region "$REGION" \
  --query 'TableNames' \
  --output text 2>/dev/null || echo "")"

check_free "Lambda Functions (CDK custom resources)" "$(aws lambda list-functions \
  --region "$REGION" \
  --query 'Functions[*].FunctionName' \
  --output text 2>/dev/null || echo "")"

check_free "ECR Repositories" "$(aws ecr describe-repositories \
  --region "$REGION" \
  --query 'repositories[*].repositoryName' \
  --output text 2>/dev/null || echo "")"

check_free "Secrets Manager (\$0.40/mo)" "$(aws secretsmanager list-secrets \
  --region "$REGION" \
  --query 'SecretList[*].Name' \
  --output text 2>/dev/null || echo "")"

check_free "Bedrock Guardrails" "$(aws bedrock list-guardrails \
  --region "$REGION" \
  --query 'guardrails[*].[name,id]' \
  --output text 2>/dev/null || echo "")"

check_free "CloudWatch Log Groups" "$(aws logs describe-log-groups \
  --region "$REGION" \
  --log-group-name-prefix "/aws/lambda/Finsight" \
  --query 'logGroups[*].logGroupName' \
  --output text 2>/dev/null || echo "")"

check_free "ECS Clusters (empty)" "$(aws ecs list-clusters \
  --region "$REGION" \
  --query 'clusterArns[*]' \
  --output text 2>/dev/null || echo "")"

# -------------------------------------------------------------------
# SUMMARY
# -------------------------------------------------------------------
echo ""
echo "============================================"
if [ $BILLABLE_ISSUES -eq 0 ]; then
  green " ✓ ALL CLEAR — nothing billable running"
  dim "   (Free-tier resources above are expected and safe to leave)"
else
  red " ✗ FOUND $BILLABLE_ISSUES BILLABLE RESOURCE(S) STILL RUNNING"
  red "   Delete them before closing your laptop!"
fi
echo "============================================"
echo ""