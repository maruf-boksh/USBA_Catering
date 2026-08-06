import { T } from '../theme';
// Real signed-in user from the web auth (same account as the web app).
import { getAuthUser } from '@/lib/auth';

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

function initials(name) {
  const parts = String(name || '').replace(/[.]/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ProfileScreen({ nav, onLogout }) {
  const user = getAuthUser();
  const name  = user?.name  ?? 'Guest User';
  const email = user?.email ?? '—';
  const role  = user?.role  ?? '—';
  const userId = user?.userId ?? '—';
  const isDark = nav.themeMode === 'dark';

  const rowStyle = { display: 'flex', justifyContent: 'space-between', paddingTop: 10, paddingBottom: 10, borderTop: `1px solid ${T.border}` };
  const labelStyle = { fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody };
  const valueStyle = { fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={BTN_BACK}>←</button>
        <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Profile</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px 24px' }}>
        {/* Identity */}
        <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '18px 14px', boxShadow: T.shadowSm, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ width: 66, height: 66, borderRadius: T.radiusFull, background: T.buttonGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24, fontWeight: 700, fontFamily: T.fontBody }}>
            {initials(name)}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, marginTop: 10 }}>{name}</div>
          <span style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: T.statusApproved, background: T.statusApprovedBg, padding: '3px 10px', borderRadius: T.radiusFull, fontFamily: T.fontBody }}>{role}</span>
        </div>

        {/* Account details */}
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '20px 2px 8px' }}>Account</div>
        <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '2px 14px', boxShadow: T.shadowSm }}>
          <div style={{ ...rowStyle, borderTop: 'none' }}>
            <span style={labelStyle}>Full Name</span><span style={valueStyle}>{name}</span>
          </div>
          <div style={rowStyle}><span style={labelStyle}>Email</span><span style={valueStyle}>{email}</span></div>
          <div style={rowStyle}><span style={labelStyle}>User ID</span><span style={valueStyle}>{userId}</span></div>
          <div style={rowStyle}><span style={labelStyle}>Role</span><span style={valueStyle}>{role}</span></div>
        </div>

        {/* Appearance */}
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '20px 2px 8px' }}>Appearance</div>
        <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, boxShadow: T.shadowSm, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: T.radiusMd, background: T.bgSubtle, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
              {isDark ? '🌙' : '☀️'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>Dark Mode</div>
              <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{isDark ? 'Dark theme is on' : 'Switch to a darker interface'}</div>
            </div>
            {/* Toggle */}
            <button
              onClick={() => nav.setTheme(isDark ? 'light' : 'dark')}
              aria-label="Toggle dark mode"
              style={{ width: 46, height: 26, borderRadius: T.radiusFull, border: 'none', cursor: 'pointer', flexShrink: 0, padding: 3, background: isDark ? T.primary : T.borderStrong, display: 'flex', justifyContent: isDark ? 'flex-end' : 'flex-start', alignItems: 'center', transition: 'background 150ms ease' }}
            >
              <span style={{ width: 20, height: 20, borderRadius: T.radiusFull, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.25)' }} />
            </button>
          </div>
          {/* Theme Center — colour presets + font size, mirroring the web */}
          <div
            onClick={() => nav.navigate('theme')}
            style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, borderTop: `1px solid ${T.border}`, cursor: 'pointer' }}
          >
            <div style={{ width: 38, height: 38, borderRadius: T.radiusMd, background: T.primaryLight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
              🎨
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>Theme & Appearance</div>
              <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>Colour theme · font size</div>
            </div>
            <span style={{ width: 16, height: 16, borderRadius: T.radiusFull, background: T.buttonGradient, flexShrink: 0, border: `2px solid ${T.border}` }} />
            <span style={{ fontSize: 18, color: T.textTertiary, lineHeight: 1 }}>›</span>
          </div>
        </div>

        {/* Sign out */}
        {onLogout && (
          <button onClick={onLogout}
            style={{ width: '100%', marginTop: 24, padding: '13px 0', background: T.bgSurface, border: `1px solid ${T.statusRejected}`, borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody, cursor: 'pointer' }}>
            Sign Out
          </button>
        )}
      </div>
    </div>
  );
}
