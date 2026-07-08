import { useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Trash2, Boxes, ShieldAlert, CircleSlash, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  equipmentAssets as SEED_ASSETS,
  assetCostByName,
  type EquipmentAsset,
} from "@/lib/sample-data";

const fmtBdt = (n: number) => `৳${n.toLocaleString()}`;

// Disposal shares the canonical asset register (same persisted key as the Assets
// page), so destroying an asset here updates the single source of truth every
// other Fleet page reads. The disposal log lives in its own key, mirroring how
// Damage Reports keeps its log separate from the asset register.
const ASSETS_KEY = "airline-equipments-assets";
const DISPOSALS_KEY = "asset-disposals";

type DisposalRecord = {
  id: string;
  assetId: string;
  assetName: string;
  reason: string;
  method: string;
  date: string;
  /** Book/unit cost at disposal, resolved from the Stock Overview asset cost. */
  cost?: number;
  note?: string;
};

const DISPOSAL_REASONS = [
  "Damaged beyond repair", "End of life", "Lost / Missing",
  "Contamination", "Safety recall", "Other",
] as const;
const DISPOSAL_METHODS = [
  "Scrapped", "Recycled", "Written off", "Returned to vendor", "Donated",
] as const;

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const today = () => new Date().toISOString().slice(0, 10);

