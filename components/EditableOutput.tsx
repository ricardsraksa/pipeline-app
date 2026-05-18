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
}: EditableOutputProps) {
  const [editing, setEditing] = useState(false);
  const [editedValue, setEditedValue] = useState<string | null>(initialEditedValue);
  const [editedAt, setEditedAt] = useState<string | null>(initialEditedAt);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    ? "font-mono text-[11.5px] text-zinc-300 whitespace-pre-wrap break-words leading-relaxed"
    : "text-[12.5px] text-zinc-300 whitespace-pre-wrap break-words leading-relaxed";

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">{label}</span>
          {isEdited && !editing && (
            <span className="text-[9px] font-mono bg-amber-900/40 text-amber-400 px-2 py-0.5 rounded-full border border-amber-900/30 uppercase tracking-wider">
              Edited
            </span>
          )}
        </div>
        {!editing && (
          <button
            onClick={enterEdit}
            title="Edit"
            className="cursor-pointer text-zinc-600 hover:text-zinc-300 transition-colors p-1 rounded hover:bg-zinc-800"
          >
            <PencilIcon />
          </button>
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
              className={`w-full bg-zinc-800 border border-zinc-700 rounded p-3 text-zinc-100 resize-none min-h-[120px] focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/10 transition-colors overflow-hidden ${monospace ? "font-mono text-[11px]" : "text-[12px]"}`}
              style={{ overflow: "hidden" }}
            />

            {saveError && (
              <p className="text-[11px] font-mono text-red-400">{saveError}</p>
            )}

            <div className="flex items-center justify-between flex-wrap gap-2">
              <button
                onClick={() => setShowOriginal((v) => !v)}
                className="text-[11px] font-mono text-zinc-600 hover:text-zinc-400 underline cursor-pointer"
              >
                {showOriginal ? "Hide original" : "Show original"}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="cursor-pointer px-3 py-1.5 border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 rounded-md text-[11px] font-mono transition-colors active:scale-95 disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="cursor-pointer px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-[11px] font-mono transition-colors active:scale-95 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            {showOriginal && (
              <div className="bg-zinc-950 border border-zinc-800 rounded p-3 mt-1">
                <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mb-2">Original AI output</p>
                <pre className="font-mono text-[10.5px] text-zinc-500 whitespace-pre-wrap break-words leading-relaxed max-h-[280px] overflow-y-auto">
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
              <p className="mt-2 text-[10px] font-mono text-zinc-600">
                Edited {relativeTime(editedAt)}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
