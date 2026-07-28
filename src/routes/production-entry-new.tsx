import { useEffect, useMemo, useState, Fragment } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, ArrowLeft, Save, ClipboardCheck, CheckCircle2, AlertCircle, Factory, Users, Eye, Package, PackageOpen, Wrench, RefreshCw, Layers,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useWorkflow, type WfProductionEntryRecord, type WfProductionInputMaterial, type WfDemandRequest } from "@/lib/workflow-store";
import { LocationPicker, LocationFilter, LocationCell } from "@/components/common/LocationPicker";
import { PRODUCTION_ITEMS, type RecipeItem } from "@/routes/production-entry";
import { resolveProductionItem } from "@/lib/meal-recipe";
import { usePersistedState } from "@/lib/use-persisted-state";
import {
  inventory, warehouses,
  type InventoryItem, type ItemMaster,
} from "@/lib/sample-data";
import { resolveItemMaster, ensureProductionItemRegistered, isItemBatchTracked } from "@/lib/item-registry";
import { useBatchNumberingMode, generateBatchCode } from "@/lib/batch-numbering-settings";
import { roundQty, fmtQty } from "@/lib/num";

const SHIFTS = ["Morning", "Evening", "Night"] as const;
const PRODUCERS = ["F. Begum", "T. Islam", "M. Karim", "N. Hossen", "S. Ahmed", "R. Karim"];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function ProductionEntryPage() {
  const { productionEntries, productionEntryRecords, addProductionEntryRecord } = useWorkflow();
  const [view, setView] = useState<"list" | "create">("list");
  const [filterOffice, setFilterOffice] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [viewEntry, setViewEntry] = useState<WfProductionEntryRecord | null>(null);

  // Orders that can accept new entries: Approved, Production Initiation, or In
  // Preparation (Pending = not approved yet, Ready for QC / Completed = target met).
  const fulfillableOrders = useMemo(
    () =>
      productionEntries.filter(
        (o) =>
          o.status === "Approved" ||
          o.status === "Production Initiation" ||
          o.status === "In Preparation",
      ),
    [productionEntries],
  );

  const filteredRecords = productionEntryRecords.filter((r) => {
    if (filterOffice && r.officeId !== filterOffice) return false;
    if (filterWarehouse && r.warehouseId !== filterWarehouse) return false;
    return true;
  });

  const totalProduced = filteredRecords.reduce((s, r) => s + r.producedQty, 0);

  // ── At-a-glance breakdowns for the KPI cards ────────────────────────────────
  // Approved-order counts, the entry vs pending-entry split, the fulfillable
  // kitchen mix, and the in-preparation / pending pipeline stages.
  const approvedStatuses = ["Approved", "Production Initiation", "In Preparation", "Ready for QC", "Completed"];
  const approvedOrders = productionEntries.filter((o) => approvedStatuses.includes(o.status));
  const totalEntry     = filteredRecords.length;
  const pendingEntry   = approvedOrders.filter((o) => o.producedQty === 0).length;
  const whNameById     = (id?: string) => warehouses.find((w) => w.id === id)?.name ?? "";
  const hotKitchen     = fulfillableOrders.filter((o) => whNameById(o.warehouseId).toLowerCase().includes("hot")).length;
  const coldKitchen    = fulfillableOrders.filter((o) => whNameById(o.warehouseId).toLowerCase().includes("cold")).length;
  const inPrepCount    = productionEntries.filter((o) => o.status === "In Preparation").length;
  const pendingCount   = productionEntries.filter((o) => o.status === "Pending").length;

  const cols: Column<WfProductionEntryRecord>[] = [
    { key: "id", header: "Entry No", render: (r) => <span className="font-mono text-xs">{r.id}</span> },
    { key: "date", header: "Date", render: (r) => <span className="tabular-nums text-xs">{r.date}</span> },
    {
      key: "productionOrderId", header: "Production Order",
      render: (r) => (
        <div className="text-xs">
          <div className="font-mono text-primary">{r.productionOrderId}</div>
          <div className="text-muted-foreground">{r.outputItemName ?? r.bom}</div>
        </div>
      ),
    },
    {
      key: "officeId", header: "Office / Warehouse",
      render: (r) => <LocationCell officeId={r.officeId} warehouseId={r.warehouseId} />,
    },
    {
      key: "producedQty", header: "Produced Qty", className: "text-right",
      render: (r) => <span className="tabular-nums font-semibold">{r.producedQty.toLocaleString()}</span>,
    },
    {
      key: "batchNo", header: "Batch",
      render: (r) => r.batchNo ? <span className="font-mono text-xs">{r.batchNo}</span> : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "shift", header: "Shift",
      render: (r) => r.shift ? <Badge variant="outline" className="text-[10px]">{r.shift}</Badge> : <span className="text-muted-foreground">—</span>,
    },
    { key: "producedBy", header: "Produced By" },
    {
      key: "actions", header: "Actions", className: "text-right",
      render: (r) => (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={(e) => { e.stopPropagation(); setViewEntry(r); }}
          aria-label={`View ${r.id}`}
        >
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Production Entry"
        subtitle="Log actual production runs against an approved Production Order — quantity rolls up to the order's Produced Qty"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={view === "create" ? "outline" : "default"}
              onClick={() => setView(view === "create" ? "list" : "create")}
            >
              {view === "create" ? (
                <><ArrowLeft className="h-4 w-4 mr-1" /> Back</>
              ) : (
                <><Plus className="h-4 w-4 mr-1" /> Create Entry</>
              )}
            </Button>
          </div>
        }
      />

      {view === "list" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <KpiCard
              label="Total Approved Orders" value={approvedOrders.length} icon={ClipboardCheck}
              tone="violet" variant="aurora"
              sub={`${pendingEntry} awaiting entry`}
              hint="Orders that passed approval, with entries logged vs pending."
              breakdown={[
                { label: "Total Entry",   value: totalEntry,   icon: "📝" },
                { label: "Pending Entry", value: pendingEntry, icon: "⏳" },
              ]}
            />
            <KpiCard
              label="Fulfillable Orders" value={fulfillableOrders.length} icon={CheckCircle2}
              tone="amber" variant="aurora"
              sub="open for entry"
              hint="Orders still able to accept production entries, by kitchen."
              breakdown={[
                { label: "Hot Kitchen",  value: hotKitchen,  icon: "🔥" },
                { label: "Cold Kitchen", value: coldKitchen, icon: "❄️" },
              ]}
            />
            <KpiCard
              label="Total Produced" value={totalProduced.toLocaleString()} icon={Factory}
              tone="green" variant="aurora"
              sub="units produced"
              hint="Units produced so far, with the active pipeline stages."
              breakdown={[
                { label: "In Preparation", value: inPrepCount,  icon: "👨‍🍳" },
                { label: "Pending",        value: pendingCount, icon: "⏳" },
              ]}
            />
          </div>

          <div className="mb-4">
            <LocationFilter
              officeId={filterOffice}
              warehouseId={filterWarehouse}
              onChange={(n) => { setFilterOffice(n.officeId); setFilterWarehouse(n.warehouseId); }}
            />
          </div>

          {filteredRecords.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Factory className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                <div className="text-sm font-medium text-foreground">No production entries yet</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Click <strong className="text-foreground">+ Create Entry</strong> to log a production run against an approved order.
                </div>
              </CardContent>
            </Card>
          ) : (
            <DataTable
              title="production-entries"
              data={filteredRecords}
              columns={cols}
              searchKeys={["id", "productionOrderId", "outputItemName", "batchNo", "producedBy"]}
              selectable={false}
            />
          )}
        </>
      ) : (
        <CreateEntry
          orders={fulfillableOrders}
          onSave={(record) => {
            addProductionEntryRecord(record);
            setView("list");
            toast.success(`${record.id} logged — ${record.producedQty} units credited to ${record.productionOrderId}.`);
          }}
          nextSeq={productionEntryRecords.length + 47}
        />
      )}

      <ProductionEntryDetailDialog
        entry={viewEntry}
        onOpenChange={(open) => { if (!open) setViewEntry(null); }}
      />

    </>
  );
}