export default function AssetDisposalPage() {
  const [assets, setAssets] = usePersistedState<EquipmentAsset[]>(ASSETS_KEY, SEED_ASSETS);
  const [disposals, setDisposals] = usePersistedState<DisposalRecord[]>(DISPOSALS_KEY, []);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingId, setPendingId] = useState(""); // current DDL choice, before "Add"
  const [reason, setReason] = useState<string>(DISPOSAL_REASONS[0]);
  const [method, setMethod] = useState<string>(DISPOSAL_METHODS[0]);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Already-destroyed assets can't be destroyed again.
  const destroyable = useMemo(() => assets.filter((a) => a.status !== "Destroyed"), [assets]);
  const selectedAssets = useMemo(
    () => destroyable.filter((a) => selectedIds.includes(a.id)),
    [destroyable, selectedIds],
  );
  const totalValue = selectedAssets.reduce((s, a) => s + (assetCostByName(a.name) ?? 0), 0);
  // Assets still available to add (destroyable and not already on the list).
  const availableToAdd = useMemo(
    () => destroyable.filter((a) => !selectedIds.includes(a.id)),
    [destroyable, selectedIds],
  );

  const addAsset = () => {
    if (!pendingId || selectedIds.includes(pendingId)) return;
    setSelectedIds((prev) => [...prev, pendingId]);
    setPendingId("");
  };
  const removeAsset = (id: string) => setSelectedIds((prev) => prev.filter((x) => x !== id));

  const activeAssets = assets.filter((a) => a.status !== "Destroyed" && a.status !== "Retired").length;
  const destroyedTotal = assets.filter((a) => a.status === "Destroyed").length;
  const thisMonthPrefix = today().slice(0, 7);
  const destroyedThisMonth = disposals.filter((d) => d.date.startsWith(thisMonthPrefix)).length;

  const requestDestroy = () => {
    if (selectedIds.length === 0) { toast.error("Select at least one asset to destroy."); return; }
    setConfirmOpen(true);
  };

  const confirmDestroy = () => {
    if (selectedAssets.length === 0) { setConfirmOpen(false); return; }

    // One disposal record per selected asset, each costed from Stock Overview.
    const records: DisposalRecord[] = selectedAssets.map((asset, i) => ({
      id: `DSP-${String(disposals.length + 1 + i).padStart(3, "0")}`,
      assetId: asset.id,
      assetName: asset.name,
      reason,
      method,
      date,
      cost: assetCostByName(asset.name),
      note: note.trim() || undefined,
    }));

    setDisposals((prev) => [...records, ...prev]);
    setAssets((prev) => prev.map((a) =>
      selectedIds.includes(a.id) ? { ...a, status: "Destroyed", location: "Disposed" } : a,
    ));
    toast.success(
      selectedAssets.length === 1
        ? `${selectedAssets[0].name} (${selectedAssets[0].id}) has been destroyed and removed from the fleet.`
        : `${selectedAssets.length} assets destroyed · ${fmtBdt(totalValue)} written off.`,
    );

    setConfirmOpen(false);
    setSelectedIds([]);
    setPendingId("");
    setNote("");
  };

  return (
    <>
      <PageHeader
        title="Asset Disposal"
        subtitle="Destroy and decommission assets that are damaged beyond repair, lost or written off"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Active Assets" value={activeAssets} icon={Boxes} tone="success" />
        <KpiCard label="Destroyed (Total)" value={destroyedTotal} icon={ShieldAlert} tone="red" />
        <KpiCard label="Destroyed (This Month)" value={destroyedThisMonth} icon={CircleSlash} tone="warning" />
      </div>

      <Card className="mb-6 border-destructive/30">
        <CardContent className="pt-6 pb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-6 text-destructive">Destroy / Decommission Asset</h3>

          {/* Asset picker — choose from the DDL and Add multiple; cost per asset
              shown in its own field, pulled from the Stock Overview report. */}
          <div className="mb-6">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Assets *</Label>
            <div className="flex gap-2 mt-1">
              <select value={pendingId} onChange={(e) => setPendingId(e.target.value)} className={selectCls}>
                <option value="">
                  {availableToAdd.length ? "Select asset to add…" : "All assets added"}
                </option>
                {availableToAdd.map((a) => (
                  <option key={a.id} value={a.id}>{a.id} — {a.name} ({a.status})</option>
                ))}
              </select>
              <Button type="button" onClick={addAsset} disabled={!pendingId} className="shrink-0">
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>

            {selectedAssets.length > 0 && (
              <div className="mt-3 rounded-md border border-input overflow-hidden">
                <div className="grid grid-cols-[1fr_150px_36px] gap-2 px-3 py-1.5 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <div>Asset</div>
                  <div className="text-right">Cost (Stock Overview)</div>
                  <div />
                </div>
                {selectedAssets.map((a) => {
                  const cost = assetCostByName(a.name);
                  return (
                    <div key={a.id} className="grid grid-cols-[1fr_150px_36px] gap-2 items-center px-3 py-2 border-t border-border">
                      <div className="min-w-0">
                        <div className="text-sm truncate">{a.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{a.id} · {a.status}</div>
                      </div>
                      <Input
                        readOnly
                        disabled
                        value={cost != null ? fmtBdt(cost) : "—"}
                        className="h-8 text-right tabular-nums bg-muted/50"
                      />
                      <button
                        type="button"
                        onClick={() => removeAsset(a.id)}
                        className="justify-self-center text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${a.name}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
                <div className="grid grid-cols-[1fr_150px_36px] gap-2 items-center px-3 py-2 border-t border-border bg-muted/20">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">
                    Total book value
                  </div>
                  <div className="text-right text-sm font-semibold tabular-nums">{fmtBdt(totalValue)}</div>
                  <div />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mb-6">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Reason *</Label>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className={selectCls}>
                {DISPOSAL_REASONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Disposal Method *</Label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={selectCls}>
                {DISPOSAL_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Disposal Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 tabular-nums" />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Note</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Condition details, incident reference…"
                className="mt-1"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="destructive" onClick={requestDestroy}>
              <Trash2 className="h-4 w-4 mr-1.5" /> Destroy {selectedIds.length > 1 ? `${selectedIds.length} Assets` : "Asset"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">Disposal Log</h3>
      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-10 text-xs uppercase tracking-wider">SL</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Ref</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Asset</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Reason</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Method</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Value</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {disposals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                  No assets destroyed yet.
                </TableCell>
              </TableRow>
            ) : (
              disposals.map((d, i) => (
                <TableRow key={d.id} className="hover:bg-muted/30">
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{d.id}</TableCell>
                  <TableCell>
                    <div className="font-medium">{d.assetName}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{d.assetId}</div>
                  </TableCell>
                  <TableCell className="text-sm">{d.reason}</TableCell>
                  <TableCell className="text-sm">{d.method}</TableCell>
                  <TableCell className="tabular-nums text-xs text-right">
                    {d.cost != null ? fmtBdt(d.cost) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">{d.date}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Destroy {selectedAssets.length === 1 ? "this asset" : `these ${selectedAssets.length} assets`}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              This permanently marks {selectedAssets.length === 1 ? "the asset" : "the assets"} as <span className="font-semibold text-destructive">Destroyed</span> and
              removes {selectedAssets.length === 1 ? "it" : "them"} from the active fleet. This can’t be undone.
            </p>
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2 max-h-52 overflow-y-auto">
              {selectedAssets.map((a) => {
                const cost = assetCostByName(a.name);
                return (
                  <div key={a.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{a.name}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{a.id}</div>
                    </div>
                    <span className="tabular-nums text-xs shrink-0">{cost != null ? fmtBdt(cost) : "—"}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{reason} · {method}</span>
              <span>Total book value: <span className="font-semibold tabular-nums">{fmtBdt(totalValue)}</span></span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDestroy}>
              <Trash2 className="h-4 w-4 mr-1.5" /> Confirm Destroy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
