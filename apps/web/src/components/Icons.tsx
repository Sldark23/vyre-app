import type { JSX } from 'react';

/* Ícones SVG inline (traço, herdando currentColor) — voz e tipos de canal.
 * Estilo visual próximo do Discord: viewBox 24, stroke 2, cantos arredondados. */

interface IconProps {
  className?: string;
  size?: number;
}

function base(props: IconProps): JSX.IntrinsicElements['svg'] {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: `icon ${props.className ?? ''}`.trim(),
    width: props.size ?? 18,
    height: props.size ?? 18,
    'aria-hidden': true,
  };
}

/* --- tipos de canal --- */

export function SpeakerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
      <path d="M15 9.5a4 4 0 0 1 0 5" />
      <path d="M17.8 6.7a8 8 0 0 1 0 10.6" />
    </svg>
  );
}

export function MegaphoneIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 10v4a1 1 0 0 0 1 1h1.2L11 19V5L5.2 9H4a1 1 0 0 0-1 1Z" />
      <path d="M14.8 8.7a4 4 0 0 1 0 6.6" />
      <path d="M8 15v4.5" />
    </svg>
  );
}

export function ForumIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 12c0 3.9-4 7-9 7-1 0-2-.1-2.9-.4L4 20l1.3-3.2C4.5 15.5 4 13.8 4 12c0-3.9 4-7 9-7s8 3.1 8 7Z" />
      <path d="M8.5 10.5h7" />
      <path d="M8.5 13.5h4" />
    </svg>
  );
}

/* --- controles de voz --- */

export function MicIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </svg>
  );
}

export function MicOffIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
      <path d="M3.5 3.5l17 17" />
    </svg>
  );
}

export function HeadphonesIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 13.5a8 8 0 0 1 16 0" />
      <rect x="3" y="13.5" width="4.5" height="7" rx="2" />
      <rect x="16.5" y="13.5" width="4.5" height="7" rx="2" />
    </svg>
  );
}

export function HeadphonesOffIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 13.5a8 8 0 0 1 16 0" />
      <rect x="3" y="13.5" width="4.5" height="7" rx="2" />
      <rect x="16.5" y="13.5" width="4.5" height="7" rx="2" />
      <path d="M3.5 3.5l17 17" />
    </svg>
  );
}

export function PhoneHangupIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10.7 13.3a16 16 0 0 0 3.4 2.6l1.3-1.3a2 2 0 0 1 2.1-.4 12.8 12.8 0 0 0 2.8.7 2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2 6.2 2 2 0 0 1 4 4h3a2 2 0 0 1 2 1.7c.1.9.3 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 12" />
      <path d="M23 1 1 23" />
    </svg>
  );
}

/* --- gestão e anexos (Fase 4) --- */

export function HashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 3 8.5 21M15.5 3 14 21M4 8.5h16M3 15.5h16" />
    </svg>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.4V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.4-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3H9a1.6 1.6 0 0 0 1-1.4V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.4 1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7V9a1.6 1.6 0 0 0 1.4 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.4 1Z" />
    </svg>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 11.5 12.7 19.8a5.5 5.5 0 0 1-7.8-7.8l8.3-8.3a3.7 3.7 0 0 1 5.2 5.2l-8.3 8.3a1.8 1.8 0 0 1-2.6-2.6l7.7-7.7" />
    </svg>
  );
}

export function CrownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 7.5 7 11l5-6.5 5 6.5 4-3.5-1.8 10.5H4.8L3 7.5Z" />
      <path d="M5.5 21h13" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 5 5.5v5.2c0 4.3 3 7.5 7 9.3 4-1.8 7-5 7-9.3V5.5L12 3Z" />
    </svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      <path d="M19 15.5l.9 2.1L22 18.5l-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 13h9.4l.8-13M10 11v5M14 11v5" />
    </svg>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M18 13l-6 6-6-6" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.6c2 .8 3.5 2.6 3.5 5.4" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m4 10.5 8-6.5 8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-9.5Z" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
    </svg>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 12c0 3.9-4 7-9 7-1 0-2-.1-2.9-.4L4 20l1.3-3.2C4.5 15.5 4 13.8 4 12c0-3.9 4-7 9-7s8 3.1 8 7Z" />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 12 20 4l-4 16-4.5-6.5L4 12Z" />
      <path d="M11.5 13.5 20 4" />
    </svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4.5 1.5L5 16 16.5 4.5Z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}
