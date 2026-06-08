"use client";

import { useEffect, useRef, useState } from "react";

// Editable product code (e.g. "P50") for a run — shown on the run page so the
// operator can fill it in while the pipeline runs. Persists to product_code.
export default function RunProductCode({ runId }: { runId: number }) {
  const [code, setCode] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const saving = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/runs/${runId}`)
      .then((r) => r.json())
      .then((d) => { if (alive) { setCode(d.run?.product_code ?? null); setLoaded(true); } })
      .catch(() => setLoaded(true));
    return () => { alive = false; };
  }, [runId]);

  async function save() {
    const v = draft.trim();
    setEditing(false);
    if (v === (code ?? "") || saving.current) return;
    saving.current = true;
    setCode(v || null);
    try {
      await fetch(`/api/runs/${runId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_code: v || null }),
      });
    } finally { saving.current = false; }
  }

  if (!loaded) return null;

  if (editing) {
    return (
      <input
        autoFocus value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } else if (e.key === "Escape") { e.preventDefault(); setEditing(false); } }}
        placeholder="P50"
        className="font-[var(--font-jetbrains-mono)] w-[72px] text-[12px] text-[var(--color-text)] bg-[var(--color-surface-2)] border border-[var(--color-border-strong)] rounded-[var(--radius-sm)] px-2 py-[5px] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-ring)]"
        aria-label="Product code"
      />
    );
  }

  return code ? (
    <button
      onClick={() => { setDraft(code); setEditing(true); }}
      title="Edit product code"
      className="inline-flex items-center gap-1.5 font-[var(--font-jetbrains-mono)] text-[12px] font-[600] px-2.5 py-[5px] rounded-[var(--radius-sm)] bg-[var(--color-accent-weak)] text-[var(--color-accent-text)] cursor-pointer hover:brightness-95 transition-all"
    >
      {code}
    </button>
  ) : (
    <button
      onClick={() => { setDraft(""); setEditing(true); }}
      title="Add a product code"
      className="inline-flex items-center gap-1.5 font-[var(--font-jetbrains-mono)] text-[12px] font-[550] px-2.5 py-[5px] rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border-strong)] text-[var(--color-text-3)] cursor-pointer hover:text-[var(--color-text)] hover:border-[var(--color-text-3)] transition-all"
    >
      + Product code
    </button>
  );
}
