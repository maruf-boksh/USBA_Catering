import { useState, useMemo } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KpiCard } from "@/components/common/KpiCard";
import { Plus, Download, ChevronUp, ChevronDown, Receipt, Clock, CheckCircle2, Banknote } from "lucide-react";
import { toast } from "sonner";

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
  notes?: string;
}

const VENDOR_LIST = [
  "Fresh Farms Ltd", "Premium Supplies Co", "Metro Wholesale",
  "AlRahman Trading", "Halal Meats Co.", "Aqua Pure BD", "Other",
];
const PO_LIST = [
  "PO-2025-0451", "PO-2025-0452", "PO-2025-0449",
  "PO-2025-0448", "PO-2025-0447", "PO-2025-0446",
];
const PAYMENT_METHODS = ["Bank Transfer", "Cheque", "Cash"];

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

const COLS: { key: keyof Invoice; label: string }[] = [
  { key: "id", label: "Invoice #" },
  { key: "vendor", label: "Vendor" },
  { key: "poRef", label: "PO Ref" },
  { key: "flight", label: "Flight" },
  { key: "amount", label: "Amount (৳)" },
  { key: "paymentMethod", label: "Method" },
  { key: "submittedBy", label: "Submitted By" },
  { key: "date", label: "Date" },
  { key: "dueDate", label: "Due Date" },
  { key: "status", label: "Status" },
];

