"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Editable run name. Shows as a link by default, with a pencil button revealed
 * on row hover; clicking opens an inline input that defaults to the current
 * (product) name. PATCH writes the new value to `brand_name`, which is the
 * field the list display already prefers over `product_name`.
 */
export function RunNameCell({
  runId,
  initial,
  href,
}: {
  runId: number;
  initial: string;
  href: string;
}) {
  const [name, setName] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Delete "${name}"? This permanently removes the run and can't be undone.`)) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      } else {
        setDeleting(false);
      }
    } catch {
      setDeleting(false);
    }
  }

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setDraft(name);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_name: trimmed }),
      });
      if (res.ok) {
        setName(trimmed);
        setEditing(false);
        router.refresh();
      } else {
        setDraft(name);
      }
    } catch {
      setDraft(name);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(name);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 mb-0.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          disabled={saving}
          className="text-[13px] text-[var(--color-text)] font-[550] bg-[var(--color-surface-2)] border border-[var(--color-border-strong)] rounded px-2 py-0.5 min-w-0 flex-1 focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)] disabled:opacity-60"
          aria-label="Run name"
        />
        <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-4)] shrink-0">
          #{runId}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 mb-0.5 group/name">
      <Link
        href={href}
        className="text-[13px] text-[var(--color-text)] font-[550] truncate min-w-0 hover:text-[var(--color-accent)] transition-colors"
      >
        {name}
      </Link>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(name);
          setEditing(true);
        }}
        title="Rename"
        aria-label="Rename run"
        className="opacity-0 group-hover/name:opacity-100 focus:opacity-100 text-[var(--color-text-3)] hover:text-[var(--color-text)] transition-opacity p-0.5 cursor-pointer shrink-0"
      >
        <svg
          className="w-3 h-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        title="Delete run"
        aria-label="Delete run"
        className="opacity-0 group-hover/name:opacity-100 focus:opacity-100 text-[var(--color-text-3)] hover:text-[var(--color-red)] transition-opacity p-0.5 cursor-pointer shrink-0 disabled:opacity-40"
      >
        <svg
          className="w-3 h-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
      <span className="font-[var(--font-ibm-plex-mono)] text-[10px] text-[var(--color-text-4)] shrink-0">
        #{runId}
      </span>
    </div>
  );
}
