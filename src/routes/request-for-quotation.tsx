import { useEffect, useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { DataTable, type Column } from "@/components/common/DataTable";
import { ReviewStatusCell } from "@/components/common/ReviewStatusCell";
import { RowActions } from "@/components/common/RowActions";
import { rowEditors } from "@/lib/row-editors";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Plus, ArrowLeft, Save, Send, Trash2, MailQuestion, FileText,
  CheckCircle2, Clock, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Select } from "antd";
import { activeItems, vendors } from "@/lib/sample-data";
import { getPurchaseRequisitions } from "@/lib/purchase-requisitions";
import { SEED_RFQS, normalizeRfqStatus, type Rfq, type RfqLine, type RfqStatus } from "@/lib/rfqs";
import { cn } from "@/lib/utils";

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function RfqPage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [rows, setRows] = usePersistedState<Rfq[]>("request-for-quotation-rows", SEED_RFQS);

  // Migrate any legacy statuses (Draft/Sent/Responses In/Closed/Cancelled) left
  // in persisted storage onto the current Pending/Approved/Rejected model.
  useEffect(() => {
    setRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        const ns = normalizeRfqStatus(r.status);
        if (ns !== r.status) { changed = true; return { ...r, status: ns }; }
        return r;
      });
      return changed ? next : prev;
    });
  }, [setRows]);

  const nextId = `RFQ-${new Date().getFullYear()}-${String(rows.length + 43).padStart(4, "0")}`;

  const addRfq = (r: Rfq) => {
    setRows((prev) => [r, ...prev]);
    setView("list");
  };

  return (
    <>
      <PageHeader
        title="Request for Quotation"
        subtitle="Issue RFQs to suppliers, set response deadlines and track replies"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> New RFQ</>}
          </Button>
        }
      />

      {view === "list" ? <RfqList rows={rows} editors={rowEditors(setRows)} /> : <RfqCreate nextId={nextId} onSave={addRfq} />}
    </>
  );
}

function RfqList({ rows, editors }: {
  rows: Rfq[];
  editors: { onSave: (u: Record<string, unknown>) => void; onDelete: (u: Record<string, unknown>) => void };
}) {
  const total = rows.length;
  const pending = rows.filter((r) => r.status === "Pending").length;
  const approved = rows.filter((r) => r.status === "Approved").length;
  const rejected = rows.filter((r) => r.status === "Rejected").length;

  const cols: Column<Rfq>[] = [
    { key: "id", header: "RFQ #", render: (r) => <span className="font-mono text-xs">{r.id}</span> },
    { key: "date", header: "Date" },
    { key: "prRef", header: "PR Ref", render: (r) => r.prRef ?? <span className="text-muted-foreground">—</span> },
    { key: "lines", header: "Items", render: (r) => `${r.lines.length} item${r.lines.length === 1 ? "" : "s"}` },
    {
      key: "invitedSuppliers", header: "Suppliers",
      render: (r) =>
        r.invitedSuppliers.length === 0
          ? <span className="text-muted-foreground">—</span>
          : <span>{r.invitedSuppliers.length}</span>,
    },
    { key: "deadline", header: "Deadline" },
    { key: "status", header: "Status", render: (r) => (
      <ReviewStatusCell category="Request for Quotation" refId={r.id}>
        <StatusBadge status={r.status} />
      </ReviewStatusCell>
    ) },
  ];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total RFQs" value={total}    icon={MailQuestion} tone="navy" />
        <KpiCard label="Pending"    value={pending}  icon={Clock}        tone="warning" />
        <KpiCard label="Approved"   value={approved} icon={CheckCircle2} tone="success" />
        <KpiCard label="Rejected"   value={rejected} icon={XCircle}      tone="red" />
      </div>

      <DataTable
        title="rfqs"
        data={rows}
        columns={cols}
        searchKeys={["id", "prRef", "status"]}
        selectable={false}
        actions={(r) => (
          <RowActions
            row={r}
            actions={["view", "edit", "print", "delete"]}
            onSave={editors.onSave}
            onDelete={editors.onDelete}
            editDetail={({ save, close }) => <RfqFields mode="edit" initial={r} onSubmit={save} onClose={close} />}
          />
        )}
      />
    </>
  );
}

function RfqCreate({ nextId, onSave }: { nextId: string; onSave: (r: Rfq) => void }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <RfqFields mode="create" nextId={nextId} onSave={onSave} />
      </CardContent>
    </Card>
  );
}

/**
 * Shared RFQ form fields. Used by the Create page (mode="create") and the
 * row Edit modal (mode="edit", pre-filled from `initial`) so both share an
 * identical layout including the dynamic item-line table.
 */
