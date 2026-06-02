import type { CSSProperties } from 'react';

export function LogoOrbitIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 54 54" fill="none"
         stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {/* orbit ripples (open right) */}
      <path d="M31 9 A18 18 0 1 0 31 45" strokeWidth="2" opacity="0.92" />
      <path d="M30 15 A12 12 0 1 0 30 39" strokeWidth="2" opacity="0.76" />
      <path d="M29 21 A6 6 0 1 0 29 33" strokeWidth="2" opacity="0.6" />
      {/* flight-path swoosh */}
      <path d="M17 47 C17 34 29 26 43 24 C51 23 50 16 44 17" strokeWidth="2" opacity="0.85" />
      {/* jet climbing */}
      <g className="hc-plane-ci">
        <g fill="currentColor" stroke="none"
           transform="translate(43 22) rotate(40) scale(0.52) translate(-12.5 -12)">
          <path d="M22 16v-2l-8-5V3.5C14 2.67 13.33 2 12.5 2S11 2.67 11 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l9 2.5z" />
        </g>
      </g>
    </svg>
  );
}

export function LogoTile({
  size = 56,
  glow = true,
  light = false,
}: {
  size?: number;
  glow?: boolean;
  light?: boolean;
}) {
  const inner = Math.round(size * 0.78);
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.26),
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    background: light ? 'var(--paper)' : 'var(--gradient-tile)',
    color: light ? 'var(--red)' : '#fff',
    boxShadow: glow ? 'var(--shadow-tile-glow)' : light ? 'var(--shadow-tile-light)' : '0 1px 2px rgba(0,0,0,.18)',
  };
  return (
    <div style={style}>
      <LogoOrbitIcon size={inner} />
    </div>
  );
}

export function LogoLockup({ size = 48, color = 'currentColor' }: { size?: number; color?: string }) {
  const h = Math.round(size * 96 / 150);
  return (
    <svg width={size} height={h} viewBox="0 0 150 96" fill="none"
         stroke={color} strokeLinecap="round" strokeLinejoin="round">
      {/* slim fork (left) */}
      <path d="M18 22 V36" strokeWidth="1.6" />
      <path d="M22 22 V36" strokeWidth="1.6" />
      <path d="M26 22 V36" strokeWidth="1.6" />
      <path d="M30 22 V36" strokeWidth="1.6" />
      <ellipse cx="24" cy="37.5" rx="6.4" ry="3" fill={color} stroke="none" />
      <path d="M24 38 V80" strokeWidth="2.6" />
      {/* slim knife (right) */}
      <path d="M126 21 C129.5 30 130 41 128.5 51 L123.5 51 C122 41 122.5 30 126 21 Z" fill={color} stroke="none" />
      <path d="M126 50 V80" strokeWidth="2.6" />
      {/* orbit ripples */}
      <path d="M74 26 A22 22 0 1 0 74 66" strokeWidth="1.7" opacity="0.92" />
      <path d="M73 33 A15 15 0 1 0 73 59" strokeWidth="1.7" opacity="0.78" />
      <path d="M72 40 A8 8 0 1 0 72 52" strokeWidth="1.7" opacity="0.62" />
      {/* flight-path swoosh */}
      <path d="M57 71 C57 54 70 44 86 40 C98 37 96 30 88 31" strokeWidth="1.8" opacity="0.85" />
      {/* jet climbing */}
      <g fill={color} stroke="none" transform="translate(86 36) rotate(40) scale(0.64) translate(-12.5 -12)">
        <path d="M22 16v-2l-8-5V3.5C14 2.67 13.33 2 12.5 2S11 2.67 11 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l9 2.5z" />
      </g>
    </svg>
  );
}
