import { useState, type FormEvent } from "react";

interface Props {
  onSend: (message: string) => void;
  isStreaming: boolean;
  onStop: () => void;
}

export function ChatInput({ onSend, isStreaming, onStop }: Props) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setInput("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-3 p-4 border-t border-gray-200">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Ask about HSBC, Barclays, or Lloyds annual reports..."
        className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        disabled={isStreaming}
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white
            hover:bg-red-700 transition-colors"
        >
          Stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={!input.trim()}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white
            hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      )}
    </form>
  );
}
