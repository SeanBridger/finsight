import * as cdk from 'aws-cdk-lib/core';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { CONFIG } from './config';

interface MonitoringStackProps extends cdk.StackProps {
  alertEmail?: string;
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps = {}) {
    super(scope, id, props);

    const namespace = 'FinSight';

    // SNS topic for alarm notifications
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${CONFIG.projectName}-alarms`,
      displayName: 'FinSight LLMOps Alarms',
    });

    // Subscribe email if provided
    if (props.alertEmail) {
      alarmTopic.addSubscription(
        new subscriptions.EmailSubscription(props.alertEmail)
      );
    }

    const snsAction = new actions.SnsAction(alarmTopic);

    // --- Alarm 1: High latency (agent stuck in loop) ---
    const latencyAlarm = new cloudwatch.Alarm(this, 'HighLatencyAlarm', {
      alarmName: `${CONFIG.projectName}-high-latency`,
      alarmDescription:
        'P95 request latency exceeded 30s — possible agent loop or Bedrock throttling',
      metric: new cloudwatch.Metric({
        namespace,
        metricName: 'RequestLatencyMs',
        statistic: 'p95',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 30000, // 30 seconds
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    latencyAlarm.addAlarmAction(snsAction);

    // --- Alarm 2: Cost spike (runaway tool chains) ---
    const costAlarm = new cloudwatch.Alarm(this, 'CostSpikeAlarm', {
      alarmName: `${CONFIG.projectName}-cost-spike`,
      alarmDescription:
        'Total request cost exceeded $1 in 5 minutes — runaway agentic chain or unexpected traffic',
      metric: new cloudwatch.Metric({
        namespace,
        metricName: 'RequestCostUSD',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1.0, // $1 in 5 minutes
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    costAlarm.addAlarmAction(snsAction);

    // --- Alarm 3: Errors (Bedrock failures, guardrail issues) ---
    const errorAlarm = new cloudwatch.Alarm(this, 'ErrorRateAlarm', {
      alarmName: `${CONFIG.projectName}-errors`,
      alarmDescription:
        'Errors detected — Bedrock invocation failure, timeout, or unhandled exception',
      metric: new cloudwatch.Metric({
        namespace,
        metricName: 'ErrorCount',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 3, // 3 errors in 5 minutes
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    errorAlarm.addAlarmAction(snsAction);

    // --- Outputs ---
    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'SNS topic for LLMOps alarms',
    });
  }
}