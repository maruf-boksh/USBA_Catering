import type { CSSProperties } from 'react';

interface AviationLogoProps {
  className?: string;
  style?: CSSProperties;
  showBackground?: boolean;
  bgColor?: string;
  animated?: boolean;
}

export default function AviationLogo({
  className,
  style,
  showBackground = true,
  bgColor = '#E10101',
  animated = false,
}: AviationLogoProps) {
  return (
    <svg
      viewBox="0 0 300 360"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'block', ...style }}
      role="img"
      aria-label="AeroGalley Catering – Aviation Catering Management"
    >
      {/* ── Background ─────────────────────────────────────────── */}
      {showBackground && <rect width="300" height="360" fill={bgColor} />}

      {/* ── Background shimmer pulse (animated only) ───────────── */}
      {showBackground && animated && (
        <rect width="300" height="360" fill="white" opacity="0">
          <animate
            attributeName="opacity"
            values="0;0.09;0"
            dur="2.8s"
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
          />
        </rect>
      )}

      {/* ── Plate ring ─────────────────────────────────────────── */}
      <ellipse
        cx="150" cy="308"
        rx="108" ry="33"
        fill="none" stroke="white" strokeWidth="16"
      >
        {animated && (
          <animate
            attributeName="opacity"
            values="1;0.7;1"
            dur="2.8s"
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
          />
        )}
      </ellipse>

      {/* ── Spoon (left, −8°) ──────────────────────────────────── */}
      <g transform="translate(78,183) rotate(-8)">
        <ellipse cx="0" cy="-108" rx="24" ry="29" fill="white" />
        <rect x="-5.5" y="-85" width="11" height="207" rx="5.5" fill="white" />
      </g>

      {/* ── Fork (centre-left, −2°) ────────────────────────────── */}
      <g transform="translate(150,183) rotate(-2)">
        <rect x="-16"  y="-115" width="7.5" height="54" rx="3.75" fill="white" />
        <rect x="-5.5" y="-115" width="7.5" height="54" rx="3.75" fill="white" />
        <rect x="5"    y="-115" width="7.5" height="54" rx="3.75" fill="white" />
        <rect x="15.5" y="-115" width="7.5" height="54" rx="3.75" fill="white" />
        <rect x="-16" y="-63" width="39" height="11" fill="white" />
        <path d="M-16,-52 L-7,0 L7,0 L16,-52 Z" fill="white" />
        <rect x="-7" y="-2" width="14" height="117" rx="6" fill="white" />
      </g>

      {/* ── Airplane — static ──────────────────────────────────── */}
      {!animated && (
        <g transform="translate(162,183) rotate(-46)">
          <path d="M-148,-8 L92,-8 C115,-8 148,0 148,0 C115,8 92,8 -148,8 C-156,4 -156,-4 -148,-8 Z" fill="white" />
          <path d="M5,-8 L-44,-78 L-60,-8 Z" fill="white" />
          <path d="M5,8 L-44,78 L-60,8 Z" fill="white" />
          <path d="M-108,-7 L-150,-38 L-124,-7 Z" fill="white" />
          <path d="M-108,7 L-150,38 L-124,7 Z" fill="white" />
          <path d="M-104,-7 L-144,-36 L-118,-7 Z" fill="white" />
        </g>
      )}

      {/* ── Airplane — animated drift ──────────────────────────── */}
      {animated && (
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values="162,183; 166,179; 162,183"
            keyTimes="0;0.5;1"
            calcMode="spline"
            keySplines="0.45 0 0.55 1;0.45 0 0.55 1"
            dur="3.2s"
            repeatCount="indefinite"
          />
          <g transform="rotate(-46)">
            <path d="M-148,-8 L92,-8 C115,-8 148,0 148,0 C115,8 92,8 -148,8 C-156,4 -156,-4 -148,-8 Z" fill="white" />
            <path d="M5,-8 L-44,-78 L-60,-8 Z" fill="white" />
            <path d="M5,8 L-44,78 L-60,8 Z" fill="white" />
            <path d="M-108,-7 L-150,-38 L-124,-7 Z" fill="white" />
            <path d="M-108,7 L-150,38 L-124,7 Z" fill="white" />
            <path d="M-104,-7 L-144,-36 L-118,-7 Z" fill="white" />
          </g>
        </g>
      )}
    </svg>
  );
}
