import { useEffect } from 'react';
import { T } from '../theme';

export function SplashScreen({ onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2350);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div style={{
      flex: 1,
      background: T.heroGradient,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      position: 'relative',
    }}>

      {/* Subtle background rings */}
      <div style={{
        position: 'absolute',
        width: 320, height: 320,
        borderRadius: T.radiusFull,
        border: '1px solid rgba(255,255,255,0.05)',
        animation: 'ringPulse 3s ease-in-out 0.5s infinite',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        width: 220, height: 220,
        borderRadius: T.radiusFull,
        border: '1px solid rgba(255,255,255,0.08)',
        animation: 'ringPulse 3s ease-in-out 0.9s infinite',
        pointerEvents: 'none',
      }} />

      {/* ── Flight group — takes off upward at 1.5 s ── */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        animation: 'flightTakeOff 0.75s ease-in 1.5s forwards',
      }}>
        {/* Flight trail — dots arc above the plane */}
        <div style={{
          display: 'flex',
          gap: 8,
          marginBottom: 10,
          animation: 'trailIn 0.6s ease-out 0.6s both',
        }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{
              width: i < 2 ? 3 : 4,
              height: i < 2 ? 3 : 4,
              borderRadius: T.radiusFull,
              background: `rgba(255,255,255,${0.12 + i * 0.1})`,
              animation: `trailDot 1.8s ease-in-out ${0.1 * i}s infinite`,
            }} />
          ))}
        </div>

        {/* Logo tile */}
        <div style={{
          width: 90, height: 90,
          borderRadius: 24,
          background: 'rgba(255,255,255,0.11)',
          border: '1.5px solid rgba(255,255,255,0.24)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(14px)',
          animation: 'tileIn 0.55s cubic-bezier(0.34,1.56,0.64,1) both, tilePulse 3s ease-in-out 0.8s infinite',
          marginBottom: 6,
        }}>
          {/* Airplane — entry arc then continuous float */}
          <div style={{ animation: 'planeEntry 0.75s cubic-bezier(0.22,1.4,0.36,1) 0.15s both' }}>
            <div style={{ animation: 'planeFloat 3.2s ease-in-out 0.9s infinite' }}>
              {/* was: width="46" height="46" */}
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2h0A1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L21 16z"
                  fill="white"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
      {/* ── end flight group ── */}

      {/* Brand wordmark */}
      <div style={{
        textAlign: 'center',
        lineHeight: 1,
        animation: 'textUp 0.5s ease-out 0.5s both',
        marginBottom: 6,
      }}>
        <div style={{
          fontFamily: T.fontBrand,
          fontSize: 25,
          fontWeight: 700,
          letterSpacing: '0.15em',
          color: '#ffffff',
          textTransform: 'uppercase',
        }}>
          AEROGALLEY
        </div>
        <div style={{
          fontFamily: T.fontBrand,
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.35em',
          color: 'rgba(255,255,255,0.62)',
          textTransform: 'uppercase',
          marginTop: 5,
        }}>
          CATERING
        </div>
      </div>

      {/* Divider line */}
      <div style={{
        width: 40,
        height: 1,
        background: 'rgba(255,255,255,0.18)',
        borderRadius: 1,
        animation: 'textUp 0.45s ease-out 0.65s both',
        marginBottom: 8,
      }} />

      {/* Tagline */}
      <div style={{
        fontFamily: T.fontBody,
        fontSize: 12,
        color: 'rgba(255,255,255,0.48)',
        letterSpacing: '0.06em',
        animation: 'textUp 0.45s ease-out 0.72s both',
      }}>
        Aviation Catering Operations
      </div>

      {/* Loading dots */}
      <div style={{
        display: 'flex',
        gap: 7,
        marginTop: 44,
        animation: 'fadeIn 0.4s ease-out 1s both',
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 7, height: 7,
            borderRadius: T.radiusFull,
            background: 'rgba(255,255,255,0.6)',
            animation: `splashDot 1.3s ease-in-out ${i * 0.22}s infinite`,
          }} />
        ))}
      </div>

      {/* Version */}
      <div style={{
        position: 'absolute',
        bottom: 20,
        fontFamily: T.fontBody,
        fontSize: 10,
        color: 'rgba(255,255,255,0.22)',
        letterSpacing: '0.04em',
        animation: 'fadeIn 0.5s ease-out 1.2s both',
      }}>
        v2.4
      </div>

      <style>{`
        @keyframes tileIn {
          from { transform: scale(0.45) translateY(24px); opacity: 0; }
          to   { transform: scale(1)    translateY(0);    opacity: 1; }
        }
        @keyframes tilePulse {
          0%, 100% { box-shadow: 0 0  0  0   rgba(255,255,255,0.06); }
          50%       { box-shadow: 0 0 28px 10px rgba(255,255,255,0.13); }
        }
        @keyframes planeEntry {
          from { transform: translate(18px, 22px) rotate(28deg) scale(0.45); opacity: 0; }
          to   { transform: translate(0,    0)    rotate(0deg)  scale(1);    opacity: 1; }
        }
        @keyframes planeFloat {
          /* was: 30% rotate(-4deg), 65% rotate(2deg) — removed tilt */
          0%, 100% { transform: translateY(0px);  }
          30%      { transform: translateY(-5px); }
          65%      { transform: translateY(-1px); }
        }
        @keyframes textUp {
          from { transform: translateY(14px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes trailIn {
          from { opacity: 0; transform: translateX(-10px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes trailDot {
          0%, 80%, 100% { opacity: 0.15; transform: scale(0.7); }
          40%            { opacity: 0.7;  transform: scale(1.2); }
        }
        @keyframes splashDot {
          0%, 80%, 100% { opacity: 0.22; transform: scale(0.72); }
          40%            { opacity: 1;    transform: scale(1.22); }
        }
        @keyframes ringPulse {
          0%, 100% { transform: scale(0.95); opacity: 0.5; }
          50%       { transform: scale(1.05); opacity: 1;   }
        }
        @keyframes flightTakeOff {
          /* was: 20% rotate(-8deg), 100% rotate(-14deg) — removed tilt */
          0%   { transform: translateY(0);      opacity: 1; }
          20%  { transform: translateY(-40px);  opacity: 1; }
          100% { transform: translateY(-680px); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
