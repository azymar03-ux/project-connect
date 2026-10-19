"use client";
import { useState } from "react";
export default function AccountExport() {
  const [sections, setSections] = useState<string[]>([]),
    [section, setSection] = useState("profile"),
    [cursor, setCursor] = useState<string | null>(null),
    [started, setStarted] = useState(false),
    [complete, setComplete] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [page, setPage] = useState(0),
    [limit, setLimit] = useState(100);
  async function manifest() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/account/export/sections");
      const b = await r.json();
      if (!r.ok) throw Error(b.message);
      setSections(b.sections);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({ section, limit: String(limit) });
      if (cursor) query.set("cursor", cursor);
      const r = await fetch("/api/account/export/page?" + query);
      const b = await r.json();
      if (!r.ok) throw Error(b.message);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(b, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `projectconnect-${section}-page-${page + 1}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setCursor(b.nextCursor);
      setStarted(true);
      setComplete(!b.nextCursor);
      setPage((n) => n + 1);
    } catch (e: any) {
      setError(e.message || "Export failed. Retry this page.");
    } finally {
      setBusy(false);
    }
  }
  function restart() {
    setCursor(null);
    setStarted(false);
    setComplete(false);
    setPage(0);
    setError("");
  }
  return (
    <section aria-label="Paginated account export">
      <h4>Large account / complete section exports</h4>
      <p className="integration-note">
        No total row cap. Download each section a page at a time; keep going
        until complete. This is live data, not a cross-page snapshot. Edits
        during export can change results. Includes only your own sent messages
        and outgoing follows/blocks; no file bytes or authentication/storage
        secrets. Cursors expire after one hour or sign-out.
      </p>
      {!sections.length ? (
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => void manifest()}
        >
          Choose export section
        </button>
      ) : (
        <>
          <label className="field">
            Export section
            <select
              aria-label="Export section"
              value={section}
              disabled={busy}
              onChange={(e) => {
                setSection(e.target.value);
                restart();
              }}
            >
              {sections.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Rows per page
            <select
              aria-label="Rows per page"
              value={limit}
              disabled={busy}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              {[100, 25, 5, 1].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || complete}
            onClick={() => void download()}
          >
            {busy
              ? "Preparing…"
              : started
                ? "Download next page"
                : "Download first page"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={restart}
          >
            Restart section
          </button>
          <p role="status">
            {complete
              ? `Section complete: ${page} page(s) downloaded.`
              : started
                ? `${page} page(s) downloaded; more available.`
                : ""}
          </p>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
