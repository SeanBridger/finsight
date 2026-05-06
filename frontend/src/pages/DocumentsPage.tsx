import { useEffect, useState } from "react";
import type { Document } from "../types/research";

const API_URL = import.meta.env.VITE_API_URL || "";
const TERMINAL_STATUSES = new Set(["ready", "failed"]);

export function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  const refreshDocuments = async () => {
    const res = await fetch(`${API_URL}/documents/list`);
    const data = await res.json();
    setDocuments(data.documents);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/documents/list`);
        const data = await res.json();
        setDocuments(data.documents);
      } catch (err) {
        console.error("Failed to fetch documents:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const hasActiveDocuments = documents.some((d) => !TERMINAL_STATUSES.has(d.status));

    if (!hasActiveDocuments || loading) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/documents/list`);
        const data = await res.json();
        setDocuments(data.documents);

        const stillActive = data.documents.some((d: Document) => !TERMINAL_STATUSES.has(d.status));
        if (!stillActive) clearInterval(interval);
      } catch {
        // Silently fail — next poll will retry
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [documents, loading]);

  const filtered = documents.filter(
    (d) =>
      !filter ||
      d.company.toLowerCase().includes(filter.toLowerCase()) ||
      d.filename.toLowerCase().includes(filter.toLowerCase()),
  );

  const statusColor: Record<string, string> = {
    ready: "bg-green-100 text-green-700",
    uploading: "bg-yellow-100 text-yellow-700",
    uploaded: "bg-blue-100 text-blue-700",
    ingesting: "bg-purple-100 text-purple-700",
    failed: "bg-red-100 text-red-700",
  };

  const statusLabel: Record<string, string> = {
    ready: "Indexed",
    uploading: "Uploading",
    uploaded: "Processing",
    ingesting: "Indexing",
    failed: "Failed",
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Document Library</h2>
            <p className="text-sm text-gray-500">
              {documents.length} document{documents.length !== 1 && "s"} in corpus
            </p>
          </div>
          <button
            onClick={() => setShowUpload(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Upload Document
          </button>
        </div>

        <input
          type="text"
          placeholder="Filter by company or filename..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mb-4 w-full rounded-lg border border-gray-200 px-4 py-2 text-sm outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-300"
        />

        {loading ? (
          <p className="py-12 text-center text-sm text-gray-400">Loading documents...</p>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">No documents found</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-600">Document</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Company</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Period</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Uploaded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((doc) => (
                  <tr key={doc.documentId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{doc.filename}</td>
                    <td className="px-4 py-3 text-gray-600">{doc.company}</td>
                    <td className="px-4 py-3 text-gray-600">{doc.docType}</td>
                    <td className="px-4 py-3 text-gray-600">{doc.period}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[doc.status] || "bg-gray-100 text-gray-600"}`}
                      >
                        {statusLabel[doc.status] || doc.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(doc.uploadedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showUpload && (
          <UploadModal
            onClose={() => setShowUpload(false)}
            onUploaded={() => {
              setShowUpload(false);
              void refreshDocuments();
            }}
          />
        )}
      </div>
    </div>
  );
}

function UploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [company, setCompany] = useState("");
  const [docType, setDocType] = useState("Annual Report");
  const [period, setPeriod] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.type === "application/pdf") {
      setFile(dropped);
      setError("");
    } else {
      setError("Only PDF files are supported");
    }
  };

  const handleSubmit = async () => {
    if (!file || !company || !period) return;
    setUploading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/documents/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          company,
          doc_type: docType,
          period,
        }),
      });
      const { upload_url, document_id } = await res.json();

      const uploadRes = await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });

      if (!uploadRes.ok) throw new Error("S3 upload failed");

      await fetch(`${API_URL}/documents/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id }),
      });

      // Close modal and refresh table immediately
      onUploaded();

      // Trigger sync in the background — don't block the UI
      fetch(`${API_URL}/documents/sync`, { method: "POST" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    }
  };

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => currentYear - i);
  const periods = years.flatMap((y) => [
    `FY ${y}`,
    `H1 ${y}`,
    `H2 ${y}`,
    `Q1 ${y}`,
    `Q2 ${y}`,
    `Q3 ${y}`,
    `Q4 ${y}`,
  ]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Upload Document</h3>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById("file-input")?.click()}
          className={`mb-4 flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed p-8 transition-colors ${
            dragOver
              ? "border-blue-400 bg-blue-50"
              : file
                ? "border-green-300 bg-green-50"
                : "border-gray-200 hover:border-gray-300"
          }`}
        >
          <input
            id="file-input"
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                setError("");
              }
            }}
          />
          {file ? (
            <p className="text-sm font-medium text-green-700">{file.name}</p>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-600">
                Drop a PDF here or click to browse
              </p>
              <p className="mt-1 text-xs text-gray-400">PDF files only</p>
            </>
          )}
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-gray-600">Company</label>
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="e.g. HSBC"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-300"
          />
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-gray-600">Document Type</label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-300"
          >
            <option>Annual Report</option>
            <option>Earnings Transcript</option>
            <option>Regulatory Filing</option>
            <option>Investor Presentation</option>
          </select>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-600">Period</label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-300"
          >
            <option value="">Select period...</option>
            {periods.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!file || !company || !period || uploading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload & Ingest"}
          </button>
        </div>
      </div>
    </div>
  );
}
