import { useState } from 'react';
import { T } from '../theme';
import { MOCK_APPROVALS, MOCK_POS, MOCK_DEMANDS, MOCK_APPROVAL_DOCS } from '../mockData';
// The queues that were missing from this inbox — real records from the web's
// own stores, listed in exactly the same shape as everything else here, so the
// screen, its cards, its detail page and its filters are unchanged. Deciding on
// one of these writes the same decision Approval Management writes.
import { getPurchaseRequisitions, setPurchaseRequisitionStatus, applyReceiptToPR } from '@/lib/purchase-requisitions';
import { getDirectReceiptApprovals, setDirectReceiptApprovalStatus } from '@/lib/direct-receipt-approvals';
import { useWorkflow } from '@/lib/workflow-store';
import { getAuthUser } from '@/lib/auth';

const TYPE_ICONS = {
  'Purchase Order':          '🛒',
  'Payment Approval':        '💳',
  'Demand Request':          '📝',
  'Flight Orders':           '✈️',
  'Crew Orders':             '👥',
  'Request for Quotation':   '✉️',
  'Quotation':               '💰',
  'Purchase Requisition':    '📄',
  'Goods Receipt':           '📦',
  'Transfer Request':        '🔁',
  'Stock Adjustment':        '⚖️',
  'Production Order':        '🏭',
  'Bill of Materials':       '🧾',
  'User Account':            '👤',
  'Dispatch':                '🚚',
  'Maintenance':             '🔧',
  'Return Items':            '↩️',
  'Purchase Return':         '🔙',
  'Galley Loading':          '🗄️',
  'Personal Hygiene':        '🧼',
  'Daily Hygiene Monitoring':'🧽',
  'Damaged Product Disposal':'🗑️',
  'Delay Refreshment':       '⏱️',
  'Last-Minute Change':      '⚠️',
};

