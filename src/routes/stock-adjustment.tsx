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

type AdjType = "Increase" | "Decrease";
type AdjReason = "Wastage" | "Expiry Writeoff" | "Damage" | "Quantity Correction" | "Production Transfer" | "Other";
type AdjStatus = "Pending Approval" | "Approved" | "Rejected";

type Adjustment = {
  id: string;
  date: string;
  itemCode: string;
  item: string;
  category: string;
  uom: string;
  currentStock: number;
  adjustQty: number;
  adjustType: AdjType;
  reason: string;
  reference: string;
  remarks: string;
  adjustedBy: string;
  status: AdjStatus;
};

const INITIAL_ADJUSTMENTS: Adjustment[] = [
  {
    id: "ADJ-0001", date: "2026-05-15", itemCode: "INV-1002", item: "Chicken Breast",
    category: "Protein", uom: "Kg", currentStock: 64, adjustQty: 12, adjustType: "Decrease",
    reason: "Wastage", reference: "WO-2026-0012",
    remarks: "Over-portioning during lunch production run", adjustedBy: "M. Karim", status: "Approved",
  },
  {
    id: "ADJ-0002", date: "2026-05-15", itemCode: "INV-1005", item: "Tomato",
    category: "Vegetable", uom: "Kg", currentStock: 22, adjustQty: 8, adjustType: "Decrease",
    reason: "Expiry Writeoff", reference: "EW-2026-0003",
    remarks: "Batch expired before use — batch TM-2511", adjustedBy: "S. Ahmed", status: "Approved",
  },
  {
    id: "ADJ-0003", date: "2026-05-16", itemCode: "INV-1008", item: "Salmon Fillet",
    category: "Protein", uom: "Kg", currentStock: 12, adjustQty: 4, adjustType: "Decrease",
    reason: "Damage", reference: "DMG-2026-0002",
    remarks: "Cold chain break — blast freezer malfunction (AS-105)", adjustedBy: "F. Begum", status: "Pending Approval",
  },
  {
    id: "ADJ-0004", date: "2026-05-17", itemCode: "INV-1006", item: "Wheat Flour",
    category: "Grains", uom: "Kg", currentStock: 320, adjustQty: 50, adjustType: "Increase",
    reason: "Quantity Correction", reference: "GRN-5507",
    remarks: "GRN quantity was under-recorded at receiving point", adjustedBy: "S. Ahmed", status: "Approved",
  },
  {
    id: "ADJ-0005", date: "2026-05-17", itemCode: "INV-1003", item: "Mineral Water 250ml",
    category: "Beverage", uom: "Bottle", currentStock: 4200, adjustQty: 120, adjustType: "Decrease",
    reason: "Production Transfer", reference: "TRF-2026-0005",
    remarks: "Transferred to crew catering section for BS-307", adjustedBy: "M. Karim", status: "Pending Approval",
  },
];

const REASONS: AdjReason[] = [
  "Wastage", "Expiry Writeoff", "Damage", "Quantity Correction", "Production Transfer", "Other",
];

export default function StockAdjustment() {
  const [adjustments, setAdjustments] = usePersistedState<Adjustment[]>("stock-adjustments", INITIAL_ADJUSTMENTS);
  const [newOpen, setNewOpen] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newType, setNewType] = useState<AdjType>("Decrease");
  const [newReason, setNewReason] = useState<string>("Wastage");
  const [newReference, setNewReference] = useState("");
  const [newRemarks, setNewRemarks] = useState("");
  const [newBy, setNewBy] = useState("");

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
      reason: newReason,
      reference: newReference,
      remarks: newRemarks,
      adjustedBy: newBy,
      status: "Pending Approval",
    };
    setAdjustments((prev) => [adj, ...prev]);
    setNewOpen(false);
    setNewItem(""); setNewQty(""); setNewReference(""); setNewRemarks(""); setNewBy("");
    setNewType("Decrease"); setNewReason("Wastage");
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
                  {" · "}Category: {selectedInvItem.category} · Storage: {selectedInvItem.storage}
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

            <div>
              <Label>Adjusted By</Label>
              <Input
                value={newBy}
                onChange={(e) => setNewBy(e.target.value)}
                placeholder="Staff name"
                className="mt-1"
              />
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
