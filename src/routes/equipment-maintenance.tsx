import { useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
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
  Plus, ArrowLeft, Save, Clock, AlertTriangle, Eye, X, Send,
} from "lucide-react";
import { toast } from "sonner";
import { equipmentAssets as SEED_ASSETS, type EquipmentAsset } from "@/lib/sample-data";
import { cn } from "@/lib/utils";
import { useWorkflow, type WfMaintenanceApproval } from "@/lib/workflow-store";

const WORK_TYPES: WfMaintenanceApproval["workType"][] = ["Routine", "Repair", "Calibration", "Inspection"];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const DEFAULT_VENDORS = [
  "AlRahman Trading",
  "Equipment Masters BD",
  "Fresh Farms Ltd",
  "Halal Meats Co.",
  "Metro Wholesale",
  "Premium Supplies Co",
  "TechServ Solutions",
];

function statusBadgeCls(status: WfMaintenanceApproval["status"]) {
  switch (status) {
    case "Logged":               return "bg-muted text-muted-foreground border-muted-foreground/30";
    case "Pending Approval":     return "bg-amber-50 text-amber-700 border-amber-200";
    case "Maintenance Approved": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "Rejected":             return "bg-red-50 text-red-700 border-red-200";
    case "Sent to Accounts":     return "bg-blue-50 text-blue-700 border-blue-200";
    case "Payment Approved":     return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "Payment Rejected":     return "bg-red-50 text-red-700 border-red-200";
    default:                     return "bg-muted text-muted-foreground border-muted-foreground/30";
  }
}

export default function EquipmentMaintenancePage() {
  const [view, setView] = useState<"list" | "create">("list");
  const [assets, setAssets] = usePersistedState<EquipmentAsset[]>("equipment-maintenance-assets", SEED_ASSETS);
  const [selectedAsset, setSelectedAsset] = useState<EquipmentAsset | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<WfMaintenanceApproval | null>(null);
  const [sendToAccountsEntry, setSendToAccountsEntry] = useState<WfMaintenanceApproval | null>(null);

  const { maintenanceApprovals, addMaintenanceApproval, updateMaintenanceApproval } = useWorkflow();

  const nextLogId = useMemo(
    () => `MNT-${String(7000 + maintenanceApprovals.length + 1).padStart(4, "0")}`,
    [maintenanceApprovals.length],
  );

  const logMaintenance = (entry: WfMaintenanceApproval) => {
    addMaintenanceApproval(entry);
    setAssets((prev) =>
      prev.map((a) =>
        a.id === entry.assetId
          ? { ...a, lastMaintenance: entry.serviceDate, nextMaintenance: entry.nextDue, status: a.status === "In Maintenance" ? "In Service" : a.status }
          : a,
      ),
    );
    setView("list");
  };

  const handleSendForApproval = (id: string) => {
    updateMaintenanceApproval(id, { status: "Pending Approval" });
    toast.success(`${id} sent for approval.`);
  };

  const handleSendToAccounts = (data: { accountsHeadId: string; vendor: string; expenseCost: number }) => {
    if (!sendToAccountsEntry) return;
    updateMaintenanceApproval(sendToAccountsEntry.id, {
      status: "Sent to Accounts",
      accountsHeadId: data.accountsHeadId,
      vendor: data.vendor,
      expenseCost: data.expenseCost,
      sentToAccountsAt: new Date().toISOString().slice(0, 10),
    });
    toast.success(`${sendToAccountsEntry.id} sent to Accounts.`);
    setSendToAccountsEntry(null);
  };

  return (
    <>
      <PageHeader
        title="Equipment Maintenance"
        subtitle="Service-due watchlist + maintenance log book for trolleys, racks, containers and galley equipment"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create"
              ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back to List</>
              : <><Plus className="h-4 w-4 mr-1" /> Log Maintenance</>}
          </Button>
        }
      />

      {view === "list"
        ? <MaintenanceList
            assets={assets}
            entries={maintenanceApprovals}
            onViewEntry={setSelectedEntry}
            onSendForApproval={handleSendForApproval}
            onSendToAccounts={setSendToAccountsEntry}
          />
        : <MaintenanceCreate nextLogId={nextLogId} assets={assets} onSave={logMaintenance} />}

      {selectedAsset && (
        <AssetViewModal asset={selectedAsset} onClose={() => setSelectedAsset(null)} />
      )}
      {selectedEntry && (
        <EntryViewModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
      )}
      {sendToAccountsEntry && (
        <SendToAccountsModal
          entry={sendToAccountsEntry}
          onClose={() => setSendToAccountsEntry(null)}
          onSubmit={handleSendToAccounts}
        />
      )}
    </>
  );
}

