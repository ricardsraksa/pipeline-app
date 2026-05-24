"use client";

import { useState, useRef, useEffect } from "react";

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export type EditableOutputProps = {
  runId: number;
  field: string;
  stage: "stage1" | "stage2" | "stage3";
  originalValue: string;
  editedValue?: string | null;
  editedAt?: string | null;
  label: string;
  monospace?: boolean;
  /** If set, shows a Download button in the header that saves the displayed
   *  value to this filename. */
  downloadFilename?: string;
};

export default function EditableOutput({
  runId,
  field,
  stage,
  originalValue,
  editedValue: initialEditedValue = null,
  editedAt: initialEditedAt = null,
  label,
  monospace = true,
  downloadFilename,
}: EditableOutputProps) {
  const [editing, setEditing] = useState(false);
  const [editedValue, setEditedValue] = useState<string | null>(initialEditedValue);
  const [editedAt, setEditedAt] = useState<string | null>(initialEditedAt);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function copyValue() {
    navigator.clipboard.writeText(editedValue ?? originalValue).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  }

  function downloadValue() {
    if (!downloadFilename) return;
    const ext = downloadFilename.split(".").pop()?.toLowerCase();
    const mime = ext === "md" ? "text/markdown" : "text/plain";
    const text = editedValue ?? originalValue;
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = Object.assign(document.createElement("a"), { href: url, download: downloadFilename });
    a.click();
    URL.revokeObjectURL(url);
  }

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    if (editing) autoResize();
  }, [editing, draft]);

  function enterEdit() {
    setDraft(editedValue ?? originalValue);
    setSaveError("");
    setShowOriginal(false);
    setEditing(true);
    setTimeout(() => { textareaRef.current?.focus(); autoResize(); }, 0);
  }

  function cancelEdit() {
    setEditing(false);
    setSaveError("");
    setShowOriginal(false);
  }

  async function save() {
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "field_edit", field, value: draft, stage }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Save failed");
      setEditedValue(draft);
      setEditedAt(new Date().toISOString());
      setEditing(false);
      setShowOriginal(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save — try again");
    } finally {
      setSaving(false);
    }
  }

  const displayValue = editedValue ?? originalValue;
  const isEdited = editedValue !== null;
  const textCls = monospace
    ? "font-[var(--font-ibm-plex-mono)] text-[13px] leading-relaxed text-[var(--color-text)] whitespace-pre-wrap break-words"
    : "text-[13px] leading-relaxed text-[var(--color-text)] whitespace-pre-wrap break-words";

  return (
    <div className="border border-[var(--color-border)] rounded-[11px] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(20,20,18,.05)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-[650] uppercase tracking-[0.1em] text-[var(--color-text-3)]">{label}</span>
          {isEdited && !editing && (
            <span className="inline-flex items-center gap-1.5 text-xs font-[620] px-2.5 py-1 rounded-full bg-[var(--color-amber-bg)] text-[var(--color-amber)] whitespace-nowrap">
              Edited
            </span>
          )}
        </div>
        {!editing && (
          <div className="flex items-center gap-1">
            <button
              onClick={copyValue}
              title="Copy to clipboard"
              className={[
                "cursor-pointer inline-flex items-center gap-[6px] rounded-lg px-3 py-[7px] text-[12.5px] font-[620] border border-transparent bg-transparent transition-all whitespace-nowrap",
                copied
                  ? "text-[var(--color-green)]"
                  : "text-[var(--color-text-2)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]",
              ].join(" ")}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
            {downloadFilename && (
              <button
                onClick={downloadValue}
                title={`Download as ${downloadFilename}`}
                className="cursor-pointer inline-flex items-center gap-[6px] rounded-lg px-3 py-[7px] text-[12.5px] font-[620] border border-transparent bg-transparent text-[var(--color-text-2)] transition-all hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] whitespace-nowrap"
              >
                ↓ Download
              </button>
            )}
            <button
              onClick={enterEdit}
              title="Edit"
              className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-3 py-[7px] text-[12.5px] font-[620] border border-transparent bg-transparent text-[var(--color-text-2)] transition-all hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)] whitespace-nowrap"
            >
              <PencilIcon />
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        {editing ? (
          <div className="space-y-3">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); autoResize(); }}
              className={[
                "w-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] rounded-lg px-[13px] py-[11px] transition-all focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] resize-none min-h-[120px] overflow-hidden",
                monospace ? "font-[var(--font-ibm-plex-mono)] text-[12px]" : "text-[13px]",
              ].join(" ")}
              style={{ overflow: "hidden" }}
            />

            {saveError && (
              <p className="text-[11px] font-[var(--font-ibm-plex-mono)] text-[var(--color-error)]">{saveError}</p>
            )}

            <div className="flex items-center justify-between flex-wrap gap-2">
              <button
                onClick={() => setShowOriginal((v) => !v)}
                className="text-[11px] font-[var(--font-ibm-plex-mono)] text-[var(--color-text-3)] hover:text-[var(--color-text-2)] underline cursor-pointer"
              >
                {showOriginal ? "Hide original" : "Show original"}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-3 py-[7px] text-[12.5px] font-[620] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] transition-all hover:border-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] whitespace-nowrap disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="cursor-pointer inline-flex items-center gap-[7px] rounded-lg px-3 py-[7px] text-[12.5px] font-[620] bg-[var(--color-primary)] text-[var(--color-on-primary)] border border-transparent transition-all hover:brightness-105 whitespace-nowrap disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            {showOriginal && (
              <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg p-3 mt-1">
                <p className="text-[9px] font-[var(--font-ibm-plex-mono)] text-[var(--color-text-3)] uppercase tracking-widest mb-2">Original AI output</p>
                <pre className="font-[var(--font-ibm-plex-mono)] text-[10.5px] text-[var(--color-text-2)] whitespace-pre-wrap break-words leading-relaxed max-h-[280px] overflow-y-auto">
                  {originalValue}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <div>
            <pre className={`${textCls} max-h-[520px] overflow-y-auto`}>
              {displayValue}
            </pre>
            {isEdited && editedAt && (
              <p className="mt-2 text-[10px] font-[var(--font-ibm-plex-mono)] text-[var(--color-text-3)]">
                Edited {relativeTime(editedAt)}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
