import { T } from '../theme';
import {
  NAV_CATALOGUE, MORE_TAB, navItem,
  MIN_NAV_TABS, MAX_NAV_TABS, DEFAULT_NAV_KEYS, isDefaultNavTabs,
} from '../nav-config';

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };

function SectionLabel({ children, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '18px 2px 8px' }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        {children}
      </span>
      {hint && <span style={{ fontSize: 10, color: T.textDisabled, fontFamily: T.fontBody }}>{hint}</span>}
    </div>
  );
}

// Small square icon well — same idiom as the More rows, but carrying the real
// bar icon so the picker shows exactly what will land on the bar.
function IconWell({ item, active }) {
  return (
    <div style={{
      width: 34, height: 34, borderRadius: T.radiusMd, flexShrink: 0,
      background: active ? T.primaryLight : T.bgSubtle,
      border: `1px solid ${active ? T.primary + '55' : T.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {item.icon(active)}
    </div>
  );
}

/**
 * Bottom Bar — pick the modules on the nav bar.
 *
 * Two lists rather than one list of checkboxes: the top one is ordered (it IS
 * the bar, left to right), the bottom one is everything still available. More is
 * shown greyed in the preview so it is obvious it cannot be removed.
 */
export function NavSettingsScreen({ nav }) {
  const tabs = nav.navTabs;
  const atMax = tabs.length >= MAX_NAV_TABS;
  const atMin = tabs.length <= MIN_NAV_TABS;

  const add    = (key) => { if (!atMax) nav.setNavTabs([...tabs, key]); };
  const remove = (key) => { if (!atMin) nav.setNavTabs(tabs.filter((k) => k !== key)); };
  const move   = (i, d) => {
    const next = [...tabs];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    nav.setNavTabs(next);
  };

  const available = NAV_CATALOGUE.filter((i) => !tabs.includes(i.key));
  const groups = available.reduce((acc, i) => {
    (acc[i.group] = acc[i.group] || []).push(i);
    return acc;
  }, {});

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={BTN_BACK}>←</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Bottom Bar</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 1 }}>
            Choose the modules you use most
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 14px 24px' }}>

        {/* Live preview — the real bar, rendered at rest */}
        <SectionLabel>Preview</SectionLabel>
        <div style={{
          background: T.bgSurface, border: `1px solid ${T.border}`,
          borderRadius: T.radiusLg, boxShadow: T.shadowSm, overflow: 'hidden',
          display: 'flex', padding: '9px 0',
        }}>
          {[...tabs.map(navItem).filter(Boolean), MORE_TAB].map((item, i) => (
            <div key={item.key} style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 3,
              opacity: item.key === 'more' ? 0.5 : 1,
            }}>
              {item.icon(i === 0)}
              <span style={{
                fontSize: 9, fontFamily: T.fontBody, whiteSpace: 'nowrap',
                fontWeight: i === 0 ? 700 : 500,
                color: i === 0 ? T.primary : T.textTertiary,
              }}>
                {item.label}
              </span>
            </div>
          ))}
        </div>

        {/* ── On the bar ── */}
        <SectionLabel hint={`${tabs.length} of ${MAX_NAV_TABS}`}>On the bar</SectionLabel>
        {tabs.map((key, i) => {
          const item = navItem(key);
          if (!item) return null;
          return (
            <div key={key} style={{
              background: T.bgSurface, border: `1px solid ${T.border}`,
              borderRadius: T.radiusLg, padding: '9px 10px', marginBottom: 8,
              display: 'flex', alignItems: 'center', gap: 10, boxShadow: T.shadowSm,
            }}>
              <IconWell item={item} active />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{item.name}</div>
                <div style={{ fontSize: 10.5, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 1 }}>
                  Slot {i + 1} · shows as “{item.label}”
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <StepBtn label="↑" disabled={i === 0}               onPress={() => move(i, -1)} />
                <StepBtn label="↓" disabled={i === tabs.length - 1} onPress={() => move(i, +1)} />
                <StepBtn label="✕" danger disabled={atMin}          onPress={() => remove(key)} />
              </div>
            </div>
          );
        })}
        {atMin && (
          <div style={{ fontSize: 10.5, color: T.textDisabled, fontFamily: T.fontBody, margin: '-2px 2px 0' }}>
            At least {MIN_NAV_TABS} modules must stay on the bar.
          </div>
        )}

        {/* ── Everything else ── */}
        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <SectionLabel hint={atMax ? 'bar is full' : undefined}>{group}</SectionLabel>
            {items.map((item) => (
              <div
                key={item.key}
                onClick={() => add(item.key)}
                style={{
                  background: T.bgSurface, border: `1px solid ${T.border}`,
                  borderRadius: T.radiusLg, padding: '9px 10px', marginBottom: 8,
                  display: 'flex', alignItems: 'center', gap: 10,
                  cursor: atMax ? 'not-allowed' : 'pointer',
                  opacity: atMax ? 0.45 : 1,
                }}
              >
                <IconWell item={item} active={false} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{item.name}</div>
                  <div style={{ fontSize: 10.5, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 1 }}>
                    Shows as “{item.label}”
                  </div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, fontFamily: T.fontBody,
                  color: atMax ? T.textDisabled : T.primary,
                  border: `1px solid ${atMax ? T.border : T.primary + '55'}`,
                  background: atMax ? 'transparent' : T.primaryLight,
                  borderRadius: T.radiusFull, padding: '4px 10px', flexShrink: 0,
                }}>
                  + Add
                </span>
              </div>
            ))}
          </div>
        ))}

        <button
          onClick={() => nav.setNavTabs([...DEFAULT_NAV_KEYS])}
          disabled={isDefaultNavTabs(tabs)}
          style={{
            width: '100%', marginTop: 14, padding: '11px 0',
            background: T.bgSurface, border: `1px solid ${T.border}`,
            borderRadius: T.radiusMd, fontFamily: T.fontBody,
            fontSize: 13, fontWeight: 700,
            color: isDefaultNavTabs(tabs) ? T.textDisabled : T.textSecondary,
            cursor: isDefaultNavTabs(tabs) ? 'default' : 'pointer',
          }}
        >
          Reset to default bar
        </button>

        <div style={{ fontSize: 10.5, color: T.textDisabled, fontFamily: T.fontBody, textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
          More is always on the bar — everything you leave off is still one tap away inside it.
        </div>
      </div>
    </div>
  );
}

function StepBtn({ label, onPress, disabled, danger }) {
  return (
    <button
      onClick={onPress}
      disabled={disabled}
      style={{
        width: 28, height: 28, borderRadius: T.radiusMd,
        border: `1px solid ${T.border}`, background: T.bgSubtle,
        color: disabled ? T.textDisabled : (danger ? T.statusRejected : T.textSecondary),
        fontSize: 12, fontFamily: T.fontBody, lineHeight: 1,
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {label}
    </button>
  );
}
