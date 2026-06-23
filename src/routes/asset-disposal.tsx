import { useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { StatusBadge } from "@/components/common/StatusBadge";
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
import { Trash2, Boxes, ShieldAlert, CircleSlash } from "lucide-react";
import { toast } from "sonner";
import {
  equipmentAssets as SEED_ASSETS,
  type EquipmentAsset,
} from "@/lib/sample-data";

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
  approvedBy: string;
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

  const [assetId, setAssetId] = useState("");
  const [reason, setReason] = useState<string>(DISPOSAL_REASONS[0]);
  const [method, setMethod] = useState<string>(DISPOSAL_METHODS[0]);
  const [date, setDate] = useState(today());
  const [approvedBy, setApprovedBy] = useState("");
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Already-destroyed assets can't be destroyed again.
  const destroyable = useMemo(() => assets.filter((a) => a.status !== "Destroyed"), [assets]);
  const selectedAsset = assets.find((a) => a.id === assetId) ?? null;

  const activeAssets = assets.filter((a) => a.status !== "Destroyed" && a.status !== "Retired").length;
  const destroyedTotal = assets.filter((a) => a.status === "Destroyed").length;
  const thisMonthPrefix = today().slice(0, 7);
  const destroyedThisMonth = disposals.filter((d) => d.date.startsWith(thisMonthPrefix)).length;

  const requestDestroy = () => {
    if (!assetId) { toast.error("Select an asset to destroy."); return; }
    if (!approvedBy.trim()) { toast.error("Approver is required to destroy an asset."); return; }
    setConfirmOpen(true);
  };

  const confirmDestroy = () => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) { setConfirmOpen(false); return; }

    const record: DisposalRecord = {
      id: `DSP-${String(disposals.length + 1).padStart(3, "0")}`,
      assetId,
      assetName: asset.name,
      reason,
      method,
      date,
      approvedBy: approvedBy.trim(),
      note: note.trim() || undefined,
    };

    setDisposals((prev) => [record, ...prev]);
    setAssets((prev) => prev.map((a) =>
      a.id === assetId ? { ...a, status: "Destroyed", location: "Disposed" } : a,
    ));
    toast.success(`${asset.name} (${assetId}) has been destroyed and removed from the fleet.`);

    setConfirmOpen(false);
    setAssetId("");
    setApprovedBy("");
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mb-6">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Asset *</Label>
              <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={selectCls}>
                <option value="">Select asset…</option>
                {destroyable.map((a) => (
                  <option key={a.id} value={a.id}>{a.id} — {a.name} ({a.status})</option>
                ))}
              </select>
            </div>
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
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Approved By *</Label>
              <Input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} placeholder="Authorising officer" className="mt-1" />
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
              <Trash2 className="h-4 w-4 mr-1.5" /> Destroy Asset
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
              <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Approved By</TableHead>
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
                  <TableCell className="tabular-nums text-xs">{d.date}</TableCell>
                  <TableCell className="text-xs">{d.approvedBy}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Destroy this asset?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              This permanently marks the asset as <span className="font-semibold text-destructive">Destroyed</span> and
              removes it from the active fleet. This can’t be undone.
            </p>
            {selectedAsset && (
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{selectedAsset.name}</span>
                  <StatusBadge status={selectedAsset.status} />
                </div>
                <div className="font-mono text-xs text-muted-foreground">{selectedAsset.id}</div>
                <div className="text-xs text-muted-foreground">{reason} · {method}</div>
              </div>
            )}
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
