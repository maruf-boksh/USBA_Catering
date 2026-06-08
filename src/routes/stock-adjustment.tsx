import { useState, useMemo } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Plus, SlidersHorizontal, AlertTriangle, CheckCircle, Clock } from "lucide-react";
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

export default function StockAdjustment() {
  const [adjustments, setAdjustments] = usePersistedState<Adjustment[]>("stock-adjustments", INITIAL_ADJUSTMENTS);
  const [newOpen, setNewOpen] = useState(false);
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
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
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
    </>
  );
}
