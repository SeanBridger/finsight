import { useEffect, useState } from "react";
import type { Citation } from "../types/research";

interface Props {
  citation: Citation;
  onClose: () => void;
}

export function CitationDrawer({ citation, onClose }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setOpen(true));
  }, []);

  const handleClose = () => {
    setOpen(false);
    setTimeout(onClose, 200);
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={handleClose}
      />
      <div
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-md border-l border-gray-200
          bg-white shadow-xl flex flex-col transition-transform duration-200 ease-out ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Source Document</h2>
            <p className="mt-0.5 text-xs text-gray-500">{citation.source.replace(".pdf", "")}</p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs text-gray-500">
              Relevance: {(citation.relevance_score * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
            Retrieved passage
          </p>
          <div className="text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
            {citation.text}
          </div>
        </div>
      </div>
    </>
  );
}
