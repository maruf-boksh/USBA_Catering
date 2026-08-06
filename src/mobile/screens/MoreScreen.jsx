import { T } from '../theme';

const OPERATIONS = [
  { key: 'approvals',    icon: '✅', label: 'Approvals',           sub: 'Pending approvals inbox'    },
  { key: 'dispatch',     icon: '🚛', label: 'Dispatch',            sub: 'Manage flight dispatches'   },
  { key: 'dispatch-mon', icon: '📡', label: 'Dispatch Monitoring', sub: 'Cold chain & live status'   },
];

const INVENTORY = [
  { key: 'stock',   icon: '📦', label: 'Stock Overview',  sub: 'Current inventory levels'   },
  { key: 'demands', icon: '📝', label: 'Demand Requests', sub: 'Raise & track material demand' },
];

const LOCAL_PURCHASE = [
  { key: 'purchase-requisition', icon: '📋', label: 'Purchase Requisition', sub: 'Requisition, approve, receive & inspect' },
];

const GALLEY = [
  { key: 'galley-overview', icon: '🍽️', label: 'Galley Planning',  sub: 'Plans, status & stock overview' },
  { key: 'return-log',      icon: '↩️', label: 'Return Log',       sub: 'Consumable returns & reusables' },
];

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: T.textTertiary,
      fontFamily: T.fontBody, textTransform: 'uppercase',
      letterSpacing: '0.07em', marginTop: 18, marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

function MenuRow({ item, onPress }) {
  return (
    <div
      onClick={onPress}
      style={{
        background: T.bgSurface,
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusLg,
        padding: '12px 14px',
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        boxShadow: T.shadowSm,
      }}
    >
      <div style={{
        width: 42, height: 42,
        borderRadius: T.radiusMd,
        background: T.primaryLight,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, flexShrink: 0,
      }}>
        {item.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
          {item.label}
        </div>
        <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
          {item.sub}
        </div>
      </div>
      <span style={{ fontSize: 18, color: T.textTertiary, lineHeight: 1 }}>›</span>
    </div>
  );
}

export function MoreScreen({ nav, onLogout }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{ background: T.topbarGradient, padding: '12px 16px', flexShrink: 0 }}>
        <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>More</div>
        <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
          Operations & Supply Chain
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 14px 24px' }}>

        <SectionLabel>Operations</SectionLabel>
        {OPERATIONS.map(item => (
          <MenuRow key={item.key} item={item} onPress={() => nav.navigate(item.key)} />
        ))}

        <SectionLabel>Inventory &amp; Store</SectionLabel>
        {INVENTORY.map(item => (
          <MenuRow key={item.key} item={item} onPress={() => nav.navigate(item.key)} />
        ))}

        <SectionLabel>Local Purchase</SectionLabel>
        {LOCAL_PURCHASE.map(item => (
          <MenuRow key={item.key} item={item} onPress={() => nav.navigate(item.key)} />
        ))}

        <SectionLabel>Galley Planning</SectionLabel>
        {GALLEY.map(item => (
          <MenuRow key={item.key} item={item} onPress={() => nav.navigate(item.key)} />
        ))}

        {/* Sign out */}
        <div style={{ marginTop: 28, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
          <button
            onClick={onLogout}
            style={{
              width: '100%', padding: '13px 0',
              background: T.bgSurface,
              border: `1px solid ${T.statusRejected}`,
              borderRadius: T.radiusMd,
              fontSize: 14, fontWeight: 700,
              color: T.statusRejected,
              fontFamily: T.fontBody, cursor: 'pointer',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
