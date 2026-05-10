export interface RequestMetric {
  timestamp: string;
  question: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  toolCallCount: number;
  toolsUsed: string[];
  iterations: number;
  guardrailBlocked: boolean;
  error: string | null;
}

export interface Aggregates {
  totalRequests: number;
  blockedRequests: number;
  errorRequests: number;
  latency: { p50: number; p95: number; p99: number; avg: number };
  cost: { total: number; avg: number; max: number };
  tokens: {
    totalInput: number;
    totalOutput: number;
    avgInput: number;
    avgOutput: number;
  };
  tools: {
    avgCallsPerRequest: number;
    frequency: Record<string, number>;
  };
}

export interface MetricsData {
  requests: RequestMetric[];
  aggregates: Aggregates;
}

export interface EvalResult {
  id: string;
  question: string;
  category: string;
  relevance: number;
  faithfulness: number;
  reasoning: string;
  latency_s: number;
  tool_calls: string[];
  guardrail_blocked: boolean;
}

export interface EvalData {
  eval_id: string;
  timestamp: string;
  dataset_size: number;
  avg_relevance: number;
  avg_faithfulness: number;
  category_scores: Record<
    string,
    { count: number; avg_relevance: number; avg_faithfulness: number }
  >;
  results: EvalResult[];
}
