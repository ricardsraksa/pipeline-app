"use client";

// Import (home): the product table.

import { useRouter } from "next/navigation";
import ImportTable from "@/components/import/ImportTable";
import DocImport from "@/components/import/DocImport";

export default function ImportScreen() {
  const router = useRouter();
  const done = () => router.refresh();
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "44px 22px 80px" }} data-screen-label="Import">
      <div className="flex items-baseline justify-between mb-[20px]">
        <h1 className="text-[19px] font-[600] tracking-[-0.02em] text-[var(--color-text)]">Import</h1>
        <DocImport onImported={done} />
      </div>
      <ImportTable onImported={done} />
    </div>
  );
}
