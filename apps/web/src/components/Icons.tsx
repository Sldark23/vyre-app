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
