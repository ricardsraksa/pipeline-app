// Inline SVG icons — Heroicons / Lucide style, sized via className.
// Default size: w-4 h-4 (16px). All icons render with currentColor.

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function base(props: IconProps) {
  const { className = "w-4 h-4", ...rest } = props;
  return {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
}

export const Icon = {
  Pipeline: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M4 6h16M4 12h10M4 18h7" />
    </svg>
  ),
  History: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M3 12a9 9 0 1 0 3.5-7.1" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  Settings: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  ArrowRight: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  ),
  ArrowLeft: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  ),
  ChevronRight: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
  ChevronDown: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  Check: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  X: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  Copy: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  Download: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  ),
  Play: (p: IconProps) => (
    <svg {...base(p)} fill="currentColor" stroke="none">
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  Refresh: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M3 12a9 9 0 0 1 15.5-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.4L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  ),
  Alert: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  ),
  Loader: (p: IconProps) => (
    <svg {...base(p)} className={`${p.className ?? "w-4 h-4"} animate-spin`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  ),
  ExternalLink: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  ),
  Spark: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  ),
  Image: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  ),
  Doc: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8M16 17H8M10 9H8" />
    </svg>
  ),
  ThumbsUp: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7V10l5-7c1.1 0 2 .9 2 2v.88z" />
    </svg>
  ),
  ThumbsDown: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17v12l-5 7c-1.1 0-2-.9-2-2v-.88z" />
    </svg>
  ),
};
