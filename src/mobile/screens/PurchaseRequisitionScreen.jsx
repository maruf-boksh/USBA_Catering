import { useState } from 'react';
import { T } from '../theme';
// The whole local-purchase cycle, on the phone, on the WEB's own records —
// nothing here is mocked and nothing is duplicated:
//
//   Requisition → Approve → Receive → Inspect
//
//   Requisition  getPurchaseRequisitions / addPurchaseRequisition
//                (same localStorage list routes/purchase-requisition.tsx persists)
//   Approve      setPurchaseRequisitionStatus — the decision Approval Management
//                writes; goods receipts clear through the same queue as the web
//   Receive      addDirectReceiptApproval — the identical payload Receive Items'
//                Direct Receive submits, carrying sourcePrId + prReceipts so the
//                requisition's received qty is written back on approval
//   Inspect      useWorkflow().grns / updateGRNLineQC — the Quality Control
//                module's own store; passed qty posts to Stock Overview and
//                failed qty initiates a Purchase Return, exactly as on the web
import {
  getPurchaseRequisitions,
  addPurchaseRequisition,
  setPurchaseRequisitionStatus,
  applyReceiptToPR,
  procurementStage,
  prReceived,
} from '@/lib/purchase-requisitions';
import {
  getDirectReceiptApprovals,
  addDirectReceiptApproval,
  setDirectReceiptApprovalStatus,
} from '@/lib/direct-receipt-approvals';
import { useWorkflow } from '@/lib/workflow-store';
import { applyInventoryStock } from '@/lib/stock-adjustments';
import { activeItems, vendors } from '@/lib/sample-data';
import { SEED_RETURNS } from '@/routes/purchase-return';
import { Combobox } from '../components/Combobox';

const ITEM_NAMES = activeItems.map((it) => it.name);
const VENDOR_NAMES = vendors.map((v) => v.name);

