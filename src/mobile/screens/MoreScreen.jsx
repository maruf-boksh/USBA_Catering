import { useState } from 'react';
import { T } from '../theme';

const OPERATIONS = [
  { key: 'approvals',    icon: '✅', label: 'Approvals',           sub: 'Pending approvals inbox'    },
  { key: 'delay-management', icon: '⏱️', label: 'Delay Management', sub: 'Log delays & track refreshments' },
  { key: 'packaging',    icon: '📦', label: 'Packaging',           sub: 'Pack flight labels & mark done' },
  { key: 'wastage',      icon: '🗑️', label: 'Wastage Management',  sub: 'Disposal reports & approvals' },
  // Dispatch and Dispatch Monitoring are one module: the hub carries both as
  // sub-tabs, so the menu offers one card rather than two overlapping ones.
  { key: 'dispatch',     icon: '🚛', label: 'Dispatch',            sub: 'Dispatch board & monitoring' },
];

const INVENTORY = [
  { key: 'stock',   icon: '📦', label: 'Stock Overview',  sub: 'Current inventory levels'   },
  { key: 'demands', icon: '📝', label: 'Demand Requests', sub: 'Raise & track material demand' },
];

// All three open the same Local Purchase screen, each landing on its own stage
// of the cycle — the stages were only reachable as tabs before.
const LOCAL_PURCHASE = [
  { key: 'purchase-requisition', icon: '📋', label: 'Purchase Requisition', sub: 'Raise & approve requisitions' },
  { key: 'purchase-receive',     icon: '📥', label: 'Receive Items',        sub: 'Goods receipt against a requisition' },
  { key: 'purchase-qc',          icon: '🔍', label: 'Quality Control',      sub: 'Inspect receipts · accept or reject' },
];

const GALLEY = [
  { key: 'galley-overview', icon: '🍽️', label: 'Galley Planning',  sub: 'Plans, status & stock overview' },
  { key: 'return-log',      icon: '↩️', label: 'Return Log',       sub: 'Consumable returns & reusables' },
];

const SETTINGS = [
  { key: 'nav-settings', icon: '🧭', label: 'Bottom Bar',   sub: 'Choose the modules on the nav bar' },
  { key: 'theme',   icon: '🎨', label: 'Theme & Appearance', sub: 'Colour theme, dark mode & font size' },
  { key: 'profile', icon: '👤', label: 'Profile',            sub: 'Account details & sign out' },
];

/*
 * The module sections, in menu order. Everything here is user-editable through
 * Edit; Settings is deliberately left out of the list so the doors to Theme,
 * Bottom Bar and Profile can never be closed from inside the app.
 */
const SECTIONS = [
  { label: 'Operations',        items: OPERATIONS },
  { label: 'Inventory & Store', items: INVENTORY },
  { label: 'Local Purchase',    items: LOCAL_PURCHASE },
  { label: 'Galley Planning',   items: GALLEY },
];

/*
 * Persisted list customisation.
 *
 * Stored as the keys the user REMOVED rather than the ones kept: a module added
 * to the menu in a later build then appears for everyone by default, instead of
 * staying invisible to whoever had already saved a list. The default settings
 * are therefore simply "nothing removed" — which is what Reset writes back.
 */
const MORE_KEY = 'aerogalley-mobile-more-v1';
const DEFAULT_HIDDEN = [];
const EDITABLE_KEYS = new Set(SECTIONS.flatMap((s) => s.items.map((i) => i.key)));

function sanitizeHidden(keys) {
  const clean = [];
  for (const k of Array.isArray(keys) ? keys : []) {
    if (EDITABLE_KEYS.has(k) && !clean.includes(k)) clean.push(k);
  }
  return clean;
}

function loadMoreHidden() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(MORE_KEY) || 'null'); } catch { /* ignore */ }
  return sanitizeHidden(saved);
}

function saveMoreHidden(keys) {
  const clean = sanitizeHidden(keys);
  try { localStorage.setItem(MORE_KEY, JSON.stringify(clean)); } catch { /* ignore */ }
  return clean;
}

function SectionLabel({ children, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 10, marginTop: 18, marginBottom: 8, minHeight: 24,
    }}>
      <span style={{
        fontSize: 11, fontWeight: 700, color: T.textTertiary,
        fontFamily: T.fontBody, textTransform: 'uppercase',
        letterSpacing: '0.07em',
      }}>
        {children}
      </span>
      {right}
    </div>
  );
}

