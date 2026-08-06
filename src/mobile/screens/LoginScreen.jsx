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

/** The wing silhouette the desktop hero flies — shared so both read as one brand. */
const PLANE_D =
  'M22 0 L6 2 L3 2.4 L-5 11 L-8 11 L-5 2.6 L-15 2.2 L-18 6 L-20 6 L-19 2 L-21 1.4 ' +
  'L-21 -1.4 L-19 -2 L-20 -6 L-18 -6 L-15 -2.2 L-5 -2.6 L-8 -11 L-5 -11 L3 -2.4 L6 -2 Z';

/**
 * Live flight paths behind the mobile hero — the desktop sign-in panel's
 * animation, rebuilt for a 360x200 band.
 *
 * Same idea, fewer moving parts: two routes instead of three and a shallower
 * arc, because the desktop's near-vertical climb reads as a straight line once
 * it is squeezed into a strip a fifth as tall. Planes are glued to their route
 * with animateMotion + mpath, so the aircraft and the dotted path can never
 * drift apart the way two independently-tweened animations would.
 *
 * Decorative only: aria-hidden, and it never takes a tap.
 */
function HeroSky() {
  // Each plane fades in over the first 7% of its run and out over the last 7%,
  // so it appears just off the origin rather than materialising on the dot.
  const flight = (routeId, dur, begin, scale, fill, glow) => (
    <g style={{ filter: `drop-shadow(0 0 4px ${glow})` }}>
      <animateMotion
        dur={dur} begin={begin} repeatCount="indefinite" rotate="auto"
        keyPoints="0;0;1" keyTimes="0;0.07;1"
        calcMode="spline" keySplines="0 0 1 1;0.42 0 0.58 1"
      >
        <mpath href={`#${routeId}`} />
      </animateMotion>
      <animate
        attributeName="opacity" values="0;1;1;0" keyTimes="0;0.07;0.93;1"
        dur={dur} begin={begin} repeatCount="indefinite"
      />
      <path fill={fill} transform={`scale(${scale})`} d={PLANE_D} />
    </g>
  );

  // A waypoint that breathes: r and opacity together, so the ring expands as it
  // fades instead of popping back at full strength.
  const waypoint = (cx, cy, r, core, ring, delay) => (
    <>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={ring} strokeWidth="1.2">
        <animate attributeName="r" values={`${r};${r * 2.6}`} dur="2.6s" begin={delay} repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.75;0" dur="2.6s" begin={delay} repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={ring} strokeWidth="1.4" />
      <circle cx={cx} cy={cy} r={r * 0.58} fill={core} />
    </>
  );

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 360 200"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.9 }}
    >
      {/* Range arcs from the origin station */}
      {[70, 130, 190, 250].map((r) => (
        <circle key={r} cx="26" cy="182" r={r} stroke="rgba(255,90,90,0.16)" strokeWidth="1" />
      ))}

      {/* Routes — ids are referenced by the mpath above */}
      <path id="ml-route-a" d="M26 182 Q150 96 340 40" stroke="rgba(255,165,165,0.75)" strokeWidth="1.4" strokeDasharray="3 7" strokeLinecap="round" />
      <path id="ml-route-b" d="M26 182 Q140 150 330 112" stroke="rgba(255,150,150,0.55)" strokeWidth="1.3" strokeDasharray="3 7" strokeLinecap="round" />

      {waypoint(26, 182, 7, '#ffffff', 'rgba(255,255,255,0.42)', '0.8s')}
      {waypoint(340, 40, 5, '#ff4646', 'rgba(255,80,80,0.55)', '0s')}
      {waypoint(330, 112, 4.5, '#ff7676', 'rgba(255,110,110,0.45)', '1.3s')}

      {flight('ml-route-a', '7s', '0s', 0.3, '#ffffff', 'rgba(255,130,130,0.6)')}
      {flight('ml-route-b', '8.4s', '1.6s', 0.26, '#ffd9d9', 'rgba(255,130,130,0.45)')}
    </svg>
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
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <HeroSky />
        <div
          style={{
            width: 58,
            position: 'relative',
            zIndex: 1,
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
        <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
          {/* The wordmark is the one piece of type that has to feel like a badge,
              not a label — polished fill, a slow sheen across the letters, and a
              glow that lifts it off the hero. Orbitron stays: it is the brand
              face the rest of the app is set in. */}
          <div
            className="ml-wordmark"
            style={{
              fontFamily: T.fontBrand,
              fontSize: 21,
              fontWeight: 800,
              letterSpacing: '0.15em',
              // Painted by the gradient below; kept as the no-background-clip fallback.
              color: '#fff',
              lineHeight: 1.05,
              textIndent: '0.15em',   // balances the trailing letter-space
            }}
          >
            AEROGALLEY
          </div>
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 4,
            }}
          >
            <span style={{ width: 18, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.34))' }} />
            <span style={{ fontFamily: T.fontBrand, fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.66)', letterSpacing: '0.3em', textIndent: '0.3em' }}>
              CATERING
            </span>
            <span style={{ width: 18, height: 1, background: 'linear-gradient(270deg, transparent, rgba(255,255,255,0.34))' }} />
          </div>
        </div>
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

        {/* Ownership line. Hairlines either side lift it off the white so it
            reads as a signature rather than the fine print it replaced. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 34 }}>
          <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${T.border})` }} />
          <div style={{ textAlign: 'center', fontFamily: T.fontBody, lineHeight: 1.35, whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.textSecondary, letterSpacing: '0.02em' }}>
              AeroGalley Catering
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, color: T.textDisabled, letterSpacing: '0.22em', textTransform: 'uppercase', marginTop: 1 }}>
              by{' '}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  color: T.primary,
                  background: `linear-gradient(92deg, ${T.primary}, ${T.primaryDark})`,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                US-Bangla Airlines
              </span>
            </div>
          </div>
          <span style={{ flex: 1, height: 1, background: `linear-gradient(270deg, transparent, ${T.border})` }} />
        </div>
      </div>

      {toast && <MobileToast message={toast} onDismiss={() => setToast(null)} />}

      <style>{`
        @keyframes mobileSpinL { to { transform: rotate(360deg); } }

        /* Wordmark: brushed-metal fill with a highlight that sweeps across the
           letters, then rests — a constant shimmer would read as a broken GIF. */
        .ml-wordmark {
          background: linear-gradient(
            100deg,
            #ffffff 0%, #ffffff 38%,
            #fff3f3 45%, #ffdcdc 50%, #fff3f3 55%,
            #ffffff 62%, #ffffff 100%
          );
          background-size: 260% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          filter: drop-shadow(0 1px 1px rgba(0,0,0,0.35))
                  drop-shadow(0 0 14px rgba(255,120,120,0.4));
          animation: mlWordmarkSheen 6.5s ease-in-out infinite;
        }
        @keyframes mlWordmarkSheen {
          0%   { background-position: 150% 0; }
          38%  { background-position: -50% 0; }
          100% { background-position: -50% 0; }
        }

        /* Motion is decoration here; the wordmark still reads without it. */
        @media (prefers-reduced-motion: reduce) {
          .ml-wordmark { animation: none; background-position: 50% 0; }
        }
      `}</style>
    </div>
  );
}
