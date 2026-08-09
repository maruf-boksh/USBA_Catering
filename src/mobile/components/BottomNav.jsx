import { T } from '../theme';
import { navItem, MORE_TAB } from '../nav-config';

/**
 * The bottom bar. Which modules appear is the user's choice (Bottom Bar screen,
 * persisted in nav-config); More is always pinned last so nothing the user did
 * not promote becomes unreachable.
 *
 * `badges` is keyed by tab id, so a count follows its module onto and off the
 * bar without this component knowing what any of them mean.
 */
export function BottomNav({ tabs, activeTab, onTabPress, badges = {} }) {
  const items = [...tabs.map(navItem).filter(Boolean), MORE_TAB];

  return (
    <div
      style={{
        height: T.bottomNavHeight,
        background: T.bgSurface,
        borderTop: `1px solid ${T.border}`,
        display: 'flex',
        alignItems: 'stretch',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {items.map((tab) => {
        const active = activeTab === tab.key;
        const badge  = badges[tab.key] ?? 0;
        return (
          <button
            key={tab.key}
            onClick={() => onTabPress(tab.key)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '6px 0 4px',
              position: 'relative',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {/* Active indicator line at top */}
            {active && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '20%',
                  right: '20%',
                  height: 2,
                  background: T.primary,
                  borderRadius: '0 0 2px 2px',
                }}
              />
            )}

            {/* Count badge — whichever module owns one */}
            <div style={{ position: 'relative' }}>
              {tab.icon(active)}
              {badge > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -6,
                    background: T.primary,
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 700,
                    fontFamily: T.fontBody,
                    minWidth: 14,
                    height: 14,
                    borderRadius: T.radiusFull,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 3px',
                    border: `1.5px solid ${T.bgSurface}`,
                  }}
                >
                  {badge > 9 ? '9+' : badge}
                </div>
              )}
            </div>

            <span
              style={{
                fontSize: 10,
                fontFamily: T.fontBody,
                fontWeight: active ? 700 : 500,
                color: active ? T.primary : T.textTertiary,
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
