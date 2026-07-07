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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Send, Boxes, PackageCheck, Save } from "lucide-react";
import { toast } from "sonner";
import {
  equipmentAssets as SEED_ASSETS,
  type EquipmentAsset,
} from "@/lib/sample-data";
import { getAuthUser } from "@/lib/auth";
import { getActiveStaff } from "@/lib/staff";

// Assignment shares the canonical asset register (same persisted key as the
// Assets page), so an assignment here updates the single source of truth every
// other Fleet page reads. The assignment log lives in its own key, mirroring how
// Damage Reports keeps its log separate from the asset register.
const ASSETS_KEY = "airline-equipments-assets";
const ASSIGNMENTS_KEY = "asset-assignments";

type AssignmentRecord = {
  id: string;
  assetId: string;
  assetName: string;
  assignTo: string;
  date: string;
  assignedBy: string;
  note?: string;
};

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const today = () => new Date().toISOString().slice(0, 10);

export default function AssetAssignmentPage() {
  const [assets, setAssets] = usePersistedState<EquipmentAsset[]>(ASSETS_KEY, SEED_ASSETS);
  const [assignments, setAssignments] = usePersistedState<AssignmentRecord[]>(ASSIGNMENTS_KEY, []);

  const [assetId, setAssetId] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");

  // Assigned By is detected from the logged-in user — not hand-typed.
  const assignedBy = getAuthUser()?.name ?? "Current User";

  // Assets are assigned to an employee (the person who takes custody) — drawn
  // from the active staff roster (same source the User Access screen manages).
  const employees = useMemo(() => getActiveStaff(), []);

  // Destroyed / retired assets are out of the fleet — only live assets are assignable.
  const assignable = useMemo(
    () => assets.filter((a) => a.status !== "Destroyed" && a.status !== "Retired"),
    [assets],
  );

  const totalAssets = assets.length;
  const assignedCount = assets.filter((a) => a.status === "Assigned" || a.status === "In Service").length;
  const available = assignable.length - assignedCount;

  const save = () => {
    if (!assetId) { toast.error("Select an asset to assign."); return; }
    if (!assignTo.trim()) { toast.error("Select an employee to assign the asset to."); return; }
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) { toast.error("Asset not found."); return; }

    const record: AssignmentRecord = {
      id: `ASN-${String(assignments.length + 1).padStart(3, "0")}`,
      assetId,
      assetName: asset.name,
      assignTo: assignTo.trim(),
      date,
      assignedBy,
      note: note.trim() || undefined,
    };

    setAssignments((prev) => [record, ...prev]);
    setAssets((prev) => prev.map((a) =>
      a.id === assetId ? { ...a, status: "Assigned", location: assignTo.trim() } : a,
    ));
    toast.success(`${asset.name} (${assetId}) assigned to ${assignTo.trim()}.`);

    setAssetId("");
    setAssignTo("");
    setNote("");
  };

  return (
    <>
      <PageHeader
        title="Asset Assignment"
        subtitle="Assign reusable equipment to flights & stations and track custody"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Total Assets" value={totalAssets} icon={Boxes} tone="navy" />
        <KpiCard label="Currently Assigned" value={assignedCount} icon={PackageCheck} tone="success" />
        <KpiCard label="Available to Assign" value={Math.max(0, available)} icon={Send} tone="warning" />
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6 pb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-6">Assign Asset</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mb-6">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Asset *</Label>
              <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={selectCls}>
                <option value="">Select asset…</option>
                {assignable.map((a) => (
                  <option key={a.id} value={a.id}>{a.id} — {a.name} ({a.status})</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Assign To *</Label>
              <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className={selectCls}>
                <option value="">Select employee…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.fullName}>{e.fullName} — {e.role}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Assignment Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 tabular-nums" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Assigned By</Label>
              <Input value={assignedBy} disabled readOnly className="mt-1 bg-muted/50" />
              <p className="text-[11px] text-muted-foreground mt-1">Detected from your login.</p>
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Note</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional remarks…"
                className="mt-1"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={save}>
              <Save className="h-4 w-4 mr-1.5" /> Assign Asset
            </Button>
          </div>
        </CardContent>
      </Card>

      <h3 className="text-sm font-semibold uppercase tracking-wider mb-3">Assignment History</h3>
      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-10 text-xs uppercase tracking-wider">SL</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Ref</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Asset</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Assigned To</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                  No assignments recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              assignments.map((r, i) => (
                <TableRow key={r.id} className="hover:bg-muted/30">
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{r.id}</TableCell>
                  <TableCell>
                    <div className="font-medium">{r.assetName}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.assetId}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.assignTo}</TableCell>
                  <TableCell className="tabular-nums text-xs">{r.date}</TableCell>
                  <TableCell className="text-xs">{r.assignedBy}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
