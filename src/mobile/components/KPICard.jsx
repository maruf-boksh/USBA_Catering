import { T } from '../theme';

export function KPICard({ label, value, sub, accent, icon, onPress }) {
  const accentColor = accent || T.primary;
  return (
    <button
      onClick={onPress}
      style={{
        background: T.bgSurface,
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusLg,
        padding: '12px 13px 11px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        cursor: onPress ? 'pointer' : 'default',
        textAlign: 'left',
        boxShadow: T.shadowSm,
        width: '100%',
        WebkitTapHighlightColor: 'transparent',
        transition: 'box-shadow 0.15s',
      }}
    >
      {/* Top row: icon dot + label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: T.radiusFull,
            background: accentColor,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontFamily: T.fontBody,
            fontWeight: 500,
            color: T.textTertiary,
            lineHeight: 1.2,
            flex: 1,
          }}
        >
          {label}
        </span>
        {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
      </div>

      {/* Value */}
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          fontFamily: T.fontBody,
          color: T.textPrimary,
          lineHeight: 1,
        }}
      >
        {value}
      </div>

      {/* Sub-label */}
      {sub && (
        <div
          style={{
            fontSize: 11,
            fontFamily: T.fontBody,
            color: T.textTertiary,
            lineHeight: 1.2,
          }}
        >
          {sub}
        </div>
      )}
    </button>
  );
}
