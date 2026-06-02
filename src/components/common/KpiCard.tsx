import React from 'react';

// Harvest Catering KPI accents — brand red leads, with status + ink variants.
// Tinted tones fade a soft status wash into white, matching the dashboard mockup.
const TONE: Record<string, { accent: string; bg: string }> = {
  navy:    { accent: '#E10101', bg: '#ffffff' },                              // brand red
  red:     { accent: '#E10101', bg: 'linear-gradient(180deg,#fdecea,#fff 70%)' },
  success: { accent: '#0f7a40', bg: '#ffffff' },
  warning: { accent: '#b45309', bg: 'linear-gradient(180deg,#fbf1e6,#fff 70%)' },
  info:    { accent: '#3c3a40', bg: '#ffffff' },
  ink:     { accent: '#1a0204', bg: '#ffffff' },
};

// A leading delta token in the sub-line (e.g. "+1", "−14", "9%") gets colored:
// negative → bad/red, otherwise → ok/green. Plain counts ("1 catering related")
// stay muted so we don't paint every footer.
function splitDelta(sub: string): { delta?: string; dir?: 'up' | 'down'; rest: string } {
  const [first, ...others] = sub.split(' ');
  const rest = others.join(' ');
  const isSigned = /^[+\-−]/.test(first);
  const isPct = /^\d+(\.\d+)?%$/.test(first);
  if (isSigned || isPct) {
    const dir: 'up' | 'down' = /^[-−]/.test(first) ? 'down' : 'up';
    return { delta: first, dir, rest };
  }
  return { rest: sub };
}

export function KpiCard({
  label, value, sub, icon, tone = 'navy',
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  tone?: keyof typeof TONE;
}) {
  const t = TONE[tone] ?? TONE.navy;

  // Render a leading currency glyph (৳) smaller, like the mockup's `.cur` span.
  const valueStr = String(value);
  const curMatch = valueStr.match(/^(৳\s*)(.*)$/);

  const footer = sub ? splitDelta(sub) : null;

  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: t.bg,
      border: '1px solid var(--line, #e6e2e0)',
      borderRadius: 16,
      padding: '18px 18px 16px',
      boxShadow: '0 1px 2px rgba(26,2,4,.04), 0 12px 30px -22px rgba(26,2,4,.18)',
      transition: 'box-shadow 150ms, transform 150ms',
      height: '100%',
    }}>
      {/* left accent bar */}
      <span style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: t.accent, borderRadius: 0, opacity: 0.85,
      }} />

      {/* top row: label + icon */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: '0.13em',
          textTransform: 'uppercase', color: 'var(--muted-foreground, #6b6b72)',
        }}>
          {label}
        </span>
        <div style={{
          width: 38, height: 38, borderRadius: 11,
          display: 'grid', placeItems: 'center', flexShrink: 0,
          color: '#fff', background: t.accent,
          boxShadow: `0 8px 18px -9px ${t.accent}`,
        }}>
          {React.createElement(icon, { style: { width: 18, height: 18 } })}
        </div>
      </div>

      {/* number */}
      <div style={{
        fontFamily: "var(--serif, 'Newsreader', Georgia, serif)",
        fontWeight: 600, fontSize: 42, lineHeight: 1,
        letterSpacing: '-0.015em', marginTop: 14,
        color: 'var(--ink, #1a0204)',
      }}>
        {curMatch ? (
          <>
            <span style={{ fontSize: 24, fontWeight: 500, color: 'var(--muted-foreground, #6b6b72)', marginRight: 1 }}>
              {curMatch[1].trim()}
            </span>
            {curMatch[2]}
          </>
        ) : valueStr}
      </div>

      {/* sub / delta footer */}
      {footer && (
        <div style={{ fontSize: 12, color: 'var(--muted-foreground, #6b6b72)', marginTop: 9, display: 'flex', alignItems: 'center', gap: 6 }}>
          {footer.delta && (
            <span style={{
              fontWeight: 600,
              color: footer.dir === 'down' ? '#E10101' : '#0f7a40',
            }}>
              {footer.delta}
            </span>
          )}
          {footer.delta ? footer.rest : footer.rest}
        </div>
      )}
    </div>
  );
}
