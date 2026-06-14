import { useState, useMemo } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KpiCard } from "@/components/common/KpiCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { BadgeCheck, Clock, CheckCircle2, AlertTriangle, ShoppingCart, Wrench, Eye, X } from "lucide-react";
import { toast } from "sonner";
import { useWorkflow, type WfPurchaseOrder, type WfMaintenanceApproval } from "@/lib/workflow-store";

type InvStatus = "Pending" | "Approved" | "Paid" | "Rejected";

interface Invoice {
  id: string;
  vendor: string;
  poRef: string;
  flight: string;
  amount: number;
  submittedBy: string;
  date: string;
  dueDate: string;
  paymentMethod: string;
  status: InvStatus;
}

const INITIAL_INVOICES: Invoice[] = [
  { id: "INV-1041", vendor: "Fresh Farms Ltd", poRef: "PO-2025-0451", flight: "BS-315", amount: 24500, submittedBy: "S. Ahmed", date: "2025-11-05", dueDate: "2025-11-20", paymentMethod: "Bank Transfer", status: "Paid" },
  { id: "INV-1042", vendor: "Premium Supplies Co", poRef: "PO-2025-0452", flight: "BS-316", amount: 30000, submittedBy: "M. Karim", date: "2025-11-05", dueDate: "2025-11-20", paymentMethod: "Bank Transfer", status: "Approved" },
  { id: "INV-1043", vendor: "AlRahman Trading", poRef: "PO-2025-0450", flight: "BS-307", amount: 18400, submittedBy: "N. Hasan", date: "2025-11-06", dueDate: "2025-11-21", paymentMethod: "Cheque", status: "Pending" },
  { id: "INV-1044", vendor: "Metro Wholesale", poRef: "PO-2025-0449", flight: "BS-203", amount: 45200, submittedBy: "A. Khan", date: "2025-11-06", dueDate: "2025-11-21", paymentMethod: "Bank Transfer", status: "Pending" },
  { id: "INV-1045", vendor: "Halal Meats Co.", poRef: "PO-2025-0448", flight: "BS-141", amount: 22800, submittedBy: "S. Ahmed", date: "2025-11-07", dueDate: "2025-11-22", paymentMethod: "Cheque", status: "Rejected" },
  { id: "INV-1046", vendor: "Fresh Farms Ltd", poRef: "PO-2025-0447", flight: "BS-225", amount: 16900, submittedBy: "M. Karim", date: "2025-11-07", dueDate: "2025-11-22", paymentMethod: "Bank Transfer", status: "Paid" },
];

function statusColor(status: string) {
  switch (status) {
    case "Pending": return "bg-amber-100 text-amber-800";
    case "Approved": return "bg-blue-100 text-blue-800";
    case "Paid": return "bg-green-100 text-green-800";
    case "Rejected": return "bg-red-100 text-red-800";
    default: return "bg-gray-100 text-gray-800";
  }
}

const TABLE_HEADERS = ["Invoice #", "Vendor", "PO Ref", "Flight", "Amount (৳)", "Due Date", "Submitted By", "Status", "Actions"];

function InvoiceRow({ inv, actions }: { inv: Invoice; actions: React.ReactNode }) {
  return (
    <tr className="border-b hover:bg-muted/30">
      <td className="p-3 font-medium">{inv.id}</td>
      <td className="p-3">{inv.vendor}</td>
      <td className="p-3 text-muted-foreground">{inv.poRef}</td>
      <td className="p-3">{inv.flight}</td>
      <td className="p-3 font-medium">৳{inv.amount.toLocaleString()}</td>
      <td className="p-3 text-muted-foreground">{inv.dueDate}</td>
      <td className="p-3">{inv.submittedBy}</td>
      <td className="p-3">
        <span className={`px-2 py-1 rounded text-xs font-medium ${statusColor(inv.status)}`}>{inv.status}</span>
      </td>
      <td className="p-3">{actions}</td>
    </tr>
  );
}

function TableHead() {
  return (
    <thead>
      <tr className="border-b bg-muted/50">
        {TABLE_HEADERS.map(h => (
          <th key={h} className="p-3 text-left font-semibold text-sm">{h}</th>
        ))}
      </tr>
    </thead>
  );
}

