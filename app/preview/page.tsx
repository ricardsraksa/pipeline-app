"use client";

// Full design preview — renders the Claude Design "Signal" handoff prototype
// (all screens, mock data) edge-to-edge so the complete UI can be reviewed in
// the app. The prototype's own files are vendored under /public/pipeline-ui/.
// This is a staging surface; real screens get wired into the live routes
// progressively.
export default function PreviewPage() {
  return (
    <iframe
      src="/pipeline-ui/Pipeline.html"
      title="Pipeline design preview"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: "none", zIndex: 60, background: "var(--color-bg)" }}
    />
  );
}
