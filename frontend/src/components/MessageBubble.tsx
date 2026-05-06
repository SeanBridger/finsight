import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Citation, Message } from "../types/research";
import { CitationPanel } from "./CitationPanel";

interface Props {
  message: Message;
  onCitationClick?: (citation: Citation) => void;
}

export function MessageBubble({ message, onCitationClick }: Props) {
  const isUser = message.role === "user";

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
          {message.isStreaming && (
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-blue-500 animate-pulse rounded-sm" />
          )}
        </div>

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
