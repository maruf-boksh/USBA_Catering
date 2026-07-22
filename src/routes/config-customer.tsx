import { useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus, ArrowLeft, Save, Users, CheckCircle, XCircle,
  Upload, Download, FileSpreadsheet, CheckCircle2, AlertCircle,
} from "lucide-react";
import { KpiCard } from "@/components/common/KpiCard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { rowEditors } from "@/lib/row-editors";

export type Customer = {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  taxId: string;
  category: string;
  status: "Active" | "Inactive";
};

/** localStorage key (under the shared prefix) for the Customer Profile master. */
export const CUSTOMER_STORE_KEY = "config-customer-rows";

const CATEGORIES = ["Salvage Buyer", "Animal Feed", "Recycler", "Wholesale", "Charity / NGO", "Other"];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export const CUSTOMER_SEED: Customer[] = [
  { id: "CUS-001", code: "GREEN-FARMS", name: "Green Farms",         contactPerson: "A. Rahman",  phone: "+880 1721-100001", email: "buy@greenfarms.bd",   address: "Savar, Dhaka",       taxId: "TIN-100001", category: "Animal Feed",  status: "Active" },
  { id: "CUS-002", code: "ECO-RECYCLE", name: "Eco Recycle Ltd.",    contactPerson: "M. Islam",   phone: "+880 1722-100002", email: "info@ecorecycle.bd",  address: "Gazipur",            taxId: "TIN-100002", category: "Recycler",     status: "Active" },
  { id: "CUS-003", code: "CITY-WHOLE",  name: "City Wholesale",      contactPerson: "S. Karim",   phone: "+880 1723-100003", email: "orders@citywhole.bd", address: "Karwan Bazar, Dhaka", taxId: "TIN-100003", category: "Wholesale",    status: "Active" },
  { id: "CUS-004", code: "HOPE-NGO",    name: "Hope Foundation",     contactPerson: "R. Begum",   phone: "+880 1724-100004", email: "contact@hopengo.bd",  address: "Mirpur, Dhaka",      taxId: "—",          category: "Charity / NGO", status: "Active" },
];

export default function ConfigCustomerPage() {
  const [rows, setRows] = usePersistedState<Customer[]>(CUSTOMER_STORE_KEY, CUSTOMER_SEED);
  const [view, setView] = useState<"list" | "create" | "bulk">("list");

  const toggle = (id: string) =>
    setRows((p) => p.map((r) => (r.id === id ? { ...r, status: r.status === "Active" ? "Inactive" : "Active" } : r)));

  const add = (c: Customer) => { setRows((p) => [c, ...p]); setView("list"); };
  const addBulk = (customers: Customer[]) => { setRows((p) => [...customers, ...p]); setView("list"); };
  const active = rows.filter((r) => r.status === "Active").length;
  const nextSeq = rows.length + 1;

  return (
    <>
      <PageHeader
        title="Customer Profile"
        subtitle="Manage customer / buyer master data — salvage buyers, contacts, tax IDs and categories"
        actions={
          view === "list" ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setView("bulk")}>
                <Upload className="h-4 w-4 mr-1" /> Bulk Upload
              </Button>
              <Button onClick={() => setView("create")}>
                <Plus className="h-4 w-4 mr-1" /> Create Customer
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setView("list")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          )
        }
      />
      {view === "list" && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <KpiCard label="Total Customers" value={rows.length} icon={Users} tone="navy" />
            <KpiCard label="Active" value={active} icon={CheckCircle} tone="success" />
            <KpiCard label="Inactive" value={rows.length - active} icon={XCircle} tone="warning" />
          </div>
          <CustomerList data={rows} onToggle={toggle} editors={rowEditors(setRows)} />
        </>
      )}
      {view === "create" && (
        <CustomerCreate nextId={`CUS-${String(nextSeq).padStart(3, "0")}`} onSave={add} />
      )}
      {view === "bulk" && (
        <CustomerBulkUpload
          nextSeq={nextSeq}
          existingCodes={new Set(rows.map((r) => r.code.toUpperCase()))}
          onImport={addBulk}
          onCancel={() => setView("list")}
        />
      )}
    </>
  );
}

function CustomerList({ data, onToggle, editors }: { data: Customer[]; onToggle: (id: string) => void; editors: { onSave: (u: Record<string, unknown>) => void; onDelete: (u: Record<string, unknown>) => void } }) {
  const cols: Column<Customer>[] = [
    { key: "id", header: "ID" },
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: "name", header: "Customer Name" },
    { key: "category", header: "Category" },
    { key: "contactPerson", header: "Contact" },
    { key: "phone", header: "Phone", className: "text-xs" },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const a = r.status === "Active";
        return (
          <div className="flex items-center gap-2">
            <Switch checked={a} onCheckedChange={() => onToggle(r.id)} />
            <span className={cn("text-xs font-medium", a ? "text-success" : "text-muted-foreground")}>{r.status}</span>
          </div>
        );
      },
    },
  ];
  return (
    <DataTable
      title="customers"
      data={data}
      columns={cols}
      searchKeys={["id", "code", "name", "category", "contactPerson"]}
      selectable={false}
      actions={(r) => (
        <RowActions
          row={r}
          actions={["view", "edit", "print"]}
          onSave={editors.onSave}
          editDetail={({ save, close }) => <CustomerFields mode="edit" initial={r} onSubmit={save} onClose={close} />}
        />
      )}
    />
  );
}

