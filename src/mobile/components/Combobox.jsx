import { useState, useRef, useEffect } from 'react';
import { T } from '../theme';

/**
 * In-frame combobox — a type-or-pick dropdown that renders INSIDE the mobile
 * phone frame (unlike the native <datalist>, whose popup escapes the frame and
 * overflows the viewport). Free text is allowed; `onChange` fires on both typing
 * and selecting, so callers can still auto-fill related fields on pick.
 */
export function Combobox({
  value,
  onChange,
  options = [],
  placeholder,
  invalid = false,
  disabled = false,
  containerStyle,
  maxVisible = 60,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close when tapping/clicking anywhere outside the field + dropdown.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  const q = String(value || '').trim().toLowerCase();
  const filtered = (q ? options.filter((o) => o.toLowerCase().includes(q)) : options).slice(0, maxVisible);

  return (
    <div ref={ref} style={{ position: 'relative', ...containerStyle }}>
      <input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => setOpen(true)}
        style={{
          width: '100%', boxSizing: 'border-box',
          border: `1px solid ${invalid ? T.statusRejected : T.border}`,
          borderRadius: T.radiusMd, padding: '10px 32px 10px 12px',
          fontSize: 13, fontFamily: T.fontBody, outline: 'none',
          background: T.bgSurface, color: T.textPrimary,
        }}
      />
      {/* chevron toggle */}
      <span
        onMouseDown={(e) => { e.preventDefault(); if (!disabled) setOpen((o) => !o); }}
        style={{
          position: 'absolute', right: 11, top: '50%', transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`,
          color: T.textTertiary, fontSize: 10, cursor: disabled ? 'default' : 'pointer',
          transition: 'transform 120ms ease', userSelect: 'none',
        }}
      >
        ▼
      </span>

      {open && !disabled && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 60,
          background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusMd,
          boxShadow: T.shadowLg, maxHeight: 208, overflowY: 'auto',
        }}>
          {filtered.map((opt) => {
            const active = opt.toLowerCase() === q;
            return (
              <div
                key={opt}
                onMouseDown={(e) => { e.preventDefault(); onChange(opt); setOpen(false); }}
                style={{
                  padding: '9px 12px', fontSize: 13, fontFamily: T.fontBody, color: T.textPrimary,
                  cursor: 'pointer', borderTop: `1px solid ${T.border}`,
                  background: active ? T.bgSubtle : 'transparent',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = T.bgSubtle; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = active ? T.bgSubtle : 'transparent'; }}
              >
                {opt}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
