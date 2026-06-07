"use client";

import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";

// Owns the sidebar collapsed state and renders the responsive grid so the
// sidebar can minimise (236px ⇄ 64px) with a smooth animation.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("pl_sidebar") === "1");
    setHydrated(true);
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("pl_sidebar", next ? "1" : "0");
      return next;
    });
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${collapsed ? 64 : 236}px 1fr`,
        minHeight: "100vh",
        transition: hydrated ? "grid-template-columns .22s ease" : undefined,
      }}
    >
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div style={{ minWidth: 0, overflowX: "hidden", display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}