function MenuRow({ item, onPress, editing = false, hidden = false, onToggle }) {
  const dimmed = editing && hidden;
  return (
    <div
      onClick={editing ? undefined : onPress}
      style={{
        background: T.bgSurface,
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusLg,
        padding: '12px 14px',
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: editing ? 'default' : 'pointer',
        boxShadow: T.shadowSm,
        opacity: dimmed ? 0.55 : 1,
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
          {hidden && editing ? 'Removed from this list' : item.sub}
        </div>
      </div>
      {editing ? (
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          style={{
            flexShrink: 0, padding: '5px 11px',
            borderRadius: T.radiusFull,
            fontFamily: T.fontBody, fontSize: 11, fontWeight: 700,
            cursor: 'pointer',
            background: hidden ? T.primaryLight : T.bgSubtle,
            border: `1px solid ${hidden ? T.primary + '55' : T.statusRejected + '55'}`,
            color: hidden ? T.primary : T.statusRejected,
          }}
        >
          {hidden ? '+ Add' : '✕ Remove'}
        </button>
      ) : (
        <span style={{ fontSize: 18, color: T.textTertiary, lineHeight: 1 }}>›</span>
      )}
    </div>
  );
}

export function MoreScreen({ nav, onLogout }) {
  // Edit mode is a view state only — it starts off on every open, and no
  // navigation happens while it is on.
  const [editing, setEditing] = useState(false);
  const [hidden, setHiddenState] = useState(loadMoreHidden);
  const setHidden = (keys) => setHiddenState(saveMoreHidden(keys));

  const isHidden  = (key) => hidden.includes(key);
  const toggleKey = (key) => setHidden(isHidden(key) ? hidden.filter((k) => k !== key) : [...hidden, key]);
  const isDefault = hidden.length === DEFAULT_HIDDEN.length;

  // While editing, every module is listed so removed ones can be added back;
  // otherwise only the kept ones show, and an emptied section drops out.
  const sections = SECTIONS
    .map((s) => ({ ...s, rows: editing ? s.items : s.items.filter((i) => !isHidden(i.key)) }))
    .filter((s) => s.rows.length > 0);

  const editButton = (
    <button
      onClick={() => setEditing((v) => !v)}
      style={{
        padding: '4px 13px', borderRadius: T.radiusFull,
        fontFamily: T.fontBody, fontSize: 11, fontWeight: 700, cursor: 'pointer',
        background: editing ? T.primaryLight : T.bgSurface,
        border: `1px solid ${editing ? T.primary + '55' : T.border}`,
        color: editing ? T.primary : T.textSecondary,
      }}
    >
      {editing ? 'Done' : 'Edit'}
    </button>
  );

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

        {sections.length === 0 && <SectionLabel right={editButton}>Menu</SectionLabel>}

        {editing && (
          <div style={{
            background: T.bgSubtle, border: `1px solid ${T.border}`,
            borderRadius: T.radiusMd, padding: '9px 11px', marginTop: 12,
            fontSize: 10.5, lineHeight: 1.5, color: T.textTertiary, fontFamily: T.fontBody,
          }}>
            Remove what you don’t use — nothing is deleted, the module just leaves this
            list and can be added back any time.
          </div>
        )}

        {sections.map((section, si) => (
          <div key={section.label}>
            <SectionLabel right={si === 0 ? editButton : undefined}>{section.label}</SectionLabel>
            {section.rows.map((item) => (
              <MenuRow
                key={item.key}
                item={item}
                editing={editing}
                hidden={isHidden(item.key)}
                onToggle={() => toggleKey(item.key)}
                onPress={() => nav.navigate(item.key)}
              />
            ))}
          </div>
        ))}

        {/* Reset belongs to the module list, so it stays above Settings —
            everything below this point is untouched by Edit. */}
        {editing && (
          <button
            onClick={() => setHidden([...DEFAULT_HIDDEN])}
            disabled={isDefault}
            style={{
              width: '100%', marginTop: 14, padding: '12px 0',
              background: T.bgSurface, border: `1px solid ${T.border}`,
              borderRadius: T.radiusMd, fontFamily: T.fontBody,
              fontSize: 13, fontWeight: 700,
              color: isDefault ? T.textDisabled : T.textSecondary,
              cursor: isDefault ? 'default' : 'pointer',
            }}
          >
            {isDefault ? 'Showing the default list' : `Reset to default list (${hidden.length} removed)`}
          </button>
        )}

        {/* Settings sits outside Edit entirely — same rows, still tappable,
            whether or not the module list is being customised. */}
        <SectionLabel>Settings</SectionLabel>
        {SETTINGS.map(item => (
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