function MaintenanceList({
  assets, entries, onViewEntry, onSendForApproval, onSendToAccounts,
}: {
  assets: EquipmentAsset[];
  entries: WfMaintenanceApproval[];
  onViewEntry: (e: WfMaintenanceApproval) => void;
  onSendForApproval: (id: string) => void;
  onSendToAccounts: (e: WfMaintenanceApproval) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const eligible = assets.filter(
    (a) => a.status !== "Damaged" && a.status !== "Retired" && a.status !== "New" && a.status !== "Used",
  );
  const overdue = eligible.filter((a) => a.nextMaintenance <= today);
  const dueSoon = eligible.filter((a) => a.nextMaintenance > today && a.nextMaintenance <= cutoff30);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <KpiCard label="Overdue" value={overdue.length} icon={AlertTriangle} tone="red" />
        <KpiCard label="Due in 30d" value={dueSoon.length} icon={Clock} tone="warning" />
      </div>

      <div className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Maintenance Logs
      </div>
      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="text-xs uppercase tracking-wider">Log ID</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Service Date</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Asset</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Work Type</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Next Due</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Notes</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-6">
                  No maintenance logged yet. Click "Log Maintenance" to record a service event.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((e) => (
                <TableRow key={e.id} className="hover:bg-muted/30">
                  <TableCell className="font-mono text-xs">{e.id}</TableCell>
                  <TableCell className="tabular-nums text-xs">{e.serviceDate}</TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{e.assetName}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{e.assetId}</div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        e.workType === "Routine"     && "bg-[#f0fdfa] text-[#0f766e] border-[#99f6e4]",
                        e.workType === "Repair"      && "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]",
                        e.workType === "Calibration" && "bg-[#EFF6FF] text-[#1d4ed8] border-[#BFDBFE]",
                        e.workType === "Inspection"  && "bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]",
                      )}
                    >
                      {e.workType}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">{e.nextDue}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{e.notes ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-[10px]", statusBadgeCls(e.status))}>
                      {e.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => onViewEntry(e)}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="View details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {e.status === "Logged" && (
                        <Button
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => onSendForApproval(e.id)}
                        >
                          <Send className="h-3 w-3 mr-1" /> Send for Approval
                        </Button>
                      )}
                      {e.status === "Maintenance Approved" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px] border-blue-400 text-blue-700 hover:bg-blue-50"
                          onClick={() => onSendToAccounts(e)}
                        >
                          Send to Accounts
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function AssetViewModal({ asset, onClose }: { asset: EquipmentAsset; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <div className="text-sm font-semibold">{asset.name}</div>
            <div className="font-mono text-xs text-muted-foreground mt-0.5">{asset.id}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5 grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Category</p>
            <Badge variant="outline" className="text-[10px]">{asset.category}</Badge>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Status</p>
            <p className="text-sm font-medium">{asset.status}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Location</p>
            <p className="text-sm">{asset.location}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Quantity</p>
            <p className="text-sm tabular-nums">{asset.quantity}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Last Maintenance</p>
            <p className="text-sm tabular-nums">{asset.lastMaintenance}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Next Maintenance</p>
            <p className="text-sm tabular-nums">{asset.nextMaintenance}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function EntryViewModal({ entry, onClose }: { entry: WfMaintenanceApproval; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <div className="text-sm font-semibold">{entry.id}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{entry.serviceDate}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5 grid grid-cols-2 gap-x-6 gap-y-4">
          <div className="col-span-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Asset</p>
            <p className="text-sm font-medium">{entry.assetName}</p>
            <p className="font-mono text-[10px] text-muted-foreground mt-0.5">{entry.assetId}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Work Type</p>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                entry.workType === "Routine"     && "bg-[#f0fdfa] text-[#0f766e] border-[#99f6e4]",
                entry.workType === "Repair"      && "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]",
                entry.workType === "Calibration" && "bg-[#EFF6FF] text-[#1d4ed8] border-[#BFDBFE]",
                entry.workType === "Inspection"  && "bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]",
              )}
            >
              {entry.workType}
            </Badge>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Status</p>
            <Badge variant="outline" className={cn("text-[10px]", statusBadgeCls(entry.status))}>
              {entry.status}
            </Badge>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Service Date</p>
            <p className="text-sm tabular-nums">{entry.serviceDate}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Next Due</p>
            <p className="text-sm tabular-nums">{entry.nextDue}</p>
          </div>
          {entry.approvedBy && (
            <div className="col-span-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Approved By</p>
              <p className="text-sm">{entry.approvedBy}</p>
              <p className="text-[10px] text-muted-foreground">{entry.approvedAt}</p>
            </div>
          )}
          {entry.accountsHeadId && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Accounts Head ID</p>
              <p className="text-sm font-mono">{entry.accountsHeadId}</p>
            </div>
          )}
          {entry.vendor && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Vendor</p>
              <p className="text-sm">{entry.vendor}</p>
            </div>
          )}
          {entry.expenseCost !== undefined && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Expense Cost</p>
              <p className="text-sm font-semibold tabular-nums">৳ {entry.expenseCost.toLocaleString()}</p>
            </div>
          )}
          {entry.notes && (
            <div className="col-span-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Notes</p>
              <p className="text-sm text-muted-foreground leading-relaxed bg-muted/40 rounded-md px-4 py-3 border border-border">
                {entry.notes}
              </p>
            </div>
          )}
          {entry.rejectionReason && (
            <div className="col-span-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 text-destructive">Rejection Reason</p>
              <p className="text-sm text-destructive leading-relaxed bg-destructive/5 rounded-md px-4 py-3 border border-destructive/20">
                {entry.rejectionReason}
              </p>
            </div>
          )}
          {entry.paymentRejectionReason && (
            <div className="col-span-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 text-destructive">Payment Rejection Reason</p>
              <p className="text-sm text-destructive leading-relaxed bg-destructive/5 rounded-md px-4 py-3 border border-destructive/20">
                {entry.paymentRejectionReason}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SendToAccountsModal({
  entry, onClose, onSubmit,
}: {
  entry: WfMaintenanceApproval;
  onClose: () => void;
  onSubmit: (data: { accountsHeadId: string; vendor: string; expenseCost: number }) => void;
}) {
  const accountsHeadId = `ACH-${entry.id.replace("MNT-", "")}`;
  const [vendorList, setVendorList] = useState<string[]>(DEFAULT_VENDORS);
  const [vendor, setVendor] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newVendor, setNewVendor] = useState("");
  const [expenseCost, setExpenseCost] = useState("");

  const handleVendorChange = (v: string) => {
    if (v === "__add_new__") {
      setAddingNew(true);
      setVendor("");
    } else {
      setAddingNew(false);
      setVendor(v);
    }
  };

  const handleAddNewVendor = () => {
    const trimmed = newVendor.trim();
    if (!trimmed) return;
    setVendorList((prev) => [...prev, trimmed]);
    setVendor(trimmed);
    setAddingNew(false);
    setNewVendor("");
  };

  const handleSubmit = () => {
    const effectiveVendor = addingNew ? newVendor.trim() : vendor;
    if (!effectiveVendor) { toast.error("Select or enter a vendor."); return; }
    const cost = parseFloat(expenseCost);
    if (!expenseCost || isNaN(cost) || cost <= 0) { toast.error("Enter a valid expense cost."); return; }
    const finalVendor = addingNew ? newVendor.trim() : effectiveVendor;
    if (addingNew && finalVendor) {
      setVendorList((prev) => (prev.includes(finalVendor) ? prev : [...prev, finalVendor]));
    }
    onSubmit({ accountsHeadId, vendor: finalVendor, expenseCost: cost });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <div className="text-sm font-semibold">Send to Accounts</div>
            <div className="font-mono text-xs text-muted-foreground mt-0.5">{entry.id}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {/* Read-only summary of previously filled data */}
          <div className="bg-muted/40 rounded-md border border-border p-4 grid grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Log ID</p>
              <p className="text-sm font-mono font-medium">{entry.id}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Asset</p>
              <p className="text-sm font-medium">{entry.assetName}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Work Type</p>
              <p className="text-sm">{entry.workType}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Service Date</p>
              <p className="text-sm tabular-nums">{entry.serviceDate}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Next Due</p>
              <p className="text-sm tabular-nums">{entry.nextDue}</p>
            </div>
            {entry.notes && (
              <div className="col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Notes</p>
                <p className="text-sm text-muted-foreground">{entry.notes}</p>
              </div>
            )}
          </div>

          {/* System-generated Accounts Head ID */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Accounts Head ID</Label>
            <Input value={accountsHeadId} disabled className="mt-1 font-mono bg-muted/30" />
          </div>

          {/* Vendor selection with Add New */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Vendor *</Label>
            <select
              value={addingNew ? "__add_new__" : vendor}
              onChange={(e) => handleVendorChange(e.target.value)}
              className={selectCls}
            >
              <option value="">Select vendor…</option>
              {vendorList.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
              <option value="__add_new__">+ Add New Vendor</option>
            </select>
            {addingNew && (
              <div className="flex gap-2 mt-2">
                <Input
                  value={newVendor}
                  onChange={(e) => setNewVendor(e.target.value)}
                  placeholder="Enter new vendor name"
                  className="flex-1"
                  onKeyDown={(e) => e.key === "Enter" && handleAddNewVendor()}
                />
                <Button size="sm" variant="outline" onClick={handleAddNewVendor}>Add</Button>
                <Button size="sm" variant="ghost" onClick={() => { setAddingNew(false); setNewVendor(""); }}>Cancel</Button>
              </div>
            )}
          </div>

          {/* Expense Cost */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Expense Cost (৳) *</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={expenseCost}
              onChange={(e) => setExpenseCost(e.target.value)}
              placeholder="0.00"
              className="mt-1 tabular-nums"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit}>
              <Send className="h-4 w-4 mr-1.5" /> Send to Accounts
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MaintenanceCreate({
  nextLogId, assets, onSave,
}: {
  nextLogId: string;
  assets: EquipmentAsset[];
  onSave: (e: WfMaintenanceApproval) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const sixMonthsOut = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);

  const [assetId, setAssetId] = useState("");
  const [serviceDate, setServiceDate] = useState(today);
  const [nextDue, setNextDue] = useState(sixMonthsOut);
  const [workType, setWorkType] = useState<WfMaintenanceApproval["workType"]>("Routine");
  const [notes, setNotes] = useState("");

  const selectedAsset = assets.find((a) => a.id === assetId);

  const save = () => {
    if (!selectedAsset) { toast.error("Select an asset."); return; }
    onSave({
      id: nextLogId,
      assetId: selectedAsset.id,
      assetName: selectedAsset.name,
      serviceDate,
      nextDue,
      workType,
      notes: notes.trim() || undefined,
      submittedAt: today,
      status: "Logged",
    });
    toast.success(`Service logged for ${selectedAsset.name}. Next due ${nextDue}.`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Log Maintenance Event</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save Log</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Log ID</Label>
            <Input value={nextLogId} disabled className="mt-1 font-mono" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Asset *</Label>
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={selectCls}>
              <option value="">Select asset…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.id}) · {a.location}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Service Date</Label>
            <Input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Next Maintenance</Label>
            <Input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Work Type</Label>
            <select value={workType} onChange={(e) => setWorkType(e.target.value as WfMaintenanceApproval["workType"])} className={selectCls}>
              {WORK_TYPES.map((w) => <option key={w}>{w}</option>)}
            </select>
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1"
              placeholder="Parts replaced, observations, follow-up items…"
            />
          </div>
        </div>
        <div className="mt-4 text-[11px] text-muted-foreground bg-muted/40 border border-border rounded px-3 py-2">
          Saving updates the asset's Last and Next maintenance dates. If the asset was "In Maintenance", it moves back to "In Service".
        </div>
      </CardContent>
    </Card>
  );
}
