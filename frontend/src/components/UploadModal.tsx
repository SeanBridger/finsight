import { useState } from "react";
import { API_URL } from "../utils/api";

interface UploadModalProps {
  onClose: () => void;
  onUploaded: () => void;
}

export function UploadModal({ onClose, onUploaded }: UploadModalProps) {
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
