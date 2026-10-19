"use client";
import { useState } from "react";
export default function PreviewImage({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  const [attempt, setAttempt] = useState(0),
    [state, setState] = useState("loading");
  return (
    <div className="upload-image-preview">
      <img
        key={attempt}
        src={
          attempt
            ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}`
            : src
        }
        alt={alt}
        onLoad={() => setState("ready")}
        onError={() => setState("failed")}
        style={{
          width: 96,
          height: 72,
          objectFit: "cover",
          borderRadius: 12,
          display: state === "failed" ? "none" : "block",
        }}
      />
      {state === "loading" && <p role="status">Loading image preview…</p>}
      {state === "failed" && (
        <div role="status">
          <p>
            Image preview unavailable. The image may still be awaiting security
            verification.
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setState("loading");
              setAttempt((a) => a + 1);
            }}
          >
            Retry image preview
          </button>
        </div>
      )}
    </div>
  );
}
