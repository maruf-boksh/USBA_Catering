import { useState, useEffect, useMemo, useRef } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  FileText, ClipboardList, CheckCircle, Plus, Save, Send, Trash2, Pencil, Eye, ArrowLeft, ShoppingCart, AlertTriangle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  getActiveItemProfiles, getItemTypeOptions, getUomOptionsForItem, primaryUomEquivalent,
} from "@/lib/item-profiles";
import type { UomOption } from "@/lib/sample-data";
import { fmtQty } from "@/lib/num";
import { LocationPicker, LocationFilter, LocationCell } from "@/components/common/LocationPicker";
import { useWorkflow, type WfRequisition, type WfDemandItem } from "@/lib/workflow-store";
import { useArrivalFlash } from "@/lib/arrival-flash";
import {
  seedRequisitions,
  procurementStage,
  prReceived,
  matchesStatusFilter,
  isPrApprovalOverdue,
  PR_APPROVAL_SLA_HOURS,
  PR_STATUS_FILTERS,
  type PRLineItem,
  type Priority,
  type PurchaseRequisition,
} from "@/lib/purchase-requisitions";

const PRIORITIES: Priority[] = ["Normal", "Urgent"];
const UOMS = ["Kg", "Litre", "Pcs", "Box", "Pack", "Unit", "Bottle"];

const REQUESTERS = [
  "S. Ahmed",
  "M. Hossain",
  "F. Begum",
  "A. Khan",
  "N. Hasan",
  "M. Karim",
  "R. Islam",
  "T. Rahman",
];


const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

type PickerItem = {
  name: string;
  uom: string;
  description: string;
  itemType: string;
  /** Primary UOM + any Alt UOMs configured on the item's profile. */
  uomOptions: UomOption[];
};

// Item picker — pulled live from the Item Profile master (config-item.tsx), so
// items, item types and alt UOMs added there are usable here without a rebuild.
function buildItemMaster(): PickerItem[] {
  return getActiveItemProfiles().map((i) => ({
    name: i.name,
    uom: i.uom,
    // Full classification path, so two similarly-named lines are told apart in
    // the picker without opening the Item Profile.
    description: [i.code, i.category, i.subCategory, i.minorCategory]
      .filter(Boolean).join(" · "),
    itemType: i.itemType,
    uomOptions: getUomOptionsForItem(i.name, [i]),
  }));
}

/** DDL label for a UOM option — alts carry their conversion, e.g. "Dozen (×12 Piece)". */
function uomOptionLabel(o: UomOption, primaryUom: string): string {
  return o.isPrimary ? o.uom : `${o.uom} (×${fmtQty(o.conversion)} ${primaryUom})`;
}

/**
 * Stock-unit equivalent of a saved line, when it was raised in an Alt UOM. Uses
 * the values stored on the line, falling back to a live Item Profile lookup for
 * lines saved before alt UOMs were recorded (seed / legacy rows).
 */
function lineAltEquivalent(l: PRLineItem): { qty: number; uom: string } | null {
  if (l.primaryQty != null && l.primaryUom) return { qty: l.primaryQty, uom: l.primaryUom };
  return primaryUomEquivalent(l.itemName, l.qty, l.uom);
}

/** UoM table cell shared by every PR line table: entered unit + stock equivalent. */
function UomCell({ line }: { line: PRLineItem }) {
  const eq = lineAltEquivalent(line);
  return (
    <div className="leading-tight">
      <span>{line.uom}</span>
      {eq && (
        <div className="text-[11px] text-muted-foreground whitespace-nowrap">
          = {fmtQty(eq.qty)} {eq.uom}
        </div>
      )}
    </div>
  );
}

/** "All" plus every item type configured in the Item Profile's Item Type DDL. */
const ITEM_TYPE_ALL = "All";

function filterByItemType(master: PickerItem[], type: string): PickerItem[] {
  if (type === ITEM_TYPE_ALL) return master;
  return master.filter((i) => i.itemType === type);
}

// ── Bridge: convert workflow-store WfRequisition (e.g. MRP-generated) into the
// local PurchaseRequisition shape so they show up in this module's list. The
// item rate is looked up from the central inventory if available; otherwise 0.
function wfReqToPurchaseRequisition(wf: WfRequisition): PurchaseRequisition {
  const lines: PRLineItem[] = (wf.demandItems ?? []).map((d, i) => ({
    id: `${wf.id}-L${i + 1}`,
    itemName: d.name,
    description: d.type ? `${d.type}` : "",
    qty: d.qty,
    uom: d.uom,
    rate: 0,    // unit rate isn't carried on demand items
  }));
  const totalAmount = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  // Map workflow statuses → local statuses for the list display
  const statusMap: Record<string, string> = {
    "Pending Accounts": "Pending Approval",
    "Approved": "Approved",
    "Rejected": "Rejected",
  };
  const status = statusMap[wf.status] ?? "Pending Approval";
  return {
    id: wf.id,
    date: wf.date.slice(0, 10),
    officeId: wf.officeId ?? "OFF-001",
    warehouseId: wf.warehouseId ?? "WH-001",
    requestedBy: wf.requestedBy,
    requiredBy: "—",
    priority: "Normal",
    justification: wf.note,
    lines,
    status,
    totalAmount,
  };
}

