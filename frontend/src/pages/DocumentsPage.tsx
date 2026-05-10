import { useEffect, useState } from "react";
import type { Document } from "../types/research";
import { UploadModal } from "../components/UploadModal";
import { API_URL } from "../utils/api";
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