function RfqFields({
  mode, nextId, initial, onSave, onSubmit, onClose,
}: {
  mode: "create" | "edit";
  nextId?: string;
  initial?: Rfq;
  onSave?: (r: Rfq) => void;
  onSubmit?: (patch: Record<string, unknown>) => void;
  onClose?: () => void;
}) {
  const isEdit = mode === "edit";
  const today = new Date().toISOString().slice(0, 10);
  const oneWeekOut = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const [date] = useState(initial?.date ?? today);
  const [prRef, setPrRef] = useState(initial?.prRef ?? "");
  const [deadline, setDeadline] = useState(initial?.deadline ?? oneWeekOut);
  const [invited, setInvited] = useState<string[]>(initial?.invitedSuppliers ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<RfqLine[]>(initial?.lines ?? [
    { id: `l-${Date.now()}`, itemName: "", uom: "Kg", qty: 0 },
  ]);

  const itemOptions = useMemo(() => activeItems.slice(0, 80), []);
  // PR Reference choices come from the Purchase Requisition table (single
  // source) — only Approved PRs can be quoted against.
  const prOptions = useMemo(
    () => getPurchaseRequisitions().filter((pr) => pr.status === "Approved"),
    [],
  );

  // Selecting a PR loads its line items into the RFQ (item, qty, uom, spec).
  const handlePrChange = (id: string) => {
    setPrRef(id);
    const pr = prOptions.find((p) => p.id === id);
    if (pr) {
      setLines(
        pr.lines.map((l, i) => ({
          id: `pr-${i}-${l.id}`,
          itemName: l.itemName,
          uom: l.uom,
          qty: l.qty,
          spec: l.description || undefined,
        })),
      );
    }
  };

  const addLine = () => {
    setLines((prev) => [...prev, { id: `l-${Date.now()}`, itemName: "", uom: "Kg", qty: 0 }]);
  };
  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));
  const updateLine = (id: string, patch: Partial<RfqLine>) =>
    setLines((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l));

  const pickItem = (id: string, itemName: string) => {
    const it = itemOptions.find((i) => i.name === itemName);
    updateLine(id, { itemName, uom: it?.uom ?? "Kg" });
  };

  const save = (status: RfqStatus) => {
    if (lines.length === 0 || lines.every((l) => !l.itemName.trim())) {
      toast.error("Add at least one item line.");
      return;
    }
    if (invited.length === 0) {
      toast.error("Select at least one supplier.");
      return;
    }
    if (!deadline) {
      toast.error("Set a response deadline.");
      return;
    }
    const cleanLines = lines.filter((l) => l.itemName.trim());
    const payload = {
      date,
      prRef: prRef.trim() || undefined,
      deadline,
      status,
      invitedSuppliers: invited,
      lines: cleanLines,
      notes: notes.trim() || undefined,
    };
    if (isEdit) {
      onSubmit?.(payload);
      onClose?.();
    } else {
      onSave?.({ id: nextId!, ...payload });
      toast.success(`${nextId} submitted for approval.`);
    }
  };

  return (
    <>
      {!isEdit && (
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">New Request for Quotation</h3>
          <div className="flex items-center gap-2">
            <Button onClick={() => save("Pending")}>
              <Send className="h-4 w-4 mr-1.5" /> Submit for Approval
            </Button>
          </div>
        </div>
      )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 mb-6">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">RFQ #</Label>
            <Input value={initial?.id ?? nextId ?? ""} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
            <Input value={date} disabled className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">PR Reference</Label>
            <select
              value={prRef}
              onChange={(e) => handlePrChange(e.target.value)}
              className={cn(selectCls, "font-mono")}
            >
              <option value="">— None —</option>
              {prOptions.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.id} — {pr.requestedBy} · {pr.status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Response Deadline *</Label>
            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1" />
          </div>
        </div>

        <div className="mb-6">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
            Select Suppliers {invited.length > 0 && <span className="text-foreground">({invited.length} selected)</span>}
          </Label>
          <Select
            mode="multiple"
            value={invited}
            onChange={(vals) => setInvited(vals as string[])}
            placeholder="Select one or more suppliers"
            style={{ width: "100%" }}
            allowClear
            showSearch
            optionFilterProp="label"
            getPopupContainer={(trigger) => trigger.parentElement as HTMLElement}
            options={vendors.map((v) => ({ value: v.name, label: `${v.name} — ${v.category}` }))}
          />
        </div>

        <div className="mb-2 flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Items Requested</Label>
          <Button size="sm" variant="outline" onClick={addLine}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Line
          </Button>
        </div>
        <div className="rounded-md border border-border overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left font-semibold">Item</th>
                <th className="p-2 text-left font-semibold w-20">UoM</th>
                <th className="p-2 text-left font-semibold w-24">Qty</th>
                <th className="p-2 text-left font-semibold">Specification / Note</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-border/50">
                  <td className="p-2">
                    <select
                      value={l.itemName}
                      onChange={(e) => pickItem(l.id, e.target.value)}
                      className={selectCls}
                    >
                      <option value="">Select item</option>
                      {/* Loaded-from-PR items may not be in the master list — keep them selectable. */}
                      {l.itemName && !itemOptions.some((it) => it.name === l.itemName) && (
                        <option value={l.itemName}>{l.itemName}</option>
                      )}
                      {itemOptions.map((it) => (
                        <option key={it.id} value={it.name}>{it.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 text-muted-foreground text-xs">{l.uom}</td>
                  <td className="p-2">
                    <Input
                      type="number"
                      min={0}
                      value={l.qty || ""}
                      onChange={(e) => updateLine(l.id, { qty: Number(e.target.value) })}
                      className="h-8 text-xs"
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      value={l.spec ?? ""}
                      onChange={(e) => updateLine(l.id, { spec: e.target.value })}
                      placeholder="optional"
                      className="h-8 text-xs"
                    />
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={() => removeLine(l.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1"
            placeholder="Special delivery instructions, packaging requirements, etc."
          />
        </div>

      {isEdit && (
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save(initial?.status ?? "Pending")}>
            <Save className="h-4 w-4 mr-1.5" /> Save Changes
          </Button>
        </div>
      )}
    </>
  );
}
