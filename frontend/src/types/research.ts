export interface Citation {
  source: string;
  s3_uri: string;
  relevance_score: number;
  text: string;
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

export interface DoneEvent {
  type: "done";
  token_usage: {
    input: number;
    output: number;
  };
}

export type SSEEvent = CitationsEvent | DeltaEvent | DoneEvent;

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  isGrounded?: boolean;
  tokenUsage?: { input: number; output: number };
  isStreaming?: boolean;
}