export default function InvoicesPayments() {
  const [invoices, setInvoices] = usePersistedState<Invoice[]>("accounts-invoices", INITIAL_INVOICES);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<keyof Invoice>("date");
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [nextNum, setNextNum] = useState(1047);

  const [fVendor, setFVendor] = useState("");
  const [fPO, setFPO] = useState("");
  const [fFlight, setFFlight] = useState("");
  const [fDate, setFDate] = useState(new Date().toISOString().split("T")[0]);
  const [fDueDate, setFDueDate] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fMethod, setFMethod] = useState("Bank Transfer");
  const [fSubmittedBy, setFSubmittedBy] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fErrors, setFErrors] = useState<Record<string, string>>({});

  const PER_PAGE = 8;

  const filtered = useMemo(() =>
    invoices
      .filter(inv =>
        inv.id.toLowerCase().includes(search.toLowerCase()) ||
        inv.vendor.toLowerCase().includes(search.toLowerCase()) ||
        inv.poRef.toLowerCase().includes(search.toLowerCase()) ||
        inv.status.toLowerCase().includes(search.toLowerCase())
      )
      .sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        if (typeof av === "string") return sortDesc ? (bv as string).localeCompare(av) : av.localeCompare(bv as string);
        return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
      }),
    [invoices, search, sortKey, sortDesc]
  );

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);

  const toggleSort = (k: keyof Invoice) => {
    if (sortKey === k) setSortDesc(d => !d);
    else { setSortKey(k); setSortDesc(true); }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!fVendor) e.vendor = "Required";
    if (!fPO) e.po = "Required";
    if (!fFlight.trim()) e.flight = "Required";
    if (!fAmount || parseFloat(fAmount) <= 0) e.amount = "Must be > 0";
    if (!fSubmittedBy.trim()) e.submittedBy = "Required";
    setFErrors(e);
    return !Object.keys(e).length;
  };

  const handleCreate = () => {
    if (!validate()) return;
    const inv: Invoice = {
      id: `INV-${String(nextNum).padStart(4, "0")}`,
      vendor: fVendor, poRef: fPO, flight: fFlight,
      amount: parseFloat(fAmount), submittedBy: fSubmittedBy,
      date: fDate, dueDate: fDueDate, paymentMethod: fMethod,
      status: "Pending", notes: fNotes,
    };
    setInvoices(prev => [inv, ...prev]);
    setNextNum(n => n + 1);
    setCreateOpen(false);
    setFVendor(""); setFPO(""); setFFlight(""); setFAmount("");
    setFSubmittedBy(""); setFNotes(""); setFDueDate(""); setFErrors({});
    toast.success("Invoice recorded successfully");
  };

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

  const totalInvoiced = invoices.reduce((s, i) => s + i.amount, 0);
  const totalPaid = invoices.filter(i => i.status === "Paid").reduce((s, i) => s + i.amount, 0);

  return (
    <>
      <PageHeader
        title="Invoices & Payments"
        subtitle="Track and manage all vendor invoices — record, review and mark payments"
        actions={
          <>
            <Button variant="outline" onClick={() => toast.success("Export started.")}>
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-1" /> Record Invoice</Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Record New Invoice</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Invoice #</Label>
                      <Input value={`INV-${String(nextNum).padStart(4, "0")}`} disabled className="bg-muted" />
                    </div>
                    <div>
                      <Label>Vendor *</Label>
                      <Select value={fVendor} onValueChange={setFVendor}>
                        <SelectTrigger className={fErrors.vendor ? "border-red-500" : ""}><SelectValue placeholder="Select vendor" /></SelectTrigger>
                        <SelectContent>{VENDOR_LIST.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                      {fErrors.vendor && <p className="text-red-500 text-xs mt-1">{fErrors.vendor}</p>}
                    </div>
                    <div>
                      <Label>Linked PO *</Label>
                      <Select value={fPO} onValueChange={setFPO}>
                        <SelectTrigger className={fErrors.po ? "border-red-500" : ""}><SelectValue placeholder="Select PO" /></SelectTrigger>
                        <SelectContent>{PO_LIST.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                      </Select>
                      {fErrors.po && <p className="text-red-500 text-xs mt-1">{fErrors.po}</p>}
                    </div>
                    <div>
                      <Label>Flight Ref *</Label>
                      <Input value={fFlight} onChange={e => setFFlight(e.target.value)} placeholder="e.g. BS-315" className={fErrors.flight ? "border-red-500" : ""} />
                      {fErrors.flight && <p className="text-red-500 text-xs mt-1">{fErrors.flight}</p>}
                    </div>
                    <div>
                      <Label>Invoice Date</Label>
                      <Input type="date" value={fDate} onChange={e => setFDate(e.target.value)} />
                    </div>
                    <div>
                      <Label>Due Date</Label>
                      <Input type="date" value={fDueDate} onChange={e => setFDueDate(e.target.value)} />
                    </div>
                    <div>
                      <Label>Amount (৳) *</Label>
                      <Input type="number" value={fAmount} onChange={e => setFAmount(e.target.value)} placeholder="0" className={fErrors.amount ? "border-red-500" : ""} />
                      {fErrors.amount && <p className="text-red-500 text-xs mt-1">{fErrors.amount}</p>}
                    </div>
                    <div>
                      <Label>Payment Method</Label>
                      <Select value={fMethod} onValueChange={setFMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Label>Submitted By *</Label>
                      <Input value={fSubmittedBy} onChange={e => setFSubmittedBy(e.target.value)} placeholder="Your name" className={fErrors.submittedBy ? "border-red-500" : ""} />
                      {fErrors.submittedBy && <p className="text-red-500 text-xs mt-1">{fErrors.submittedBy}</p>}
                    </div>
                    <div className="col-span-2">
                      <Label>Notes</Label>
                      <Textarea value={fNotes} onChange={e => setFNotes(e.target.value)} placeholder="Optional notes" rows={2} />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button onClick={handleCreate}>Record Invoice</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Invoiced" value={`৳${totalInvoiced.toLocaleString()}`} icon={Receipt} tone="navy" />
        <KpiCard label="Pending Review" value={invoices.filter(i => i.status === "Pending").length} icon={Clock} tone="warning" />
        <KpiCard label="Approved" value={invoices.filter(i => i.status === "Approved").length} icon={CheckCircle2} tone="navy" />
        <KpiCard label="Total Paid" value={`৳${totalPaid.toLocaleString()}`} icon={Banknote} tone="success" />
      </div>

      <div className="flex gap-3 items-center justify-between flex-wrap mb-4">
        <Input
          placeholder="Search Invoice #, Vendor, PO Ref, Status..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="max-w-sm"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  {COLS.map(col => (
                    <th key={col.key} className="p-3 text-left font-semibold cursor-pointer hover:bg-muted" onClick={() => toggleSort(col.key)}>
                      <div className="flex items-center gap-1">
                        {col.label}
                        {sortKey === col.key && (sortDesc ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />)}
                      </div>
                    </th>
                  ))}
                  <th className="p-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">No records found</td></tr>
                ) : paginated.map(inv => (
                  <tr key={inv.id} className="border-b hover:bg-muted/30">
                    <td className="p-3 font-medium">{inv.id}</td>
                    <td className="p-3">{inv.vendor}</td>
                    <td className="p-3 text-muted-foreground">{inv.poRef}</td>
                    <td className="p-3">{inv.flight}</td>
                    <td className="p-3 font-medium">৳{inv.amount.toLocaleString()}</td>
                    <td className="p-3 text-muted-foreground">{inv.paymentMethod}</td>
                    <td className="p-3">{inv.submittedBy}</td>
                    <td className="p-3 text-muted-foreground">{inv.date}</td>
                    <td className="p-3 text-muted-foreground">{inv.dueDate || "—"}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${statusColor(inv.status)}`}>{inv.status}</span>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1.5 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => { setSelected(inv); setViewOpen(true); }}>View</Button>
                        {inv.status === "Pending" && <>
                          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => approve(inv)}>Approve</Button>
                          <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={() => openReject(inv)}>Reject</Button>
                        </>}
                        {inv.status === "Approved" && (
                          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => markPaid(inv)}>Mark Paid</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {filtered.length === 0 ? 0 : (page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page === totalPages || filtered.length === 0} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* View Detail Dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invoice Details — {selected?.id}</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-2.5 text-sm">
              {(
                [
                  ["Vendor", selected.vendor],
                  ["Linked PO", selected.poRef],
                  ["Flight Reference", selected.flight],
                  ["Amount", `৳${selected.amount.toLocaleString()}`],
                  ["Payment Method", selected.paymentMethod],
                  ["Invoice Date", selected.date],
                  ["Due Date", selected.dueDate || "—"],
                  ["Submitted By", selected.submittedBy],
                  ["Notes", selected.notes || "—"],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label} className="flex gap-2">
                  <span className="font-semibold w-36 shrink-0">{label}:</span>
                  <span className="text-muted-foreground">{value}</span>
                </div>
              ))}
              <div className="flex gap-2 items-center">
                <span className="font-semibold w-36 shrink-0">Status:</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(selected.status)}`}>{selected.status}</span>
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={() => setViewOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Invoice — {selected?.id}</DialogTitle></DialogHeader>
          <div>
            <Label>Rejection Reason *</Label>
            <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Provide a reason for rejection" rows={4} />
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
