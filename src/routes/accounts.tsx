import { useState, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Download, ChevronUp, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { KpiCard } from "@/components/common/KpiCard";
import { ShoppingCart, Layers, CreditCard, Receipt } from "lucide-react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { getCriticalLmcsForApproval, LMC_APPROVALS_KEY, LMC_CHARGE, type LmcDecision } from "@/routes/lmc";

// Types
interface PurchaseOrder {
  id: string;
  vendor: string;
  flightRef: string;
  itemsCount: number;
  totalAmount: number;
  createdBy: string;
  date: string;
  status: "Draft" | "Pending Approval" | "Approved" | "Rejected" | "Paid";
}

interface BOM {
  id: string;
  linkedPO: string;
  flightNumber: string;
  mealType: string;
  itemsCount: number;
  createdBy: string;
  date: string;
  status: "Draft" | "Generated" | "Approved" | "Rejected";
}

interface Invoice {
  id: string;
  vendor: string;
  poRef: string;
  flight: string;
  amount: number;
  submittedBy: string;
  date: string;
  status: "Pending" | "Approved" | "Paid" | "Rejected";
}

interface AuditLog {
  timestamp: string;
  user: string;
  action: string;
  module: string;
}

interface POItem {
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

interface BOMItem {
  material: string;
  quantity: number;
  unit: string;
  inStore: boolean;
}

// Vendor list
const VENDOR_LIST = [
  "Fresh Farms Ltd",
  "Premium Supplies Co",
  "Metro Wholesale",
  "AlRahman Trading",
  "Other",
];

const MEAL_TYPES = [
  "Vegetarian Continental",
  "Chicken Biryani",
  "Vegan Buddha Bowl",
  "Grilled Fish & Rice",
  "Crew Meal",
  "Special Meal",
];

const UNITS = ["kg", "L", "pcs", "boxes"];
const PAYMENT_METHODS = ["Bank Transfer", "Cheque", "Cash"];

// Initial data
const initialPOs: PurchaseOrder[] = [
  {
    id: "PO-2025-0451",
    vendor: "Fresh Farms Ltd",
    flightRef: "BS-315",
    itemsCount: 3,
    totalAmount: 24500,
    createdBy: "S. Ahmed",
    date: "2025-11-05",
    status: "Approved",
  },
  {
    id: "PO-2025-0452",
    vendor: "Premium Supplies Co",
    flightRef: "BS-316",
    itemsCount: 2,
    totalAmount: 30000,
    createdBy: "M. Karim",
    date: "2025-11-05",
    status: "Pending Approval",
  },
];

const initialBOMs: BOM[] = [
  {
    id: "BOM-006",
    linkedPO: "PO-2025-0451",
    flightNumber: "BS-315",
    mealType: "Chicken Biryani",
    itemsCount: 5,
    createdBy: "S. Ahmed",
    date: "2025-11-05",
    status: "Approved",
  },
  {
    id: "BOM-007",
    linkedPO: "PO-2025-0452",
    flightNumber: "BS-316",
    mealType: "Crew Meal",
    itemsCount: 3,
    createdBy: "M. Karim",
    date: "2025-11-05",
    status: "Generated",
  },
];

const initialInvoices: Invoice[] = [
  {
    id: "INV-1041",
    vendor: "Fresh Farms Ltd",
    poRef: "PO-2025-0451",
    flight: "BS-315",
    amount: 24500,
    submittedBy: "S. Ahmed",
    date: "2025-11-05",
    status: "Approved",
  },
  {
    id: "INV-1042",
    vendor: "Premium Supplies Co",
    poRef: "PO-2025-0452",
    flight: "BS-316",
    amount: 30000,
    submittedBy: "M. Karim",
    date: "2025-11-05",
    status: "Pending",
  },
];

// Utility to get status badge color
function getStatusColor(status: string) {
  switch (status) {
    case "Draft":
    case "Pending":
      return "bg-gray-100 text-gray-800";
    case "Pending Approval":
      return "bg-amber-100 text-amber-800";
    case "Approved":
    case "Generated":
      return "bg-green-100 text-green-800";
    case "Rejected":
      return "bg-red-100 text-red-800";
    case "Paid":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// Purchase Orders Tab
function PurchaseOrdersTab() {
  const [pos, setPos] = useState<PurchaseOrder[]>(initialPOs);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<keyof PurchaseOrder>("date");
  const [sortDesc, setSortDesc] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [auditLog, setAuditLog] = useState<AuditLog[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const [formVendor, setFormVendor] = useState("");
  const [formFlightRef, setFormFlightRef] = useState("");
  const [formPODate, setFormPODate] = useState(new Date().toISOString().split("T")[0]);
  const [formPaymentTerms, setFormPaymentTerms] = useState("Immediate");
  const [formNotes, setFormNotes] = useState("");
  const [formItems, setFormItems] = useState<POItem[]>([{ name: "", quantity: 0, unit: "kg", unitPrice: 0 }]);
  const [formBOMRef, setFormBOMRef] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const itemsPerPage = 5;

  // Filter and sort
  const filtered = useMemo(() => {
    return pos
      .filter((po) =>
        po.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        po.vendor.toLowerCase().includes(searchTerm.toLowerCase()) ||
        po.flightRef.toLowerCase().includes(searchTerm.toLowerCase()) ||
        po.status.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        if (typeof aVal === "string") {
          return sortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
        }
        return sortDesc ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number);
      });
  }, [pos, searchTerm, sortBy, sortDesc]);

  const paginatedPOs = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filtered.length / itemsPerPage);

  const totalAmount = useMemo(() => formItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0), [formItems]);

  const addLogEntry = (action: string) => {
    setAuditLog((prev) => [
      ...prev,
      {
        timestamp: new Date().toLocaleString(),
        user: "Current User",
        action,
        module: "Accounts",
      },
    ]);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formVendor) errors.vendor = "Vendor is required";
    if (!formFlightRef.trim()) errors.flightRef = "Flight Reference is required";
    if (formItems.some((item) => !item.name.trim())) errors.items = "All item names are required";
    if (formItems.some((item) => item.quantity <= 0)) errors.itemsQty = "All quantities must be greater than 0";
    if (formItems.some((item) => item.unitPrice <= 0)) errors.itemsPrice = "All unit prices must be greater than 0";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const createPO = () => {
    if (!validateForm()) return;

    const newPO: PurchaseOrder = {
      id: `PO-2025-${String(parseInt(pos[pos.length - 1]?.id.split("-")[2] || "0450") + 1).padStart(4, "0")}`,
      vendor: formVendor,
      flightRef: formFlightRef,
      itemsCount: formItems.filter((i) => i.name).length,
      totalAmount,
      createdBy: "Current User",
      date: formPODate,
      status: "Draft",
    };

    setPos((prev) => [newPO, ...prev]);
    addLogEntry(`Created PO ${newPO.id}`);
    setCreateModalOpen(false);
    setFormVendor("");
    setFormFlightRef("");
    setFormPODate(new Date().toISOString().split("T")[0]);
    setFormPaymentTerms("Immediate");
    setFormNotes("");
    setFormItems([{ name: "", quantity: 0, unit: "kg", unitPrice: 0 }]);
    setFormBOMRef("");
    setFormErrors({});
    toast.success("PO created successfully");
  };

  const approvePO = (po: PurchaseOrder) => {
    setPos((prev) => prev.map((p) => (p.id === po.id ? { ...p, status: "Approved" } : p)));
    addLogEntry(`Approved PO ${po.id}`);
    toast.success(`PO ${po.id} approved`);
  };

  const openRejectModal = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setRejectModalOpen(true);
    setRejectionReason("");
  };

  const rejectPO = () => {
    if (!selectedPO) return;
    setPos((prev) => prev.map((p) => (p.id === selectedPO.id ? { ...p, status: "Rejected" } : p)));
    addLogEntry(`Rejected PO ${selectedPO.id}: ${rejectionReason}`);
    toast.success(`PO ${selectedPO.id} rejected`);
    setRejectModalOpen(false);
    setRejectionReason("");
    setSelectedPO(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center justify-between flex-wrap">
        <Input
          placeholder="Search PO Number, Vendor, Flight Reference..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
          className="max-w-sm"
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> Create New PO
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New Purchase Order</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Vendor *</Label>
                    <Select value={formVendor} onValueChange={setFormVendor}>
                      <SelectTrigger className={formErrors.vendor ? "border-red-500" : ""}>
                        <SelectValue placeholder="Select vendor" />
                      </SelectTrigger>
                      <SelectContent>
                        {VENDOR_LIST.map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formErrors.vendor && <p className="text-red-500 text-sm mt-1">{formErrors.vendor}</p>}
                  </div>
                  <div>
                    <Label>Flight Reference *</Label>
                    <Input
                      value={formFlightRef}
                      onChange={(e) => setFormFlightRef(e.target.value)}
                      placeholder="e.g. BS-315"
                      className={formErrors.flightRef ? "border-red-500" : ""}
                    />
                    {formErrors.flightRef && <p className="text-red-500 text-sm mt-1">{formErrors.flightRef}</p>}
                  </div>
                  <div>
                    <Label>PO Date</Label>
                    <Input type="date" value={formPODate} onChange={(e) => setFormPODate(e.target.value)} />
                  </div>
                  <div>
                    <Label>Payment Terms</Label>
                    <Select value={formPaymentTerms} onValueChange={setFormPaymentTerms}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Immediate">Immediate</SelectItem>
                        <SelectItem value="Net-15">Net-15</SelectItem>
                        <SelectItem value="Net-30">Net-30</SelectItem>
                        <SelectItem value="Net-45">Net-45</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Notes</Label>
                  <Textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Optional notes"
                    rows={2}
                  />
                </div>

                <div className="border rounded-lg p-4">
                  <h4 className="font-semibold mb-3">Items</h4>
                  <div className="space-y-3">
                    {formItems.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-5 gap-2 items-end">
                        <Input
                          placeholder="Item Name"
                          value={item.name}
                          onChange={(e) => {
                            const newItems = [...formItems];
                            newItems[idx].name = e.target.value;
                            setFormItems(newItems);
                          }}
                        />
                        <Input
                          type="number"
                          placeholder="Qty"
                          value={item.quantity}
                          onChange={(e) => {
                            const newItems = [...formItems];
                            newItems[idx].quantity = parseFloat(e.target.value) || 0;
                            setFormItems(newItems);
                          }}
                        />
                        <Select
                          value={item.unit}
                          onValueChange={(val) => {
                            const newItems = [...formItems];
                            newItems[idx].unit = val;
                            setFormItems(newItems);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {UNITS.map((u) => (
                              <SelectItem key={u} value={u}>
                                {u}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          placeholder="Price ৳"
                          value={item.unitPrice}
                          onChange={(e) => {
                            const newItems = [...formItems];
                            newItems[idx].unitPrice = parseFloat(e.target.value) || 0;
                            setFormItems(newItems);
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setFormItems(formItems.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setFormItems([...formItems, { name: "", quantity: 0, unit: "kg", unitPrice: 0 }])}
                  >
                    + Add Item
                  </Button>
                  <div className="mt-3 pt-3 border-t">
                    <div className="font-semibold">Total Amount: ৳{totalAmount.toLocaleString()}</div>
                  </div>
                </div>

                <div>
                  <Label>BOM Reference (optional)</Label>
                  <Input value={formBOMRef} onChange={(e) => setFormBOMRef(e.target.value)} placeholder="BOM-001" />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateModalOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={createPO}>Create PO</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  {[
                    { key: "id" as const, label: "PO Number" },
                    { key: "vendor" as const, label: "Vendor" },
                    { key: "flightRef" as const, label: "Flight Reference" },
                    { key: "itemsCount" as const, label: "Items Count" },
                    { key: "totalAmount" as const, label: "Total Amount (৳)" },
                    { key: "createdBy" as const, label: "Created By" },
                    { key: "date" as const, label: "Date" },
                    { key: "status" as const, label: "Status" },
                    { label: "Actions" },
                  ].map((col) => (
                    <th
                      key={col.key || "actions"}
                      className="p-3 text-left font-semibold cursor-pointer hover:bg-muted"
                      onClick={() => {
                        if (col.key) {
                          if (sortBy === col.key) {
                            setSortDesc(!sortDesc);
                          } else {
                            setSortBy(col.key);
                            setSortDesc(true);
                          }
                        }
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {col.label || col.key}
                        {col.key && sortBy === col.key && (
                          <span>{sortDesc ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}</span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedPOs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-muted-foreground">
                      No records found
                    </td>
                  </tr>
                ) : (
                  paginatedPOs.map((po) => (
                    <tr key={po.id} className="border-b hover:bg-muted/50">
                      <td className="p-3">{po.id}</td>
                      <td className="p-3">{po.vendor}</td>
                      <td className="p-3">{po.flightRef}</td>
                      <td className="p-3">{po.itemsCount}</td>
                      <td className="p-3">৳{po.totalAmount.toLocaleString()}</td>
                      <td className="p-3">{po.createdBy}</td>
                      <td className="p-3">{po.date}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(po.status)}`}>
                          {po.status}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedPO(po);
                              setViewModalOpen(true);
                            }}
                          >
                            View
                          </Button>
                          {po.status === "Pending Approval" && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => approvePO(po)}>
                                Approve
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openRejectModal(po)}>
                                Reject
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t flex items-center justify-between text-sm">
            <div>
              Showing {filtered.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} to{" "}
              {Math.min(currentPage * itemsPerPage, filtered.length)} of {filtered.length}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === totalPages || filtered.length === 0}
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* View Modal */}
      <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Purchase Order Details</DialogTitle>
          </DialogHeader>
          {selectedPO && (
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-semibold">PO Number:</span> {selectedPO.id}
              </div>
              <div>
                <span className="font-semibold">Vendor:</span> {selectedPO.vendor}
              </div>
              <div>
                <span className="font-semibold">Flight Reference:</span> {selectedPO.flightRef}
              </div>
              <div>
                <span className="font-semibold">Items Count:</span> {selectedPO.itemsCount}
              </div>
              <div>
                <span className="font-semibold">Total Amount:</span> ৳{selectedPO.totalAmount.toLocaleString()}
              </div>
              <div>
                <span className="font-semibold">Created By:</span> {selectedPO.createdBy}
              </div>
              <div>
                <span className="font-semibold">Date:</span> {selectedPO.date}
              </div>
              <div>
                <span className="font-semibold">Status:</span>{" "}
                <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(selectedPO.status)}`}>
                  {selectedPO.status}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setViewModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Modal */}
      <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Purchase Order</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Rejection Reason *</Label>
            <Textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Please provide a reason for rejection"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={rejectPO}>Confirm Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// BOM Tab
function BOMTab() {
  const [boms, setBoms] = useState<BOM[]>(initialBOMs);
  const [pos] = useState<PurchaseOrder[]>(initialPOs);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<keyof BOM>("date");
  const [sortDesc, setSortDesc] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [auditLog, setAuditLog] = useState<AuditLog[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [selectedBOM, setSelectedBOM] = useState<BOM | null>(null);

  const [nextBOMNum, setNextBOMNum] = useState(8);
  const [formLinkedPO, setFormLinkedPO] = useState("");
  const [formFlightNumber, setFormFlightNumber] = useState("");
  const [formMealType, setFormMealType] = useState("");
  const [formProductionDate, setFormProductionDate] = useState(new Date().toISOString().split("T")[0]);
  const [formItems, setFormItems] = useState<BOMItem[]>([{ material: "", quantity: 0, unit: "kg", inStore: false }]);
  const [formNotes, setFormNotes] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const itemsPerPage = 5;

  const filtered = useMemo(() => {
    return boms
      .filter((bom) =>
        bom.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bom.linkedPO.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bom.flightNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bom.status.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        if (typeof aVal === "string") {
          return sortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
        }
        return sortDesc ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number);
      });
  }, [boms, searchTerm, sortBy, sortDesc]);

  const paginatedBOMs = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filtered.length / itemsPerPage);

  const addLogEntry = (action: string) => {
    setAuditLog((prev) => [
      ...prev,
      {
        timestamp: new Date().toLocaleString(),
        user: "Current User",
        action,
        module: "Accounts",
      },
    ]);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formLinkedPO) errors.linkedPO = "Linked PO is required";
    if (!formFlightNumber.trim()) errors.flightNumber = "Flight Number is required";
    if (!formMealType) errors.mealType = "Meal Type is required";
    if (formItems.some((item) => !item.material.trim())) errors.items = "All material names are required";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const generateBOM = () => {
    if (!validateForm()) return;

    const newBOM: BOM = {
      id: `BOM-${String(nextBOMNum).padStart(3, "0")}`,
      linkedPO: formLinkedPO,
      flightNumber: formFlightNumber,
      mealType: formMealType,
      itemsCount: formItems.filter((i) => i.material).length,
      createdBy: "Current User",
      date: formProductionDate,
      status: "Generated",
    };

    setBoms((prev) => [newBOM, ...prev]);
    setNextBOMNum(nextBOMNum + 1);
    addLogEntry(`Generated BOM ${newBOM.id}`);
    setCreateModalOpen(false);
    setFormLinkedPO("");
    setFormFlightNumber("");
    setFormMealType("");
    setFormProductionDate(new Date().toISOString().split("T")[0]);
    setFormItems([{ material: "", quantity: 0, unit: "kg", inStore: false }]);
    setFormNotes("");
    setFormErrors({});
    toast.success("BOM generated successfully");
  };

  const approveBOM = (bom: BOM) => {
    setBoms((prev) => prev.map((b) => (b.id === bom.id ? { ...b, status: "Approved" } : b)));
    addLogEntry(`Approved BOM ${bom.id}`);
    toast.success(`BOM ${bom.id} approved`);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center justify-between flex-wrap">
        <Input
          placeholder="Search BOM Ref, PO, Flight Number..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
          className="max-w-sm"
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> Generate BOM
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Generate Bill of Materials</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>BOM Reference</Label>
                    <Input value={`BOM-${String(nextBOMNum).padStart(3, "0")}`} disabled className="bg-muted" />
                  </div>
                  <div>
                    <Label>Link to PO *</Label>
                    <Select value={formLinkedPO} onValueChange={setFormLinkedPO}>
                      <SelectTrigger className={formErrors.linkedPO ? "border-red-500" : ""}>
                        <SelectValue placeholder="Select PO" />
                      </SelectTrigger>
                      <SelectContent>
                        {pos.map((po) => (
                          <SelectItem key={po.id} value={po.id}>
                            {po.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formErrors.linkedPO && <p className="text-red-500 text-sm mt-1">{formErrors.linkedPO}</p>}
                  </div>
                  <div>
                    <Label>Flight Number *</Label>
                    <Input
                      value={formFlightNumber}
                      onChange={(e) => setFormFlightNumber(e.target.value)}
                      placeholder="e.g. BS-315"
                      className={formErrors.flightNumber ? "border-red-500" : ""}
                    />
                    {formErrors.flightNumber && <p className="text-red-500 text-sm mt-1">{formErrors.flightNumber}</p>}
                  </div>
                  <div>
                    <Label>Meal Type *</Label>
                    <Select value={formMealType} onValueChange={setFormMealType}>
                      <SelectTrigger className={formErrors.mealType ? "border-red-500" : ""}>
                        <SelectValue placeholder="Select meal type" />
                      </SelectTrigger>
                      <SelectContent>
                        {MEAL_TYPES.map((mt) => (
                          <SelectItem key={mt} value={mt}>
                            {mt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formErrors.mealType && <p className="text-red-500 text-sm mt-1">{formErrors.mealType}</p>}
                  </div>
                  <div>
                    <Label>Production Date</Label>
                    <Input type="date" value={formProductionDate} onChange={(e) => setFormProductionDate(e.target.value)} />
                  </div>
                </div>

                <div className="border rounded-lg p-4">
                  <h4 className="font-semibold mb-3">Raw Materials</h4>
                  <div className="space-y-3">
                    {formItems.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-5 gap-2 items-end">
                        <Input
                          placeholder="Material Name"
                          value={item.material}
                          onChange={(e) => {
                            const newItems = [...formItems];
                            newItems[idx].material = e.target.value;
                            setFormItems(newItems);
                          }}
                        />
                        <Input
                          type="number"
                          placeholder="Qty"
                          value={item.quantity}
                          onChange={(e) => {
                            const newItems = [...formItems];
                            newItems[idx].quantity = parseFloat(e.target.value) || 0;
                            setFormItems(newItems);
                          }}
                        />
                        <Select
                          value={item.unit}
                          onValueChange={(val) => {
                            const newItems = [...formItems];
                            newItems[idx].unit = val;
                            setFormItems(newItems);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {UNITS.map((u) => (
                              <SelectItem key={u} value={u}>
                                {u}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={item.inStore}
                            onChange={(e) => {
                              const newItems = [...formItems];
                              newItems[idx].inStore = e.target.checked;
                              setFormItems(newItems);
                            }}
                            className="h-4 w-4"
                          />
                          <span className="text-xs">In Store</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setFormItems(formItems.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setFormItems([...formItems, { material: "", quantity: 0, unit: "kg", inStore: false }])}
                  >
                    + Add Material
                  </Button>
                </div>

                <div>
                  <Label>Notes</Label>
                  <Textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Optional notes"
                    rows={2}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateModalOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={generateBOM}>Generate BOM</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  {[
                    { key: "id" as const, label: "BOM Ref" },
                    { key: "linkedPO" as const, label: "Linked PO" },
                    { key: "flightNumber" as const, label: "Flight Number" },
                    { key: "mealType" as const, label: "Meal Type" },
                    { key: "itemsCount" as const, label: "Items Count" },
                    { key: "createdBy" as const, label: "Created By" },
                    { key: "date" as const, label: "Date" },
                    { key: "status" as const, label: "Status" },
                    { label: "Actions" },
                  ].map((col) => (
                    <th
                      key={col.key || "actions"}
                      className="p-3 text-left font-semibold cursor-pointer hover:bg-muted"
                      onClick={() => {
                        if (col.key) {
                          if (sortBy === col.key) {
                            setSortDesc(!sortDesc);
                          } else {
                            setSortBy(col.key);
                            setSortDesc(true);
                          }
                        }
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {col.label || col.key}
                        {col.key && sortBy === col.key && (
                          <span>{sortDesc ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}</span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedBOMs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-muted-foreground">
                      No records found
                    </td>
                  </tr>
                ) : (
                  paginatedBOMs.map((bom) => (
                    <tr key={bom.id} className="border-b hover:bg-muted/50">
                      <td className="p-3">{bom.id}</td>
                      <td className="p-3">{bom.linkedPO}</td>
                      <td className="p-3">{bom.flightNumber}</td>
                      <td className="p-3">{bom.mealType}</td>
                      <td className="p-3">{bom.itemsCount}</td>
                      <td className="p-3">{bom.createdBy}</td>
                      <td className="p-3">{bom.date}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(bom.status)}`}>
                          {bom.status}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedBOM(bom);
                              setViewModalOpen(true);
                            }}
                          >
                            View
                          </Button>
                          {bom.status === "Generated" && (
                            <Button variant="ghost" size="sm" onClick={() => approveBOM(bom)}>
                              Approve
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t flex items-center justify-between text-sm">
            <div>
              Showing {filtered.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} to{" "}
              {Math.min(currentPage * itemsPerPage, filtered.length)} of {filtered.length}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === totalPages || filtered.length === 0}
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* View Modal */}
      <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>BOM Details</DialogTitle>
          </DialogHeader>
          {selectedBOM && (
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-semibold">BOM Reference:</span> {selectedBOM.id}
              </div>
              <div>
                <span className="font-semibold">Linked PO:</span> {selectedBOM.linkedPO}
              </div>
              <div>
                <span className="font-semibold">Flight Number:</span> {selectedBOM.flightNumber}
              </div>
              <div>
                <span className="font-semibold">Meal Type:</span> {selectedBOM.mealType}
              </div>
              <div>
                <span className="font-semibold">Items Count:</span> {selectedBOM.itemsCount}
              </div>
              <div>
                <span className="font-semibold">Created By:</span> {selectedBOM.createdBy}
              </div>
              <div>
                <span className="font-semibold">Date:</span> {selectedBOM.date}
              </div>
              <div>
                <span className="font-semibold">Status:</span>{" "}
                <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(selectedBOM.status)}`}>
                  {selectedBOM.status}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setViewModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Payments & Approvals Tab
function PaymentsApprovalsTab() {
  const [invoices, setInvoices] = useState<Invoice[]>(initialInvoices);
  const [pos] = useState<PurchaseOrder[]>(initialPOs);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<keyof Invoice>("date");
  const [sortDesc, setSortDesc] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [auditLog, setAuditLog] = useState<AuditLog[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const [nextInvNum, setNextInvNum] = useState(1043);
  const [formVendor, setFormVendor] = useState("");
  const [formLinkedPO, setFormLinkedPO] = useState("");
  const [formFlightRef, setFormFlightRef] = useState("");
  const [formInvoiceDate, setFormInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [formAmount, setFormAmount] = useState("");
  const [formPaymentMethod, setFormPaymentMethod] = useState("Bank Transfer");
  const [formSubmittedBy, setFormSubmittedBy] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const itemsPerPage = 5;

  const filtered = useMemo(() => {
    return invoices
      .filter((inv) =>
        inv.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inv.vendor.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inv.poRef.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inv.status.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        if (typeof aVal === "string") {
          return sortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
        }
        return sortDesc ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number);
      });
  }, [invoices, searchTerm, sortBy, sortDesc]);

  const paginatedInvoices = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(filtered.length / itemsPerPage);

  const addLogEntry = (action: string) => {
    setAuditLog((prev) => [
      ...prev,
      {
        timestamp: new Date().toLocaleString(),
        user: "Current User",
        action,
        module: "Accounts",
      },
    ]);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formVendor) errors.vendor = "Vendor is required";
    if (!formLinkedPO) errors.linkedPO = "Linked PO is required";
    if (!formFlightRef.trim()) errors.flightRef = "Flight Reference is required";
    if (!formAmount || parseFloat(formAmount) <= 0) errors.amount = "Amount must be greater than 0";
    if (!formSubmittedBy.trim()) errors.submittedBy = "Submitted By is required";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const recordPayment = () => {
    if (!validateForm()) return;

    const newInvoice: Invoice = {
      id: `INV-${String(nextInvNum).padStart(4, "0")}`,
      vendor: formVendor,
      poRef: formLinkedPO,
      flight: formFlightRef,
      amount: parseFloat(formAmount),
      submittedBy: formSubmittedBy,
      date: formInvoiceDate,
      status: "Pending",
    };

    setInvoices((prev) => [newInvoice, ...prev]);
    setNextInvNum(nextInvNum + 1);
    addLogEntry(`Submitted Invoice ${newInvoice.id}`);
    setCreateModalOpen(false);
    setFormVendor("");
    setFormLinkedPO("");
    setFormFlightRef("");
    setFormInvoiceDate(new Date().toISOString().split("T")[0]);
    setFormAmount("");
    setFormPaymentMethod("Bank Transfer");
    setFormSubmittedBy("");
    setFormNotes("");
    setFormErrors({});
    toast.success("Invoice submitted successfully");
  };

  const approveInvoice = (inv: Invoice) => {
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, status: "Approved" } : i)));
    addLogEntry(`Approved Invoice ${inv.id}`);
    toast.success(`Invoice ${inv.id} approved`);
  };

  const markPaid = (inv: Invoice) => {
    setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, status: "Paid" } : i)));
    addLogEntry(`Marked Invoice ${inv.id} as Paid`);
    toast.success(`Invoice ${inv.id} marked as paid`);
  };

  const openRejectModal = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setRejectModalOpen(true);
    setRejectionReason("");
  };

  const rejectInvoice = () => {
    if (!selectedInvoice) return;
    setInvoices((prev) => prev.map((i) => (i.id === selectedInvoice.id ? { ...i, status: "Rejected" } : i)));
    addLogEntry(`Rejected Invoice ${selectedInvoice.id}: ${rejectionReason}`);
    toast.success(`Invoice ${selectedInvoice.id} rejected`);
    setRejectModalOpen(false);
    setRejectionReason("");
    setSelectedInvoice(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center justify-between flex-wrap">
        <Input
          placeholder="Search Invoice, Vendor, PO Reference..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
          className="max-w-sm"
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
          <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> Record Payment
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Record Payment</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Invoice Number</Label>
                    <Input value={`INV-${String(nextInvNum).padStart(4, "0")}`} disabled className="bg-muted" />
                  </div>
                  <div>
                    <Label>Vendor *</Label>
                    <Select value={formVendor} onValueChange={setFormVendor}>
                      <SelectTrigger className={formErrors.vendor ? "border-red-500" : ""}>
                        <SelectValue placeholder="Select vendor" />
                      </SelectTrigger>
                      <SelectContent>
                        {VENDOR_LIST.map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formErrors.vendor && <p className="text-red-500 text-sm mt-1">{formErrors.vendor}</p>}
                  </div>
                  <div>
                    <Label>Linked PO *</Label>
                    <Select value={formLinkedPO} onValueChange={setFormLinkedPO}>
                      <SelectTrigger className={formErrors.linkedPO ? "border-red-500" : ""}>
                        <SelectValue placeholder="Select PO" />
                      </SelectTrigger>
                      <SelectContent>
                        {pos.map((po) => (
                          <SelectItem key={po.id} value={po.id}>
                            {po.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formErrors.linkedPO && <p className="text-red-500 text-sm mt-1">{formErrors.linkedPO}</p>}
                  </div>
                  <div>
                    <Label>Flight Reference *</Label>
                    <Input
                      value={formFlightRef}
                      onChange={(e) => setFormFlightRef(e.target.value)}
                      placeholder="e.g. BS-315"
                      className={formErrors.flightRef ? "border-red-500" : ""}
                    />
                    {formErrors.flightRef && <p className="text-red-500 text-sm mt-1">{formErrors.flightRef}</p>}
                  </div>
                  <div>
                    <Label>Invoice Date</Label>
                    <Input type="date" value={formInvoiceDate} onChange={(e) => setFormInvoiceDate(e.target.value)} />
                  </div>
                  <div>
                    <Label>Amount (৳) *</Label>
                    <Input
                      type="number"
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value)}
                      placeholder="0"
                      className={formErrors.amount ? "border-red-500" : ""}
                    />
                    {formErrors.amount && <p className="text-red-500 text-sm mt-1">{formErrors.amount}</p>}
                  </div>
                  <div>
                    <Label>Payment Method</Label>
                    <Select value={formPaymentMethod} onValueChange={setFormPaymentMethod}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Submitted By *</Label>
                    <Input
                      value={formSubmittedBy}
                      onChange={(e) => setFormSubmittedBy(e.target.value)}
                      placeholder="Your name"
                      className={formErrors.submittedBy ? "border-red-500" : ""}
                    />
                    {formErrors.submittedBy && <p className="text-red-500 text-sm mt-1">{formErrors.submittedBy}</p>}
                  </div>
                </div>

                <div>
                  <Label>Notes</Label>
                  <Textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Optional notes"
                    rows={2}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateModalOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={recordPayment}>Submit Invoice</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  {[
                    { key: "id" as const, label: "Invoice No" },
                    { key: "vendor" as const, label: "Vendor" },
                    { key: "poRef" as const, label: "PO Reference" },
                    { key: "flight" as const, label: "Flight" },
                    { key: "amount" as const, label: "Amount (৳)" },
                    { key: "submittedBy" as const, label: "Submitted By" },
                    { key: "date" as const, label: "Date" },
                    { key: "status" as const, label: "Status" },
                    { label: "Actions" },
                  ].map((col) => (
                    <th
                      key={col.key || "actions"}
                      className="p-3 text-left font-semibold cursor-pointer hover:bg-muted"
                      onClick={() => {
                        if (col.key) {
                          if (sortBy === col.key) {
                            setSortDesc(!sortDesc);
                          } else {
                            setSortBy(col.key);
                            setSortDesc(true);
                          }
                        }
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {col.label || col.key}
                        {col.key && sortBy === col.key && (
                          <span>{sortDesc ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}</span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-muted-foreground">
                      No records found
                    </td>
                  </tr>
                ) : (
                  paginatedInvoices.map((inv) => (
                    <tr key={inv.id} className="border-b hover:bg-muted/50">
                      <td className="p-3">{inv.id}</td>
                      <td className="p-3">{inv.vendor}</td>
                      <td className="p-3">{inv.poRef}</td>
                      <td className="p-3">{inv.flight}</td>
                      <td className="p-3">৳{inv.amount.toLocaleString()}</td>
                      <td className="p-3">{inv.submittedBy}</td>
                      <td className="p-3">{inv.date}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(inv.status)}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedInvoice(inv);
                              setViewModalOpen(true);
                            }}
                          >
                            View
                          </Button>
                          {inv.status === "Pending" && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => approveInvoice(inv)}>
                                Approve
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openRejectModal(inv)}>
                                Reject
                              </Button>
                            </>
                          )}
                          {inv.status === "Approved" && (
                            <Button variant="ghost" size="sm" onClick={() => markPaid(inv)}>
                              Mark Paid
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t flex items-center justify-between text-sm">
            <div>
              Showing {filtered.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} to{" "}
              {Math.min(currentPage * itemsPerPage, filtered.length)} of {filtered.length}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === totalPages || filtered.length === 0}
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* View Modal */}
      <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invoice Details</DialogTitle>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-semibold">Invoice Number:</span> {selectedInvoice.id}
              </div>
              <div>
                <span className="font-semibold">Vendor:</span> {selectedInvoice.vendor}
              </div>
              <div>
                <span className="font-semibold">PO Reference:</span> {selectedInvoice.poRef}
              </div>
              <div>
                <span className="font-semibold">Flight:</span> {selectedInvoice.flight}
              </div>
              <div>
                <span className="font-semibold">Amount:</span> ৳{selectedInvoice.amount.toLocaleString()}
              </div>
              <div>
                <span className="font-semibold">Submitted By:</span> {selectedInvoice.submittedBy}
              </div>
              <div>
                <span className="font-semibold">Date:</span> {selectedInvoice.date}
              </div>
              <div>
                <span className="font-semibold">Status:</span>{" "}
                <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(selectedInvoice.status)}`}>
                  {selectedInvoice.status}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setViewModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Modal */}
      <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Invoice</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Rejection Reason *</Label>
            <Textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Please provide a reason for rejection"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={rejectInvoice}>Confirm Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Main Accounts Component
// Approved critical LMCs are billable last-minute changes — a flat LMC_CHARGE
// per change. This surfaces them to Accounts (read-only) once GM-approved.
function LmcChargesTab() {
  const [decisions] = usePersistedState<Record<string, LmcDecision>>(LMC_APPROVALS_KEY, {});
  const charges = useMemo(
    () =>
      getCriticalLmcsForApproval()
        .map((l) => ({ l, d: decisions[l.id] }))
        .filter((x) => x.d?.status === "Approved"),
    [decisions],
  );
  const total = charges.length * LMC_CHARGE;
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                <th className="text-left p-3 text-xs uppercase tracking-wider font-semibold">Approved</th>
                <th className="text-left p-3 text-xs uppercase tracking-wider font-semibold">Flight / Order</th>
                <th className="text-left p-3 text-xs uppercase tracking-wider font-semibold">Change</th>
                <th className="text-left p-3 text-xs uppercase tracking-wider font-semibold">Type</th>
                <th className="text-left p-3 text-xs uppercase tracking-wider font-semibold">Approved By</th>
                <th className="text-right p-3 text-xs uppercase tracking-wider font-semibold">Charge</th>
              </tr>
            </thead>
            <tbody>
              {charges.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-sm text-muted-foreground py-10">No billable last-minute changes yet — a critical LMC becomes chargeable once approved in Approval Management.</td></tr>
              ) : charges.map(({ l, d }) => (
                <tr key={l.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="p-3 tabular-nums text-xs text-muted-foreground whitespace-nowrap">{d?.at}</td>
                  <td className="p-3"><span className="font-semibold">{l.flight}</span> <span className="text-muted-foreground text-xs">· {l.sector} · {l.orderNo}</span></td>
                  <td className="p-3 text-xs tabular-nums">{l.changeText}</td>
                  <td className="p-3 text-xs">{l.typeLabel}</td>
                  <td className="p-3 text-xs">{d?.by}</td>
                  <td className="p-3 text-right tabular-nums font-medium">{LMC_CHARGE.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            {charges.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30">
                  <td colSpan={5} className="p-3 text-right text-xs font-semibold uppercase tracking-wider">Total LMC Charges</td>
                  <td className="p-3 text-right tabular-nums font-bold">{total.toLocaleString()}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Accounts() {
  const [activeTab, setActiveTab] = useState("po");
  const [lmcDecisions] = usePersistedState<Record<string, LmcDecision>>(LMC_APPROVALS_KEY, {});
  const lmcChargeCount = useMemo(
    () => getCriticalLmcsForApproval().filter((l) => lmcDecisions[l.id]?.status === "Approved").length,
    [lmcDecisions],
  );

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Purchase Orders, Bill of Materials, Payments & LMC charges"
        actions={<></>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total POs" value={initialPOs.length} icon={ShoppingCart} tone="navy" />
        <KpiCard label="Total BOMs" value={initialBOMs.length} icon={Layers} tone="success" />
        <KpiCard label="Pending Invoices" value={initialInvoices.filter((i) => i.status === "Pending").length} icon={CreditCard} tone="warning" />
        <KpiCard label="LMC Charges" value={(lmcChargeCount * LMC_CHARGE).toLocaleString()} sub={`${lmcChargeCount} change${lmcChargeCount === 1 ? "" : "s"}`} icon={Receipt} tone="red" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="po">
            <ShoppingCart className="h-4 w-4 mr-1" /> Purchase Orders
          </TabsTrigger>
          <TabsTrigger value="bom">
            <Layers className="h-4 w-4 mr-1" /> BOM
          </TabsTrigger>
          <TabsTrigger value="payments">
            <CreditCard className="h-4 w-4 mr-1" /> Payments & Approvals
          </TabsTrigger>
          <TabsTrigger value="lmc">
            <Receipt className="h-4 w-4 mr-1" /> LMC Charges
          </TabsTrigger>
        </TabsList>

        <TabsContent value="po" className="mt-4">
          <PurchaseOrdersTab />
        </TabsContent>

        <TabsContent value="bom" className="mt-4">
          <BOMTab />
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <PaymentsApprovalsTab />
        </TabsContent>

        <TabsContent value="lmc" className="mt-4">
          <LmcChargesTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
