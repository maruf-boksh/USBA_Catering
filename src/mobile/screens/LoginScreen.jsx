import { useState } from 'react';
import { T } from '../theme';

function MobileToast({ message, onDismiss }) {
  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'absolute',
        bottom: 24,
        left: 16,
        right: 16,
        background: T.textPrimary,
        color: '#fff',
        borderRadius: T.radiusMd,
        padding: '11px 14px',
        fontSize: 13,
        fontFamily: T.fontBody,
        zIndex: 100,
        boxShadow: T.shadowLg,
        cursor: 'pointer',
        lineHeight: 1.4,
      }}
    >
      {message}
    </div>
  );
}

export function LoginScreen({ onLogin }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [toast, setToast]       = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSignIn = () => {
    if (loading) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onLogin();
    }, 950);
  };

  const inputStyle = {
    height: 46,
    border: `1.5px solid ${T.border}`,
    borderRadius: T.radiusMd,
    padding: '0 13px',
    fontSize: 14,
    fontFamily: T.fontBody,
    color: T.textPrimary,
    background: T.bgSubtle,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: T.bgSurface,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Hero panel */}
      <div
        style={{
          background: T.heroGradient,
          padding: '28px 24px 36px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: T.radiusLg,
            background: 'rgba(255,255,255,0.14)',
            border: '1.5px solid rgba(255,255,255,0.22)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2h0A1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L21 16z" fill="white"/>
          </svg>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: T.fontBrand, fontSize: 19, fontWeight: 700, color: '#fff', letterSpacing: '0.12em' }}>HARVEST</div>
          <div style={{ fontFamily: T.fontBrand, fontSize: 9,  fontWeight: 500, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.28em', marginTop: 2 }}>CATERING</div>
        </div>
        <div style={{ fontFamily: T.fontBody, fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: -2 }}>Operations Platform</div>
      </div>

      {/* Form */}
      <div
        style={{
          flex: 1,
          padding: '24px 24px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          overflowY: 'auto',
        }}
      >
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, lineHeight: 1.2 }}>Sign in</div>
          <div style={{ fontSize: 13, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 4 }}>Access your operations dashboard</div>
        </div>

        {/* Email */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, fontFamily: T.fontBody }}>Email address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@usbair.com"
            onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
            onFocus={(e) => e.target.style.borderColor = T.primary}
            onBlur={(e)  => e.target.style.borderColor = T.border}
            style={inputStyle}
          />
        </div>

        {/* Password */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, fontFamily: T.fontBody }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
            onFocus={(e) => e.target.style.borderColor = T.primary}
            onBlur={(e)  => e.target.style.borderColor = T.border}
            style={inputStyle}
          />
        </div>

        {/* Remember + Forgot */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ accentColor: T.primary, width: 15, height: 15, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody }}>Remember me</span>
          </label>
          <button
            onClick={() => showToast('Available in full version')}
            style={{
              background: 'none', border: 'none',
              color: T.primary, fontSize: 12,
              cursor: 'pointer', fontFamily: T.fontBody,
              fontWeight: 600, padding: 0, lineHeight: 1,
            }}
          >
            Forgot password?
          </button>
        </div>

        {/* Sign in button */}
        <button
          onClick={handleSignIn}
          disabled={loading}
          style={{
            height: 50,
            background: loading ? T.textDisabled : T.buttonGradient,
            color: '#fff',
            border: 'none',
            borderRadius: T.radiusMd,
            fontSize: 15,
            fontWeight: 700,
            fontFamily: T.fontBody,
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 4,
            letterSpacing: '0.03em',
            boxShadow: loading ? 'none' : '0 4px 16px rgba(225,1,1,0.38)',
            transition: 'background 0.2s, box-shadow 0.2s',
          }}
        >
          {loading ? (
            <>
              <svg
                width="18" height="18" viewBox="0 0 24 24" fill="none"
                style={{ animation: 'mobileSpinL 0.75s linear infinite', flexShrink: 0 }}
              >
                <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="3" fill="none"/>
                <path d="M12 2a10 10 0 0 1 10 10" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none"/>
              </svg>
              Signing in…
            </>
          ) : (
            'Sign in'
          )}
        </button>

        <div style={{ textAlign: 'center', fontSize: 11, color: T.textDisabled, fontFamily: T.fontBody, marginTop: 6 }}>
          AeroGalley Catering · Operations Platform v2.4
        </div>
      </div>

      {toast && <MobileToast message={toast} onDismiss={() => setToast(null)} />}

      <style>{`
        @keyframes mobileSpinL { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
