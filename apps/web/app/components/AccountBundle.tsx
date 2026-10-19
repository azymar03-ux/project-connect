"use client";
import { exportJobSchema, type ExportJob } from "../../shared/api-contract";
import { z } from "zod";
import { useState } from "react";
export default function AccountBundle() {
  const [jobs, setJobs] = useState<ExportJob[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function action(method: "GET" | "POST" | "DELETE", id?: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        "/api/account/export/jobs" + (id ? "/" + encodeURIComponent(id) : ""),
        { method, signal: AbortSignal.timeout(15000) },
      );
      const b = await r.json();
      if (!r.ok) throw Error(b.message || "Export request failed.");
      if (method === "GET") setJobs(z.array(exportJobSchema).parse(b));
      else {
        const list = await fetch("/api/account/export/jobs", {
          signal: AbortSignal.timeout(15000),
        });
        const data = await list.json();
        if (!list.ok) throw Error(data.message);
        setJobs(z.array(exportJobSchema).parse(data));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export request failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Account portability bundle">
      <h4>Snapshot portability ZIP</h4>
      <p className="integration-note">
        Prepare all 23 data sections together with your currently authorized
        uploads, avatar and owned project covers. The ZIP expires in 24 hours
        and only this sign-in session can download it. Up to 256 MiB total / 64
        MiB metadata / 10,000 objects; larger accounts can use section exports
        below. Three requests per day. Refresh to see queue progress; leaving
        this page does not cancel it.
      </p>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => void action("POST")}
      >
        Prepare portability ZIP
      </button>{" "}
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => void action("GET")}
      >
        Refresh export status
      </button>
      <ul aria-live="polite">
        {jobs.map((job) => (
          <li key={job.id}>
            {job.status}
            {job.artifactSize
              ? ` · ${(job.artifactSize / 1048576).toFixed(2)} MiB`
              : ""}
            {job.snapshotAt
              ? ` · snapshot ${new Date(job.snapshotAt).toLocaleString()}`
              : ""}
            {job.errorCode && (
              <span role="alert">
                {" "}
                · {job.errorCode}: retry later or use section pages.
              </span>
            )}
            {job.status === "ready" && (
              <>
                {" "}
                ·{" "}
                <a
                  href={`/api/account/export/jobs/${encodeURIComponent(job.id)}/download`}
                >
                  Download ZIP
                </a>
              </>
            )}{" "}
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void action("DELETE", job.id)}
            >
              Cancel / delete export
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
