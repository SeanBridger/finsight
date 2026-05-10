import * as cdk from 'aws-cdk-lib/core';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { Construct } from 'constructs';

export class GuardrailStack extends cdk.Stack {
  public readonly guardrailId: string;
  public readonly guardrailVersion: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const guardrail = new bedrock.CfnGuardrail(this, 'AnalystGuardrail', {
      name: 'finsight-analyst-guardrail',
      description:
        'Guardrails for FinSight investment analyst copilot. ' +
        'Restricts to financial document analysis, blocks investment advice, ' +
        'filters harmful content, detects prompt injection.',

      blockedInputMessaging:
        'Your request was blocked by our safety controls. ' +
        'FinSight is designed for financial document analysis only. ' +
        'Please rephrase your question to focus on the uploaded annual reports, ' +
        'earnings transcripts, or regulatory filings.',

      blockedOutputsMessaging:
        'The response was blocked by our safety controls. ' +
        'FinSight can only provide answers grounded in the uploaded financial documents.',

      // ── Content filters ──────────────────────────────────────────
      contentPolicyConfig: {
        filtersConfig: [
          { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'INSULTS', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          // Prompt attack: detect on input, don't flag output
          // (output=NONE avoids false positives when Claude discusses security)
          { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
        ],
      },

      // ── Topic denial ─────────────────────────────────────────────
      topicPolicyConfig: {
        topicsConfig: [
          {
            name: 'InvestmentAdvice',
            definition:
              'Specific investment recommendations, buy/sell/hold advice, portfolio allocation, ' +
              'trading strategies, or personal recommendations about securities.',
            type: 'DENY',
            examples: [
              'Should I buy HSBC shares?',
              'Is Barclays a good investment right now?',
              'What stocks should I add to my portfolio?',
              'Should I sell my Lloyds position?',
              'Give me a trading strategy for bank stocks',
            ],
          },
          {
            name: 'PersonalFinance',
            definition:
              'Personal financial planning, tax, mortgage, pension, savings, or other individual ' +
              'financial decisions unrelated to corporate filing analysis.',
            type: 'DENY',
            examples: [
              'How should I save for retirement?',
              'What mortgage rate should I get?',
              'Help me with my tax return',
              'How much should I put in my ISA?',
            ],
          },
        ],
      },

      // ── Word filters ─────────────────────────────────────────────
      wordPolicyConfig: {
        wordsConfig: [
          { text: 'buy rating' },
          { text: 'sell rating' },
          { text: 'hold rating' },
          { text: 'strong buy' },
          { text: 'strong sell' },
          { text: 'price target' },
          { text: 'investment recommendation' },
          { text: 'financial advice' },
          { text: 'you should invest' },
          { text: 'I recommend buying' },
          { text: 'I recommend selling' },
        ],
        managedWordListsConfig: [{ type: 'PROFANITY' }],
      },
    });

    // ── PROMPT_ATTACK CDK bug workaround ─────────────────────────
    // CDK L1 can override NONE → HIGH for PROMPT_ATTACK outputStrength.
    // Force correct values via CloudFormation escape hatch.
    guardrail.addOverride(
      'Properties.ContentPolicyConfig.FiltersConfig.5.OutputStrength',
      'NONE',
    );

    const version = new bedrock.CfnGuardrailVersion(this, 'GuardrailV2', {
      guardrailIdentifier: guardrail.attrGuardrailId,
      description: 'v2 — content filters, word filters, prompt attack detection, financial advice denial',
    });

    this.guardrailId = guardrail.attrGuardrailId;
    this.guardrailVersion = version.attrVersion;

    new cdk.CfnOutput(this, 'GuardrailId', {
      value: guardrail.attrGuardrailId,
      description: 'Bedrock Guardrail ID',
    });

    new cdk.CfnOutput(this, 'GuardrailVersionNumber', {
      value: version.attrVersion,
      description: 'Published guardrail version number',
    });
  }
}
