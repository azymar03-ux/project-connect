"use client";
import PreviewImage from "./PreviewImage";
import { useState } from "react";
export default function ImageUpload({
  endpoint,
  label,
  imageUrl,
  onChanged,
  readOnly = false,
}: {
  endpoint: string;
  label: string;
  imageUrl?: string;
  onChanged: () => Promise<void>;
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function send(method: string, file?: File) {
    setBusy(true);
    setError("");
    try {
      if (file && file.size > 5 * 1024 * 1024)
        throw Error("Choose an image under 5 MB.");
      const form = new FormData();
      if (file) form.append("file", file);
      const r = await fetch("/api/" + endpoint, {
        method,
        ...(file ? { body: form } : {}),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.message || "Upload failed.");
      await onChanged();
    } catch (e: any) {
      setError(e.message || "Image update failed. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="image-upload" aria-label={label + " controls"}>
      {imageUrl && (
        <PreviewImage key={imageUrl} src={imageUrl} alt={label + " preview"} />
      )}
      <label className="field">
        {label}
        <input
          type="file"
          accept="image/png,image/jpeg"
          disabled={busy || readOnly}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) void send("POST", f);
          }}
        />
      </label>
      <p className="integration-note">
        PNG/JPEG, up to 5 MB and 16 megapixels. Metadata is removed. Visible to
        the same audience as your profile/project; never upload confidential
        content.
      </p>
      {imageUrl && (
        <button
          type="button"
          className="secondary-button"
          disabled={busy || readOnly}
          onClick={() => void send("DELETE")}
        >
          Remove {label.toLowerCase()}
        </button>
      )}
      <p role="status">{busy ? "Updating image…" : ""}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
