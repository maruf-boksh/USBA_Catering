import { T } from '../theme';

export function PlaceholderScreen({ nav, title, subtitle, icon, milestone }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      {/* Topbar */}
      <div
        style={{
          background: T.topbarGradient,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{title}</div>
          {subtitle && (
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{subtitle}</div>
          )}
        </div>
      </div>

      {/* Placeholder body */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: 24,
        }}
      >
        <div style={{ fontSize: 36 }}>{icon || '🔧'}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: T.textSecondary, fontFamily: T.fontBody, textAlign: 'center' }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, textAlign: 'center' }}>
          Full screen coming in {milestone}
        </div>
      </div>
    </div>
  );
}
