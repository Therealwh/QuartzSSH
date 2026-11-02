// Minimal inline SVG icon set (16x16, stroke-based, currentColor).

interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number | undefined, className: string | undefined) {
  return {
    width: size ?? 16,
    height: size ?? 16,
    viewBox: "0 0 16 16",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
}

export function TerminalIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M4.5 6l2.5 2-2.5 2M8.5 10.5h3" />
    </svg>
  );
}

export function FolderIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M1.5 4.5v8a1 1 0 001 1h11a1 1 0 001-1v-6a1 1 0 00-1-1H8L6.5 3.5H2.5a1 1 0 00-1 1z" />
    </svg>
  );
}

export function SettingsIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" />
    </svg>
  );
}

export function PlusIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function CloseIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function SearchIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="7" cy="7" r="4" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}

export function RefreshIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M13 8a5 5 0 11-1.5-3.6M13 2.5V5h-2.5" />
    </svg>
  );
}

export function ArrowUpIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M8 13V3M4 7l4-4 4 4" />
    </svg>
  );
}

export function HomeIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M2.5 7.5L8 2.5l5.5 5M4 7v6.5h8V7" />
    </svg>
  );
}

export function TrashIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" />
    </svg>
  );
}

export function PencilIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3 13h2l8-8-2-2-8 8v2zM10.5 3.5l2 2" />
    </svg>
  );
}

export function DownloadIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M8 2v8M4.5 7L8 10.5 11.5 7M3 13h10" />
    </svg>
  );
}

export function UploadIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M8 10V2.5M4.5 6L8 2.5 11.5 6M3 13h10" />
    </svg>
  );
}

export function NewFolderIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M1.5 4.5v8a1 1 0 001 1h11a1 1 0 001-1v-6a1 1 0 00-1-1H8L6.5 3.5H2.5a1 1 0 00-1 1z" />
      <path d="M8 7.5v4M6 9.5h4" />
    </svg>
  );
}

export function ShieldIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M8 1.8l5 1.8v4c0 3.2-2.1 5.6-5 6.6-2.9-1-5-3.4-5-6.6v-4l5-1.8z" />
    </svg>
  );
}

export function PlugIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M5.5 2v3.5M10.5 2v3.5M4 5.5h8v2.5a4 4 0 01-8 0V5.5zM8 12v2.5" />
    </svg>
  );
}

export function LockIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" />
    </svg>
  );
}

export function GaugeIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M2.5 11.5a5.5 5.5 0 0111 0" />
      <path d="M8 11.5l2.9-3.9" />
      <circle cx="8" cy="11.5" r="1" />
    </svg>
  );
}

export function SplitIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M8 2.5v11" />
    </svg>
  );
}

export function BroadcastIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="8" cy="8" r="1.5" />
      <path d="M5.6 5.6a3.4 3.4 0 000 4.8M10.4 5.6a3.4 3.4 0 010 4.8M3.4 3.4a6.5 6.5 0 000 9.2M12.6 3.4a6.5 6.5 0 010 9.2" />
    </svg>
  );
}
