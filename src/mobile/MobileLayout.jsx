import { useEffect, useState } from 'react';
import { T } from './theme';

// Phone outer dimensions including the 10px bezel border on each side
const FRAME_OUTER_W = T.frameWidth  + 20;
const FRAME_OUTER_H = T.frameHeight + 20;

function StatusClock() {
  const [time, setTime] = useState(() => {
    const d = new Date();
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  });
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setTime(d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0'));
    }, 30000);
    return () => clearInterval(id);
  }, []);
  return <span>{time}</span>;
}

export function MobileLayout({ children, onClose }) {
  // Scale the phone frame so it always fits inside the viewport with breathing room.
  // Layout box is set to the *scaled* visual size so flexbox centers it correctly.
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const calc = () => {
      const availH = window.innerHeight - 80;  // 40px top + 40px bottom breathing room
      const availW = window.innerWidth  - 140; // space for close button + side margin
      setScale(Math.min(1, availH / FRAME_OUTER_H, availW / FRAME_OUTER_W));
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.78)',
        backdropFilter: 'blur(5px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {/* Layout box — matches the VISUAL scaled size so flex centres it correctly.
          The actual phone is rendered at full size and shrunk via transform. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          flexShrink: 0,
          width:  FRAME_OUTER_W * scale,
          height: FRAME_OUTER_H * scale,
        }}
      >
        {/* Close button — lives outside the scaled phone, top-right */}
        <button
          onClick={onClose}
          aria-label="Close mobile preview"
          style={{
            position: 'absolute',
            top: 0,
            right: -44,
            width: 36,
            height: 36,
            borderRadius: T.radiusFull,
            border: '1.5px solid rgba(255,255,255,0.25)',
            background: 'rgba(255,255,255,0.12)',
            color: '#fff',
            fontSize: 20,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(8px)',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.22)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
        >
          ×
        </button>

        {/* Phone frame — full size, scaled down from the top-left corner of the layout box */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transformOrigin: 'top left',
            transform: `scale(${scale})`,
            width:  FRAME_OUTER_W,
            height: FRAME_OUTER_H,
          }}
        >
          <div
            style={{
              width: T.frameWidth,
              height: T.frameHeight,
              border: `10px solid ${T.frameBezel}`,
              borderRadius: T.frameRadius,
              overflow: 'hidden',
              background: T.bgSurface,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 32px 96px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.05)',
              position: 'relative',
            }}
          >
            {/* Status bar */}
            <div
              style={{
                height: T.statusBarHeight,
                background: T.primary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 16px',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, letterSpacing: '0.04em' }}>
                <StatusClock />
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {/* Signal bars */}
                <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
                  <rect x="0"  y="6" width="3" height="4" rx="0.5" fill="white"/>
                  <rect x="4"  y="4" width="3" height="6" rx="0.5" fill="white"/>
                  <rect x="8"  y="2" width="3" height="8" rx="0.5" fill="white"/>
                  <rect x="12" y="0" width="2" height="10" rx="0.5" fill="rgba(255,255,255,0.35)"/>
                </svg>
                {/* WiFi */}
                <svg width="13" height="10" viewBox="0 0 13 10" fill="none">
                  <circle cx="6.5" cy="8.5" r="1" fill="white"/>
                  <path d="M3.8 6.1A3.7 3.7 0 0 1 6.5 5a3.7 3.7 0 0 1 2.7 1.1" stroke="white" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
                  <path d="M1.2 3.6A7 7 0 0 1 6.5 1.5a7 7 0 0 1 5.3 2.1" stroke="white" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.55"/>
                </svg>
                {/* Battery */}
                <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
                  <rect x="0.5" y="1.5" width="16" height="7" rx="1.5" stroke="white" strokeWidth="1"/>
                  <rect x="1.5" y="2.5" width="12" height="5" rx="0.5" fill="white"/>
                  <path d="M17.5 3.5v3" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
            </div>

            {/* Screen content */}
            <div
              style={{
                flex: 1,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                background: T.bgBase,
              }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