function CreateEntry({
  orders, nextSeq, onSave,
}: {
  orders: ReturnType<typeof useWorkflow>["productionEntries"];
  nextSeq: number;
  onSave: (record: WfProductionEntryRecord) => void;
}) {
  const { addDemands, demands } = useWorkflow();
  const [orderId, setOrderId] = useState("");
  const [qty, setQty] = useState("");
  const [batch, setBatch] = useState("");
  const [expiry, setExpiry] = useState("");
  const batchMode = useBatchNumberingMode();
  const [shift, setShift] = useState<typeof SHIFTS[number]>("Morning");
  const [producer, setProducer] = useState(PRODUCERS[0]);
  const [officeId, setOfficeId] = useState("OFF-001");
  const [warehouseId, setWarehouseId] = useState("WH-003");
  const [remarks, setRemarks] = useState("");
  // DR id once a Re-Cook material demand has been raised for the current order,
  // so the button flips to a confirmation and can't double-raise.
  const [demandRaised, setDemandRaised] = useState<string | null>(null);
  // User overrides for the Actual Quantity column. Keyed by row key; a missing
  // entry means the field still tracks the (scaled) BOM quantity default.
  const [actuals, setActuals] = useState<Record<string, string>>({});
  // Reason notes for rows whose Actual differs from the BOM quantity. Keyed by row key.
  const [reasons, setReasons] = useState<Record<string, string>>({});

  // Live stock — the same persisted store the Stock Overview reads — so the
  // Available Quantity column matches what the inventory screen shows.
  const [invItems] = usePersistedState<InventoryItem[]>("inventory-items", inventory);
  const availableFor = useMemo(() => {
    const byKey = new Map<string, number>();
    for (const it of invItems) {
      byKey.set(it.id.toLowerCase(), it.stock);
      byKey.set(it.name.toLowerCase(), it.stock);
    }
    return (code: string, name: string) =>
      byKey.get(code.toLowerCase()) ?? byKey.get(name.toLowerCase()) ?? 0;
  }, [invItems]);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === orderId) ?? null,
    [orders, orderId],
  );
  const remaining = selectedOrder
    ? Math.max(0, (selectedOrder.orderQty ?? selectedOrder.producedQty) - selectedOrder.producedQty)
    : 0;

  // Resolve the output item's master (static seed + persisted Item Profile) to
  // know whether it's batch-tracked and to project a shelf-life expiry. An
  // unregistered output is treated as a new batch-tracked Finished Good — it gets
  // registered on save — so the batch fields still show and can be filled.
  const outputMaster = useMemo<ItemMaster | undefined>(() => {
    if (!selectedOrder) return undefined;
    return resolveItemMaster(
      selectedOrder.outputItemName ?? selectedOrder.bom,
      selectedOrder.outputItemCode,
    );
  }, [selectedOrder]);
  const isRegistered = !!outputMaster;
  // Batch-tracking is an Item Profile attribute — the form only reflects it.
  // A not-yet-registered output takes the Item Profile default (batch-tracked);
  // change it in Item Profile if it should be a single item.
  const effectiveIsBatch = outputMaster ? isItemBatchTracked(outputMaster) : true;

  const projectedExpiry = (m?: ItemMaster): string => {
    const shelf = m?.shelfLifeDays && m.shelfLifeDays > 0
      ? m.shelfLifeDays
      : m?.subCategory === "Frozen" ? 90 : m?.subCategory === "Fresh" ? 3 : m ? 30 : 3;
    return new Date(Date.now() + shelf * 86400000).toISOString().slice(0, 10);
  };

  // Prefill the lot fields for a batch-tracked output: auto-generate the batch no
  // when the global policy is "auto", and project the expiry from shelf life.
  // Only fills blanks, so a user's manual edits are never clobbered.
  useEffect(() => {
    if (!selectedOrder || !effectiveIsBatch) return;
    if (batchMode === "auto") setBatch((b) => b || generateBatchCode());
    setExpiry((e) => e || projectedExpiry(outputMaster));
  }, [selectedOrder, effectiveIsBatch, batchMode, outputMaster]);

  // BOM materials for the selected order's output item, tagged with their BOM
  // bucket (raw / packaging / other consumption) so the table can segregate them.
  // Quantities are per-unit here; the table scales them by produced qty.
  const materials = useMemo<MaterialLine[]>(() => {
    if (!selectedOrder) return [];
    const recipe = resolveProductionItem({
      name: selectedOrder.outputItemName ?? selectedOrder.bom,
      code: selectedOrder.outputItemCode,
    });
    return [
      ...recipe.rawMaterials.map((m) => ({ ...m, category: "Raw Material" as MaterialCategory })),
      ...recipe.packagingMaterials.map((m) => ({ ...m, category: "Packaging" as MaterialCategory })),
      ...recipe.otherConsumption.map((m) => ({ ...m, category: "Other Consumption" as MaterialCategory })),
    ];
  }, [selectedOrder]);

  const producedQty = Number(qty) || 0;

  const handleSelectOrder = (id: string) => {
    setOrderId(id);
    setActuals({}); // clear any actual-qty overrides from the previous order
    setReasons({}); // clear any variance reasons from the previous order
    setDemandRaised(null); // reset the Re-Cook demand button for the new order
    setBatch("");   // clear lot fields — the effect re-prefills for the new order
    setExpiry("");
    const o = orders.find((x) => x.id === id);
    if (o) {
      // Pre-fill warehouse from the order
      if (o.officeId) setOfficeId(o.officeId);
      if (o.warehouseId) setWarehouseId(o.warehouseId);
      // Default qty to the remaining amount so the user can produce in full
      const rem = Math.max(0, (o.orderQty ?? o.producedQty) - o.producedQty);
      setQty(rem > 0 ? String(rem) : "");
    }
  };

  const handleSave = () => {
    if (!orderId) { toast.error("Select a Production Order."); return; }
    if (!selectedOrder) return;
    const q = Number(qty);
    if (!q || q <= 0) { toast.error("Produced quantity must be greater than zero."); return; }
    if (q > remaining) {
      toast.error(`Cannot exceed remaining qty (${remaining}).`);
      return;
    }
    if (!producer.trim()) { toast.error("Produced By is required."); return; }
    if (!officeId) { toast.error("Office is required."); return; }
    if (!warehouseId) { toast.error("Warehouse is required."); return; }
    if (effectiveIsBatch) {
      if (!batch.trim()) { toast.error("Batch No. is required for a batch-tracked item."); return; }
      if (!expiry) { toast.error("Expiry date is required for a batch-tracked item."); return; }
    }

    // Register the output item in the Item Profile / Stock Overview if it isn't
    // already, so its produced quantity can post as stock and the run can move to
    // the next stage.
    if (!isRegistered) {
      ensureProductionItemRegistered({
        name: selectedOrder.outputItemName ?? selectedOrder.bom,
        code: selectedOrder.outputItemCode,
        uom: "Piece",
        officeId,
        warehouseId,
      });
      toast.success(`"${selectedOrder.outputItemName ?? selectedOrder.bom}" added to Item Profile.`);
    }

    // Snapshot the Input Materials (BOM vs actual, variance, reason) onto the
    // record so the entry's View dialog can show exactly what was captured here.
    const inputMaterials: WfProductionInputMaterial[] = materials.map((m, i) => {
      const key = `${m.itemCode}#${i}`;
      const bomQty = roundQty(m.qtyPerUnit * q);
      const actualQty = roundQty(Number(actuals[key] ?? String(bomQty)) || 0);
      const available = availableFor(m.itemCode, m.itemName);
      return {
        itemCode: m.itemCode,
        itemName: m.itemName,
        uom: m.uom,
        category: m.category,
        bomQty,
        actualQty,
        variance: roundQty(actualQty - bomQty),
        available,
        remaining: roundQty(available - actualQty),
        reason: (reasons[key] ?? "").trim() || undefined,
      };
    });

    const id = `PE-2026-${String(nextSeq).padStart(6, "0")}`;
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    onSave({
      id,
      date: stamp,
      productionOrderId: orderId,
      bom: selectedOrder.bom,
      outputItemName: selectedOrder.outputItemName,
      outputItemCode: selectedOrder.outputItemCode,
      producedQty: q,
      batchNo: effectiveIsBatch ? (batch.trim() || undefined) : undefined,
      batchExpiry: effectiveIsBatch ? (expiry || undefined) : undefined,
      shift,
      producedBy: producer.trim(),
      officeId,
      warehouseId,
      remarks: remarks.trim() || undefined,
      inputMaterials: inputMaterials.length ? inputMaterials : undefined,
    });
  };

  // ── Re-Cook shortfall → Demand Requisition ────────────────────────────────
  // For a Re-Cook order, materials whose available stock can't cover the BOM
  // requirement need to be purchased. We surface them here so the user can raise
  // ONE Demand Requisition (at BOM qty) that flows through the normal approval
  // layer, tagged as Re-Cook.
  const shortMaterials = useMemo(() => {
    if (!selectedOrder?.reCook) return [];
    return materials
      .map((m) => {
        const bomQty = roundQty(m.qtyPerUnit * producedQty);
        const available = availableFor(m.itemCode, m.itemName);
        return { mat: m, bomQty, available };
      })
      .filter((r) => r.bomQty > 0 && r.available < r.bomQty);
  }, [selectedOrder, materials, producedQty, availableFor]);

  const handleGenerateDemand = () => {
    if (!selectedOrder) return;
    if (shortMaterials.length === 0) {
      toast.info("No material shortfall — every BOM item is in stock.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const drId = `DR-${9000 + demands.length + 1}`;
    const items = shortMaterials.map(({ mat, bomQty }) => {
      const invRow = invItems.find(
        (i) =>
          i.id.toLowerCase() === mat.itemCode.toLowerCase() ||
          i.name.toLowerCase() === mat.itemName.toLowerCase(),
      );
      const bucket =
        mat.category === "Packaging" ? "Packaging"
        : mat.category === "Other Consumption" ? "Other"
        : "Raw";
      return {
        id: invRow?.id ?? mat.itemCode,
        name: mat.itemName,
        qty: bomQty,
        uom: mat.uom,
        type: bucket,
      };
    });
    const dr: WfDemandRequest = {
      id: drId,
      reference: selectedOrder.id,
      requestedBy: producer.trim() || "Production",
      role: "Production (Re-Cook)",
      date: stamp,
      status: "Pending Approval",
      items,
      note: `Auto-generated from Re-Cook production entry for ${selectedOrder.id} (${selectedOrder.outputItemName ?? selectedOrder.bom}). ${items.length} short material${items.length === 1 ? "" : "s"} requested at BOM quantity for purchase.`,
      source: "Kitchen",
      officeId,
      warehouseId,
      reCook: true,
      autoFulfill: false,
    };
    addDemands([dr]);
    setDemandRaised(drId);
    toast.success(`Demand Requisition ${drId} raised (Re-Cook) for ${items.length} short material${items.length === 1 ? "" : "s"} — pending approval.`);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
                Log Production Entry
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick an approved Production Order, then record the actual quantity produced.
              </p>
            </div>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-1.5" /> Save Entry
            </Button>
          </div>

          {/* PO picker */}
          <div className="mb-5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Production Order <span className="text-destructive">*</span>
            </Label>
            <select
              value={orderId}
              onChange={(e) => handleSelectOrder(e.target.value)}
              className={selectCls}
            >
              <option value="">Select a fulfillable order…</option>
              {orders.length === 0 ? (
                <option disabled>No approved orders available</option>
              ) : (
                orders.map((o) => {
                  const target = o.orderQty ?? o.producedQty;
                  const rem = Math.max(0, target - o.producedQty);
                  return (
                    <option key={o.id} value={o.id}>
                      {o.id}{o.reCook ? " · Re-Cook" : ""} — {o.outputItemName ?? o.bom} · {o.producedQty}/{target} produced · {rem} remaining · {o.status}
                    </option>
                  );
                })
              )}
            </select>
          </div>

          {/* Order context summary */}
          {selectedOrder && (
            <div className="mb-5 rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Order Context
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-foreground">
                    {selectedOrder.outputItemName ?? selectedOrder.bom}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    BOM: {selectedOrder.bom} · Status:{" "}
                    <StatusBadge status={selectedOrder.status} />
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <SummaryStat label="Order Qty" value={(selectedOrder.orderQty ?? selectedOrder.producedQty).toLocaleString()} />
                  <SummaryStat label="Produced" value={selectedOrder.producedQty.toLocaleString()} />
                  <SummaryStat
                    label="Remaining"
                    value={remaining.toLocaleString()}
                    tone={remaining > 0 ? "warning" : "success"}
                  />
                </div>
              </div>
              {remaining === 0 && (
                <div className="mt-2 text-[11px] text-success flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3" /> Order is already fully produced.
                </div>
              )}
            </div>
          )}

          {/* Entry form */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Produced Quantity <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={0}
                max={remaining || undefined}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0"
                className="mt-1 tabular-nums"
                disabled={!selectedOrder}
              />
              {selectedOrder && Number(qty) > remaining && (
                <p className="mt-1 text-[11px] text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> Exceeds remaining ({remaining}).
                </p>
              )}
            </div>

            <div>
              {!selectedOrder ? (
                <>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Batch No.</Label>
                  <Input disabled placeholder="Select an order first" className="mt-1 font-mono" />
                </>
              ) : effectiveIsBatch ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-primary" /> Batch No.
                      <span className="text-destructive">*</span>
                      {batchMode === "auto" && (
                        <Badge variant="outline" className="text-[9px] font-normal">Auto</Badge>
                      )}
                    </Label>
                    {batchMode === "auto" ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <Input value={batch} readOnly className="font-mono bg-muted/40" />
                        <Button
                          type="button" variant="outline" size="icon"
                          className="h-9 w-9 shrink-0"
                          title="Regenerate batch code"
                          onClick={() => setBatch(generateBatchCode())}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <Input
                        value={batch}
                        onChange={(e) => setBatch(e.target.value)}
                        placeholder="e.g. BCB-20A"
                        className="mt-1 font-mono"
                      />
                    )}
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Expiry <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="date"
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                      className="mt-1 tabular-nums"
                    />
                  </div>
                  <p className="sm:col-span-2 -mt-1 text-[11px] text-muted-foreground">
                    {batchMode === "auto"
                      ? "Batch code auto-generated (policy: Configuration → Item Profile). "
                      : "Enter the lot / batch number. "}
                    This lot is recorded on Stock Overview when the run is produced.
                  </p>
                </div>
              ) : (
                <>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Batch No.</Label>
                  <div className="mt-1 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Single item (set in Item Profile) — stored as one pooled stock, no lot / expiry. Produced qty adds to Stock Overview.
                  </div>
                </>
              )}
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Shift</Label>
              <select
                value={shift}
                onChange={(e) => setShift(e.target.value as typeof SHIFTS[number])}
                className={selectCls}
              >
                {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Produced By <span className="text-destructive">*</span>
              </Label>
              <select
                value={producer}
                onChange={(e) => setProducer(e.target.value)}
                className={selectCls}
              >
                {PRODUCERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <LocationPicker
              officeId={officeId}
              warehouseId={warehouseId}
              onChange={(n) => { setOfficeId(n.officeId); setWarehouseId(n.warehouseId); }}
            />

            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Remarks</Label>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Yield notes, wastage, equipment issues, etc."
                className="mt-1 min-h-[72px]"
              />
            </div>
          </div>

          {/* Re-Cook material shortfall → raise a Demand Requisition for the
              short BOM items so they can be purchased through the normal flow. */}
          {selectedOrder?.reCook && shortMaterials.length > 0 && (
            <div className="mt-6 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                    <span className="text-sm font-semibold text-rose-800">
                      Re-Cook material shortfall
                    </span>
                    <span className="inline-flex items-center rounded-full border border-rose-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                      Re-Cook
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-rose-700/90">
                    {shortMaterials.length} material{shortMaterials.length === 1 ? "" : "s"} short of stock.
                    Raise a Demand Requisition at BOM quantity to purchase {shortMaterials.length === 1 ? "it" : "them"}.
                    It routes through the normal approval layer.
                  </p>
                </div>
                {demandRaised ? (
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700 shrink-0">
                    <CheckCircle2 className="h-4 w-4" />
                    {demandRaised} raised — pending approval
                  </div>
                ) : (
                  <Button
                    onClick={handleGenerateDemand}
                    className="shrink-0 bg-rose-600 hover:bg-rose-700 text-white"
                  >
                    <PackageOpen className="h-4 w-4 mr-1.5" /> Generate Demand Req
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Input Materials — BOM for the output item, scaled to produced qty */}
          {selectedOrder && (
            <InputMaterialsSection
              materials={materials}
              producedQty={producedQty}
              actuals={actuals}
              setActuals={setActuals}
              reasons={reasons}
              setReasons={setReasons}
              availableFor={availableFor}
            />
          )}
        </CardContent>
      </Card>

      {/* Helpful side note */}
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
        <Users className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          On save, the entry's <strong className="text-foreground">Produced Qty</strong> is added to the
          linked Production Order's running total. The order auto-advances to{" "}
          <strong className="text-foreground">In Preparation</strong> on the first entry and{" "}
          <strong className="text-foreground">Ready for QC</strong> once the full order qty is met.
        </div>
      </div>
    </div>
  );
}

function SummaryStat({
  label, value, tone,
}: { label: string; value: string; tone?: "warning" | "success" }) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success",
          !tone && "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Materials — the output item's BOM, scaled to the produced quantity, and
// segregated by BOM bucket: Raw / Input Materials, Packaging Materials, Other
// Consumptions. BOM Quantity = per-unit recipe qty × produced qty. Actual Quantity
// defaults to the BOM figure but is editable; Remaining = Available − Actual.
// Read-only w.r.t. stock — nothing is deducted here.
// ─────────────────────────────────────────────────────────────────────────────

type MaterialCategory = "Raw Material" | "Packaging" | "Other Consumption";
type MaterialLine = RecipeItem & { category: MaterialCategory };

const CATEGORY_ORDER: MaterialCategory[] = ["Raw Material", "Packaging", "Other Consumption"];
const CATEGORY_LABEL: Record<MaterialCategory, string> = {
  "Raw Material": "Raw / Input Materials",
  "Packaging": "Packaging Materials",
  "Other Consumption": "Other Consumptions",
};

function InputMaterialsSection({
  materials, producedQty, actuals, setActuals, reasons, setReasons, availableFor,
}: {
  materials: MaterialLine[];
  producedQty: number;
  actuals: Record<string, string>;
  setActuals: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  reasons: Record<string, string>;
  setReasons: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  availableFor: (code: string, name: string) => number;
}) {
  const rows = useMemo(
    () =>
      materials.map((m, i) => {
        const key = `${m.itemCode}#${i}`;
        const bomQty = roundQty(m.qtyPerUnit * producedQty);
        const actualStr = actuals[key] ?? String(bomQty);
        const actual = Number(actualStr) || 0;
        const available = availableFor(m.itemCode, m.itemName);
        return {
          key, mat: m, category: m.category, bomQty, actualStr, actual, available,
          variance: roundQty(actual - bomQty),
          remaining: roundQty(available - actual),
        };
      }),
    [materials, producedQty, actuals, availableFor],
  );

  const totalBom = roundQty(rows.reduce((s, r) => s + r.bomQty, 0));
  const totalActual = roundQty(rows.reduce((s, r) => s + r.actual, 0));
  const totalVariance = roundQty(totalActual - totalBom);
  let sl = 0; // continuous serial across all buckets

  return (
    <div className="mt-6 border-t border-border pt-5">
      <SectionTitle icon={Package} label="Input Materials" />
      {rows.length === 0 ? (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
          <AlertCircle className="h-4 w-4 inline-block mr-1.5" />
          No BOM materials registered for this output item.
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[48px]">SL</TableHead>
                <TableHead>Item Code</TableHead>
                <TableHead>Item Name</TableHead>
                <TableHead>UoM</TableHead>
                <TableHead className="text-right">BOM Quantity</TableHead>
                <TableHead className="text-right">Actual Quantity</TableHead>
                <TableHead className="text-right">Increase / Decrease</TableHead>
                <TableHead className="text-right">Available Quantity</TableHead>
                <TableHead className="text-right">Remaining Quantity</TableHead>
                <TableHead className="min-w-[200px]">Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CATEGORY_ORDER.map((cat) => {
                const group = rows.filter((r) => r.category === cat);
                if (group.length === 0) return null;
                return (
                  <Fragment key={cat}>
                    <TableRow className="bg-muted/60 hover:bg-muted/60">
                      <TableCell colSpan={10} className="py-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
                        {CATEGORY_LABEL[cat]}
                        <span className="ml-1.5 font-normal text-muted-foreground">· {group.length} item{group.length === 1 ? "" : "s"}</span>
                      </TableCell>
                    </TableRow>
                    {group.map((r) => {
                      sl += 1;
                      return (
                        <TableRow key={r.key}>
                          <TableCell className="tabular-nums text-muted-foreground">{sl}</TableCell>
                          <TableCell className="font-mono text-xs">{r.mat.itemCode}</TableCell>
                          <TableCell>{r.mat.itemName}</TableCell>
                          <TableCell>{r.mat.uom}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtQty(r.bomQty)}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              value={r.actualStr}
                              onChange={(e) =>
                                setActuals((prev) => ({ ...prev, [r.key]: e.target.value }))
                              }
                              className="h-8 w-28 ml-auto text-right tabular-nums"
                            />
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums font-medium",
                              r.variance > 0 && "text-amber-600",
                              r.variance < 0 && "text-sky-600",
                              r.variance === 0 && "text-muted-foreground font-normal",
                            )}
                          >
                            {r.variance === 0 ? "—" : `${r.variance > 0 ? "+" : ""}${fmtQty(r.variance)}`}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtQty(r.available, 4)}</TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums",
                              r.remaining < 0 && "text-destructive font-medium",
                            )}
                          >
                            {fmtQty(r.remaining, 4)}
                          </TableCell>
                          <TableCell>
                            <Input
                              value={reasons[r.key] ?? ""}
                              onChange={(e) =>
                                setReasons((prev) => ({ ...prev, [r.key]: e.target.value }))
                              }
                              disabled={r.variance === 0}
                              placeholder={r.variance === 0 ? "—" : "Reason for change…"}
                              className="h-8 text-xs"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </Fragment>
                );
              })}
              <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                <TableCell colSpan={4} className="text-right">Total</TableCell>
                <TableCell className="text-right tabular-nums">{fmtQty(totalBom)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtQty(totalActual)}</TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    totalVariance > 0 && "text-amber-600",
                    totalVariance < 0 && "text-sky-600",
                  )}
                >
                  {totalVariance === 0 ? "—" : `${totalVariance > 0 ? "+" : ""}${fmtQty(totalVariance)}`}
                </TableCell>
                <TableCell />
                <TableCell />
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// View dialog — shows entry metadata + costing computed from BOM recipe.
// Reuses PRODUCTION_ITEMS (the recipe catalog defined for production orders).
// ─────────────────────────────────────────────────────────────────────────────

const BDT = (n: number) =>
  `৳ ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type CostedLine = RecipeItem & { reqQty: number; lineCost: number };

function lookupRecipe(entry: WfProductionEntryRecord) {
  const code = entry.outputItemCode;
  const name = entry.outputItemName ?? entry.bom;
  return (
    PRODUCTION_ITEMS.find((p) => (code ? p.code === code : p.name === name)) ??
    null
  );
}

function costLines(items: RecipeItem[], producedQty: number): CostedLine[] {
  return items.map((it) => {
    const reqQty = it.qtyPerUnit * producedQty;
    return { ...it, reqQty, lineCost: reqQty * it.rate };
  });
}

function ProductionEntryDetailDialog({
  entry, onOpenChange,
}: {
  entry: WfProductionEntryRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const order = useWorkflow().productionEntries.find(
    (o) => o.id === entry?.productionOrderId,
  );

  const breakdown = useMemo(() => {
    if (!entry) return null;
    const recipe = lookupRecipe(entry);
    if (!recipe) return null;
    const raw = costLines(recipe.rawMaterials, entry.producedQty);
    const pkg = costLines(recipe.packagingMaterials, entry.producedQty);
    const other = costLines(recipe.otherConsumption, entry.producedQty);
    const sum = (arr: CostedLine[]) => arr.reduce((s, l) => s + l.lineCost, 0);
    const rawCost = sum(raw);
    const pkgCost = sum(pkg);
    const otherCost = sum(other);
    const totalCost = rawCost + pkgCost + otherCost;
    return {
      recipe, raw, pkg, other,
      rawCost, pkgCost, otherCost, totalCost,
      unitCost: entry.producedQty > 0 ? totalCost / entry.producedQty : 0,
    };
  }, [entry]);

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Factory className="h-5 w-5 text-primary" />
            Production Entry Details
          </DialogTitle>
        </DialogHeader>

        {entry && (
          <div className="space-y-5">
            {/* ── Header summary grid ──────────────────────────────────── */}
            <div className="rounded-md border border-border bg-muted/20 px-4 py-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <DetailRow label="Entry No"          value={<span className="font-mono">{entry.id}</span>} />
                <DetailRow label="Entry Date"        value={<span className="tabular-nums">{entry.date}</span>} />
                <DetailRow label="Production Order"  value={<span className="font-mono text-primary">{entry.productionOrderId}</span>} />
                <DetailRow label="Order Date"        value={<span className="tabular-nums">{order?.date ?? "—"}</span>} />
                <DetailRow label="BOM"               value={entry.bom} />
                <DetailRow label="Output Item"       value={entry.outputItemName ?? "—"} />
                <DetailRow label="Office / Warehouse" value={<LocationCell officeId={entry.officeId} warehouseId={entry.warehouseId} />} />
                <DetailRow label="Batch No"          value={entry.batchNo ?? "—"} />
                <DetailRow label="Batch Expiry"      value={entry.batchExpiry ? <span className="tabular-nums">{entry.batchExpiry}</span> : "—"} />
                <DetailRow label="Shift"             value={entry.shift ?? "—"} />
                <DetailRow label="Produced By"       value={entry.producedBy} />
                {entry.remarks && (
                  <div className="md:col-span-2">
                    <DetailRow label="Remarks" value={<span className="text-foreground">{entry.remarks}</span>} />
                  </div>
                )}
              </div>
            </div>

            {/* ── Output item costing ──────────────────────────────────── */}
            <SectionTitle icon={Factory} label="Output Item" />
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead>UoM</TableHead>
                    <TableHead className="text-right">Produced Qty</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-mono text-xs">{breakdown?.recipe.code ?? entry.outputItemCode ?? "—"}</TableCell>
                    <TableCell>{entry.outputItemName ?? entry.bom}</TableCell>
                    <TableCell>Pcs</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{entry.producedQty.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{breakdown ? BDT(breakdown.unitCost) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{breakdown ? BDT(breakdown.totalCost) : "—"}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {/* ── Recorded Input Materials (BOM vs actual, variance, reason) ── */}
            {entry.inputMaterials && entry.inputMaterials.length > 0 && (
              <>
                <SectionTitle icon={Package} label="Input Materials" />
                <div className="overflow-x-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[48px]">SL</TableHead>
                        <TableHead>Item Code</TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead>UoM</TableHead>
                        <TableHead className="text-right">BOM Qty</TableHead>
                        <TableHead className="text-right">Actual Qty</TableHead>
                        <TableHead className="text-right">Increase / Decrease</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        let sl = 0;
                        return CATEGORY_ORDER.map((cat) => {
                          const group = entry.inputMaterials!.filter((l) => l.category === cat);
                          if (group.length === 0) return null;
                          return (
                            <Fragment key={cat}>
                              <TableRow className="bg-muted/60 hover:bg-muted/60">
                                <TableCell colSpan={8} className="py-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
                                  {CATEGORY_LABEL[cat]}
                                  <span className="ml-1.5 font-normal text-muted-foreground">· {group.length} item{group.length === 1 ? "" : "s"}</span>
                                </TableCell>
                              </TableRow>
                              {group.map((l) => {
                                sl += 1;
                                return (
                                  <TableRow key={`${l.itemCode}-${sl}`}>
                                    <TableCell className="tabular-nums text-muted-foreground">{sl}</TableCell>
                                    <TableCell className="font-mono text-xs">{l.itemCode}</TableCell>
                                    <TableCell>{l.itemName}</TableCell>
                                    <TableCell>{l.uom}</TableCell>
                                    <TableCell className="text-right tabular-nums">{fmtQty(l.bomQty)}</TableCell>
                                    <TableCell className="text-right tabular-nums font-medium">{fmtQty(l.actualQty)}</TableCell>
                                    <TableCell
                                      className={cn(
                                        "text-right tabular-nums font-medium",
                                        l.variance > 0 && "text-amber-600",
                                        l.variance < 0 && "text-sky-600",
                                        l.variance === 0 && "text-muted-foreground font-normal",
                                      )}
                                    >
                                      {l.variance === 0 ? "—" : `${l.variance > 0 ? "+" : ""}${fmtQty(l.variance)}`}
                                    </TableCell>
                                    <TableCell className="text-xs">
                                      {l.reason ? l.reason : <span className="text-muted-foreground">—</span>}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </Fragment>
                          );
                        });
                      })()}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            {/* ── Materials breakdown ──────────────────────────────────── */}
            {breakdown ? (
              <>
                <SectionTitle icon={Package} label="Materials Consumed" />
                <div className="overflow-x-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[80px]">Bucket</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Item Name</TableHead>
                        <TableHead>UoM</TableHead>
                        <TableHead className="text-right">Required Qty</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Total Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <MaterialRows label="Raw"        rows={breakdown.raw} />
                      <MaterialRows label="Packaging"  rows={breakdown.pkg} />
                      <MaterialRows label="Other"      rows={breakdown.other} />
                    </TableBody>
                  </Table>
                </div>

                {/* ── Cost summary ─────────────────────────────────────── */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                  <CostTile label="Raw Materials"    value={BDT(breakdown.rawCost)}   icon={Package} />
                  <CostTile label="Packaging"        value={BDT(breakdown.pkgCost)}   icon={PackageOpen} />
                  <CostTile label="Other Consumption" value={BDT(breakdown.otherCost)} icon={Wrench} />
                  <CostTile label="Total Cost"       value={BDT(breakdown.totalCost)} icon={Factory} accent />
                </div>
              </>
            ) : (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                <AlertCircle className="h-4 w-4 inline-block mr-1.5" />
                No BOM recipe registered for this output item — costing breakdown unavailable.
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs uppercase tracking-wider text-muted-foreground min-w-[140px]">{label}</span>
      <span className="text-sm text-foreground flex-1">{value}</span>
    </div>
  );
}

function SectionTitle({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
      <Icon className="h-4 w-4 text-primary" />
      {label}
    </div>
  );
}

function MaterialRows({ label, rows }: { label: string; rows: CostedLine[] }) {
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((r, i) => (
        <TableRow key={`${label}-${r.itemCode}-${i}`}>
          <TableCell><Badge variant="outline" className="text-[10px]">{label}</Badge></TableCell>
          <TableCell className="font-mono text-xs">{r.itemCode}</TableCell>
          <TableCell>{r.itemName}</TableCell>
          <TableCell>{r.uom}</TableCell>
          <TableCell className="text-right tabular-nums">{r.reqQty.toFixed(3)}</TableCell>
          <TableCell className="text-right tabular-nums">{BDT(r.rate)}</TableCell>
          <TableCell className="text-right tabular-nums font-medium">{BDT(r.lineCost)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

function CostTile({
  label, value, icon: Icon, accent,
}: { label: string; value: string; icon: React.ElementType; accent?: boolean }) {
  return (
    <div className={cn(
      "rounded-md border px-3 py-2.5",
      accent ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30",
    )}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={cn(
        "mt-1 text-sm font-semibold tabular-nums",
        accent ? "text-primary" : "text-foreground",
      )}>
        {value}
      </div>
    </div>
  );
}