export default function PaymentApprovals() {
  const wf = useWorkflow();
  const { wfPurchaseOrders, updatePOStatus, updateRequisitionStatus, maintenanceApprovals, updateMaintenanceApproval } = wf;

  const [invoices, setInvoices] = usePersistedState<Invoice[]>("accounts-approvals-invoices", INITIAL_INVOICES);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // PO rejection dialog
  const [poRejectOpen, setPoRejectOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<WfPurchaseOrder | null>(null);
  const [poRejectReason, setPoRejectReason] = useState("");

  // Maintenance payment dialogs
  const [mntViewOpen, setMntViewOpen] = useState(false);
  const [mntViewEntry, setMntViewEntry] = useState<WfMaintenanceApproval | null>(null);
  const [mntRejectOpen, setMntRejectOpen] = useState(false);
  const [mntRejectEntry, setMntRejectEntry] = useState<WfMaintenanceApproval | null>(null);
  const [mntRejectReason, setMntRejectReason] = useState("");

  const pendingPOs = useMemo(
    () => wfPurchaseOrders.filter(p => p.status === "Pending Approval"),
    [wfPurchaseOrders]
  );

  const maintenancePaymentEntries = useMemo(
    () => maintenanceApprovals.filter(e =>
      e.status === "Sent to Accounts" || e.status === "Payment Approved" || e.status === "Payment Rejected"
    ),
    [maintenanceApprovals]
  );

  const approveMnt = (entry: WfMaintenanceApproval) => {
    updateMaintenanceApproval(entry.id, {
      status: "Payment Approved",
      paymentApprovedBy: "R. Hossain (Accounts)",
      paymentApprovedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    });
    toast.success(`${entry.id} — Payment Approved.`);
  };

  const openMntReject = (entry: WfMaintenanceApproval) => {
    setMntRejectEntry(entry);
    setMntRejectReason("");
    setMntRejectOpen(true);
  };

  const confirmMntReject = () => {
    if (!mntRejectEntry) return;
    if (!mntRejectReason.trim()) { toast.error("Provide a justification for rejection."); return; }
    updateMaintenanceApproval(mntRejectEntry.id, {
      status: "Payment Rejected",
      paymentRejectedBy: "R. Hossain (Accounts)",
      paymentRejectedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
      paymentRejectionReason: mntRejectReason.trim(),
    });
    toast.success(`${mntRejectEntry.id} — Payment Rejected.`);
    setMntRejectOpen(false);
    setMntRejectEntry(null);
    setMntRejectReason("");
  };

  const approvePO = (po: WfPurchaseOrder) => {
    updatePOStatus(po.id, "Issued to Vendor", { issuedToVendor: true });
    if (po.requisitionRef) updateRequisitionStatus(po.requisitionRef, "Approved");
    toast.success(`PO ${po.id} approved and marked as Issued to Vendor.`);
  };

  const openPOReject = (po: WfPurchaseOrder) => {
    setSelectedPO(po); setPoRejectOpen(true); setPoRejectReason("");
  };

  const confirmPOReject = () => {
    if (!selectedPO) return;
    updatePOStatus(selectedPO.id, "Rejected", { rejectionReason: poRejectReason });
    toast.success(`PO ${selectedPO.id} rejected. Supply Chain has been notified.`);
    setPoRejectOpen(false); setSelectedPO(null); setPoRejectReason("");
  };

  const pending = useMemo(() => invoices.filter(i => i.status === "Pending"), [invoices]);
  const approved = useMemo(() => invoices.filter(i => i.status === "Approved"), [invoices]);
  const paid = useMemo(() => invoices.filter(i => i.status === "Paid"), [invoices]);
  const rejected = useMemo(() => invoices.filter(i => i.status === "Rejected"), [invoices]);

  const pendingAmount = pending.reduce((s, i) => s + i.amount, 0);
  const approvedAmount = approved.reduce((s, i) => s + i.amount, 0);
  const paidAmount = paid.reduce((s, i) => s + i.amount, 0);

  const approve = (inv: Invoice) => {
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: "Approved" } : i));
    toast.success(`Invoice ${inv.id} approved`);
  };

  const markPaid = (inv: Invoice) => {
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: "Paid" } : i));
    toast.success(`Invoice ${inv.id} marked as paid`);
  };

  const openReject = (inv: Invoice) => { setSelected(inv); setRejectOpen(true); setRejectReason(""); };

  const confirmReject = () => {
    if (!selected) return;
    setInvoices(prev => prev.map(i => i.id === selected.id ? { ...i, status: "Rejected" } : i));
    toast.success(`Invoice ${selected.id} rejected`);
    setRejectOpen(false); setSelected(null); setRejectReason("");
  };

  return (
    <>
      <PageHeader
        title="Payment Approvals"
        subtitle="Review and authorize vendor payment requests — manage the payment approval workflow"
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Awaiting Approval"
          value={pending.length}
          sub={`৳${pendingAmount.toLocaleString()} pending`}
          icon={Clock}
          tone="warning"
        />
        <KpiCard
          label="Approved — Pending Payment"
          value={approved.length}
          sub={`৳${approvedAmount.toLocaleString()} to pay`}
          icon={BadgeCheck}
          tone="navy"
        />
        <KpiCard
          label="Paid This Period"
          value={paid.length}
          sub={`৳${paidAmount.toLocaleString()} settled`}
          icon={CheckCircle2}
          tone="success"
        />
        <KpiCard
          label="Rejected"
          value={rejected.length}
          icon={AlertTriangle}
          tone="red"
        />
      </div>

      {/* Maintenance Payment Approvals */}
      {maintenancePaymentEntries.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Wrench className="h-4 w-4 text-blue-500" />
              Maintenance Payment Approvals
              <span className="ml-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                {maintenancePaymentEntries.length} item{maintenancePaymentEntries.length !== 1 ? "s" : ""}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {["MNT ID", "Asset", "Accounts Head ID", "Vendor", "Expense Cost (৳)", "Status", "Actions"].map(h => (
                      <th key={h} className="p-3 text-left font-semibold text-sm">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {maintenancePaymentEntries.map(entry => (
                    <tr key={entry.id} className="border-b hover:bg-muted/30">
                      <td className="p-3 font-mono font-medium text-xs">{entry.id}</td>
                      <td className="p-3">{entry.assetName}</td>
                      <td className="p-3 font-mono text-xs text-muted-foreground">{entry.accountsHeadId ?? "—"}</td>
                      <td className="p-3">{entry.vendor ?? "—"}</td>
                      <td className="p-3 font-medium">
                        {entry.expenseCost !== undefined ? `৳${entry.expenseCost.toLocaleString()}` : "—"}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${statusColor(
                          entry.status === "Payment Approved" ? "Approved"
                          : entry.status === "Payment Rejected" ? "Rejected"
                          : "Pending"
                        )}`}>
                          {entry.status}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => { setMntViewEntry(entry); setMntViewOpen(true); }}
                          >
                            <Eye className="h-3 w-3" /> View
                          </Button>
                          {entry.status === "Sent to Accounts" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-success border-success/40 hover:bg-success/10"
                                onClick={() => approveMnt(entry)}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                                onClick={() => openMntReject(entry)}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Purchase Orders Pending Approval */}
      {pendingPOs.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-amber-500" />
              Purchase Orders Awaiting Approval
              <span className="ml-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                {pendingPOs.length} PO{pendingPOs.length !== 1 ? "s" : ""}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {["PO #", "Vendor", "Req Ref", "Amount (৳)", "Date", "Status", "Actions"].map(h => (
                      <th key={h} className="p-3 text-left font-semibold text-sm">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pendingPOs.map(po => (
                    <tr key={po.id} className="border-b hover:bg-muted/30">
                      <td className="p-3 font-medium">{po.id}</td>
                      <td className="p-3">{po.vendor}</td>
                      <td className="p-3 text-muted-foreground">{po.requisitionRef || "—"}</td>
                      <td className="p-3 font-medium">{po.amount > 0 ? `৳${po.amount.toLocaleString()}` : "—"}</td>
                      <td className="p-3 text-muted-foreground">{po.date}</td>
                      <td className="p-3"><StatusBadge status={po.status} /></td>
                      <td className="p-3">
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" className="text-success border-success/40 hover:bg-success/10" onClick={() => approvePO(po)}>
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => openPOReject(po)}>
                            Reject
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Approval Queue */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-500" />
            Awaiting Approval
            {pending.length > 0 && (
              <span className="ml-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                {pending.length} invoice{pending.length !== 1 ? "s" : ""}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pending.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No invoices awaiting approval</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <TableHead />
                <tbody>
                  {pending.map(inv => (
                    <InvoiceRow key={inv.id} inv={inv} actions={
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-success border-success/40 hover:bg-success/10"
                          onClick={() => approve(inv)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive/40 hover:bg-destructive/10"
                          onClick={() => openReject(inv)}
                        >
                          Reject
                        </Button>
                      </div>
                    } />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approved — Awaiting Payment */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-blue-500" />
            Approved — Awaiting Payment
            {approved.length > 0 && (
              <span className="ml-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                {approved.length} invoice{approved.length !== 1 ? "s" : ""}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {approved.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No approved invoices awaiting payment</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <TableHead />
                <tbody>
                  {approved.map(inv => (
                    <InvoiceRow key={inv.id} inv={inv} actions={
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-primary border-primary/40 hover:bg-primary/10"
                        onClick={() => markPaid(inv)}
                      >
                        Mark Paid
                      </Button>
                    } />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Maintenance View Dialog */}
      <Dialog open={mntViewOpen} onOpenChange={(v) => { if (!v) setMntViewOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-primary" />
              {mntViewEntry?.id} — Payment Detail
            </DialogTitle>
          </DialogHeader>
          {mntViewEntry && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Asset</p>
                <p className="font-medium">{mntViewEntry.assetName}</p>
                <p className="font-mono text-[10px] text-muted-foreground">{mntViewEntry.assetId}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Work Type</p>
                <p>{mntViewEntry.workType}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Service Date</p>
                <p className="tabular-nums">{mntViewEntry.serviceDate}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Next Due</p>
                <p className="tabular-nums">{mntViewEntry.nextDue}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Accounts Head ID</p>
                <p className="font-mono">{mntViewEntry.accountsHeadId ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Vendor</p>
                <p>{mntViewEntry.vendor ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Expense Cost</p>
                <p className="font-semibold tabular-nums text-primary">
                  {mntViewEntry.expenseCost !== undefined ? `৳ ${mntViewEntry.expenseCost.toLocaleString()}` : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Sent to Accounts</p>
                <p className="tabular-nums">{mntViewEntry.sentToAccountsAt ?? "—"}</p>
              </div>
              {mntViewEntry.notes && (
                <div className="col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Notes</p>
                  <p className="text-muted-foreground bg-muted/40 rounded px-3 py-2 border border-border">{mntViewEntry.notes}</p>
                </div>
              )}
              {mntViewEntry.paymentRejectionReason && (
                <div className="col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5 text-destructive">Rejection Justification</p>
                  <p className="text-destructive bg-destructive/5 rounded px-3 py-2 border border-destructive/20">{mntViewEntry.paymentRejectionReason}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMntViewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Maintenance Payment Reject Dialog */}
      <Dialog open={mntRejectOpen} onOpenChange={(v) => { if (!v) { setMntRejectOpen(false); setMntRejectEntry(null); setMntRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <X className="h-4 w-4 text-destructive" />
              Reject Payment — {mntRejectEntry?.id}
            </DialogTitle>
          </DialogHeader>
          {mntRejectEntry && (
            <div className="text-sm text-muted-foreground mb-2">
              <span className="font-medium text-foreground">{mntRejectEntry.assetName}</span>
              {mntRejectEntry.expenseCost !== undefined && ` · ৳${mntRejectEntry.expenseCost.toLocaleString()}`}
              {mntRejectEntry.vendor && ` · ${mntRejectEntry.vendor}`}
            </div>
          )}
          <div>
            <Label>Justification *</Label>
            <Textarea
              value={mntRejectReason}
              onChange={e => setMntRejectReason(e.target.value)}
              placeholder="Provide a justification for rejecting this payment"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMntRejectOpen(false); setMntRejectEntry(null); setMntRejectReason(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={confirmMntReject} disabled={!mntRejectReason.trim()}>Confirm Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO Reject Dialog */}
      <Dialog open={poRejectOpen} onOpenChange={setPoRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject PO — {selectedPO?.id}</DialogTitle></DialogHeader>
          {selectedPO && (
            <div className="text-sm text-muted-foreground mb-2">
              <span className="font-medium text-foreground">{selectedPO.vendor}</span>
              {selectedPO.amount > 0 && ` · ৳${selectedPO.amount.toLocaleString()}`}
              {selectedPO.requisitionRef && ` · Req: ${selectedPO.requisitionRef}`}
            </div>
          )}
          <div>
            <Label>Rejection Reason *</Label>
            <Textarea value={poRejectReason} onChange={e => setPoRejectReason(e.target.value)} placeholder="Provide a reason for rejection" rows={4} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPoRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmPOReject} disabled={!poRejectReason.trim()}>Confirm Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Invoice — {selected?.id}</DialogTitle></DialogHeader>
          {selected && (
            <div className="text-sm text-muted-foreground mb-2">
              <span className="font-medium text-foreground">{selected.vendor}</span> · ৳{selected.amount.toLocaleString()} · {selected.poRef}
            </div>
          )}
          <div>
            <Label>Rejection Reason *</Label>
            <Textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Provide a reason for rejection"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmReject} disabled={!rejectReason.trim()}>Confirm Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
