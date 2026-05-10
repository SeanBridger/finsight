import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ActiveTool, Citation, Message } from "../types/research";
import { CitationPanel } from "./CitationPanel";

const TOOL_LABELS: Record<string, string> = {
  search_documents: "Searching documents",
  get_filing_metadata: "Checking available filings",
  extract_metric: "Extracting metric",
  get_section: "Reading section",
  calculate: "Calculating",
  generate_briefing: "Drafting briefing",
};

function formatToolInput(input: Record<string, string>): string {
  if (input.operation) {
    return [input.label, `${input.a} ${input.operation} ${input.b}`].filter(Boolean).join(" — ");
  }
  const parts = [
    input.company,
    input.metric_name,
    input.section_name,
    input.query,
    input.period,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "";
}

interface Props {
  message: Message;
  activeTool?: ActiveTool | null;
  onCitationClick?: (citation: Citation) => void;
}

export function MessageBubble({ message, activeTool, onCitationClick }: Props) {
  const isUser = message.role === "user";
  const [showTools, setShowTools] = useState(false);

  if (message.isGuardrailBlocked) {
    return (
      <div className="flex justify-start">
        <div className="flex max-w-[75%] items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 ${
          isUser ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-900"
        }`}
      >
        <div className="text-sm leading-relaxed">
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                ul: ({ children }) => <ul className="mb-3 ml-4 list-disc">{children}</ul>,
                ol: ({ children }) => <ol className="mb-3 ml-4 list-decimal">{children}</ol>,
                li: ({ children }) => <li className="mb-1">{children}</li>,
                hr: () => <hr className="my-4 border-gray-200" />,
                table: ({ children }) => (
                  <div className="my-3 overflow-x-auto">
                    <table className="w-full text-xs border-collapse">{children}</table>
                  </div>
                ),
                thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
                th: ({ children }) => (
                  <th className="border border-gray-200 px-3 py-1.5 text-left font-semibold">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-gray-200 px-3 py-1.5">{children}</td>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          )}

          {message.isStreaming && !message.content && !activeTool && (
            <div className="flex items-center gap-2 py-2 text-xs text-gray-500">
              <span className="inline-block h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
              <span>{message.toolsUsed ? "Generating answer…" : "Analysing question…"}</span>
            </div>
          )}

          {message.isStreaming && activeTool && (
            <div className="flex items-center gap-2 py-2 text-xs text-gray-500">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <span>
                {TOOL_LABELS[activeTool.tool] || activeTool.tool}
                {formatToolInput(activeTool.input) && ` — ${formatToolInput(activeTool.input)}`}
              </span>
            </div>
          )}

          {message.isStreaming && !activeTool && message.content && (
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-blue-500 animate-pulse rounded-sm" />
          )}
        </div>

        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 border-t border-gray-100 pt-2">
            <button
              onClick={() => setShowTools(!showTools)}
              className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showTools ? "▾" : "▸"} {message.toolCalls.length} tool{" "}
              {message.toolCalls.length === 1 ? "call" : "calls"}
            </button>
            {showTools && (
              <div className="mt-1 space-y-1">
                {message.toolCalls.map((tc, i) => (
                  <div key={i} className="text-[10px] text-gray-400 font-mono">
                    {tc.tool}({formatToolInput(tc.input)}) → {tc.result_summary}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!isUser && message.citations && (
          <CitationPanel
            citations={message.citations}
            isGrounded={message.isGrounded ?? false}
            onCitationClick={onCitationClick}
          />
        )}

        {!isUser && message.tokenUsage && (
          <div className="mt-2 text-[10px] text-gray-400">
            {message.tokenUsage.input + message.tokenUsage.output} tokens
          </div>
        )}
      </div>
    </div>
  );
}