// ── Reference document resolver (simulates web fetch) ────────────────────────
function resolveRefData(ref) {
  // Approval Management docs brought over from the web — full detail per ID.
  const mapped = MOCK_APPROVAL_DOCS[ref];
  if (mapped) {
    const st = mapped.status || 'active';
    const color =
      st === 'approved' ? T.statusApproved :
      st === 'rejected' ? T.statusRejected :
      st === 'pending'  ? T.statusPending  : T.statusInfo;
    const colorBg =
      st === 'approved' ? T.statusApprovedBg :
      st === 'rejected' ? T.statusRejectedBg :
      st === 'pending'  ? T.statusPendingBg  : T.statusInfoBg;
    return {
      docType: mapped.docType,
      icon: TYPE_ICONS[mapped.docType] || '📄',
      color, colorBg,
      statusLabel: st,
      sections: mapped.sections,
    };
  }

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

// ── Live queues ─────────────────────────────────────────────────────────────
const ALLOC_KEY    = 'harvest-data-v1:packaging-allocations';
const DELAY_AP_KEY = 'harvest-data-v1:delay-approval-records';
const DELAY_KEY    = 'harvest-data-v1:delay-events';
const WASTAGE_KEY  = 'harvest-data-v1:wastage-entries';

const n = (v) => Number(v) || 0;
const taka = (v) => (n(v) > 0 ? `৳ ${n(v).toLocaleString()}` : null);
const p2 = (x) => String(x).padStart(2, '0');
const nowStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
const dayOf = (s) => String(s ?? '').slice(0, 10);

function readJson(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function writeJson(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota — non-fatal */ }
}

/**
 * Everything genuinely awaiting a decision, in this screen's own item shape.
 * `live` carries what the write-back needs; nothing else about the row differs
 * from a seeded one.
 */
function buildLiveApprovals(productionEntries) {
  const out = [];

  for (const pr of getPurchaseRequisitions()) {
    if (!/^pending approval$|^pending$/i.test(String(pr.status))) continue;
    out.push({
      id: `LIVE-PR-${pr.id}`, type: 'Purchase Requisition', ref: pr.id,
      amount: taka(pr.totalAmount), requestedBy: pr.requestedBy, date: dayOf(pr.date),
      status: 'pending', module: 'procurement', live: { cat: 'pr', refId: pr.id },
    });
  }

  for (const d of getDirectReceiptApprovals()) {
    if (d.status !== 'Pending') continue;
    out.push({
      id: `LIVE-GRN-${d.id}`, type: 'Goods Receipt', ref: d.dpRef,
      amount: taka(d.amount), requestedBy: d.requestedBy, date: dayOf(d.requestedAt),
      status: 'pending', module: 'procurement', live: { cat: 'grn', refId: d.id },
    });
  }

  for (const e of productionEntries ?? []) {
    if (e.status !== 'Pending') continue;
    out.push({
      id: `LIVE-PRO-${e.id}`, type: 'Production Order', ref: e.id,
      amount: null, requestedBy: 'Production', date: dayOf(e.date),
      status: 'pending', module: 'production', live: { cat: 'prod', refId: e.id },
    });
  }

  for (const a of readJson(ALLOC_KEY, [])) {
    if (a.status !== 'Pending Approval') continue;
    out.push({
      id: `LIVE-PKR-${a.id}`, type: 'Packaging', ref: a.packagingId,
      amount: null, requestedBy: a.createdBy || 'Packaging', date: dayOf(a.createdAt || a.date),
      status: 'pending', module: 'production', live: { cat: 'packaging', refId: a.id },
    });
  }

  for (const d of readJson(DELAY_AP_KEY, [])) {
    if (d.status !== 'Pending') continue;
    out.push({
      id: `LIVE-DA-${d.id}`, type: 'Delay Refreshment', ref: d.id,
      amount: taka(d.totalCost), requestedBy: d.submittedBy, date: dayOf(d.submittedAt),
      status: 'pending', module: 'operations', live: { cat: 'delay', refId: d.id },
    });
  }

  for (const w of readJson(WASTAGE_KEY, [])) {
    if (!['Pending In-Charge', 'Pending GM', 'Pending Final'].includes(w.status)) continue;
    out.push({
      id: `LIVE-WDD-${w.id}`, type: 'Damaged Product Disposal', ref: w.id,
      amount: null, requestedBy: w.preparedBy, date: dayOf(w.reportingDate || w.preparedAt),
      status: 'pending', module: 'food-safety', live: { cat: 'wastage', refId: w.id, stage: w.status },
    });
  }

  return out;
}

/**
 * The web's category order. The inbox is arranged by it so EVERY module has its
 * cards near the top — otherwise a queue that happens to hold thirty records
 * (goods receipts, disposals) buries every other module below the fold.
 */
const TYPE_ORDER = [
  'Flight Orders', 'Crew Orders', 'Demand Request', 'Request for Quotation', 'Quotation',
  'Purchase Requisition', 'Purchase Order', 'Goods Receipt', 'Transfer Request',
  'Stock Adjustment', 'Production Order', 'Packaging', 'Bill of Materials', 'User Account',
  'Dispatch', 'Maintenance', 'Return Items', 'Purchase Return', 'Galley Loading',
  'Personal Hygiene', 'Daily Hygiene Monitoring', 'Damaged Product Disposal',
  'Delay Refreshment', 'Last-Minute Change', 'Payment Approval',
];
const typeRank = (t) => {
  const i = TYPE_ORDER.indexOf(t);
  return i === -1 ? TYPE_ORDER.length : i;
};

/**
 * The web's overview grid — categories grouped into business sections, each card
 * drilling into that category's pending queue. This is what the inbox opens on,
 * so one queue holding thirty records is one card with a count, not thirty rows.
 */
const APPROVAL_SECTIONS = [
  { label: 'Operations Approval',        keys: ['Flight Orders', 'Crew Orders', 'Last-Minute Change', 'Meal Quantity Adjustment'] },
  { label: 'Dispatch Approval',          keys: ['Dispatch'] },
  { label: 'Procurement Approval',       keys: ['Request for Quotation', 'Quotation', 'Purchase Requisition', 'Purchase Order', 'Goods Receipt', 'Purchase Return'] },
  { label: 'Inventory Approval',         keys: ['Demand Request', 'Transfer Request', 'Stock Adjustment'] },
  { label: 'Production Approval',        keys: ['Production Order', 'Bill of Materials'] },
  { label: 'Packaging Approval',         keys: ['Packaging'] },
  { label: 'Administration Approval',    keys: ['User Account'] },
  { label: 'Asset Management Approval',  keys: ['Maintenance'] },
  { label: 'Consumable Returns Approval', keys: ['Return Items'] },
  { label: 'Galley Loading Approval',    keys: ['Galley Loading'] },
  { label: 'Food Safety Approval',       keys: ['Personal Hygiene', 'Daily Hygiene Monitoring'] },
  { label: 'Wastage Management Approval', keys: ['Damaged Product Disposal'] },
  { label: 'Delay Refreshment Approval', keys: ['Delay Refreshment'] },
];
/** The web's shorter card captions. */
const CATEGORY_LABEL = {
  'Request for Quotation': 'RFQ',
  'Quotation': 'Quotations',
  'Purchase Requisition': 'Purchase Req.',
  'Purchase Order': 'Purchase Orders',
  'Goods Receipt': 'Goods Receipts',
  'Purchase Return': 'Purchase Returns',
  'Demand Request': 'Demand Req.',
  'Stock Adjustment': 'Stock Adj.',
  'Production Order': 'Production',
  'Bill of Materials': 'BOM',
  'User Account': 'Users',
  'Meal Quantity Adjustment': 'Meal Qty Adjustment',
};
const GRID_TYPES = new Set(APPROVAL_SECTIONS.flatMap((s) => s.keys));

/**
 * Live rows merged into the seeded ones, then laid out module by module in the
 * web's order — newest first inside a module. A live row REPLACES the seeded
 * placeholder of the same type, so a module never shows a demo card when it has
 * a real record waiting.
 */
function buildInbox(productionEntries) {
  const live = buildLiveApprovals(productionEntries);
  const liveTypes = new Set(live.map((a) => a.type));
  const seeded = MOCK_APPROVALS.filter((a) => !(a.status === 'pending' && liveTypes.has(a.type)));
  return [...live, ...seeded].sort((a, b) =>
    typeRank(a.type) - typeRank(b.type) || String(b.date ?? '').localeCompare(String(a.date ?? '')));
}

export function ApprovalsScreen({ nav }) {
  const { productionEntries, updateProductionEntryStatus, addGRN } = useWorkflow();
  const [items, setItems]               = useState(() => buildInbox(productionEntries));
  const [toast, setToast]               = useState(null);
  const [detailItem, setDetailItem]     = useState(null);
  const [rejectNote, setRejectNote]     = useState('');
  const [showRejectPanel, setShowRejectPanel] = useState(false);
  const [refPage, setRefPage]           = useState(null); // null | 'loading' | { ref, doc }
  const [search, setSearch]             = useState('');
  const [tab, setTab]                   = useState('pending'); // 'pending' | 'log'
  const [todayOnly, setTodayOnly]       = useState(false);
  const [dateFrom, setDateFrom]         = useState('');
  const [dateTo, setDateTo]             = useState('');
  /** Category drilled into from the overview grid; null shows the grid. */
  const [catFilter, setCatFilter]       = useState(null);

  /** A live row's decision goes to the module that owns the record — the same
   *  writes Approval Management makes. Seeded rows behave exactly as before. */
  const commitLive = (live, action, note) => {
    const at = nowStamp();
    const by = getAuthUser()?.name ?? 'Mobile';
    const why = (note || '').trim() || 'Rejected on mobile';
    const ok = action === 'approved';

    if (live.cat === 'pr') {
      setPurchaseRequisitionStatus(live.refId, ok ? 'Approved' : 'Rejected');
    } else if (live.cat === 'grn') {
      const dr = getDirectReceiptApprovals().find((d) => d.id === live.refId);
      if (!dr) return;
      if (ok) {
        addGRN(dr.grn);
        if (dr.sourcePrId && dr.prReceipts?.length) applyReceiptToPR(dr.sourcePrId, dr.prReceipts);
      }
      setDirectReceiptApprovalStatus(dr.id, ok ? 'Approved' : 'Rejected',
        { processedBy: by, processedAt: at, ...(ok ? {} : { rejectionReason: why }) });
    } else if (live.cat === 'prod') {
      updateProductionEntryStatus(live.refId, ok ? 'Approved' : 'Rejected');
    } else if (live.cat === 'packaging') {
      writeJson(ALLOC_KEY, readJson(ALLOC_KEY, []).map((a) => (a.id === live.refId
        ? (ok
            ? { ...a, status: 'In Packaging', approvedBy: by, approvedAt: at, rejectedReason: undefined }
            : { ...a, status: 'Rejected', rejectedReason: why })
        : a)));
    } else if (live.cat === 'delay') {
      writeJson(DELAY_AP_KEY, readJson(DELAY_AP_KEY, []).map((d) => (d.id === live.refId
        ? { ...d, status: ok ? 'Approved' : 'Declined', processedBy: by, processedAt: at, ...(ok ? {} : { declineReason: why }) }
        : d)));
      writeJson(DELAY_KEY, readJson(DELAY_KEY, []).map((e) => (e.approvalId === live.refId
        ? { ...e, status: ok ? 'Approved' : 'Rejected', updatedAt: at } : e)));
    } else if (live.cat === 'wastage') {
      writeJson(WASTAGE_KEY, readJson(WASTAGE_KEY, []).map((w) => {
        if (w.id !== live.refId) return w;
        const stepName = w.status === 'Pending In-Charge' ? 'Production In-Charge'
          : w.status === 'Pending GM' ? 'GM Catering' : 'Final Authorization';
        if (!ok) {
          return { ...w, status: 'Rejected',
            approvalSteps: [...(w.approvalSteps ?? []), { step: stepName, by, designation: 'Business Analyst', action: 'Rejected', at, comment: why }] };
        }
        // Final Authorization posts the stock movement, which lives on the web —
        // the phone walks the chain up to it and stops there.
        if (w.status === 'Pending Final') return w;
        const designation = w.status === 'Pending In-Charge' ? 'In-Charge (Production)' : 'General Manager-Catering';
        const nextStatus = w.status === 'Pending In-Charge' ? 'Pending GM' : 'Pending Final';
        return { ...w, status: nextStatus,
          approvalSteps: [...(w.approvalSteps ?? []), { step: stepName, by, designation, action: 'Approved', at }] };
      }));
    }
  };

  const handleAction = (id, action, note = null) => {
    const item = items.find(a => a.id === id);
    if (item?.live) commitLive(item.live, action, note);
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

  const q = search.trim().toLowerCase();
  const matchesSearch = (a) =>
    !q || [a.type, a.ref, a.requestedBy, a.amount, a.status]
      .some(v => (v || '').toString().toLowerCase().includes(q));
  const todayStr = new Date().toISOString().slice(0, 10);
  const inDateFilter = (a) => {
    if (todayOnly) return a.date === todayStr;
    if (dateFrom && a.date < dateFrom) return false;
    if (dateTo && a.date > dateTo) return false;
    return true;
  };
  const visible = items.filter(a => matchesSearch(a) && inDateFilter(a));
  const inCat = (a) => !catFilter || a.type === catFilter
    || (catFilter === '__other' && !GRID_TYPES.has(a.type));
  const pending = visible.filter(a => a.status === 'pending' && inCat(a));
  const done    = visible.filter(a => a.status !== 'pending');
  const totalPending = items.filter(a => a.status === 'pending').length;
  /** Badge count per category — the whole queue, not the filtered view. */
  const countOf = (type) => items.filter(a => a.status === 'pending' && a.type === type).length;
  const otherCount = items.filter(a => a.status === 'pending' && !GRID_TYPES.has(a.type)).length;
  /** A category's pending rows, as shown (search + date filters still apply). */
  const rowsOf = (type) => visible.filter(a => a.status === 'pending' && a.type === type);
  /** Total value of a set of rows — their amounts are display strings. */
  const sumAmount = (rows) => rows.reduce((s, a) => {
    const digits = String(a.amount ?? '').replace(/[^\d]/g, '');
    return s + (digits ? Number(digits) : 0);
  }, 0);

  /** The pending approval card — identical wherever it is listed. */
  const pendingCard = (item) => (
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
  );

  /**
   * ONE card per category, whatever the queue holds:
   *   1 waiting  → that record's own card, straight to the decision
   *   many       → the category, with how many are inside it
   *   none       → the category at zero, so every module stays visible
   * Every state carries the same card outline, so the column never breaks.
   */
  const categoryCard = (type, rows) => {
    const label = CATEGORY_LABEL[type] || type;
    if (rows.length === 1) return pendingCard(rows[0]);

    const total = sumAmount(rows);
    const waiting = rows.length > 0;
    return (
      <div
        key={type}
        onClick={waiting ? () => setCatFilter(type) : undefined}
        style={{
          background: T.bgSurface,
          border: `1.5px solid ${waiting ? T.statusPending : T.borderStrong}`,
          borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10,
          boxShadow: T.shadowSm, cursor: waiting ? 'pointer' : 'default',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
            <div style={{ width: 36, height: 36, borderRadius: T.radiusMd, background: waiting ? T.statusPendingBg : T.bgSubtle, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, opacity: waiting ? 1 : 0.75 }}>
              {TYPE_ICONS[type] || '📄'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: waiting ? T.textPrimary : T.textTertiary, fontFamily: T.fontBody }}>{label}</div>
              <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                {waiting ? `${rows.length} awaiting approval` : 'Nothing awaiting approval'}
              </div>
              {waiting && total > 0 && (
                <div style={{ fontSize: 13, fontWeight: 700, color: T.statusPending, fontFamily: T.fontBody, marginTop: 4 }}>
                  ৳ {total.toLocaleString()}
                </div>
              )}
            </div>
          </div>
          {waiting ? (
            <span style={{ minWidth: 24, textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: '#fff', background: T.primary, borderRadius: T.radiusFull, padding: '3px 8px', fontFamily: T.fontBody, flexShrink: 0 }}>
              {rows.length}
            </span>
          ) : (
            <span style={{ minWidth: 24, textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: '#fff', background: T.statusApproved, borderRadius: T.radiusFull, padding: '3px 8px', fontFamily: T.fontBody, flexShrink: 0 }}>
              0
            </span>
          )}
        </div>
      </div>
    );
  };

  const toggleToday = () => setTodayOnly(v => { const nv = !v; if (nv) { setDateFrom(''); setDateTo(''); } return nv; });
  const clearDates  = () => { setTodayOnly(false); setDateFrom(''); setDateTo(''); };

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
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{totalPending} pending</div>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'absolute', top: 70, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 10 }}>
          <div style={{ background: toast.includes('✓') ? T.statusApproved : T.statusRejected, color: '#fff', borderRadius: T.radiusFull, padding: '6px 20px', fontSize: 13, fontWeight: 700, fontFamily: T.fontBody, boxShadow: T.shadowMd }}>
            {toast}
          </div>
        </div>
      )}

      {/* Search filter — sits on top of all approval cards */}
      <div style={{ padding: '10px 14px 6px', flexShrink: 0, background: T.bgBase }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: 12, fontSize: 14, color: T.textTertiary, pointerEvents: 'none' }}>🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by ID, type, requester…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 34px 10px 34px',
              border: `1px solid ${T.border}`, borderRadius: T.radiusFull,
              background: T.bgSurface, color: T.textPrimary,
              fontSize: 13, fontFamily: T.fontBody, outline: 'none',
              boxShadow: T.shadowSm,
            }}
          />
          {search && (
            <span
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: 12, fontSize: 15, color: T.textTertiary, cursor: 'pointer', lineHeight: 1 }}
            >×</span>
          )}
        </div>
      </div>

      {/* Date filter — Today toggle + date range */}
      <div style={{ padding: '0 14px 8px', flexShrink: 0, background: T.bgBase, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={toggleToday}
          style={{
            padding: '7px 14px', borderRadius: T.radiusFull, cursor: 'pointer',
            fontSize: 12, fontWeight: 700, fontFamily: T.fontBody,
            border: `1px solid ${todayOnly ? T.primary : T.border}`,
            background: todayOnly ? T.primary : T.bgSurface,
            color: todayOnly ? '#fff' : T.textSecondary,
          }}
        >
          Today
        </button>
        <input
          type="date"
          value={dateFrom}
          onChange={e => { setDateFrom(e.target.value); setTodayOnly(false); }}
          style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '7px 8px', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, background: T.bgSurface, color: T.textPrimary, fontSize: 11, fontFamily: T.fontBody, outline: 'none' }}
        />
        <span style={{ fontSize: 12, color: T.textTertiary }}>–</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => { setDateTo(e.target.value); setTodayOnly(false); }}
          style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '7px 8px', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, background: T.bgSurface, color: T.textPrimary, fontSize: 11, fontFamily: T.fontBody, outline: 'none' }}
        />
        {(todayOnly || dateFrom || dateTo) && (
          <span onClick={clearDates} style={{ fontSize: 11, fontWeight: 600, color: T.textTertiary, fontFamily: T.fontBody, cursor: 'pointer' }}>Clear</span>
        )}
      </div>

      {/* Tabs — Pending / Log */}
      <div style={{ padding: '0 14px 8px', flexShrink: 0, background: T.bgBase, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {tab === 'pending' ? 'Pending' : 'Log'}
        </div>
        <div style={{ display: 'flex', background: T.bgSubtle, border: `1px solid ${T.border}`, borderRadius: T.radiusFull, padding: 2 }}>
          {[['pending', `Pending`], ['log', 'Log']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: '5px 14px', borderRadius: T.radiusFull, cursor: 'pointer', border: 'none',
                fontSize: 12, fontWeight: 700, fontFamily: T.fontBody,
                background: tab === key ? T.primary : 'transparent',
                color: tab === key ? '#fff' : T.textSecondary,
              }}
            >
              {label}{key === 'pending' && totalPending > 0 ? ` ${pending.length}` : ''}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 14px 16px', position: 'relative' }}>
        {/* Overview grid — one card per category, with its pending count */}
        {tab === 'pending' && !catFilter && (
          <>
            {APPROVAL_SECTIONS.map((sec) => (
              <div key={sec.label}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 16, marginBottom: 8 }}>
                  {sec.label}
                </div>
                {sec.keys.map((type) => categoryCard(type, rowsOf(type)))}
              </div>
            ))}

            {otherCount > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 16, marginBottom: 8 }}>
                  Other Approvals
                </div>
                {(() => {
                  const rows = visible.filter(a => a.status === 'pending' && !GRID_TYPES.has(a.type));
                  if (rows.length === 1) return pendingCard(rows[0]);
                  return (
                    <div onClick={() => setCatFilter('__other')}
                      style={{ background: T.bgSurface, border: `1.5px solid ${T.statusPending}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm, cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
                          <div style={{ width: 36, height: 36, borderRadius: T.radiusMd, background: T.statusPendingBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>💳</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>Other</div>
                            <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{rows.length} awaiting approval</div>
                          </div>
                        </div>
                        <span style={{ minWidth: 24, textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: '#fff', background: T.primary, borderRadius: T.radiusFull, padding: '3px 8px', fontFamily: T.fontBody, flexShrink: 0 }}>
                          {rows.length}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}

        {/* Drilled into a category — its own pending queue */}
        {tab === 'pending' && catFilter && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <button onClick={() => setCatFilter(null)}
              style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusFull, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, color: T.textSecondary, fontFamily: T.fontBody, cursor: 'pointer' }}>
              ‹ All categories
            </button>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>
              {catFilter === '__other' ? 'Other' : (CATEGORY_LABEL[catFilter] || catFilter)}
            </span>
            <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginLeft: 'auto' }}>
              {pending.length} pending
            </span>
          </div>
        )}

        {tab === 'pending' && catFilter && pending.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: T.textTertiary, fontFamily: T.fontBody }}>
            Nothing waiting in this category.
          </div>
        )}

        {tab === 'pending' && catFilter && pending.map(pendingCard)}

        {tab === 'log' && done.map((item) => (
          <div
            key={item.id}
            onClick={() => setDetailItem(item)}
            style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, opacity: 0.9, cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                <div style={{ width: 32, height: 32, borderRadius: T.radiusMd, background: T.bgSubtle, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{TYPE_ICONS[item.type] || '📄'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{item.type}</div>
                  <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{item.ref} · {item.date}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: item.status === 'approved' ? T.statusApproved : T.statusRejected, background: item.status === 'approved' ? T.statusApprovedBg : T.statusRejectedBg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, textTransform: 'capitalize' }}>{item.status}</span>
                <span style={{ fontSize: 14, color: T.textTertiary }}>›</span>
              </div>
            </div>
          </div>
        ))}

        {tab === 'pending' && !catFilter && pending.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32, color: T.textTertiary, fontFamily: T.fontBody, fontSize: 13 }}>No pending approvals</div>
        )}
        {tab === 'log' && done.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32, color: T.textTertiary, fontFamily: T.fontBody, fontSize: 13 }}>No log entries</div>
        )}
      </div>
    </div>
  );
}
