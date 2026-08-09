import { T } from '../theme';

const TABS = [
  {
    key: 'home',
    label: 'Home',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M3 12L12 3l9 9" stroke={active ? T.primary : T.textTertiary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M9 21V12h6v9" stroke={active ? T.primary : T.textTertiary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5 10v11h14V10" stroke={active ? T.primary : T.textTertiary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'orders',
    label: 'Orders',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="3" stroke={active ? T.primary : T.textTertiary} strokeWidth="2"/>
        <path d="M7 8h10M7 12h7M7 16h5" stroke={active ? T.primary : T.textTertiary} strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    key: 'production',
    label: 'Production',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L2 7l10 5 10-5-10-5z" stroke={active ? T.primary : T.textTertiary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 17l10 5 10-5" stroke={active ? T.primary : T.textTertiary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 12l10 5 10-5" stroke={active ? T.primary : T.textTertiary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'qc',
    label: 'QC',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M9 11l3 3L22 4" stroke={active ? T.primary : T.textTertiary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke={active ? T.primary : T.textTertiary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'approvals',
    label: 'Approvals',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M9 4h6a1 1 0 011 1v1h2a1 1 0 011 1v13a1 1 0 01-1 1H6a1 1 0 01-1-1V7a1 1 0 011-1h2V5a1 1 0 011-1z" stroke={active ? T.primary : T.textTertiary} strokeWidth="2" strokeLinejoin="round"/>
        <path d="M9 13l2.2 2.2L15.5 11" stroke={active ? T.primary : T.textTertiary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'more',
    label: 'More',
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="5" cy="12" r="1.5" fill={active ? T.primary : T.textTertiary}/>
        <circle cx="12" cy="12" r="1.5" fill={active ? T.primary : T.textTertiary}/>
        <circle cx="19" cy="12" r="1.5" fill={active ? T.primary : T.textTertiary}/>
      </svg>
    ),
  },
];

export function BottomNav({ activeTab, onTabPress, alertBadge = 0, approvalBadge = 0 }) {
  // Each tab owns at most one count; keyed here so the badge block below stays
  // one branch instead of one per tab.
  const badgeFor = { home: alertBadge, approvals: approvalBadge };

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
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        const badge  = badgeFor[tab.key] ?? 0;
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

            {/* Count badge — alerts on Home, pending items on Approvals */}
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

            {/* 9.5px, not 10: six tabs leave ~62px each and "Production" /
                "Approvals" wrap at the larger size. */}
            <span
              style={{
                fontSize: 9.5,
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
