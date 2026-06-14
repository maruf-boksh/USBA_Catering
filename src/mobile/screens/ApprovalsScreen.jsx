import { useState } from 'react';
import { T } from '../theme';
import { MOCK_APPROVALS } from '../mockData';

const TYPE_ICONS = {
  'Purchase Order':   '🛒',
  'Payment Approval': '💳',
  'Demand Request':   '📝',
};

export function ApprovalsScreen({ nav }) {
  const [items, setItems] = useState(MOCK_APPROVALS);
  const [toast, setToast] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectNote, setRejectNote] = useState('');
  const [detailItem, setDetailItem] = useState(null);

  const handleAction = (id, action, note = null) => {
    setItems(p => p.map(a => a.id === id ? { ...a, status: action, rejectionNote: note } : a));
    setToast(action === 'approved' ? 'Approved ✓' : 'Rejected');
    setTimeout(() => setToast(null), 1800);
  };

  const pending = items.filter(a => a.status === 'pending');
  const done    = items.filter(a => a.status !== 'pending');

  // ── Detail view for completed items ──────────────────────────────────────────
  if (detailItem) {
    const current = items.find(a => a.id === detailItem.id) || detailItem;
    const isRejected = current.status === 'rejected';
    const statusColor = isRejected ? T.statusRejected : T.statusApproved;
    const statusBg    = isRejected ? T.statusRejectedBg : T.statusApprovedBg;
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => setDetailItem(null)} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Request Details</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{current.ref}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px' }}>
          {/* Header card */}
          <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '14px 16px', boxShadow: T.shadowSm }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: T.radiusMd, background: statusBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                {TYPE_ICONS[current.type] || '📄'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{current.type}</div>
                <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{current.ref}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, background: statusBg, padding: '3px 10px', borderRadius: T.radiusFull, fontFamily: T.fontBody, textTransform: 'capitalize', flexShrink: 0 }}>
                {current.status}
              </span>
            </div>

            {/* Detail rows */}
            {[
              ['Requested By', current.requestedBy],
              ['Reference',    current.ref],
              ['Date',         current.date],
              ['Module',       current.module],
              ...(current.amount ? [['Amount', current.amount]] : []),
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
                <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Rejection reason */}
          {isRejected && (
            <div style={{ marginTop: 14, background: T.statusRejectedBg, border: `1px solid ${T.statusRejected}40`, borderRadius: T.radiusLg, padding: '14px 16px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Rejection Reason
              </div>
              <div style={{ fontSize: 13, color: T.textPrimary, fontFamily: T.fontBody, lineHeight: 1.5 }}>
                {current.rejectionNote || '—'}
              </div>
            </div>
          )}

          {/* Approval confirmation */}
          {!isRejected && (
            <div style={{ marginTop: 14, background: T.statusApprovedBg, border: `1px solid ${T.statusApproved}40`, borderRadius: T.radiusLg, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>✅</span>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.statusApproved, fontFamily: T.fontBody }}>
                Request approved successfully
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main list view ─────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
        <div>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Approvals</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{pending.length} pending</div>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'absolute', top: 70, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 10 }}>
          <div style={{ background: toast.includes('✓') ? T.statusApproved : T.statusRejected, color: '#fff', borderRadius: T.radiusFull, padding: '6px 20px', fontSize: 13, fontWeight: 700, fontFamily: T.fontBody, boxShadow: T.shadowMd }}>
            {toast}
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px', position: 'relative' }}>
        {pending.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 8, marginBottom: 4 }}>Pending</div>
            {pending.map((item) => (
              <div key={item.id} style={{ background: T.bgSurface, border: `1px solid ${T.statusPending}30`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: T.radiusMd, background: T.statusPendingBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{TYPE_ICONS[item.type] || '📄'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{item.type}</div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{item.ref} · {item.requestedBy}</div>
                    {item.amount && <div style={{ fontSize: 13, fontWeight: 700, color: T.statusPending, fontFamily: T.fontBody, marginTop: 4 }}>{item.amount}</div>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => handleAction(item.id, 'approved')}
                    style={{ flex: 1, padding: '9px 0', background: T.statusApproved, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => { setRejectingId(item.id); setRejectNote(''); }}
                    style={{ flex: 1, padding: '9px 0', background: T.bgSurface, border: `1px solid ${T.statusRejected}`, borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody, cursor: 'pointer' }}
                  >
                    Reject
                  </button>
                </div>
                {rejectingId === item.id && (
                  <div style={{ marginTop: 10, padding: '10px 12px', background: T.statusRejectedBg, border: `1px solid ${T.statusRejected}30`, borderRadius: T.radiusMd }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody, marginBottom: 6 }}>
                      Rejection Justification *
                    </div>
                    <textarea
                      value={rejectNote}
                      onChange={e => setRejectNote(e.target.value)}
                      placeholder="Enter reason for rejection..."
                      rows={3}
                      style={{
                        width: '100%', boxSizing: 'border-box', resize: 'none',
                        border: `1px solid ${T.statusRejected}50`, borderRadius: T.radiusMd,
                        padding: '8px 10px', fontSize: 12, fontFamily: T.fontBody,
                        background: T.bgSurface, color: T.textPrimary, outline: 'none',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        onClick={() => setRejectingId(null)}
                        style={{ flex: 1, padding: '8px 0', background: 'none', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, fontSize: 12, fontWeight: 600, color: T.textSecondary, fontFamily: T.fontBody, cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => { handleAction(item.id, 'rejected', rejectNote); setRejectingId(null); setRejectNote(''); }}
                        disabled={!rejectNote.trim()}
                        style={{ flex: 2, padding: '8px 0', background: rejectNote.trim() ? T.statusRejected : T.textDisabled, border: 'none', borderRadius: T.radiusMd, fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: rejectNote.trim() ? 'pointer' : 'not-allowed' }}
                      >
                        Mark as Rejected
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {done.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 18, marginBottom: 4 }}>Completed</div>
            {done.map((item) => (
              <div
                key={item.id}
                onClick={() => setDetailItem(item)}
                style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, opacity: 0.85, cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{item.type}</div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{item.ref}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: item.status === 'approved' ? T.statusApproved : T.statusRejected, background: item.status === 'approved' ? T.statusApprovedBg : T.statusRejectedBg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, textTransform: 'capitalize' }}>{item.status}</span>
                    <span style={{ fontSize: 14, color: T.textTertiary }}>›</span>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {pending.length === 0 && done.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32, color: T.textTertiary, fontFamily: T.fontBody, fontSize: 13 }}>No approvals</div>
        )}
      </div>
    </div>
  );
}
