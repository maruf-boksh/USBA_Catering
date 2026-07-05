import { useState, useMemo } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { ReviewStatusCell } from "@/components/common/ReviewStatusCell";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Plus, SlidersHorizontal, AlertTriangle, CheckCircle, Clock, Eye, FileText } from "lucide-react";
import { inventory } from "@/lib/sample-data";
import { KpiCard } from "@/components/common/KpiCard";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getActiveStaff } from "@/lib/staff";
import {
  INITIAL_ADJUSTMENTS, REASONS,
  type Adjustment, type AdjType,
} from "@/lib/stock-adjustments";
import type { WastageEntry } from "./wastage-management";

function getWastageEntry(id: string): WastageEntry | null {
  try {
    const raw = window.localStorage.getItem("harvest-data-v1:wastage-entries");
    if (!raw) return null;
    const entries = JSON.parse(raw) as WastageEntry[];
    return entries.find((e) => e.id === id) ?? null;
  } catch { return null; }
}

export default function StockAdjustment() {
  const [adjustments, setAdjustments] = usePersistedState<Adjustment[]>("stock-adjustments", INITIAL_ADJUSTMENTS);
  const [newOpen, setNewOpen] = useState(false);
  const [viewAdj, setViewAdj] = useState<Adjustment | null>(null);
  const [wddEntry, setWddEntry] = useState<WastageEntry | null>(null);
  const [newItem, setNewItem] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newType, setNewType] = useState<AdjType>("Decrease");
  const [newReason, setNewReason] = useState<string>("Wastage");
  const [newOtherReason, setNewOtherReason] = useState("");
  const [newReference, setNewReference] = useState("");
  const [newRemarks, setNewRemarks] = useState("");
  const [newBy, setNewBy] = useState("");

  const staff = useMemo(() => getActiveStaff(), []);

  const selectedInvItem = useMemo(
    () => inventory.find((i) => i.id === newItem),
    [newItem],
  );

  const cols: Column<Adjustment>[] = [
    { key: "id", header: "Adj #" },
    { key: "date", header: "Date" },
    { key: "itemCode", header: "Item Code" },
    { key: "item", header: "Item" },
    {
      key: "adjustQty", header: "Adjustment",
      render: (r) => (
        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
          r.adjustType === "Increase" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
        }`}>
          {r.adjustType === "Increase" ? "+" : "−"}{r.adjustQty} {r.uom}
        </span>
      ),
    },
    { key: "reason", header: "Reason" },
    { key: "reference", header: "Reference" },
    { key: "adjustedBy", header: "Adjusted By" },
    { key: "status", header: "Status", render: (r) => (
      <ReviewStatusCell category="Stock Adjustment" refId={r.id}>
        <StatusBadge status={r.status} />
      </ReviewStatusCell>
    ) },
  ];

  const handleSave = () => {
    if (!newItem || !newQty || !newBy) {
      toast.error("Item, Quantity and Adjusted By are required.");
      return;
    }
    // When "Other" is picked the typed reason becomes the stored reason.
    if (newReason === "Other" && !newOtherReason.trim()) {
      toast.error("Please specify the reason.");
      return;
    }
    const inv = inventory.find((i) => i.id === newItem);
    const adj: Adjustment = {
      id: `ADJ-${String(adjustments.length + 1).padStart(4, "0")}`,
      date: new Date().toISOString().split("T")[0],
      itemCode: newItem,
      item: inv?.name ?? newItem,
      category: inv?.category ?? "—",
      uom: inv?.uom ?? "—",
      currentStock: inv?.stock ?? 0,
      adjustQty: Number(newQty),
      adjustType: newType,
      reason: newReason === "Other" ? newOtherReason.trim() : newReason,
      reference: newReference,
      remarks: newRemarks,
      adjustedBy: newBy,
      status: "Pending Approval",
    };
    setAdjustments((prev) => [adj, ...prev]);
    setNewOpen(false);
    setNewItem(""); setNewQty(""); setNewReference(""); setNewRemarks(""); setNewBy("");
    setNewType("Decrease"); setNewReason("Wastage"); setNewOtherReason("");
    toast.success("Adjustment submitted for approval.");
  };

  const approved = adjustments.filter((a) => a.status === "Approved").length;
  const pending = adjustments.filter((a) => a.status === "Pending Approval").length;
  const rejected = adjustments.filter((a) => a.status === "Rejected").length;

  return (
    <>
      <PageHeader
        title="Stock Adjustment"
        subtitle="Record and approve inventory corrections — wastage, damage, expiry writeoffs, quantity corrections and production transfers"
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Adjustment
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Adjustments" value={adjustments.length} icon={SlidersHorizontal} tone="navy" />
        <KpiCard label="Approved" value={approved} icon={CheckCircle} tone="success" />
        <KpiCard label="Pending Approval" value={pending} icon={Clock} tone="warning" />
        <KpiCard label="Rejected" value={rejected} icon={AlertTriangle} tone="red" />
      </div>

      <DataTable
        title="stock-adjustments"
        data={adjustments}
        columns={cols}
        searchKeys={["id", "item", "itemCode", "reason", "adjustedBy", "status"]}
        selectable={false}
        actions={(row) => (
          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setViewAdj(row)} title="View details">
            <Eye className="h-3.5 w-3.5" />
          </Button>
        )}
      />

      {/* New Adjustment Dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Stock Adjustment</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label>Item</Label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm mt-1"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
              >
                <option value="">Select inventory item</option>
                {inventory.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.id} — {i.name} (Stock: {i.stock} {i.uom})
                  </option>
                ))}
              </select>
              {selectedInvItem && (
                <p className="text-xs text-muted-foreground mt-1">
                  Current stock: <strong>{selectedInvItem.stock} {selectedInvItem.uom}</strong>
                  {" · "}Category: {selectedInvItem.category}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Adjustment Type</Label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm mt-1"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as AdjType)}
                >
                  <option value="Decrease">Decrease (−)</option>
                  <option value="Increase">Increase (+)</option>
                </select>
              </div>
              <div>
                <Label>Quantity ({selectedInvItem?.uom ?? "UOM"})</Label>
                <Input
                  type="number" min="0"
                  value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Reason</Label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm mt-1"
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                >
                  {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <Label>Reference #</Label>
                <Input
                  value={newReference}
                  onChange={(e) => setNewReference(e.target.value)}
                  placeholder="GRN / WO / DMG ref"
                  className="mt-1"
                />
              </div>
            </div>

            {/* When "Other" is chosen the user types the actual reason here. */}
            {newReason === "Other" && (
              <div>
                <Label>Specify Reason</Label>
                <Input
                  value={newOtherReason}
                  onChange={(e) => setNewOtherReason(e.target.value)}
                  placeholder="Describe the reason for this adjustment"
                  className="mt-1"
                />
              </div>
            )}

            <div>
              <Label>Adjusted By</Label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm mt-1"
                value={newBy}
                onChange={(e) => setNewBy(e.target.value)}
              >
                <option value="">Select staff</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.fullName}>{s.fullName} — {s.role}</option>
                ))}
              </select>
            </div>

            <div>
              <Label>Remarks</Label>
              <Textarea
                value={newRemarks}
                onChange={(e) => setNewRemarks(e.target.value)}
                rows={2}
                placeholder="Additional notes or explanation..."
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Submit for Approval</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Adjustment Dialog */}
      {viewAdj && (
        <Dialog open onOpenChange={(o) => { if (!o) setViewAdj(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                Adjustment — {viewAdj.id}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-1">
              {/* Status banner */}
              <div className={`rounded-md px-3 py-2 text-xs font-semibold flex items-center gap-2 ${
                viewAdj.status === "Approved"         ? "bg-emerald-50 border border-emerald-200 text-emerald-700" :
                viewAdj.status === "Pending Approval" ? "bg-amber-50 border border-amber-200 text-amber-700" :
                                                        "bg-red-50 border border-red-200 text-red-700"
              }`}>
                {viewAdj.status === "Approved" ? <CheckCircle className="h-3.5 w-3.5" /> :
                 viewAdj.status === "Pending Approval" ? <Clock className="h-3.5 w-3.5" /> :
                 <AlertTriangle className="h-3.5 w-3.5" />}
                {viewAdj.status}
              </div>
              {/* Detail grid */}
              <div className="border border-border rounded-md overflow-hidden">
                {([
                  ["Adj #",         viewAdj.id,          null],
                  ["Date",          viewAdj.date,         null],
                  ["Item Code",     viewAdj.itemCode,     null],
                  ["Item",          viewAdj.item,         null],
                  ["Category",      viewAdj.category,     null],
                  ["UOM",           viewAdj.uom,          null],
                  ["Current Stock", String(viewAdj.currentStock), null],
                  ["Adjustment",    `${viewAdj.adjustType === "Increase" ? "+" : "−"}${viewAdj.adjustQty} ${viewAdj.uom}`, null],
                  ["Reason",        viewAdj.reason,       null],
                  ["Reference",     viewAdj.reference || "—", viewAdj.reference.startsWith("WDD-") ? () => { const e = getWastageEntry(viewAdj.reference); if (e) setWddEntry(e); else toast.info("Wastage report not found."); } : null],
                  ["Adjusted By",   viewAdj.adjustedBy,   null],
                ] as [string, string, (() => void) | null][]).map(([label, value, onClick], i) => (
                  <div key={label} className={`flex items-center justify-between px-3 py-2 text-xs ${i % 2 === 0 ? "bg-muted/20" : "bg-background"} border-b border-border last:border-0`}>
                    <span className="text-muted-foreground">{label}</span>
                    {onClick ? (
                      <button
                        onClick={onClick}
                        className="font-medium text-right max-w-[55%] text-primary hover:underline cursor-pointer bg-transparent border-0 p-0 font-mono"
                      >
                        {value}
                      </button>
                    ) : (
                      <span className={`font-medium text-right max-w-[55%] ${label === "Adjustment" ? (viewAdj.adjustType === "Increase" ? "text-emerald-700" : "text-red-600") : ""}`}>{value}</span>
                    )}
                  </div>
                ))}
              </div>
              {viewAdj.remarks && (
                <div className="rounded-md bg-muted/30 border border-border px-3 py-2 text-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Remarks</p>
                  <p>{viewAdj.remarks}</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setViewAdj(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Wastage Report Reference Lookup Dialog */}
      {wddEntry && (
        <Dialog open onOpenChange={(o) => { if (!o) setWddEntry(null); }}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Wastage Report — {wddEntry.id}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              {/* Status banner */}
              <div className={`rounded-md px-3 py-2 text-xs font-semibold flex items-center gap-2 ${
                wddEntry.status === "Final Approved" ? "bg-emerald-50 border border-emerald-200 text-emerald-700" :
                wddEntry.status === "Rejected"       ? "bg-red-50 border border-red-200 text-red-700" :
                                                       "bg-amber-50 border border-amber-200 text-amber-700"
              }`}>
                {wddEntry.status === "Final Approved" ? <CheckCircle className="h-3.5 w-3.5" /> :
                 wddEntry.status === "Rejected"       ? <AlertTriangle className="h-3.5 w-3.5" /> :
                                                        <Clock className="h-3.5 w-3.5" />}
                {wddEntry.status}
              </div>
              {/* Key fields */}
              <div className="border border-border rounded-md overflow-hidden">
                {([
                  ["Report ID",       wddEntry.id],
                  ["Reporting Date",  wddEntry.reportingDate],
                  ["Wastage Type",    wddEntry.wastageType],
                  ["Item",            wddEntry.itemName],
                  ["Disposal Qty",    `${wddEntry.disposalQty} ${wddEntry.disposalQtyUnit}`],
                  ["Disposal Reason", wddEntry.disposalReason],
                  ["Disposal Method", wddEntry.disposalMethod || "—"],
                  ["Disposal Date",   wddEntry.disposalDate || "—"],
                  ["Prepared By",     wddEntry.preparedBy],
                ] as [string, string][]).map(([label, value], i) => (
                  <div key={label} className={`flex items-center justify-between px-3 py-2 text-xs ${i % 2 === 0 ? "bg-muted/20" : "bg-background"} border-b border-border last:border-0`}>
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium text-right max-w-[55%]">{value}</span>
                  </div>
                ))}
              </div>
              {/* Root cause */}
              {wddEntry.rootCause && (
                <div className="rounded-md bg-muted/30 border border-border px-3 py-2 text-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Root Cause</p>
                  <p className="leading-relaxed">{wddEntry.rootCause}</p>
                </div>
              )}
              {/* Approval log */}
              {wddEntry.approvalSteps.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Approval Log</p>
                  <div className="border border-border rounded-md overflow-hidden">
                    {wddEntry.approvalSteps.map((step, i) => (
                      <div key={i} className={`flex items-start justify-between px-3 py-2 text-xs ${i % 2 === 0 ? "bg-muted/20" : "bg-background"} border-b border-border last:border-0`}>
                        <div>
                          <p className="font-medium">{step.step}</p>
                          <p className="text-muted-foreground text-[11px]">{step.by} · {step.at}</p>
                        </div>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          step.action === "Approved"  ? "bg-emerald-100 text-emerald-700" :
                          step.action === "Rejected"  ? "bg-red-100 text-red-700" :
                          step.action === "Submitted" ? "bg-blue-100 text-blue-700" :
                                                        "bg-amber-100 text-amber-700"
                        }`}>{step.action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setWddEntry(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
