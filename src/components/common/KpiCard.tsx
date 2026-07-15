import React from 'react';

// Harvest Catering KPI accents — brand red leads, with status + ink variants.
// Tinted tones fade a soft status wash into white, matching the dashboard mockup.
const TONE: Record<string, { accent: string; bg: string }> = {
  navy:    { accent: '#E10101', bg: 'var(--color-bg-surface, #ffffff)' },     // brand red
  red:     { accent: '#E10101', bg: 'var(--color-bg-surface, #ffffff)' },
  success: { accent: '#0f7a40', bg: 'var(--color-bg-surface, #ffffff)' },
  warning: { accent: '#b45309', bg: 'var(--color-bg-surface, #ffffff)' },
  info:    { accent: '#3c3a40', bg: 'var(--color-bg-surface, #ffffff)' },
  ink:     { accent: '#1a0204', bg: 'var(--color-bg-surface, #ffffff)' },
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

// Aurora variant — soft white card with a pastel icon chip and a delta pill,
// matching the reference dashboard aesthetic (violet primary + pastel accents).
// Opt-in via variant="aurora" so other pages keep the default brand-red card.
const AURORA: Record<string, { chipBg: string; fg: string }> = {
  violet:  { chipBg: '#ede9fe', fg: '#7c3aed' },
  blue:    { chipBg: '#e0f2fe', fg: '#0284c7' },
  green:   { chipBg: '#dcfce7', fg: '#16a34a' },
  amber:   { chipBg: '#fef3c7', fg: '#d97706' },
  rose:    { chipBg: '#ffe4e6', fg: '#e11d48' },
  teal:    { chipBg: '#ccfbf1', fg: '#0d9488' },
  indigo:  { chipBg: '#e0e7ff', fg: '#4f46e5' },
  fuchsia: { chipBg: '#fae8ff', fg: '#c026d3' },
};

export function KpiCard({
  label, value, sub, icon, tone = 'navy', variant = 'default', hint, breakdown,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  tone?: string;
  variant?: 'default' | 'aurora';
  /** Optional plain-language explanation of what the metric means — shown as a
   *  subtle footnote so newcomers can read the card at a glance. Aurora only. */
  hint?: string;
  /** Optional compact split shown as a tinted mini-stat strip inside the card
   *  (e.g. Outbound / Return). `dir` colours a value green/red. Aurora only. */
  breakdown?: { label: string; value: string | number; dir?: 'up' | 'down' }[];
}) {
  const [hover, setHover] = React.useState(false);

  if (variant === 'aurora') {
    const a = AURORA[tone] ?? AURORA.violet;
    const valueStr = String(value);
    const curMatch = valueStr.match(/^(৳\s*)(.*)$/);
    const footer = sub ? splitDelta(sub) : null;
    const up = footer?.dir !== 'down';

    return (
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          background: 'var(--color-bg-surface, #fff)',
          border: '1px solid var(--color-border, #eef0f4)',
          borderRadius: 18,
          padding: '17px 19px 16px',
          boxShadow: hover
            ? '0 2px 4px rgba(16,24,40,.05), 0 22px 48px -28px rgba(16,24,40,.32)'
            : '0 1px 2px rgba(16,24,40,.04), 0 14px 34px -26px rgba(16,24,40,.26)',
          transform: hover ? 'translateY(-2px)' : 'none',
          transition: 'box-shadow 180ms ease, transform 180ms ease',
          height: '100%',
        }}
      >
        {/* top row: pastel icon chip + delta pill (or status badge) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 12,
            display: 'grid', placeItems: 'center', flexShrink: 0,
            color: a.fg, background: a.chipBg,
          }}>
            {React.createElement(icon, { style: { width: 18, height: 18 } })}
          </div>
          {footer?.delta ? (
            // Delta pill — arrow + value + the descriptive context (e.g.
            // "↓ 1 vs yesterday", "↑ 6% of target") so the comparison is clear.
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
              padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 600,
              color: up ? '#15803d' : '#b91c1c',
              background: up ? '#dcfce7' : '#fee2e2',
            }}>
              <span style={{ fontSize: 12, lineHeight: 1 }}>{up ? '↑' : '↓'}</span>
              {footer.delta.replace(/^[-−+]/, '')}
              {footer.rest && <span style={{ fontWeight: 500 }}>{footer.rest}</span>}
            </span>
          ) : footer?.rest ? (
            // Stat pill — the card's secondary stat, tinted with the card's own
            // accent (matching the icon chip) so the key figures read at a glance
            // (e.g. "174 pax affected", "0 critical").
            <span style={{
              display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap',
              padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 600,
              color: a.fg, background: a.chipBg,
            }}>
              {footer.rest}
            </span>
          ) : null}
        </div>

        {/* label */}
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--color-text-tertiary, #8a8f98)', marginTop: 15,
        }}>
          {label}
        </div>

        {/* number */}
        <div style={{
          fontWeight: 700, fontSize: 29, lineHeight: 1.05,
          letterSpacing: '-0.02em', marginTop: 5, color: 'var(--color-text-primary, #101828)',
        }}>
          {curMatch ? (
            <>
              <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text-tertiary, #8a8f98)', marginRight: 1 }}>
                {curMatch[1].trim()}
              </span>
              {curMatch[2]}
            </>
          ) : valueStr}
        </div>

        {/* breakdown — a compact at-a-glance split, tinted with the card accent */}
        {breakdown && breakdown.length > 0 && (
          <div style={{
            display: 'flex', marginTop: 13, borderRadius: 12, overflow: 'hidden',
            border: `1px solid ${a.chipBg}`, background: `${a.chipBg}66`,
          }}>
            {breakdown.map((b, i) => (
              <div key={b.label} style={{
                flex: 1, minWidth: 0, padding: '8px 11px',
                borderLeft: i === 0 ? 'none' : `1px solid ${a.chipBg}`,
              }}>
                <div style={{
                  fontSize: 15, fontWeight: 700, lineHeight: 1.1, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  color: b.dir === 'up' ? '#15803d' : b.dir === 'down' ? '#b91c1c' : a.fg,
                }}>{b.value}</div>
                <div style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.01em', marginTop: 3,
                  lineHeight: 1.25, color: 'var(--color-text-tertiary, #98a2b3)',
                }}>{b.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* hint — a plain-language footnote so newcomers understand the metric */}
        {hint && (
          <div style={{
            fontSize: 11, lineHeight: 1.4, marginTop: 11, paddingTop: 10,
            borderTop: '1px dashed var(--color-border, #eef0f4)',
            color: 'var(--color-text-tertiary, #98a2b3)',
          }}>
            {hint}
          </div>
        )}
      </div>
    );
  }

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
      borderRadius: 14,
      padding: '13px 15px 12px',
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
          fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: 'var(--muted-foreground, #6b6b72)',
        }}>
          {label}
        </span>
        <div style={{
          width: 31, height: 31, borderRadius: 9,
          display: 'grid', placeItems: 'center', flexShrink: 0,
          color: '#fff', background: t.accent,
          boxShadow: `0 8px 18px -9px ${t.accent}`,
        }}>
          {React.createElement(icon, { style: { width: 15, height: 15 } })}
        </div>
      </div>

      {/* number */}
      <div style={{
        fontFamily: "var(--serif, 'Newsreader', Georgia, serif)",
        fontWeight: 600, fontSize: 30, lineHeight: 1,
        letterSpacing: '-0.015em', marginTop: 9,
        color: 'var(--ink, #1a0204)',
      }}>
        {curMatch ? (
          <>
            <span style={{ fontSize: 18, fontWeight: 500, color: 'var(--muted-foreground, #6b6b72)', marginRight: 1 }}>
              {curMatch[1].trim()}
            </span>
            {curMatch[2]}
          </>
        ) : valueStr}
      </div>

      {/* sub / delta footer */}
      {footer && (
        <div style={{ fontSize: 11, color: 'var(--muted-foreground, #6b6b72)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
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
