import { useState } from 'react';
import { T } from '../theme';
import { MOCK_APPROVALS, MOCK_POS, MOCK_DEMANDS } from '../mockData';

const TYPE_ICONS = {
  'Purchase Order':   '🛒',
  'Payment Approval': '💳',
  'Demand Request':   '📝',
};

// ── Reference document resolver (simulates web fetch) ────────────────────────
function resolveRefData(ref) {
  if (ref.startsWith('PO-')) {
    const po = MOCK_POS.find(p => p.id === ref);
    if (po) {
      return {
        docType: 'Purchase Order',
        icon: '🛒',
        color: T.statusInfo,
        colorBg: T.statusInfoBg,
        statusLabel: po.status,
        sections: [
          {
            title: 'Order Summary',
            rows: [
              ['PO Number',     po.id],
              ['Vendor',        po.vendor],
              ['Order Date',    po.date],
              ['Total Items',   `${po.items} line items`],
              ['Order Value',   po.total],
              ['Status',        po.status.charAt(0).toUpperCase() + po.status.slice(1)],
            ],
          },
          {
            title: 'Delivery Info',
            rows: [
              ['Deliver To',    'US-Bangla Catering — Main Kitchen'],
              ['Expected',      'Within 2 business days'],
              ['Contact',       'Store Manager'],
              ['Remarks',       'Handle perishables with care'],
            ],
          },
        ],
      };
    }
  }

  if (ref.startsWith('DMD-') || ref.startsWith('GRN-')) {
    const dmd = MOCK_DEMANDS.find(d => d.id === ref);
    if (dmd) {
      return {
        docType: 'Demand Request',
        icon: '📝',
        color: T.statusPending,
        colorBg: T.statusPendingBg,
        statusLabel: dmd.status,
        sections: [
          {
            title: 'Request Details',
            rows: [
              ['Request No.',   dmd.id],
              ['Item',          dmd.item],
              ['Quantity',      `${dmd.qty} ${dmd.unit}`],
              ['Requested By',  dmd.requestedBy],
              ['Date',          dmd.date],
              ['Status',        dmd.status.charAt(0).toUpperCase() + dmd.status.slice(1)],
            ],
          },
          {
            title: 'Fulfillment Info',
            rows: [
              ['Priority',      'Medium'],
              ['Source',        'Central Store / Local Purchase'],
              ['Required For',  'Flight Catering Operations'],
              ['Approved By',   '—'],
            ],
          },
        ],
      };
    }
  }

  if (ref.startsWith('INV-')) {
    return {
      docType: 'Invoice',
      icon: '💳',
      color: T.statusApproved,
      colorBg: T.statusApprovedBg,
      statusLabel: 'due',
      sections: [
        {
          title: 'Invoice Details',
          rows: [
            ['Invoice No.',     ref],
            ['Issued By',       'Continental Aviation Services'],
            ['Invoice Date',    '2024-11-20'],
            ['Due Date',        '2024-12-20'],
            ['Payment Terms',   'Net 30'],
            ['Currency',        'BDT'],
          ],
        },
        {
          title: 'Charges Breakdown',
          rows: [
            ['Catering Service',     '৳ 85,000'],
            ['Cold Chain Logistics', '৳ 22,500'],
            ['Special Meal Prep',    '৳ 21,000'],
            ['Subtotal',             '৳ 1,28,500'],
            ['Tax / VAT',            '৳ 0 (Exempt)'],
            ['Total Due',            '৳ 1,28,500'],
          ],
        },
        {
          title: 'Bank Details',
          rows: [
            ['Bank',          'Dutch-Bangla Bank Ltd.'],
            ['Account No.',   '207.110.22836'],
            ['Branch',        'Tejgaon, Dhaka'],
            ['Routing No.',   '090261450'],
          ],
        },
      ],
    };
  }

  return {
    docType: 'Document',
    icon: '📄',
    color: T.textSecondary,
    colorBg: T.bgSubtle,
    statusLabel: 'active',
    sections: [{ title: 'Reference', rows: [['Ref No.', ref]] }],
  };
}

