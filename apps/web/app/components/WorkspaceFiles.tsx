"use client";
import { useEffect, useState } from "react";
import { Upload, Download, Trash2, File } from "lucide-react";
export default function WorkspaceFiles({
  id,
  notify,
  readOnly = false,
}: {
  id: string;
  readOnly?: boolean;
  notify: (s: string) => void;
}) {
  const [files, setFiles] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load() {
    try {
      const r = await fetch(`/api/workspaces/${id}/files`),
        b = await r.json();
      if (!r.ok) throw new Error(b.message);
      setFiles(b);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, [id]);
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>
          Project files<span>{files.length}</span>
        </h2>
        <label className="primary-button">
          <Upload size={15} />
          {busy ? "Uploading…" : "Upload file"}
          <input
            type="file"
            style={{ display: "none" }}
            disabled={busy || readOnly}
            accept=".txt,.md,.csv,.json,.py,.ts,.js,.ino,.log,.png,.jpg,.jpeg"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.append("file", file);
              setBusy(true);
              try {
                const r = await fetch(`/api/workspaces/${id}/files`, {
                    method: "POST",
                    body: form,
                  }),
                  b = await r.json();
                if (!r.ok) throw new Error(b.message);
                await load();
                notify("File uploaded");
              } catch (e: any) {
                notify(e.message);
              } finally {
                setBusy(false);
                e.target.value = "";
              }
            }}
          />
        </label>
      </div>
      <button className="secondary-button" onClick={load}>
        Refresh file security status
      </button>
      <p className="integration-note">
        Private project attachments · max 5 MB each · 50 MB total. Text/code,
        PNG and JPEG only. All downloads are attachments;
        executable/HTML/SVG/archive uploads are blocked.
      </p>
      {error && <p className="form-error">{error}</p>}
      {files.length === 0 ? (
        <div className="empty-state">
          <File size={32} />
          <h3>Your shared files belong here.</h3>
          <p>Upload a diagram, code sample, or project notes.</p>
        </div>
      ) : (
        files.map((f) => (
          <div className="application-row" key={f.id}>
            <File size={20} />
            <div>
              <strong>{f.name}</strong>
              <small>
                {Math.ceil(f.size / 1024)} KB ·{" "}
                {new Date(f.createdAt).toLocaleDateString()} ·{" "}
                {f.scanStatus === "clean"
                  ? "Security verified"
                  : f.scanStatus === "development-unscanned"
                    ? "Unscanned (development only)"
                    : f.scanStatus === "quarantined"
                      ? "Quarantined — contact support or delete"
                      : "Awaiting security verification"}
              </small>
            </div>
            {["clean", "development-unscanned"].includes(f.scanStatus) ? (
              <a
                className="secondary-button"
                href={`/api/workspaces/${id}/files/${f.id}/download`}
              >
                <Download size={14} />
                Download
              </a>
            ) : (
              <span role="status">Download unavailable</span>
            )}
            <button
              className="icon-button"
              disabled={readOnly}
              aria-label={"Delete " + f.name}
              onClick={async () => {
                if (!window.confirm("Delete this file?")) return;
                const r = await fetch(`/api/workspaces/${id}/files/${f.id}`, {
                  method: "DELETE",
                });
                if (!r.ok) return notify((await r.json()).message);
                load();
                notify("File deleted");
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))
      )}
    </section>
  );
}