const BTN_BACK = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: T.radiusFull, width: 32, height: 32, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const LABEL = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
const INPUT = { width: '100%', boxSizing: 'border-box', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 12px', fontSize: 13, fontFamily: T.fontBody, outline: 'none', background: T.bgSurface, color: T.textPrimary };
const CARD = { background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginTop: 10, boxShadow: T.shadowSm };
const SECTION = { fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '14px 2px 2px' };

const REQUESTERS = ['S. Ahmed', 'M. Hossain', 'F. Begum', 'A. Khan', 'N. Hasan', 'Store Manager', 'Kitchen Supervisor'];

// Map the web's procurement stage to the mobile status palette.
const stageStyle = (stage) => {
  switch (stage) {
    case 'Approved':
    case 'Full Order':    return { color: T.statusApproved, bg: T.statusApprovedBg };
    case 'Processing':    return { color: T.statusInfo,     bg: T.statusInfoBg };
    case 'Pending':
    case 'Partial Order': return { color: T.statusPending,  bg: T.statusPendingBg };
    case 'Rejected':
    case 'Cancelled':     return { color: T.statusRejected, bg: T.statusRejectedBg };
    default:              return { color: T.statusDraft,    bg: T.statusDraftBg };  // Draft / Closed
  }
};

const qcStyle = (status) => {
  switch (status) {
    case 'Accepted':            return { color: T.statusApproved, bg: T.statusApprovedBg };
    case 'Partially Accepted':  return { color: T.statusPending,  bg: T.statusPendingBg };
    case 'Rejected':            return { color: T.statusRejected, bg: T.statusRejectedBg };
    case 'On Hold':             return { color: T.statusInfo,     bg: T.statusInfoBg };
    default:                    return { color: T.statusDraft,    bg: T.statusDraftBg };  // Pending
  }
};

const money = (n) => `৳ ${Number(n || 0).toLocaleString()}`;
const num = (v) => Number(v) || 0;
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const stampStr = () => {
  const d = new Date();
  return `${todayStr()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const blankLine = () => ({ id: `L${Date.now()}${Math.round(performance.now())}`, itemName: '', qty: '', uom: '', rate: '' });

/** Approved, and something still to buy — the web's Initiate Purchase gate. */
const canReceive = (pr) => {
  if (String(pr.status).toLowerCase() !== 'approved') return false;
  const { ordered, received } = prReceived(pr);
  return ordered > 0 && received < ordered;
};

const isPrPending = (pr) => /^(pending approval|pending)$/i.test(String(pr.status));

/**
 * One Purchase Return per inspection, carrying every failed item — the same
 * record (same key, same shape, same seed guard) Quality Control writes on the
 * web, so a return raised from the phone lands in the Purchase Return module.
 */
function initiatePurchaseReturn(grnId, po, vendor, failed) {
  const KEY = 'harvest-data-v1:purchase-return-rows';
  let existing = SEED_RETURNS;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) existing = JSON.parse(raw);
  } catch { /* fall back to seed */ }
  const id = `RT-${new Date().getFullYear()}-${String(existing.length + 15).padStart(4, '0')}`;
  const ret = {
    id,
    date: todayStr(),
    grnRef: grnId,
    poRef: po,
    supplier: vendor,
    lines: failed.map((f, i) => ({
      id: `l-${Date.now()}-${i}`,
      itemName: f.item, uom: f.uom, qty: f.qty, unitPrice: 0,
      reason: f.reason, notes: f.notes,
    })),
    totalValue: 0,
    status: 'Submitted',
    remarks: `Auto-initiated from QC — GRN ${grnId} (${failed.length} item${failed.length === 1 ? '' : 's'} failed).`,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify([ret, ...existing]));
  } catch { /* quota — non-fatal */ }
  return id;
}

// ── Small shared pieces ─────────────────────────────────────────────────────
function Chip({ label, color, bg }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color, background: bg, padding: '2px 8px', borderRadius: T.radiusFull, fontFamily: T.fontBody, flexShrink: 0 }}>
      {label}
    </span>
  );
}

function Empty({ icon, text }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0' }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 13, color: T.textTertiary, fontFamily: T.fontBody, padding: '0 24px' }}>{text}</div>
    </div>
  );
}

function Banner({ text, tone = 'ok' }) {
  const color = tone === 'ok' ? T.statusApproved : T.statusInfo;
  const bg    = tone === 'ok' ? T.statusApprovedBg : T.statusInfoBg;
  return (
    <div style={{ background: bg, border: `1px solid ${color}30`, borderRadius: T.radiusMd, padding: '9px 12px', marginTop: 10, fontSize: 11, fontWeight: 700, color, fontFamily: T.fontBody }}>
      {text}
    </div>
  );
}

function ActionRow({ onApprove, onReject, approveLabel = 'Approve', rejectLabel = 'Reject' }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
      <button onClick={onReject}
        style={{ flex: 1, padding: '9px 0', background: 'none', border: `1px solid ${T.statusRejected}`, borderRadius: T.radiusMd, fontSize: 12, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody, cursor: 'pointer' }}>
        {rejectLabel}
      </button>
      <button onClick={onApprove}
        style={{ flex: 1, padding: '9px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}>
        {approveLabel}
      </button>
    </div>
  );
}

const TABS = [
  { key: 'requisition', label: 'Requisition' },
  { key: 'approve',     label: 'Approve' },
  { key: 'receive',     label: 'Receive' },
  { key: 'inspect',     label: 'QC' },
];

/**
 * `initialTab` is which stage of the cycle to open on — the More menu has a
 * door per stage (Purchase Requisition / Receive Items / Quality Control) and
 * they all land here. Every tab stays reachable from the tab bar either way.
 */
export function PurchaseRequisitionScreen({ nav, initialTab = 'requisition' }) {
  // Snapshot the web data on mount (mobile mounts fresh each time it opens).
  const [requisitions, setRequisitions] = useState(() => getPurchaseRequisitions());
  const [receipts, setReceipts]         = useState(() => getDirectReceiptApprovals());
  const { grns, addGRN, updateGRNLineQC } = useWorkflow();

  const [tab, setTab]           = useState(
    TABS.some((t) => t.key === initialTab) ? initialTab : 'requisition',
  );
  const [view, setView]         = useState('list');   // 'list' | 'form' | 'detail' | 'receive' | 'inspect'
  const [activeId, setActiveId] = useState(null);
  const [flashId, setFlashId]   = useState(null);
  const [notice, setNotice]     = useState('');

  const refreshPrs      = () => setRequisitions(getPurchaseRequisitions());
  const refreshReceipts = () => setReceipts(getDirectReceiptApprovals());
  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(''), 2800); };

  // ── New-PR form state ───────────────────────────────────────────────────
  const [requestedBy, setRequestedBy] = useState('');
  const [requiredBy, setRequiredBy]   = useState('');
  const [priority, setPriority]       = useState('Normal');
  const [justification, setJustification] = useState('');
  const [lines, setLines]             = useState([blankLine()]);
  const [touched, setTouched]         = useState(false);

  const validLines = lines.filter((l) => l.itemName.trim() && (parseFloat(l.qty) || 0) > 0);
  const formTotal  = validLines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.rate) || 0), 0);
  const canSubmit  = requestedBy.trim() && validLines.length > 0;

  const resetForm = () => {
    setRequestedBy(''); setRequiredBy(''); setPriority('Normal');
    setJustification(''); setLines([blankLine()]); setTouched(false);
  };

  const setLine = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, blankLine()]);
  const removeLine = (id) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  // Selecting a catalogue item auto-fills its UoM and cost rate.
  const onItemPick = (id, val) => {
    const hit = activeItems.find((it) => it.name.toLowerCase() === val.trim().toLowerCase());
    setLine(id, { itemName: val, ...(hit ? { uom: hit.uom, rate: hit.costPrice != null ? String(hit.costPrice) : '' } : {}) });
  };

  const submit = (asDraft) => {
    setTouched(true);
    if (!canSubmit) return;
    const created = addPurchaseRequisition({
      date: todayStr(),
      officeId: 'OFF-001',
      warehouseId: 'WH-003',
      requestedBy: requestedBy.trim(),
      requiredBy: requiredBy || '—',
      priority,
      justification: justification.trim(),
      lines: validLines.map((l, i) => ({
        id: `L${i + 1}`,
        itemName: l.itemName.trim(),
        description: '',
        qty: parseFloat(l.qty) || 0,
        uom: l.uom.trim() || 'unit',
        rate: parseFloat(l.rate) || 0,
      })),
      status: asDraft ? 'Draft' : 'Pending Approval',
    });
    // Re-read so the new PR (and its assigned id) appears at the top of the list.
    refreshPrs();
    setFlashId(created.id);
    resetForm();
    setTab('requisition');
    setView('list');
    setTimeout(() => setFlashId(null), 2400);
  };

  // ── Approve ─────────────────────────────────────────────────────────────
  const pendingPrs      = requisitions.filter(isPrPending);
  const pendingReceipts = receipts.filter((d) => d.status === 'Pending');

  const decidePr = (pr, approved) => {
    setPurchaseRequisitionStatus(pr.id, approved ? 'Approved' : 'Rejected');
    refreshPrs();
    flash(`${pr.id} ${approved ? 'approved — ready to receive' : 'rejected'}.`);
  };

  /** Same two writes Approval Management makes: record the GRN (→ Quality
   *  Control) and post the received qty back onto the requisition. */
  const decideReceipt = (dr, approved) => {
    if (approved) {
      addGRN(dr.grn);
      if (dr.sourcePrId && dr.prReceipts?.length) applyReceiptToPR(dr.sourcePrId, dr.prReceipts);
      setDirectReceiptApprovalStatus(dr.id, 'Approved', { processedBy: 'Mobile', processedAt: stampStr() });
    } else {
      setDirectReceiptApprovalStatus(dr.id, 'Rejected', { processedBy: 'Mobile', processedAt: stampStr() });
    }
    refreshReceipts();
    refreshPrs();
    flash(approved ? `${dr.dpRef} recorded — sent to Inspect.` : `${dr.dpRef} rejected.`);
  };

  // ── Receive ─────────────────────────────────────────────────────────────
  const receivable = requisitions.filter(canReceive);
  const [rcvVendor, setRcvVendor]     = useState('');
  const [rcvBy, setRcvBy]             = useState('');
  const [rcvChallan, setRcvChallan]   = useState('');
  const [rcvInvoice, setRcvInvoice]   = useState('');
  const [rcvNote, setRcvNote]         = useState('');
  const [rcvLines, setRcvLines]       = useState([]);
  const [rcvTouched, setRcvTouched]   = useState(false);

  const openReceive = (pr) => {
    setRcvVendor(''); setRcvBy(''); setRcvChallan(''); setRcvInvoice('');
    setRcvNote(pr.justification || '');
    setRcvTouched(false);
    setRcvLines(pr.lines
      .map((l) => ({
        prLineId: l.id,
        name: l.itemName,
        uom: l.uom,
        outstanding: Math.max(0, num(l.qty) - num(l.receivedQty)),
        qty: String(Math.max(0, num(l.qty) - num(l.receivedQty))),
        rate: String(num(l.rate)),
        expiry: '',
      }))
      .filter((l) => l.outstanding > 0));
    setActiveId(pr.id);
    setView('receive');
  };

  const setRcvLine = (prLineId, patch) =>
    setRcvLines((prev) => prev.map((l) => (l.prLineId === prLineId ? { ...l, ...patch } : l)));

  const rcvActive   = rcvLines.filter((l) => num(l.qty) > 0);
  const rcvTotal    = rcvActive.reduce((s, l) => s + num(l.qty) * num(l.rate), 0);
  const rcvNoRate   = rcvActive.filter((l) => num(l.rate) <= 0);
  const rcvOverQty  = rcvLines.filter((l) => num(l.qty) > l.outstanding);
  const canReceiveSubmit = rcvVendor.trim() && rcvBy.trim() && rcvActive.length > 0
    && rcvNoRate.length === 0 && rcvOverQty.length === 0;

  /** Exactly the payload Receive Items submits — it clears through the same
   *  Goods Receipt approval, then becomes a GRN and a PR write-back. */
  const submitReceive = () => {
    setRcvTouched(true);
    if (!canReceiveSubmit) return;
    const pr = requisitions.find((r) => r.id === activeId);
    if (!pr) return;
    const stamp = Date.now().toString().slice(-5);
    const grnId = `GRN-${stamp}`;
    const dpRef = `DP-${new Date().getFullYear()}-${stamp}`;
    const grn = {
      id: grnId,
      poRef: dpRef,
      vendor: rcvVendor.trim(),
      receivedBy: rcvBy.trim(),
      date: new Date().toLocaleString(),
      grnDate: todayStr(),
      challanNo: rcvChallan.trim() || undefined,
      lines: rcvActive.map((l, i) => ({
        itemId: `${grnId}-L${i + 1}`,
        name: l.name,
        qty: num(l.qty),
        uom: l.uom,
        temp: '',
        expiry: l.expiry,
        rate: num(l.rate),
        qcStatus: 'Pending',
      })),
      officeId: pr.officeId,
      warehouseId: pr.warehouseId,
      direct: true,
      note: rcvNote.trim(),
      invoiceNo: rcvInvoice.trim() || undefined,
      amount: rcvTotal,
    };
    addDirectReceiptApproval({
      id: `DRC-${stamp}`,
      dpRef,
      vendor: rcvVendor.trim(),
      amount: rcvTotal,
      itemsCount: rcvActive.length,
      requestedBy: rcvBy.trim(),
      requestedAt: stampStr(),
      justification: rcvNote.trim() || `Received against ${pr.id}.`,
      attachments: [],
      grn,
      sourcePrId: pr.id,
      prReceipts: rcvActive.map((l) => ({ lineId: l.prLineId, qty: num(l.qty) })),
      status: 'Pending',
    });
    refreshReceipts();
    setActiveId(null);
    setTab('approve');
    setView('list');
    flash(`${dpRef} submitted — pending goods-receipt approval.`);
  };

  // ── Inspect ─────────────────────────────────────────────────────────────
  const inspectable = grns.filter((g) => g.lines.some((l) => l.qcStatus === 'Pending'));
  // Lines already decided, newest receipt first — the history the web QC list
  // keeps behind its status filter. Read-only: the web locks a line once it
  // leaves Pending, so there is no re-inspect path here either.
  const inspected = grns
    .map((g) => ({ grn: g, done: g.lines.filter((l) => l.qcStatus && l.qcStatus !== 'Pending') }))
    .filter((x) => x.done.length > 0)
    .reverse();
  const [insDrafts, setInsDrafts] = useState({});

  const openInspect = (g) => {
    const d = {};
    // Default: inspect the full received qty, all passing — one tap accepts all.
    g.lines.forEach((l, i) => {
      if (l.qcStatus === 'Pending') d[i] = { qcQty: String(l.qty), passQty: String(l.qty), remarks: '' };
    });
    setInsDrafts(d);
    setActiveId(g.id);
    setView('inspect');
  };

  const setInsDraft = (idx, patch) =>
    setInsDrafts((prev) => ({ ...prev, [idx]: { ...prev[idx], ...patch } }));

  // Clamp a line into a resolved split: inspected ≤ received, passed ≤ inspected.
  const resolveLine = (received, d) => {
    const qcQ = Math.max(0, Math.min(num(d?.qcQty), received));
    const pass = Math.max(0, Math.min(num(d?.passQty), qcQ));
    return { qcQ, pass, fail: Math.max(0, qcQ - pass) };
  };
  const lineStatus = (received, pass, fail) =>
    fail === 0 && pass === received ? 'Accepted' : pass === 0 ? 'Rejected' : 'Partially Accepted';

  const confirmInspect = () => {
    const g = grns.find((x) => x.id === activeId);
    if (!g) return;
    const failed = [];
    let inspected = 0;
    g.lines.forEach((l, i) => {
      const d = insDrafts[i];
      if (!d) return;
      const { qcQ, pass, fail } = resolveLine(l.qty, d);
      if (qcQ <= 0) return;
      inspected++;
      updateGRNLineQC(g.id, i, lineStatus(l.qty, pass, fail), {
        qcQty: qcQ, qcPassQty: pass, qcFailQty: fail,
        qcCompliedQty: fail === 0 ? 'Yes' : 'No',
        qcRemarks: d.remarks.trim() || undefined,
        ...(fail > 0 ? { qcReason: 'Quality Issue' } : {}),
      });
      if (pass > 0) applyInventoryStock(l.name, pass);
      if (fail > 0) failed.push({ item: l.name, uom: l.uom, qty: fail, reason: 'Quality Issue', notes: d.remarks.trim() || undefined });
    });
    if (inspected === 0) { flash('Enter a QC quantity for at least one item.'); return; }
    const rtId = failed.length ? initiatePurchaseReturn(g.id, g.poRef, g.vendor, failed) : null;
    setActiveId(null);
    setView('list');
    flash(`${g.id} inspected — ${inspected} item${inspected === 1 ? '' : 's'} processed${rtId ? ` · Return ${rtId}` : ''}.`);
  };

  const counts = {
    requisition: requisitions.length,
    approve: pendingPrs.length + pendingReceipts.length,
    receive: receivable.length,
    inspect: inspectable.length,
  };

  // ── New requisition form ────────────────────────────────────────────────
  if (view === 'form') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
        <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => { resetForm(); setView('list'); }} style={BTN_BACK}>←</button>
          <div>
            <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>New Purchase Requisition</div>
            <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>Raise a requisition · syncs to web</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {/* Requested by */}
          <div style={{ marginBottom: 14 }}>
            <div style={LABEL}>Requested By *</div>
            <Combobox value={requestedBy} onChange={setRequestedBy} options={REQUESTERS}
              placeholder="Name / role" invalid={touched && !requestedBy.trim()} />
          </div>

          {/* Required by + priority */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Required By</div>
              <input type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} style={INPUT} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>Priority</div>
              <div style={{ display: 'flex', border: `1px solid ${T.border}`, borderRadius: T.radiusMd, overflow: 'hidden' }}>
                {['Normal', 'Urgent'].map((p) => (
                  <button key={p} onClick={() => setPriority(p)}
                    style={{ flex: 1, padding: '9px 0', fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer', border: 'none',
                      background: priority === p ? (p === 'Urgent' ? T.statusRejected : T.primary) : T.bgSurface,
                      color: priority === p ? '#fff' : T.textTertiary }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Line items */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 2px 8px' }}>
            <div style={{ ...LABEL, marginBottom: 0 }}>Items *</div>
            <button onClick={addLine} style={{ background: 'none', border: `1px solid ${T.primary}`, color: T.primary, borderRadius: T.radiusMd, padding: '3px 10px', fontSize: 11, fontWeight: 700, fontFamily: T.fontBody, cursor: 'pointer' }}>+ Add</button>
          </div>

          {lines.map((l, idx) => {
            const lineTotal = (parseFloat(l.qty) || 0) * (parseFloat(l.rate) || 0);
            const missing = touched && !(l.itemName.trim() && (parseFloat(l.qty) || 0) > 0) && (l.itemName.trim() || l.qty);
            return (
              <div key={l.id} style={{ background: T.bgSurface, border: `1px solid ${missing ? T.statusRejected : T.border}`, borderRadius: T.radiusLg, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody }}>Item {idx + 1}</span>
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(l.id)} style={{ background: 'none', border: 'none', color: T.statusRejected, fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: 0 }}>×</button>
                  )}
                </div>
                <Combobox value={l.itemName} onChange={(v) => onItemPick(l.id, v)} options={ITEM_NAMES}
                  placeholder="Search or type an item" containerStyle={{ marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="number" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.id, { qty: e.target.value })} placeholder="Qty" style={{ ...INPUT, flex: 1, fontWeight: 700 }} />
                  <input value={l.uom} onChange={(e) => setLine(l.id, { uom: e.target.value })} placeholder="UoM" style={{ ...INPUT, flex: 1 }} />
                  <input type="number" inputMode="decimal" value={l.rate} onChange={(e) => setLine(l.id, { rate: e.target.value })} placeholder="Rate" style={{ ...INPUT, flex: 1 }} />
                </div>
                {lineTotal > 0 && (
                  <div style={{ textAlign: 'right', fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 5 }}>Line total: <span style={{ fontWeight: 700, color: T.textPrimary }}>{money(lineTotal)}</span></div>
                )}
              </div>
            );
          })}

          {/* Justification */}
          <div style={{ margin: '6px 0 14px' }}>
            <div style={LABEL}>Justification (optional)</div>
            <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} placeholder="Reason for this requisition…"
              style={{ ...INPUT, resize: 'none' }} />
          </div>

          {/* Total */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.bgSubtle, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 14px', marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Est. Total</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{money(formTotal)}</span>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => submit(true)} disabled={!canSubmit}
              style={{ flex: 1, padding: '13px 0', background: 'none', border: `2px solid ${canSubmit ? T.borderStrong : T.border}`, borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: canSubmit ? T.textSecondary : T.textDisabled, fontFamily: T.fontBody, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
              Save Draft
            </button>
            <button onClick={() => submit(false)} disabled={!canSubmit}
              style={{ flex: 2, padding: '13px 0', background: canSubmit ? T.buttonGradient : T.borderStrong, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.7 }}>
              Submit for Approval
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Receive form ────────────────────────────────────────────────────────
  if (view === 'receive' && activeId) {
    const pr = requisitions.find((r) => r.id === activeId);
    if (pr) {
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
          <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button onClick={() => { setActiveId(null); setView('list'); }} style={BTN_BACK}>←</button>
            <div>
              <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Receive Goods</div>
              <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{pr.id} · {pr.requestedBy}</div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={LABEL}>Vendor *</div>
                <Combobox value={rcvVendor} onChange={setRcvVendor} options={VENDOR_NAMES}
                  placeholder="Supplier" invalid={rcvTouched && !rcvVendor.trim()} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={LABEL}>Received By *</div>
                <Combobox value={rcvBy} onChange={setRcvBy} options={REQUESTERS}
                  placeholder="Name / role" invalid={rcvTouched && !rcvBy.trim()} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={LABEL}>Challan No</div>
                <input value={rcvChallan} onChange={(e) => setRcvChallan(e.target.value)} placeholder="CH-…" style={INPUT} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={LABEL}>Invoice No</div>
                <input value={rcvInvoice} onChange={(e) => setRcvInvoice(e.target.value)} placeholder="INV-…" style={INPUT} />
              </div>
            </div>

            <div style={{ ...LABEL, margin: '4px 2px 8px' }}>Items Received *</div>
            {rcvLines.map((l) => {
              const over = num(l.qty) > l.outstanding;
              const noRate = rcvTouched && num(l.qty) > 0 && num(l.rate) <= 0;
              return (
                <div key={l.prLineId} style={{ background: T.bgSurface, border: `1px solid ${over || noRate ? T.statusRejected : T.border}`, borderRadius: T.radiusLg, padding: '10px 12px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{l.name}</span>
                    <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, flexShrink: 0, paddingLeft: 8 }}>
                      {l.outstanding} {l.uom} due
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="number" inputMode="decimal" value={l.qty} onChange={(e) => setRcvLine(l.prLineId, { qty: e.target.value })} placeholder="Qty" style={{ ...INPUT, flex: 1, fontWeight: 700 }} />
                    <input type="number" inputMode="decimal" value={l.rate} onChange={(e) => setRcvLine(l.prLineId, { rate: e.target.value })} placeholder="Rate" style={{ ...INPUT, flex: 1 }} />
                    <input type="date" value={l.expiry} onChange={(e) => setRcvLine(l.prLineId, { expiry: e.target.value })} style={{ ...INPUT, flex: 1.2 }} />
                  </div>
                  {over && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody, marginTop: 5 }}>
                      Exceeds the {l.outstanding} {l.uom} still due.
                    </div>
                  )}
                  {noRate && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.statusRejected, fontFamily: T.fontBody, marginTop: 5 }}>
                      Enter a purchase rate.
                    </div>
                  )}
                </div>
              );
            })}

            <div style={{ margin: '6px 0 14px' }}>
              <div style={LABEL}>Receiving Remarks</div>
              <textarea value={rcvNote} onChange={(e) => setRcvNote(e.target.value)} rows={2} placeholder="Delivery note, condition…"
                style={{ ...INPUT, resize: 'none' }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.bgSubtle, border: `1px solid ${T.border}`, borderRadius: T.radiusMd, padding: '10px 14px', marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Receipt Value</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{money(rcvTotal)}</span>
            </div>

            <button onClick={submitReceive} disabled={!canReceiveSubmit}
              style={{ width: '100%', padding: '13px 0', background: canReceiveSubmit ? T.buttonGradient : T.borderStrong, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: canReceiveSubmit ? 'pointer' : 'not-allowed', opacity: canReceiveSubmit ? 1 : 0.7 }}>
              Submit For Approval
            </button>
            <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, textAlign: 'center', marginTop: 8 }}>
              Recorded as a GRN and routed to Quality Control once approved.
            </div>
          </div>
        </div>
      );
    }
  }

  // ── Inspect form ────────────────────────────────────────────────────────
  if (view === 'inspect' && activeId) {
    const g = grns.find((x) => x.id === activeId);
    if (g) {
      const pending = g.lines.map((l, i) => ({ ...l, idx: i })).filter((l) => l.qcStatus === 'Pending');
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
          <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button onClick={() => { setActiveId(null); setView('list'); }} style={BTN_BACK}>←</button>
            <div>
              <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Inspect Receipt</div>
              <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{g.id} · {g.vendor}</div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            <div style={{ ...LABEL, margin: '0 2px 8px' }}>Items To Inspect ({pending.length})</div>
            {pending.map((l) => {
              const d = insDrafts[l.idx] || { qcQty: '', passQty: '', remarks: '' };
              const { qcQ, pass, fail } = resolveLine(l.qty, d);
              return (
                <div key={l.idx} style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '10px 12px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{l.name}</span>
                    <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, flexShrink: 0, paddingLeft: 8 }}>
                      {l.qty} {l.uom} received
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ ...LABEL, marginBottom: 4 }}>Inspected</div>
                      <input type="number" inputMode="decimal" value={d.qcQty} onChange={(e) => setInsDraft(l.idx, { qcQty: e.target.value })} style={{ ...INPUT, fontWeight: 700 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ ...LABEL, marginBottom: 4 }}>Passed</div>
                      <input type="number" inputMode="decimal" value={d.passQty} onChange={(e) => setInsDraft(l.idx, { passQty: e.target.value })} style={{ ...INPUT, fontWeight: 700 }} />
                    </div>
                  </div>
                  <input value={d.remarks} onChange={(e) => setInsDraft(l.idx, { remarks: e.target.value })} placeholder="Remarks (optional)"
                    style={{ ...INPUT, marginTop: 8 }} />
                  {qcQ > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 7 }}>
                      <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                        {pass} pass · {fail} fail
                      </span>
                      {(() => { const st = lineStatus(l.qty, pass, fail); const s = qcStyle(st); return <Chip label={st} color={s.color} bg={s.bg} />; })()}
                    </div>
                  )}
                </div>
              );
            })}

            <div style={{ background: T.statusInfoBg, border: `1px solid ${T.statusInfo}30`, borderRadius: T.radiusMd, padding: '10px 14px', margin: '4px 0 14px' }}>
              <div style={{ fontSize: 11, color: T.textSecondary, fontFamily: T.fontBody }}>
                Passed quantity posts to Stock Overview. Failed quantity initiates a Purchase Return to the vendor.
              </div>
            </div>

            <button onClick={confirmInspect}
              style={{ width: '100%', padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}>
              Confirm Inspection
            </button>
          </div>
        </div>
      );
    }
  }

  // ── Requisition detail ──────────────────────────────────────────────────
  if (view === 'detail' && activeId) {
    const pr = requisitions.find((r) => r.id === activeId);
    if (pr) {
      const stage = procurementStage(pr);
      const s = stageStyle(stage);
      const { ordered, received, pct } = prReceived(pr);
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
          <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button onClick={() => { setActiveId(null); setView('list'); }} style={BTN_BACK}>←</button>
            <div>
              <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Requisition Detail</div>
              <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{pr.id}</div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {/* Summary */}
            <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{money(pr.totalAmount)}</span>
                <Chip label={stage} color={s.color} bg={s.bg} />
              </div>
              {[['Requested By', pr.requestedBy], ['Date', pr.date], ['Required By', pr.requiredBy], ['Priority', pr.priority]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 7, paddingBottom: 7, borderTop: `1px solid ${T.border}` }}>
                  <span style={{ fontSize: 12, color: T.textTertiary, fontFamily: T.fontBody }}>{l}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: l === 'Priority' && v === 'Urgent' ? T.statusRejected : T.textPrimary, fontFamily: T.fontBody }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Receipt progress — only meaningful once approved */}
            {(stage === 'Processing' || stage === 'Partial Order' || stage === 'Full Order') && (
              <div style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '12px 14px', marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Received</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{received} / {ordered} · {pct}%</span>
                </div>
                <div style={{ height: 6, borderRadius: T.radiusFull, background: T.bgSubtle, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? T.statusApproved : T.primary }} />
                </div>
              </div>
            )}

            {/* Line items */}
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 2px 8px' }}>
              Items ({pr.lines.length})
            </div>
            {pr.lines.map((l) => (
              <div key={l.id} style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{l.itemName}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody, flexShrink: 0, paddingLeft: 8 }}>{money(l.qty * l.rate)}</span>
                </div>
                {l.description && <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginBottom: 3 }}>{l.description}</div>}
                <div style={{ fontSize: 11, color: T.textSecondary, fontFamily: T.fontBody }}>
                  {l.qty} {l.uom} × {money(l.rate)}
                  {num(l.receivedQty) > 0 && ` · ${num(l.receivedQty)} received`}
                </div>
              </div>
            ))}

            {/* Justification */}
            {pr.justification && (
              <div style={{ background: T.statusInfoBg, border: `1px solid ${T.statusInfo}30`, borderRadius: T.radiusMd, padding: '10px 14px', marginTop: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.statusInfo, fontFamily: T.fontBody, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Justification</div>
                <div style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody }}>{pr.justification}</div>
              </div>
            )}

            {/* The next step in the cycle, offered where the record already is */}
            {isPrPending(pr) && (
              <ActionRow
                onApprove={() => { decidePr(pr, true); setActiveId(null); setView('list'); }}
                onReject={() => { decidePr(pr, false); setActiveId(null); setView('list'); }}
              />
            )}
            {canReceive(pr) && (
              <button onClick={() => openReceive(pr)}
                style={{ width: '100%', marginTop: 12, padding: '13px 0', background: T.buttonGradient, border: 'none', borderRadius: T.radiusMd, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: T.fontBody, cursor: 'pointer' }}>
                Receive Goods
              </button>
            )}
          </div>
        </div>
      );
    }
  }

  // ── List view (tabbed) ──────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: T.bgBase, overflow: 'hidden' }}>
      <div style={{ background: T.topbarGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={() => nav.goBack()} style={BTN_BACK}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.fontBody, fontSize: 15, fontWeight: 700, color: '#fff' }}>Local Purchase</div>
          <div style={{ fontFamily: T.fontBody, fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>Requisition · Approve · Receive · QC</div>
        </div>
        {tab === 'requisition' && (
          <button onClick={() => { resetForm(); setView('form'); }}
            style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.55)', borderRadius: T.radiusMd, height: 30, padding: '0 12px', cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: T.fontBody, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            + New
          </button>
        )}
      </div>

      {/* Stage tabs — the purchase cycle, in order */}
      <div style={{ display: 'flex', background: T.bgSurface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ flex: 1, padding: '10px 0 8px', background: 'none', border: 'none', borderBottom: `2px solid ${on ? T.primary : 'transparent'}`, cursor: 'pointer', fontFamily: T.fontBody, fontSize: 11.5, fontWeight: 700, color: on ? T.primary : T.textTertiary, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              {t.label}
              {counts[t.key] > 0 && (
                <span style={{ fontSize: 9.5, fontWeight: 700, color: on ? '#fff' : T.textTertiary, background: on ? T.primary : T.bgSubtle, borderRadius: T.radiusFull, padding: '1px 5px', minWidth: 14, textAlign: 'center' }}>
                  {counts[t.key]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px' }}>
        {notice && <Banner text={notice} />}

        {/* ── Requisition ─────────────────────────────────────────────── */}
        {tab === 'requisition' && (
          requisitions.length === 0 ? (
            <Empty icon="📋" text="No purchase requisitions yet. Tap “+ New” to raise one." />
          ) : requisitions.map((pr) => {
            const stage = procurementStage(pr);
            const s = stageStyle(stage);
            const isNew = pr.id === flashId;
            return (
              <div key={pr.id} onClick={() => { setActiveId(pr.id); setView('detail'); }}
                style={{ ...CARD, border: `1px solid ${isNew ? T.primary : T.border}`, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ flex: 1, paddingRight: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{pr.id}</div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{pr.requestedBy} · {pr.date}</div>
                  </div>
                  <Chip label={stage} color={s.color} bg={s.bg} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: T.textSecondary, fontFamily: T.fontBody }}>{pr.lines.length} item{pr.lines.length === 1 ? '' : 's'}{pr.priority === 'Urgent' ? ' · Urgent' : ''}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{money(pr.totalAmount)}</span>
                </div>
                {isNew && <div style={{ fontSize: 10, fontWeight: 700, color: T.statusApproved, fontFamily: T.fontBody, marginTop: 5 }}>✓ Requisition raised · synced to web</div>}
              </div>
            );
          })
        )}

        {/* ── Approve ─────────────────────────────────────────────────── */}
        {tab === 'approve' && (
          pendingPrs.length === 0 && pendingReceipts.length === 0 ? (
            <Empty icon="✅" text="Nothing waiting for approval." />
          ) : (
            <>
              {pendingPrs.length > 0 && <div style={SECTION}>Purchase Requisition ({pendingPrs.length})</div>}
              {pendingPrs.map((pr) => (
                <div key={pr.id} style={CARD}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ flex: 1, paddingRight: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{pr.id}</div>
                      <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{pr.requestedBy} · {pr.date}</div>
                    </div>
                    <Chip label="Pending" color={T.statusPending} bg={T.statusPendingBg} />
                  </div>
                  <div style={{ fontSize: 11, color: T.textSecondary, fontFamily: T.fontBody, marginBottom: 2 }}>
                    {pr.lines.map((l) => `${l.itemName} ${l.qty} ${l.uom}`).join(', ')}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{pr.priority === 'Urgent' ? 'Urgent' : 'Normal'} · required {pr.requiredBy}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{money(pr.totalAmount)}</span>
                  </div>
                  <ActionRow onApprove={() => decidePr(pr, true)} onReject={() => decidePr(pr, false)} />
                </div>
              ))}

              {pendingReceipts.length > 0 && <div style={SECTION}>Goods Receipt ({pendingReceipts.length})</div>}
              {pendingReceipts.map((dr) => (
                <div key={dr.id} style={CARD}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ flex: 1, paddingRight: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{dr.dpRef}</div>
                      <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{dr.vendor} · {dr.requestedAt}</div>
                    </div>
                    <Chip label="Pending" color={T.statusPending} bg={T.statusPendingBg} />
                  </div>
                  <div style={{ fontSize: 11, color: T.textSecondary, fontFamily: T.fontBody, marginBottom: 2 }}>
                    {dr.grn.lines.map((l) => `${l.name} ${l.qty} ${l.uom}`).join(', ')}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>
                      {dr.itemsCount} item{dr.itemsCount === 1 ? '' : 's'}{dr.sourcePrId ? ` · against ${dr.sourcePrId}` : ''}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{money(dr.amount)}</span>
                  </div>
                  <ActionRow onApprove={() => decideReceipt(dr, true)} onReject={() => decideReceipt(dr, false)} />
                </div>
              ))}
            </>
          )
        )}

        {/* ── Receive ─────────────────────────────────────────────────── */}
        {tab === 'receive' && (
          receivable.length === 0 ? (
            <Empty icon="📦" text="No approved requisition is waiting on goods. Approve one first." />
          ) : receivable.map((pr) => {
            const { ordered, received, pct } = prReceived(pr);
            return (
              <div key={pr.id} onClick={() => openReceive(pr)} style={{ ...CARD, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ flex: 1, paddingRight: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{pr.id}</div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{pr.requestedBy} · required {pr.requiredBy}</div>
                  </div>
                  <Chip label={received > 0 ? 'Partial' : 'Approved'}
                    color={received > 0 ? T.statusPending : T.statusApproved}
                    bg={received > 0 ? T.statusPendingBg : T.statusApprovedBg} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>Received</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{received} / {ordered} · {pct}%</span>
                </div>
                <div style={{ height: 6, borderRadius: T.radiusFull, background: T.bgSubtle, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: T.primary }} />
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.primary, fontFamily: T.fontBody, marginTop: 8 }}>Receive Goods ›</div>
              </div>
            );
          })
        )}

        {/* ── QC / Inspect ────────────────────────────────────────────── */}
        {tab === 'inspect' && inspectable.length === 0 && inspected.length === 0 && (
          <Empty icon="🔍" text="No receipt is waiting on inspection. Approve a goods receipt first." />
        )}

        {tab === 'inspect' && inspectable.length > 0 && (
          <div style={SECTION}>Awaiting inspection ({inspectable.length})</div>
        )}
        {tab === 'inspect' && (
          inspectable.map((g) => {
            const pending = g.lines.filter((l) => l.qcStatus === 'Pending');
            return (
              <div key={g.id} onClick={() => openInspect(g)} style={{ ...CARD, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ flex: 1, paddingRight: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{g.id}</div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{g.vendor} · {g.poRef}</div>
                  </div>
                  <Chip label="Pending QC" color={T.statusPending} bg={T.statusPendingBg} />
                </div>
                <div style={{ fontSize: 11, color: T.textSecondary, fontFamily: T.fontBody, marginBottom: 2 }}>
                  {pending.map((l) => `${l.name} ${l.qty} ${l.uom}`).join(', ')}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody }}>{pending.length} item{pending.length === 1 ? '' : 's'} to inspect</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: T.primary, fontFamily: T.fontBody }}>Inspect ›</span>
                </div>
              </div>
            );
          })
        )}

        {tab === 'inspect' && inspected.length > 0 && (
          <>
            <div style={SECTION}>Inspected ({inspected.length})</div>
            {inspected.map(({ grn: g, done }) => (
              <div key={`done-${g.id}`} style={CARD}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ flex: 1, paddingRight: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontBody }}>{g.id}</div>
                    <div style={{ fontSize: 11, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>{g.vendor} · {g.poRef}</div>
                  </div>
                </div>
                {done.map((l, i) => {
                  const s = qcStyle(l.qcStatus);
                  const pass = num(l.qcPassQty);
                  const fail = num(l.qcFailQty);
                  return (
                    <div key={`${g.id}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 7, borderTop: i === 0 ? 'none' : `1px solid ${T.border}` }}>
                      <div style={{ flex: 1, minWidth: 0, paddingBottom: 7 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary, fontFamily: T.fontBody }}>{l.name}</div>
                        <div style={{ fontSize: 10.5, color: T.textTertiary, fontFamily: T.fontBody, marginTop: 2 }}>
                          {pass} passed · {fail} failed of {l.qty} {l.uom}
                          {l.qcRemarks ? ` · ${l.qcRemarks}` : ''}
                        </div>
                      </div>
                      <Chip label={l.qcStatus} color={s.color} bg={s.bg} />
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
