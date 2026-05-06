import type { Citation } from "../types/research";

interface Props {
  citations: Citation[];
  isGrounded: boolean;
  onCitationClick?: (citation: Citation) => void;
}

export function CitationPanel({ citations, isGrounded, onCitationClick }: Props) {
  if (citations.length === 0) return null;

  // Group citations by source document
  const grouped = citations.reduce<Record<string, Citation[]>>((acc, c) => {
    const name = c.source.replace(".pdf", "");
    if (!acc[name]) acc[name] = [];
    acc[name].push(c);
    return acc;
  }, {});

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            isGrounded ? "bg-green-500" : "bg-amber-500"
          }`}
        />
        <span className="text-xs font-medium text-gray-500">
          {isGrounded
            ? `Grounded in ${citations.length} passage${citations.length !== 1 ? "s" : ""}`
            : "Low confidence"}
        </span>
      </div>
      {Object.entries(grouped).map(([name, chunks]) => (
        <div key={name} className="mb-2 last:mb-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <svg
              className="h-3 w-3 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span className="text-xs text-gray-600">{name}</span>
          </div>
          <div className="flex gap-1.5 ml-[18px]">
            {chunks.map((c, i) => (
              <button
                key={i}
                onClick={() => onCitationClick?.(c)}
                className="flex h-5 w-5 items-center justify-center rounded bg-gray-100
                  text-[10px] font-medium text-gray-600 hover:bg-blue-50
                  hover:text-blue-700 transition-colors cursor-pointer"
                title={`Passage ${i + 1} — relevance ${(c.relevance_score * 100).toFixed(0)}%`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
