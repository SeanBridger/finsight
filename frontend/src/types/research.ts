export interface Citation {
  source: string;
  s3_uri?: string;
  relevance_score: number;
  text: string;
}

export interface ToolCall {
  tool: string;
  input: Record<string, string>;
  result_summary: string;
  iteration: number;
}

export interface CitationsEvent {
  type: "citations";
  citations: Citation[];
  is_grounded: boolean;
}

export interface DeltaEvent {
  type: "delta";
  text: string;
}

export interface ToolCallEvent {
  type: "tool_call";
  tool: string;
  input: Record<string, string>;
  iteration: number;
}

export interface ToolResultEvent {
  type: "tool_result";
  tool: string;
  summary: string;
}

export interface DoneEvent {
  type: "done";
  tool_calls?: ToolCall[];
  iterations?: number;
  token_usage: {
    input: number;
    output: number;
  };
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type SSEEvent =
  | CitationsEvent
  | DeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | DoneEvent
  | ErrorEvent;

export interface ActiveTool {
  tool: string;
  input: Record<string, string>;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  isGrounded?: boolean;
  tokenUsage?: { input: number; output: number };
  toolCalls?: ToolCall[];
  toolsUsed?: boolean;
  isStreaming?: boolean;
}

export interface Document {
  documentId: string;
  filename: string;
  s3Key: string;
  company: string;
  docType: string;
  period: string;
  status: "uploading" | "uploaded" | "ingesting" | "ready" | "failed";
  uploadedAt: string;
}