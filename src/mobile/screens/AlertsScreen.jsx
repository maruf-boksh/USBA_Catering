import { T } from '../theme';
import { MOCK_INVENTORY_ALERTS, MOCK_QC_CHECKS, MOCK_DISPATCHES, MOCK_KPIS } from '../mockData';

function AlertRow({ icon, title, subtitle, badge, badgeColor, badgeBg }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 0',
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <div
        style={{
          width: 36, height: 36,
          borderRadius: T.radiusMd,
          background: badgeBg || T.primaryLight,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody, lineHeight: 1.3 }}>
          {title}
        </div>
        <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 3, lineHeight: 1.4 }}>
          {subtitle}
        </div>
      </div>
      {badge && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: badgeColor || T.primary,
            background: badgeBg || T.primaryLight,
            padding: '3px 8px',
            borderRadius: T.radiusFull,
            fontFamily: T.fontBody,
            flexShrink: 0,
            alignSelf: 'flex-start',
            marginTop: 1,
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

export function AlertsScreen({ nav }) {
  const qcIssue = MOCK_QC_CHECKS.find((q) => q.result === 'open');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      {/* Topbar */}
      <div
        style={{
          background: T.topbarGradient,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => nav.goBack()}
          style={{
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: T.radiusFull,
            width: 32, height: 32,
            cursor: 'pointer',
            color: '#fff',
            fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          ←
        </button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Alerts</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
            {MOCK_KPIS.inventoryAlerts + (qcIssue ? 1 : 0) + 1} active alerts
          </div>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 20px' }}>

        {/* Section: QC */}
        {qcIssue && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 16, marginBottom: 2 }}>
              Quality Control
            </div>
            <AlertRow
              icon="🌡️"
              title={`Temperature Alert — ${qcIssue.item}`}
              subtitle={`Flight ${qcIssue.flight} · ${qcIssue.issue} · Checked ${qcIssue.time} by ${qcIssue.checkedBy}`}
              badge="Open"
              badgeColor={T.primary}
              badgeBg={T.primaryLight}
            />
          </>
        )}

        {/* Section: Inventory */}
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 16, marginBottom: 2 }}>
          Inventory — Low Stock
        </div>
        {MOCK_INVENTORY_ALERTS.map((a) => (
          <AlertRow
            key={a.id}
            icon="📦"
            title={a.item}
            subtitle={`Current: ${a.current} ${a.unit} · Reorder point: ${a.reorderPoint} ${a.unit}`}
            badge="Low Stock"
            badgeColor={T.statusDelayed}
            badgeBg={T.statusDelayedBg}
          />
        ))}

        {/* Section: Dispatch */}
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 16, marginBottom: 2 }}>
          Dispatch
        </div>
        <AlertRow
          icon="🚛"
          title="Dispatch pending — Flight BG105"
          subtitle={`DAC → LHR · Departure 09:45 · No driver assigned yet`}
          badge="Pending"
          badgeColor={T.statusPending}
          badgeBg={T.statusPendingBg}
        />

        {/* Section: Approvals */}
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 16, marginBottom: 2 }}>
          Approvals
        </div>
        <AlertRow
          icon="⏳"
          title={`${MOCK_KPIS.pendingApprovals} items awaiting your approval`}
          subtitle="Purchase orders · Payment approvals · Demand requests"
          badge={`${MOCK_KPIS.pendingApprovals} pending`}
          badgeColor={T.statusPending}
          badgeBg={T.statusPendingBg}
        />
      </div>
    </div>
  );
}