export function ApprovalsScreen({ nav }) {
  const [items, setItems]               = useState(MOCK_APPROVALS);
  const [toast, setToast]               = useState(null);
  const [detailItem, setDetailItem]     = useState(null);
  const [rejectNote, setRejectNote]     = useState('');
  const [showRejectPanel, setShowRejectPanel] = useState(false);
  const [refPage, setRefPage]           = useState(null); // null | 'loading' | { ref, doc }

  const handleAction = (id, action, note = null) => {
    setItems(p => p.map(a => a.id === id ? { ...a, status: action, rejectionNote: note } : a));
    setToast(action === 'approved' ? 'Approved ✓' : 'Rejected');
    setDetailItem(null);
    setShowRejectPanel(false);
    setRejectNote('');
    setTimeout(() => setToast(null), 1800);
  };

  const fetchRef = (ref) => {
    setRefPage('loading');
    setTimeout(() => {
      setRefPage({ ref, doc: resolveRefData(ref) });
    }, 900);
  };

  const pending = items.filter(a => a.status === 'pending');
  const done    = items.filter(a => a.status !== 'pending');

  // ── Reference document page ───────────────────────────────────────────────
  if (refPage !== null) {
    if (refPage === 'loading') {
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
          <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button onClick={() => setRefPage(null)} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Fetching Document…</div>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              border: `3px solid ${T.border}`,
              borderTopColor: T.primary,
              animation: 'spin 0.8s linear infinite',
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <div style={{ fontSize: 13, color: T.textTertiary, fontFamily: T.fontBody }}>Loading from server…</div>
          </div>
        </div>
      );
    }

    const { ref, doc } = refPage;
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => setRefPage(null)} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>{doc.docType}</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{ref}</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px' }}>
          {/* Doc header */}
          <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '14px 16px', marginBottom: 12, boxShadow: T.shadowSm, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: T.radiusMd, background: doc.colorBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>
              {doc.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{doc.docType}</div>
              <div style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{ref}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: doc.color, background: doc.colorBg, padding: '3px 10px', borderRadius: T.radiusFull, fontFamily: T.fontBody, textTransform: 'capitalize', flexShrink: 0 }}>
              {doc.statusLabel}
            </span>
          </div>

          {/* Sections */}
          {doc.sections.map((section) => (
            <div key={section.title} style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 16px', marginBottom: 12, boxShadow: T.shadowSm }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                {section.title}
              </div>
              {section.rows.map(([label, value], i) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: i === 0 ? 0 : 9, paddingBottom: 9, borderTop: i === 0 ? 'none' : `1px solid ${T.border}` }}>
                  <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (detailItem) {
    const current    = items.find(a => a.id === detailItem.id) || detailItem;
    const isPending  = current.status === 'pending';
    const isRejected = current.status === 'rejected';
    const statusColor = isPending ? T.statusPending : isRejected ? T.statusRejected : T.statusApproved;
    const statusBg    = isPending ? T.statusPendingBg : isRejected ? T.statusRejectedBg : T.statusApprovedBg;

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button
            onClick={() => { setDetailItem(null); setShowRejectPanel(false); setRejectNote(''); }}
            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >←</button>
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

            {[
              ['Requested By', current.requestedBy],
              ['Reference',    current.ref],
              ['Date',         current.date],
              ['Module',       current.module],
              ...(current.amount ? [['Amount', current.amount]] : []),
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
                <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{label}</span>
                {label === 'Reference' ? (
                  <span
                    onClick={() => fetchRef(value)}
                    style={{ fontSize: 12, fontWeight: 700, color: T.statusInfo, fontFamily: T.fontBody, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
                  >
                    {value} ↗
                  </span>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{value}</span>
                )}
              </div>
            ))}
          </div>

          {/* Pending: Approve / Reject buttons */}
          {isPending && !showRejectPanel && (
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                onClick={() => handleAction(current.id, 'approved')}
                style={{ flex: 1, padding: '13px 0', background: T.statusApproved, border: 'none', borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}
              >
                Approve
              </button>
              <button
                onClick={() => { setShowRejectPanel(true); setRejectNote(''); }}
                style={{ flex: 1, padding: '13px 0', background: T.bgSurface, border: `1px solid ${T.statusRejected}`, borderRadius: T.radiusMd, fontSize: 14, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody, cursor: 'pointer' }}
              >
                Reject
              </button>
            </div>
          )}

          {/* Pending: Rejection justification panel */}
          {isPending && showRejectPanel && (
            <div style={{ marginTop: 14, padding: '14px 16px', background: T.statusRejectedBg, border: `1px solid ${T.statusRejected}30`, borderRadius: T.radiusLg }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody, marginBottom: 8 }}>
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
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  onClick={() => setShowRejectPanel(false)}
                  style={{ flex: 1, padding: '10px 0', background: 'none', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, fontSize: 13, fontWeight: 600, color: T.textSecondary, fontFamily: T.fontBody, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleAction(current.id, 'rejected', rejectNote)}
                  disabled={!rejectNote.trim()}
                  style={{ flex: 2, padding: '10px 0', background: rejectNote.trim() ? T.statusRejected : T.textDisabled, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: rejectNote.trim() ? 'pointer' : 'not-allowed' }}
                >
                  Mark as Rejected
                </button>
              </div>
            </div>
          )}

          {/* Completed: rejection reason */}
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

          {/* Completed: approval confirmation */}
          {!isPending && !isRejected && (
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
              <div
                key={item.id}
                onClick={() => setDetailItem(item)}
                style={{ background: T.bgSurface, border: `1.5px solid ${T.statusPending}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm, cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
                    <div style={{ width: 36, height: 36, borderRadius: T.radiusMd, background: T.statusPendingBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{TYPE_ICONS[item.type] || '📄'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{item.type}</div>
                      <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{item.ref} · {item.requestedBy}</div>
                      {item.amount && <div style={{ fontSize: 13, fontWeight: 700, color: T.statusPending, fontFamily: T.fontBody, marginTop: 4 }}>{item.amount}</div>}
                    </div>
                  </div>
                  <span style={{ fontSize: 14, color: T.textTertiary, flexShrink: 0 }}>›</span>
                </div>
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