function CustomerCreate({ nextId, onSave }: { nextId: string; onSave: (c: Customer) => void }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <CustomerFields mode="create" nextId={nextId} onSave={onSave} />
      </CardContent>
    </Card>
  );
}

/**
 * Shared Customer form fields. Used by the Create page (mode="create") and the
 * row Edit modal (mode="edit", pre-filled from `initial`) so both share an
 * identical layout.
 */
function CustomerFields({
  mode, nextId, initial, onSave, onSubmit, onClose, embedded,
}: {
  mode: "create" | "edit";
  nextId?: string;
  initial?: Customer;
  onSave?: (c: Customer) => void;
  onSubmit?: (patch: Record<string, unknown>) => void;
  onClose?: () => void;
  embedded?: boolean;
}) {
  const isEdit = mode === "edit";
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? CATEGORIES[0]);
  const [contactPerson, setContactPerson] = useState(initial?.contactPerson ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [taxId, setTaxId] = useState(initial?.taxId ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");

  const save = () => {
    if (!name.trim()) { toast.error("Customer name is required."); return; }
    if (!code.trim()) { toast.error("Customer code is required."); return; }
    const payload = {
      code: code.trim().toUpperCase(), name: name.trim(),
      contactPerson, phone, email, address, taxId, category,
    };
    if (isEdit) {
      onSubmit?.(payload);
      onClose?.();
    } else {
      onSave?.({ id: nextId!, ...payload, status: "Active" });
      toast.success(`Customer "${name.trim()}" created.`);
      if (embedded) onClose?.();
    }
  };

  return (
    <>
      {!isEdit && !embedded && (
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Create Customer</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save</Button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Customer ID</Label>
          <Input value={initial?.id ?? nextId ?? ""} disabled className="mt-1 font-mono" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Customer Code <span className="text-destructive">*</span></Label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1" placeholder="e.g. GREEN-FARMS" />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Customer Name <span className="text-destructive">*</span></Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Category</Label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tax / TIN</Label>
          <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} className="mt-1" placeholder="TIN-XXXXXX" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Contact Person</Label>
          <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" placeholder="+880 1XXX-XXXXXX" />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
        </div>
        <div className="md:col-span-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Address</Label>
          <Textarea value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1" rows={2} />
        </div>
      </div>
      {(isEdit || embedded) && (
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>
            <Save className="h-4 w-4 mr-1.5" /> {isEdit ? "Save Changes" : "Save Customer"}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Reusable "Create Customer" modal — the same CustomerFields form the Customer
 * Profile page uses, wrapped in a Dialog. The caller owns the customer list and
 * appends the created record via onCreate (so it persists under
 * CUSTOMER_STORE_KEY and the caller's own dropdown updates immediately).
 */
export function AddCustomerDialog({
  open, onOpenChange, nextId, onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nextId: string;
  onCreate: (customer: Customer) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" /> Create Customer
          </DialogTitle>
        </DialogHeader>
        <CustomerFields
          mode="create"
          embedded
          nextId={nextId}
          onSave={onCreate}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

// ── Bulk upload ───────────────────────────────────────────────────────────────

type ParsedCustomer = {
  rowNo: number;
  code: string;
  name: string;
  category: string;
  contactPerson: string;
  phone: string;
  email: string;
  taxId: string;
  address: string;
  errors: string[];
};

const TEMPLATE_HEADER = "Code,Name,Category,Contact,Phone,Email,TaxId,Address";
const TEMPLATE_SAMPLE = [
  TEMPLATE_HEADER,
  "GREEN-FARMS,Green Farms,Animal Feed,A. Rahman,+880 1721-100001,buy@greenfarms.bd,TIN-100001,Savar Dhaka",
  "ECO-RECYCLE,Eco Recycle Ltd.,Recycler,M. Islam,+880 1722-100002,info@ecorecycle.bd,TIN-100002,Gazipur",
].join("\n");

function parseCustomerRows(text: string, existingCodes: Set<string>): ParsedCustomer[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const first = lines[0].toLowerCase();
  const startIdx = first.includes("code") && first.includes("name") ? 1 : 0;
  const seen = new Set<string>();
  const validCats = new Set(CATEGORIES.map((c) => c.toLowerCase()));
  return lines.slice(startIdx).map((line, i) => {
    const parts = line.split(/[,\t]/).map((p) => p.trim());
    const [code = "", name = "", category = "", contactPerson = "", phone = "", email = "", taxId = "", address = ""] = parts;
    const errors: string[] = [];
    const codeUpper = code.toUpperCase();
    if (!code) errors.push("Missing code");
    else if (existingCodes.has(codeUpper)) errors.push(`Code "${code}" already exists`);
    else if (seen.has(codeUpper)) errors.push(`Duplicate code "${code}" in file`);
    else seen.add(codeUpper);
    if (!name) errors.push("Missing customer name");
    const resolvedCat = category || CATEGORIES[0];
    if (category && !validCats.has(category.toLowerCase())) errors.push(`Unknown category "${category}"`);
    return {
      rowNo: i + 1, code: codeUpper, name, category: resolvedCat,
      contactPerson, phone, email, taxId, address, errors,
    };
  });
}

function CustomerBulkUpload({
  nextSeq, existingCodes, onImport, onCancel,
}: {
  nextSeq: number;
  existingCodes: Set<string>;
  onImport: (rows: Customer[]) => void;
  onCancel: () => void;
}) {
  const [paste, setPaste] = useState("");
  const parsed = parseCustomerRows(paste, existingCodes);
  const validRows = parsed.filter((r) => r.errors.length === 0);
  const invalidRows = parsed.filter((r) => r.errors.length > 0);

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_SAMPLE], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "customer-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setPaste(await file.text());
  };

  const handleImport = () => {
    if (validRows.length === 0) { toast.error("No valid rows to import."); return; }
    const customers: Customer[] = validRows.map((r, i) => ({
      id: `CUS-${String(nextSeq + i).padStart(3, "0")}`,
      code: r.code,
      name: r.name,
      contactPerson: r.contactPerson,
      phone: r.phone,
      email: r.email,
      address: r.address,
      taxId: r.taxId,
      category: r.category,
      status: "Active",
    }));
    onImport(customers);
    toast.success(`Imported ${customers.length} customer${customers.length === 1 ? "" : "s"}.${invalidRows.length ? ` ${invalidRows.length} row(s) skipped.` : ""}`);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider">Bulk Upload Customers</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Paste rows from a spreadsheet or upload a CSV file. Header row is optional.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-1.5" /> Template CSV
              </Button>
              <Button variant="outline" onClick={onCancel}>Cancel</Button>
              <Button onClick={handleImport} disabled={validRows.length === 0}>
                <Save className="h-4 w-4 mr-1.5" />
                Import {validRows.length > 0 ? `${validRows.length} Row${validRows.length === 1 ? "" : "s"}` : ""}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Paste CSV / TSV</Label>
              <p className="text-[11px] text-muted-foreground font-mono mt-0.5 mb-1.5">
                Code, Name, Category, Contact, Phone, Email, TaxId, Address
              </p>
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                rows={12}
                placeholder={`GREEN-FARMS, Green Farms, Animal Feed, A. Rahman, +880 1721-100001, buy@greenfarms.bd, TIN-100001, Savar Dhaka\nECO-RECYCLE, Eco Recycle Ltd., Recycler, M. Islam, +880 1722-100002, info@ecorecycle.bd, TIN-100002, Gazipur`}
                className="w-full text-xs font-mono rounded-md border border-input bg-background px-3 py-2 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="mt-3 flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer text-primary hover:underline">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Upload .csv file
                  <input
                    type="file"
                    accept=".csv,.txt,text/csv"
                    className="hidden"
                    onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {paste && (
                  <button type="button" onClick={() => setPaste("")} className="text-xs text-muted-foreground hover:text-foreground">
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Preview</Label>
                <div className="flex items-center gap-2 text-[11px]">
                  {validRows.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 className="h-3 w-3" /> {validRows.length} valid
                    </span>
                  )}
                  {invalidRows.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <AlertCircle className="h-3 w-3" /> {invalidRows.length} error
                    </span>
                  )}
                </div>
              </div>
              <div className="border border-border rounded-md overflow-hidden max-h-[320px] overflow-y-auto">
                <Table>
                  <TableHeader className="bg-muted/40 sticky top-0">
                    <TableRow>
                      <TableHead className="w-8 text-[10px] uppercase tracking-wider">#</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Code</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Name</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Category</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider w-20">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-8">
                          Paste rows on the left to preview them here.
                        </TableCell>
                      </TableRow>
                    ) : (
                      parsed.map((r) => {
                        const ok = r.errors.length === 0;
                        return (
                          <TableRow key={r.rowNo} className={ok ? "" : "bg-destructive/5"}>
                            <TableCell className="text-xs tabular-nums text-muted-foreground">{r.rowNo}</TableCell>
                            <TableCell className="text-xs font-mono">{r.code || "—"}</TableCell>
                            <TableCell className="text-xs">{r.name || "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{r.category || "—"}</TableCell>
                            <TableCell>
                              {ok ? (
                                <Badge className="bg-success/15 text-success border-success/30 font-medium" variant="outline">
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> OK
                                </Badge>
                              ) : (
                                <Badge
                                  className="bg-destructive/15 text-destructive border-destructive/30 font-medium"
                                  variant="outline"
                                  title={r.errors.join("; ")}
                                >
                                  <AlertCircle className="h-3 w-3 mr-1" /> Error
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
              {invalidRows.length > 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Hover an <span className="text-destructive font-medium">Error</span> badge to see why a row is invalid. Only valid rows are imported.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
