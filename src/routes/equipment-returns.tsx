import { useState, useMemo } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { getEquipmentAssets, setEquipmentAssetStatus } from "@/lib/equipment-assets";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, ArrowLeft, Save, Undo2, CheckCircle2, AlertTriangle, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  equipmentReturns as SEED_RETURNS,
  type EquipmentReturn,
} from "@/lib/sample-data";
import { cn } from "@/lib/utils";

const CONDITIONS: EquipmentReturn["condition"][] = ["Good", "Minor Issue", "Damaged"];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function EquipmentReturnsPage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [returns, setReturns] = usePersistedState<EquipmentReturn[]>("equipment-returns", SEED_RETURNS);

  const nextId = `ER-${String(7000 + returns.length + 1).padStart(4, "0")}`;

  const addReturn = (r: EquipmentReturn) => {
    setReturns((prev) => [r, ...prev]);
    setView("list");
  };

  return (
    <>
      <PageHeader
        title="Equipment Returns"
        subtitle="Post-flight equipment returns log — condition recorded by the dispatch handler on arrival"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> Log Return</>}
          </Button>
        }
      />

      {view === "list"
        ? <ReturnList returns={returns} />
        : <ReturnCreate nextId={nextId} onSave={addReturn} />}
    </>
  );
}

function ReturnList({ returns }: { returns: EquipmentReturn[] }) {
  const total = returns.length;
  const good = returns.filter((r) => r.condition === "Good").length;
  const minor = returns.filter((r) => r.condition === "Minor Issue").length;
  const damaged = returns.filter((r) => r.condition === "Damaged").length;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Returns" value={total} icon={Undo2} tone="navy" />
        <KpiCard label="Good Condition" value={good} icon={CheckCircle2} tone="success" />
        <KpiCard label="Minor Issues" value={minor} icon={AlertTriangle} tone="warning" />
        <KpiCard label="Damaged" value={damaged} icon={ShieldAlert} tone="red" />
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-14 text-xs uppercase tracking-wider">SL</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Return ID</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Asset</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Returned By</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Condition</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Remarks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {returns.map((r, i) => (
              <TableRow key={r.id} className="hover:bg-muted/30">
                <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                <TableCell className="font-mono text-xs">{r.id}</TableCell>
                <TableCell className="tabular-nums text-xs">{r.date}</TableCell>
                <TableCell className="font-medium">{r.flight}</TableCell>
                <TableCell>
                  <div className="font-medium">{r.assetName}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{r.assetId}</div>
                </TableCell>
                <TableCell className="text-xs">{r.returnedBy}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      r.condition === "Good" && "border-success/40 bg-success/10 text-success",
                      r.condition === "Minor Issue" && "border-warning/40 bg-warning/10 text-warning",
                      r.condition === "Damaged" && "border-destructive/40 bg-destructive/10 text-destructive",
                    )}
                  >
                    {r.condition}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.remarks ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function ReturnCreate({ nextId, onSave }: { nextId: string; onSave: (r: EquipmentReturn) => void }) {
  const nowIso = new Date().toISOString().slice(0, 16).replace("T", " ");

  const [date, setDate] = useState(nowIso);
  const [flight, setFlight] = useState("");
  const [assetId, setAssetId] = useState("");
  const [returnedBy, setReturnedBy] = useState("");
  const [condition, setCondition] = useState<EquipmentReturn["condition"]>("Good");
  const [remarks, setRemarks] = useState("");

  // Live register (read once on mount) so the picker lists current assets, not
  // the static seed.
  const assets = useMemo(() => getEquipmentAssets(), []);
  const selectedAsset = assets.find((a) => a.id === assetId);

  const save = () => {
    if (!flight.trim()) { toast.error("Flight number is required."); return; }
    if (!selectedAsset) { toast.error("Select the asset being returned."); return; }
    if (!returnedBy.trim()) { toast.error("Returned By is required."); return; }
    onSave({
      id: nextId,
      date,
      flight: flight.trim().toUpperCase(),
      assetId: selectedAsset.id,
      assetName: selectedAsset.name,
      returnedBy: returnedBy.trim(),
      condition,
      remarks: remarks.trim() || undefined,
    });
    // Reconcile the register: a damaged return takes the asset out of service;
    // a good/minor return puts it back in service at the store.
    setEquipmentAssetStatus(
      selectedAsset.id,
      condition === "Damaged" ? "Damaged" : "In Service",
    );
    toast.success(`${nextId} logged · ${selectedAsset.name} returned in ${condition} condition.`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Log Equipment Return</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save Return</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Return ID</Label>
            <Input value={nextId} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date / Time</Label>
            <Input value={date} onChange={(e) => setDate(e.target.value)} placeholder="2026-05-20 18:40" className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Flight # *</Label>
            <Input
              value={flight}
              onChange={(e) => setFlight(e.target.value)}
              placeholder="e.g. BG-402"
              className="mt-1 font-mono uppercase"
            />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Asset *</Label>
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={selectCls}>
              <option value="">Select asset…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Condition</Label>
            <select value={condition} onChange={(e) => setCondition(e.target.value as EquipmentReturn["condition"])} className={selectCls}>
              {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Returned By *</Label>
            <Input
              value={returnedBy}
              onChange={(e) => setReturnedBy(e.target.value)}
              placeholder="Dispatch handler name"
              className="mt-1"
            />
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Remarks</Label>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              className="mt-1"
              placeholder="Damage observed, parts missing, follow-up needed…"
            />
          </div>
        </div>
        {condition !== "Good" && (
          <div className="mt-4 text-[11px] text-warning bg-warning/10 border border-warning/30 rounded px-3 py-2">
            Tip: For damaged or issue-flagged returns, also file a Damage Report so the asset enters the repair queue.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