type PRPrefill = {
  // Single-item prefill (e.g. from Stock Overview). Optional so a multi-line
  // payload (from a Demand Request's shortfall table) can omit them.
  itemName?: string;
  uom?: string;
  qty?: number;
  rate?: number;
  priority?: Priority;
  justification?: string;
  source?: string;
  requestedBy?: string;
  officeId?: string;
  warehouseId?: string;
  /** Multi-line prefill — takes precedence over the single-item fields. */
  lines?: PRLineItem[];
};

export default function PurchaseRequisitionPage() {
  useArrivalFlash();
  const navigate = useNavigate();
  const { wfRequisitions, updateRequisition } = useWorkflow();
  const [requisitions, setRequisitions] = usePersistedState<PurchaseRequisition[]>("purchase-requisitions", seedRequisitions);
  const [view, setView] = useState<"list" | "create">("list");
  const [selected, setSelected] = useState<PurchaseRequisition | null>(null);
  const [editing, setEditing] = useState<PurchaseRequisition | null>(null);
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [prefill, setPrefill] = useState<PRPrefill | null>(null);
  // Re-send (for overdue PRs) — collects a fresh justification in a popup.
  const [resendTarget, setResendTarget] = useState<PurchaseRequisition | null>(null);
  const [resendReason, setResendReason] = useState("");

  // Status values where a requisition is still mutable. Once approved /
  // rejected / closed the form is read-only.
  const isEditable = (r: PurchaseRequisition) =>
    r.status === "Pending Approval" || r.status === "Draft";

  /**
   * Persist an edited requisition. If it lives in our local seed array we
   * update there; if it was bridged in from the workflow store (MRP, demand
   * auto-flow) we push the edit back via `updateRequisition` so other modules
   * see the same line-item changes.
   */
  const saveEditedRequisition = (next: PurchaseRequisition) => {
    const isLocal = requisitions.some((r) => r.id === next.id);
    if (isLocal) {
      setRequisitions((prev) => prev.map((r) => (r.id === next.id ? next : r)));
    } else {
      // Bridged from workflow-store. Translate the local lines back into the
      // WfDemandItem shape and patch the workflow record.
      const demandItems: WfDemandItem[] = next.lines.map((l) => ({
        id: l.id,
        name: l.itemName,
        qty: l.qty,
        uom: l.uom,
        type: l.description || "Material",
      }));
      updateRequisition(next.id, {
        items: next.lines.length,
        demandItems,
        note: next.justification,
      });
    }
    toast.success(`${next.id} updated.`);
    setEditing(null);
  };

  // Auto-open Create view when navigated to from Stock Overview (or any other
  // page that stashes a "pr-prefill-from-inventory" payload in sessionStorage).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("pr-prefill-from-inventory");
      if (!raw) return;
      sessionStorage.removeItem("pr-prefill-from-inventory");
      const parsed = JSON.parse(raw) as PRPrefill;
      setPrefill(parsed);
      setView("create");
      const count = parsed.lines?.length ?? (parsed.itemName ? 1 : 0);
      const what = count === 1 && parsed.itemName ? parsed.itemName : `${count} item${count === 1 ? "" : "s"}`;
      toast.success(
        parsed.source
          ? `New PR pre-filled from ${parsed.source} — ${what}.`
          : `New PR pre-filled with ${what}.`,
      );
    } catch {
      /* malformed payload — ignore */
    }
  }, []);

  const addRequisition = (pr: PurchaseRequisition) => {
    setRequisitions((prev) => [pr, ...prev]);
    setView("list");
    setPrefill(null);
  };

  // Back from the Create view: if it was opened via an external prefill (e.g.
  // the Demand Request shortfall flow) return to the previous page; otherwise
  // just drop back to this module's list.
  const handleBack = () => {
    if (prefill) { setPrefill(null); navigate(-1); }
    else setView("list");
  };

  // Workflow-store requisitions (MRP, kitchen demand, etc.) bridged in for display.
  // De-dupe in case any local PR happens to share an id with a workflow record.
  // Local requisitions come FIRST so a freshly created PR (prepended in
  // addRequisition) lands at the top of page 1 instead of behind the bridged rows.
  const bridged: PurchaseRequisition[] = wfRequisitions.map(wfReqToPurchaseRequisition);
  const localIds = new Set(requisitions.map((r) => r.id));
  const combined = [
    ...requisitions,
    ...bridged.filter((b) => !localIds.has(b.id)),
  ];

  const filtered = combined.filter((r) => {
    if (filterOffice && r.officeId !== filterOffice) return false;
    if (filterWarehouse && r.warehouseId !== filterWarehouse) return false;
    if (!matchesStatusFilter(r, filterStatus)) return false;
    return true;
  });

  const totalCount = filtered.length;
  const draftCount = filtered.filter((r) => r.status === "Draft").length;
  const pendingCount = filtered.filter((r) => r.status === "Pending Approval").length;
  const approvedCount = filtered.filter((r) => r.status === "Approved").length;

  // ── 72-hour approval SLA ────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const overduePending = combined.filter((r) => isPrApprovalOverdue(r));

  // Notify (once per mount) that the approver and requester were alerted about
  // requisitions still pending beyond the 72-hour window.
  const slaNotifiedRef = useRef(false);
  useEffect(() => {
    if (overduePending.length > 0 && !slaNotifiedRef.current) {
      slaNotifiedRef.current = true;
      toast.warning(
        `${overduePending.length} requisition${overduePending.length === 1 ? "" : "s"} pending approval beyond ${PR_APPROVAL_SLA_HOURS}h — approver and requester notified.`,
      );
    }
  }, [overduePending.length]);

  // Requester re-sends an overdue requisition — opens a justification popup first.
  const openResend = (r: PurchaseRequisition) => {
    setResendTarget(r);
    setResendReason("");
  };

  // Confirm re-send: resets the 72h clock (new PR date) and records the
  // requester's justification (mentioning the earlier delay).
  const confirmResend = () => {
    if (!resendTarget) return;
    if (!resendReason.trim()) { toast.error("Add a justification mentioning the earlier delay."); return; }
    const note = `[Re-sent ${today} after earlier ${PR_APPROVAL_SLA_HOURS}h approval delay] `;
    const updated: PurchaseRequisition = {
      ...resendTarget,
      date: today,
      status: "Pending Approval",
      justification: note + resendReason.trim(),
    };
    if (requisitions.some((x) => x.id === resendTarget.id)) {
      setRequisitions((prev) => prev.map((x) => (x.id === resendTarget.id ? updated : x)));
    } else {
      updateRequisition(resendTarget.id, { note: updated.justification });
    }
    toast.success(`${resendTarget.id} re-sent for approval — 72h window reset; approver notified.`);
    setResendTarget(null);
    setResendReason("");
  };

  const cols: Column<PurchaseRequisition>[] = [
    { key: "id",          header: "PR No" },
    { key: "date",        header: "Date" },
    {
      key: "officeId", header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    { key: "requestedBy", header: "Requested By" },
    {
      key: "lines", header: "Items", className: "text-right",
      render: (r) => <span>{r.lines.length}</span>,
    },
    {
      key: "totalAmount", header: "Est. Amount", className: "text-right",
      render: (r) => <span className="tabular-nums">৳ {r.totalAmount.toLocaleString()}</span>,
    },
    {
      key: "priority", header: "Priority",
      render: (r) => (
        <Badge
          variant={r.priority === "Urgent" ? "destructive" : "outline"}
          className="text-[10px]"
        >
          {r.priority}
        </Badge>
      ),
    },
    {
      // Combined status: the procurement stage IS the status — it folds the
      // approval state (Draft / Pending / Rejected / Cancelled / Closed) and the
      // receipt-driven stage (Processing / Partial Order / Full Order) into one.
      key: "status", header: "Status",
      render: (r) => <StatusBadge status={procurementStage(r)} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Purchase Requisition"
        subtitle="Create and track requisitions before issuing purchase orders"
        actions={
          view === "create" ? (
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          ) : (
            <Button onClick={() => setView("create")}>
              <Plus className="h-4 w-4 mr-1" />
              Create Requisition
            </Button>
          )
        }
      />

      {view === "list" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Total PRs"          value={totalCount}    icon={FileText}      tone="navy"    />
            <KpiCard label="Draft"              value={draftCount}    icon={ClipboardList} tone="warning" />
            <KpiCard label="Pending Approval"   value={pendingCount}  icon={ClipboardList} tone="warning" />
            <KpiCard label="Approved"           value={approvedCount} icon={CheckCircle}   tone="success" />
          </div>

          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <LocationFilter
                officeId={filterOffice}
                warehouseId={filterWarehouse}
                onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
              />
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Status</Label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className={selectCls + " min-w-[160px]"}
                >
                  {PR_STATUS_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <span className="text-xs text-muted-foreground">
              Showing <strong className="text-foreground tabular-nums">{filtered.length}</strong> of {combined.length}
            </span>
          </div>

          {overduePending.length > 0 && (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <div>
                <span className="font-semibold">
                  {overduePending.length} requisition{overduePending.length === 1 ? "" : "s"} pending approval beyond {PR_APPROVAL_SLA_HOURS} hours.
                </span>{" "}
                The approver and requester have been notified. The requester can re-send an overdue requisition for approval — the earlier delay is recorded in its justification.
                <span className="ml-1 font-mono text-[11px]">{overduePending.map((r) => r.id).join(", ")}</span>
              </div>
            </div>
          )}

          <div data-arrival-id="pr-list">
            <DataTable
              title="purchase-requisitions"
              data={filtered}
              columns={cols}
              searchKeys={["id", "requestedBy", "status"]}
              selectable={false}
              actions={(r) => (
                <div className="flex items-center gap-1.5">
                  {isPrApprovalOverdue(r) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px] border-amber-400 text-amber-700 hover:bg-amber-50"
                      onClick={() => openResend(r)}
                      title={`Re-send ${r.id} for approval`}
                    >
                      <Send className="h-3 w-3 mr-1" /> Re-send
                    </Button>
                  )}
                  {isEditable(r) && (
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 border-primary/40 text-primary hover:bg-primary/5"
                      onClick={() => setEditing(r)}
                      title={`Edit ${r.id}`}
                      aria-label={`Edit ${r.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    onClick={() => setSelected(r)}
                    title={`View ${r.id}`}
                    aria-label={`View ${r.id}`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            />
          </div>
        </>
      ) : (
        <PurchaseRequisitionCreate
          nextNumber={Math.max(...requisitions.map((r) => Number(r.id.split("-").pop()))) + 1}
          onSave={addRequisition}
          prefill={prefill}
        />
      )}

      <RequisitionDetailsDialog
        requisition={selected}
        onClose={() => setSelected(null)}
      />

      <RequisitionEditDialog
        requisition={editing}
        onClose={() => setEditing(null)}
        onSave={saveEditedRequisition}
      />

      {/* Re-send for approval — justification popup for overdue requisitions */}
      <Dialog open={!!resendTarget} onOpenChange={(o) => { if (!o) setResendTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{resendTarget ? `Re-send ${resendTarget.id} for approval` : "Re-send for approval"}</DialogTitle>
          </DialogHeader>
          <div className="rounded-md border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
            This requisition was pending approval beyond {PR_APPROVAL_SLA_HOURS} hours. Re-sending resets the 72-hour window and notifies the approver — mention the earlier delay below.
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Justification <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={resendReason}
              onChange={(e) => setResendReason(e.target.value)}
              placeholder="Explain the re-send, noting the earlier 72-hour approval delay…"
              className="mt-1 min-h-24"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResendTarget(null)}>Cancel</Button>
            <Button onClick={confirmResend}>
              <Send className="h-4 w-4 mr-1.5" /> Re-send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PurchaseRequisitionCreate({
  nextNumber, onSave, prefill,
}: {
  nextNumber: number;
  onSave: (pr: PurchaseRequisition) => void;
  prefill?: PRPrefill | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  // Required By must not exceed 72 hours (3 days) from the PR date.
  const maxRequiredBy = new Date(Date.now() + 72 * 3600 * 1000).toISOString().slice(0, 10);

  // Header state — PR Date is auto-set by the system to today (created "now",
  // not back/forward dated); not user-editable.
  const [prDate] = useState(today);
  const [officeId, setOfficeId] = useState(prefill?.officeId ?? "OFF-001");
  const [warehouseId, setWarehouseId] = useState(prefill?.warehouseId ?? "WH-001");
  const [requestedBy, setRequestedBy] = useState(prefill?.requestedBy ?? "");
  const [requiredBy, setRequiredBy] = useState("");
  const [priority, setPriority] = useState<Priority>(prefill?.priority ?? "Normal");
  const [justification, setJustification] = useState(prefill?.justification ?? "");

  // Line state
  const itemMaster = useMemo(buildItemMaster, []);
  const itemTypeOptions = useMemo(() => getItemTypeOptions(), []);
  const [itemTypeFilter, setItemTypeFilter] = useState(ITEM_TYPE_ALL);
  const [itemSearch, setItemSearch] = useState("");
  const [showItemDrop, setShowItemDrop] = useState(false);
  const [itemName, setItemName] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("");
  const [uom, setUom] = useState(UOMS[0]);
  const [rate, setRate] = useState("");
  const [lines, setLines] = useState<PRLineItem[]>(
    prefill?.lines?.length
      ? prefill.lines.map((l, i) => ({ ...l, id: l.id || `LN-PREFILL-${i + 1}` }))
      : prefill?.itemName
        ? [{
            id: `LN-PREFILL-${Date.now()}`,
            itemName: prefill.itemName,
            description: "",
            qty: prefill.qty ?? 0,
            uom: prefill.uom ?? UOMS[0],
            rate: prefill.rate ?? 0,
          }]
        : [],
  );

  const totalAmount = lines.reduce((s, l) => s + l.qty * l.rate, 0);

  const filteredItemMaster = useMemo(
    () => filterByItemType(itemMaster, itemTypeFilter),
    [itemMaster, itemTypeFilter],
  );

  const visibleItems = itemSearch.trim()
    ? filteredItemMaster.filter((i) => i.name.toLowerCase().includes(itemSearch.trim().toLowerCase()))
    : filteredItemMaster;

  // UOM choices follow the picked item: its Primary UOM plus every Alt UOM on
  // its Item Profile. Falls back to the generic list until an item is chosen.
  const selectedItem = itemMaster.find((i) => i.name === itemName);
  const uomOptions = selectedItem?.uomOptions ?? [];
  // Live "2 Carton = 720 Piece" readout for the row being entered.
  const draftEquivalent = itemName && Number(qty) > 0
    ? primaryUomEquivalent(itemName, Number(qty), uom)
    : null;

  const addLine = () => {
    if (!itemName.trim()) { toast.error("Item name is required."); return; }
    if (!itemMaster.find((i) => i.name === itemName.trim())) { toast.error("Select a valid item from the list."); return; }
    const qtyN = Number(qty);
    if (!qtyN || qtyN <= 0) { toast.error("Quantity must be greater than zero."); return; }
    const rateN = Number(rate);
    if (rateN < 0) { toast.error("Rate cannot be negative."); return; }
    const eq = primaryUomEquivalent(itemName.trim(), qtyN, uom);
    setLines((prev) => [
      ...prev,
      {
        id: `LN-${Date.now()}`,
        itemName: itemName.trim(),
        description: description.trim(),
        qty: qtyN,
        uom,
        rate: rateN,
        ...(eq ? { primaryQty: eq.qty, primaryUom: eq.uom } : {}),
      },
    ]);
    setItemName("");
    setItemSearch("");
    setDescription("");
    setQty("");
    setRate("");
    setUom(UOMS[0]);   // back to the generic list until the next item is picked
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleSave = (submit: boolean) => {
    if (!officeId) { toast.error("Office is required."); return; }
    if (!warehouseId) { toast.error("Warehouse is required."); return; }
    if (!requestedBy.trim()) { toast.error("Requested By is required."); return; }
    if (requiredBy && requiredBy > maxRequiredBy) {
      toast.error("Required By must be within 72 hours of the PR date.");
      return;
    }
    if (lines.length === 0) { toast.error("Add at least one line item."); return; }

    const newPR: PurchaseRequisition = {
      id: `PR-2026-${String(nextNumber).padStart(3, "0")}`,
      date: prDate,
      officeId, warehouseId,
      requestedBy: requestedBy.trim(),
      requiredBy: requiredBy || "—",
      priority,
      justification: justification.trim(),
      lines,
      status: submit ? "Pending Approval" : "Draft",
      totalAmount,
    };
    onSave(newPR);
    toast.success(`${newPR.id} ${submit ? "saved — pending approval" : "saved as draft"}.`);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
              Requisition Information
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => handleSave(false)}>
                <Save className="h-4 w-4 mr-1.5" /> Save Draft
              </Button>
              <Button onClick={() => handleSave(true)}>
                <Save className="h-4 w-4 mr-1.5" /> Save
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                PR Date <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={prDate}
                readOnly
                tabIndex={-1}
                title="PR date is set to today and cannot be changed"
                className="mt-1 bg-muted/50 text-muted-foreground cursor-default"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Auto-set by the system to today.</p>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Required By
              </Label>
              <Input
                type="date"
                value={requiredBy}
                min={today}
                max={maxRequiredBy}
                onChange={(e) => setRequiredBy(e.target.value)}
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Must be within 72 hours of the PR date.</p>
            </div>

            <LocationPicker
              officeId={officeId}
              warehouseId={warehouseId}
              onChange={(n) => { setOfficeId(n.officeId); setWarehouseId(n.warehouseId); }}
            />

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Requested By <span className="text-destructive">*</span>
              </Label>
              <select
                value={requestedBy}
                onChange={(e) => setRequestedBy(e.target.value)}
                className={selectCls}
              >
                <option value="">Select requester…</option>
                {REQUESTERS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Priority
              </Label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className={selectCls}
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Justification / Remarks
              </Label>
              <Textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Why is this requisition needed?"
                className="mt-1 min-h-[72px]"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
              Line Items
            </h3>
            <div className="text-sm text-muted-foreground">
              Estimated Total:{" "}
              <span className="font-bold text-foreground tabular-nums">
                ৳ {totalAmount.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item Type</Label>
              <select
                value={itemTypeFilter}
                onChange={(e) => {
                  setItemTypeFilter(e.target.value);
                  setItemName("");
                  setItemSearch("");
                  setDescription("");
                  setUom(UOMS[0]);
                }}
                className={selectCls}
              >
                <option value={ITEM_TYPE_ALL}>All</option>
                {itemTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="md:col-span-3 relative">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Item <span className="text-destructive">*</span>
              </Label>
              <input
                value={itemName || itemSearch}
                onFocus={() => { setItemSearch(""); setShowItemDrop(true); }}
                onChange={(e) => { setItemSearch(e.target.value); setItemName(""); setShowItemDrop(true); }}
                onBlur={() => setShowItemDrop(false)}
                placeholder="Type to search item…"
                className={selectCls + " mt-1"}
              />
              {showItemDrop && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto rounded-md border border-input bg-background shadow-md">
                  {visibleItems.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No items found.</div>
                  ) : (
                    visibleItems.map((i) => (
                      <div
                        key={i.name}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setItemName(i.name);
                          setItemSearch("");
                          setShowItemDrop(false);
                          setUom(i.uom);
                          setDescription(i.description);
                        }}
                        className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                      >
                        {i.name}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Description
              </Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Spec / brand"
                className="mt-1"
              />
            </div>

            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Qty <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={0}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="mt-1"
              />
            </div>

            <div className="md:col-span-1">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                UoM
              </Label>
              <select
                value={uom}
                onChange={(e) => setUom(e.target.value)}
                className={selectCls}
              >
                {uomOptions.length > 0
                  ? uomOptions.map((o) => (
                      <option key={o.uom} value={o.uom}>
                        {uomOptionLabel(o, uomOptions[0].uom)}
                      </option>
                    ))
                  : UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>

            <div className="md:col-span-1">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Est. Rate
              </Label>
              <Input
                type="number"
                min={0}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="mt-1"
              />
            </div>

            <div className="md:col-span-1">
              <Button variant="outline" onClick={addLine} className="w-full">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {draftEquivalent && (
            <p className="mt-2 text-xs text-muted-foreground">
              {fmtQty(Number(qty))} {uom} ={" "}
              <span className="font-semibold text-foreground">
                {fmtQty(draftEquivalent.qty)} {draftEquivalent.uom}
              </span>{" "}
              in stock unit · Est. Rate is per {uom}.
            </p>
          )}

          <div className="mt-6 border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-14 text-xs uppercase tracking-wider">SL</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Description</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Qty</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">UoM</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Rate</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Amount</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                      No line items added yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {lines.map((l, i) => (
                      <TableRow key={l.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-medium">{l.itemName}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {l.description || "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(l.qty)}</TableCell>
                        <TableCell><UomCell line={l} /></TableCell>
                        <TableCell className="text-right tabular-nums">{l.rate.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(l.qty * l.rate).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => removeLine(l.id)}
                            aria-label={`Remove ${l.itemName}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell colSpan={6} className="text-right uppercase text-xs tracking-wider">
                        Total
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        ৳ {totalAmount.toLocaleString()}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RequisitionDetailsDialog({
  requisition, onClose,
}: { requisition: PurchaseRequisition | null; onClose: () => void }) {
  const navigate = useNavigate();
  const stage = requisition ? procurementStage(requisition) : null;
  const totals = requisition ? prReceived(requisition) : null;
  // Direct (local) purchase is offered whenever the requisitioned amount hasn't
  // been fully received — i.e. received < requisition — except on terminal PRs.
  // Receiving against a PR is initiated from Receive Items → Direct Receive
  // ("Receive from PR"); this dialog is read-only detail.

  return (
    <Dialog open={!!requisition} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>
            Requisition Details
            {requisition && (
              <span className="font-mono text-sm text-muted-foreground ml-2">
                — {requisition.id}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {requisition && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm">
              <Field label="Date" value={requisition.date} />
              <Field label="Required By" value={requisition.requiredBy} />
              <Field label="Requested By" value={requisition.requestedBy} />
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Priority</div>
                <div className="mt-1">
                  <Badge
                    variant={requisition.priority === "Urgent" ? "destructive" : "outline"}
                    className="text-[10px]"
                  >
                    {requisition.priority}
                  </Badge>
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</div>
                <div className="mt-1"><StatusBadge status={stage ?? requisition.status} /></div>
              </div>
              <Field label="Items" value={requisition.lines.length.toString()} />
              <Field label="Total Est." value={`৳ ${requisition.totalAmount.toLocaleString()}`} bold />
            </div>

            {/* Procurement stage — where the whole order stands right now */}
            {stage && totals && (
              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Receipt Progress
                  </span>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    <strong className="text-foreground">{totals.received}</strong> of{" "}
                    <strong className="text-foreground">{totals.ordered}</strong> units received
                    {totals.remaining > 0 && (
                      <span className="text-amber-700"> · {totals.remaining} pending</span>
                    )}
                  </div>
                </div>
                {/* progress bar */}
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${totals.pct >= 100 ? "bg-green-600" : "bg-primary"}`}
                    style={{ width: `${totals.pct}%` }}
                  />
                </div>
                <div className="mt-1">
                  <span className="text-[11px] text-muted-foreground">{totals.pct}% received</span>
                </div>
              </div>
            )}

            {requisition.justification && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                  Justification
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground">
                  {requisition.justification}
                </div>
              </div>
            )}

            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                Line Items
              </div>
              <div className="border border-border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="w-14 text-xs uppercase tracking-wider">SL</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Description</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Requisition</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Ordered</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Received</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Pending</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">UoM</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Rate</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requisition.lines.map((l, i) => (
                      <TableRow key={l.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-medium">{l.itemName}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {l.description || "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(l.qty)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {fmtQty(l.orderedQty ?? 0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-green-700">
                          {fmtQty(l.receivedQty ?? 0)}
                        </TableCell>
                        <TableCell className={"text-right tabular-nums " + (Math.max(l.qty - (l.receivedQty ?? 0), 0) > 0 ? "text-amber-700 font-medium" : "text-muted-foreground")}>
                          {fmtQty(Math.max(l.qty - (l.receivedQty ?? 0), 0))}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const s = lineReceiptStatus(l.qty, l.receivedQty ?? 0);
                            return <span className={"inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium " + s.cls}>{s.label}</span>;
                          })()}
                        </TableCell>
                        <TableCell><UomCell line={l} /></TableCell>
                        <TableCell className="text-right tabular-nums">{l.rate.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(l.qty * l.rate).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell colSpan={10} className="text-right uppercase text-xs tracking-wider">
                        Total
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        ৳ {requisition.totalAmount.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Per-line receipt status, derived from how much of the requisitioned qty has
// been received: none → Not Received, some → Partially Received, all → Fulfilled.
function lineReceiptStatus(qty: number, received: number): { label: string; cls: string } {
  if (received <= 0) return { label: "Not Received", cls: "bg-muted text-muted-foreground" };
  if (received < qty) return { label: "Partially Received", cls: "bg-amber-100 text-amber-800" };
  return { label: "Fulfilled", cls: "bg-green-100 text-green-800" };
}

function Field({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={"mt-1 text-sm text-foreground" + (bold ? " font-semibold" : "")}>
        {value}
      </div>
    </div>
  );
}

/**
 * Edit dialog for in-flight requisitions (Draft / Pending Approval). Users
 * can adjust the priority + justification and add / remove / mutate line
 * items. Save persists either to local state or back to the workflow store
 * via the parent's onSave handler.
 */
function RequisitionEditDialog({
  requisition, onClose, onSave,
}: {
  requisition: PurchaseRequisition | null;
  onClose: () => void;
  onSave: (r: PurchaseRequisition) => void;
}) {
  const [priority, setPriority] = useState<Priority>("Normal");
  const [justification, setJustification] = useState("");
  const [lines, setLines] = useState<PRLineItem[]>([]);

  // Draft-line state (the "add new" row at the bottom of the table)
  const itemMaster = useMemo(buildItemMaster, [requisition]);
  const itemTypeOptions = useMemo(() => getItemTypeOptions(), [requisition]);
  const [itemTypeFilter, setItemTypeFilter] = useState(ITEM_TYPE_ALL);
  const [itemSearch, setItemSearch] = useState("");
  const [showItemDrop, setShowItemDrop] = useState(false);
  const [itemName, setItemName] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("");
  const [uom, setUom] = useState(UOMS[0]);
  const [rate, setRate] = useState("");

  const filteredItemMaster = useMemo(
    () => filterByItemType(itemMaster, itemTypeFilter),
    [itemMaster, itemTypeFilter],
  );

  const visibleItems = itemSearch.trim()
    ? filteredItemMaster.filter((i) => i.name.toLowerCase().includes(itemSearch.trim().toLowerCase()))
    : filteredItemMaster;

  const selectedItem = itemMaster.find((i) => i.name === itemName);
  const uomOptions = selectedItem?.uomOptions ?? [];
  const draftEquivalent = itemName && Number(qty) > 0
    ? primaryUomEquivalent(itemName, Number(qty), uom)
    : null;

  // Reseed local state every time the dialog opens with a new requisition.
  useEffect(() => {
    if (!requisition) return;
    setPriority(requisition.priority);
    setJustification(requisition.justification);
    setLines(requisition.lines.map((l) => ({ ...l })));
    setItemName(""); setItemSearch(""); setDescription(""); setQty(""); setRate("");
    setUom(UOMS[0]); setShowItemDrop(false);
    setItemTypeFilter(ITEM_TYPE_ALL);
  }, [requisition]);

  if (!requisition) return null;

  const totalAmount = lines.reduce((s, l) => s + l.qty * l.rate, 0);

  const addLine = () => {
    if (!itemName.trim()) { toast.error("Pick an item to add."); return; }
    if (!itemMaster.find((i) => i.name === itemName.trim())) { toast.error("Select a valid item from the list."); return; }
    const qtyN = Number(qty);
    if (!qtyN || qtyN <= 0) { toast.error("Quantity must be greater than zero."); return; }
    const rateN = Number(rate);
    if (rateN < 0) { toast.error("Rate cannot be negative."); return; }
    if (lines.some((l) => l.itemName.toLowerCase() === itemName.trim().toLowerCase())) {
      toast.error(`${itemName} is already in this requisition.`); return;
    }
    const eq = primaryUomEquivalent(itemName.trim(), qtyN, uom);
    setLines((prev) => [
      ...prev,
      {
        id: `LN-${Date.now()}`,
        itemName: itemName.trim(),
        description: description.trim(),
        qty: qtyN,
        uom,
        rate: rateN,
        ...(eq ? { primaryQty: eq.qty, primaryUom: eq.uom } : {}),
      },
    ]);
    setItemName(""); setItemSearch(""); setDescription(""); setQty(""); setRate(""); setUom(UOMS[0]);
  };

  // Editing a qty has to re-derive the stock-unit equivalent, or an alt-UOM line
  // would keep the old converted figure.
  const updateLine = (id: string, patch: Partial<PRLineItem>) =>
    setLines((prev) => prev.map((l) => {
      if (l.id !== id) return l;
      const next = { ...l, ...patch };
      if (patch.qty === undefined) return next;
      const eq = primaryUomEquivalent(next.itemName, next.qty, next.uom);
      return eq
        ? { ...next, primaryQty: eq.qty, primaryUom: eq.uom }
        : { ...next, primaryQty: undefined, primaryUom: undefined };
    }));

  const removeLine = (id: string) =>
    setLines((prev) => prev.filter((l) => l.id !== id));

  const handleSave = () => {
    if (lines.length === 0) { toast.error("At least one line item is required."); return; }
    onSave({ ...requisition, priority, justification, lines, totalAmount });
  };

  return (
    <Dialog open={!!requisition} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            Edit Requisition
            <span className="font-mono text-sm text-muted-foreground ml-1">— {requisition.id}</span>
            <StatusBadge status={requisition.status} />
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Header fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Priority</Label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className={selectCls}
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Requested By</Label>
              <Input value={requisition.requestedBy} disabled className="mt-1" />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Justification / Remarks</Label>
              <Textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Why is this requisition needed?"
                className="mt-1 min-h-[60px]"
              />
            </div>
          </div>

          {/* Add line row */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Add Item
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
              <div className="md:col-span-2">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Item Type</Label>
                <select
                  value={itemTypeFilter}
                  onChange={(e) => {
                    setItemTypeFilter(e.target.value);
                    setItemName("");
                    setItemSearch("");
                    setDescription("");
                    setUom(UOMS[0]);
                  }}
                  className={selectCls}
                >
                  <option value={ITEM_TYPE_ALL}>All</option>
                  {itemTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="md:col-span-4 relative">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Item</Label>
                <input
                  value={itemName || itemSearch}
                  onFocus={() => { setItemSearch(""); setShowItemDrop(true); }}
                  onChange={(e) => { setItemSearch(e.target.value); setItemName(""); setShowItemDrop(true); }}
                  onBlur={() => setShowItemDrop(false)}
                  placeholder="Type to search item…"
                  className={selectCls + " mt-1"}
                />
                {showItemDrop && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto rounded-md border border-input bg-background shadow-md">
                    {visibleItems.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No items found.</div>
                    ) : (
                      visibleItems.map((i) => (
                        <div
                          key={i.name}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setItemName(i.name);
                            setItemSearch("");
                            setShowItemDrop(false);
                            setUom(i.uom);
                            setDescription(i.description);
                          }}
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                        >
                          {i.name}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className="md:col-span-2">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Description</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Spec / brand" className="mt-1" />
              </div>
              <div className="md:col-span-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Qty</Label>
                <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className="mt-1" />
              </div>
              <div className="md:col-span-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">UoM</Label>
                <select value={uom} onChange={(e) => setUom(e.target.value)} className={selectCls}>
                  {uomOptions.length > 0
                    ? uomOptions.map((o) => (
                        <option key={o.uom} value={o.uom}>
                          {uomOptionLabel(o, uomOptions[0].uom)}
                        </option>
                      ))
                    : UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="md:col-span-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Rate</Label>
                <Input type="number" min={0} value={rate} onChange={(e) => setRate(e.target.value)} className="mt-1" />
              </div>
              <div className="md:col-span-1">
                <Button variant="outline" onClick={addLine} className="w-full h-9">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {draftEquivalent && (
              <p className="mt-2 text-xs text-muted-foreground">
                {fmtQty(Number(qty))} {uom} ={" "}
                <span className="font-semibold text-foreground">
                  {fmtQty(draftEquivalent.qty)} {draftEquivalent.uom}
                </span>{" "}
                in stock unit · Rate is per {uom}.
              </p>
            )}
          </div>

          {/* Existing lines — qty/rate inline editable */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center justify-between">
              <span>Line Items ({lines.length})</span>
              <span className="text-foreground">
                Total: <span className="font-bold tabular-nums">৳ {totalAmount.toLocaleString()}</span>
              </span>
            </div>
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-12 text-xs uppercase tracking-wider">SL</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Description</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-24">Qty</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-20">UoM</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-28">Rate</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-28">Amount</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">
                        No line items yet — add one above.
                      </TableCell>
                    </TableRow>
                  ) : (
                    lines.map((l, i) => (
                      <TableRow key={l.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-medium">{l.itemName}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{l.description || "—"}</TableCell>
                        <TableCell>
                          <Input
                            type="number" min={0}
                            value={l.qty}
                            onChange={(e) => updateLine(l.id, { qty: Number(e.target.value) || 0 })}
                            className="h-8 tabular-nums"
                          />
                        </TableCell>
                        <TableCell><UomCell line={l} /></TableCell>
                        <TableCell>
                          <Input
                            type="number" min={0}
                            value={l.rate}
                            onChange={(e) => updateLine(l.id, { rate: Number(e.target.value) || 0 })}
                            className="h-8 tabular-nums"
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(l.qty * l.rate).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => removeLine(l.id)}
                            aria-label={`Remove ${l.itemName}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-1.5" /> Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
