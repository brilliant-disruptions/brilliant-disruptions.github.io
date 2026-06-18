"use client";

// Surfaces the real client/server error instead of Next's blank "This page
// couldn't load" screen. Temporary diagnostic aid — once the /overview crash
// is understood, this can be slimmed to a friendlier production message.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#000008",
          color: "#e5e7eb",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          padding: "2rem",
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ fontSize: "1.1rem", color: "#ff6b6b", marginBottom: "1rem" }}>
          Unhandled error
        </h1>
        <p style={{ margin: "0 0 0.5rem" }}>
          <strong>message:</strong> {error?.message || "(no message)"}
        </p>
        {error?.digest && (
          <p style={{ margin: "0 0 0.5rem" }}>
            <strong>digest:</strong> {error.digest}
          </p>
        )}
        {error?.stack && (
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: "0.75rem",
              background: "#0a0a16",
              border: "1px solid #1f2937",
              borderRadius: "6px",
              padding: "1rem",
              overflow: "auto",
              maxHeight: "60vh",
            }}
          >
            {error.stack}
          </pre>
        )}
        <button
          onClick={reset}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            background: "#1f2937",
            color: "#e5e7eb",
            border: "1px solid #374151",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
