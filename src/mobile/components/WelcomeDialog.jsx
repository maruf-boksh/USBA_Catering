import { useEffect, useState } from 'react';
import { T } from '../theme';
import { getAuthUser } from '@/lib/auth';

// Same time-of-day greeting the home topbar uses, so the toast and the screen
// behind it never disagree about whether it is morning.
function greetingForNow() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function initialsOf(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/**
 * Post sign-in welcome — a single-line pill that slides in from the right edge,
 * just under the home topbar.
 *
 * Deliberately not a modal: a greeting is an acknowledgement, not a decision, so
 * it takes no tap and blocks nothing. It sits above the dashboard, auto-retires
 * after 3.5s, and a tap dismisses it early.
 */
export function WelcomeDialog({ onClose }) {
  const [closing, setClosing] = useState(false);
  const user  = getAuthUser();
  const name  = user?.name ?? 'Guest User';
  const first = name.split(/\s+/)[0];
  const photo = user?.photoUrl;

  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 220); // let the slide-out finish before unmounting
  };

  useEffect(() => {
    const id = setTimeout(dismiss, 3500);
    return () => clearTimeout(id);
  }, []);

  return (
    // Wrapper is click-through (pointerEvents: none) so the dashboard stays fully
    // usable underneath — only the pill itself takes a tap.
    <div style={{ position: 'absolute', inset: 0, zIndex: 200, pointerEvents: 'none' }}>
      <style>{`
        @keyframes mobileWelcomeIn {
          from { opacity: 0; transform: translateX(115%) }
          to   { opacity: 1; transform: none }
        }
        @keyframes mobileWelcomeOut {
          from { opacity: 1; transform: none }
          to   { opacity: 0; transform: translateX(115%) }
        }
      `}</style>

      <div
        onClick={dismiss}
        role="status"
        style={{
          position: 'absolute',
          top: 84,          // clears the two-row home topbar
          right: 12,
          maxWidth: 'calc(100% - 24px)',
          pointerEvents: 'auto',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px 7px 7px',
          background: T.bgSurface,
          border: `1px solid ${T.border}`,
          borderLeft: `3px solid ${T.primary}`,
          borderRadius: T.radiusFull,
          boxShadow: T.shadowLg,
          fontFamily: T.fontBody,
          whiteSpace: 'nowrap',
          animation: `${closing ? 'mobileWelcomeOut' : 'mobileWelcomeIn'} 0.26s cubic-bezier(0.16,1,0.3,1) both`,
        }}
      >
        {photo ? (
          <img
            src={photo}
            alt=""
            style={{ width: 24, height: 24, borderRadius: T.radiusFull, objectFit: 'cover', flexShrink: 0, display: 'block' }}
          />
        ) : (
          <span style={{
            width: 24, height: 24, borderRadius: T.radiusFull, flexShrink: 0,
            background: T.buttonGradient, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 800,
          }}>
            {initialsOf(name)}
          </span>
        )}
        <span style={{
          fontSize: 12, fontWeight: 600, color: T.textSecondary,
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          Welcome back, <strong style={{ color: T.textPrimary, fontWeight: 800 }}>{first}</strong> — good {greetingForNow()}
        </span>
      </div>
    </div>
  );
}
