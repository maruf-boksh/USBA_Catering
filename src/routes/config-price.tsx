import { useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Plus, ArrowLeft, Save, BadgeDollarSign, TrendingUp, Calendar,
  Upload, Download, FileSpreadsheet, CheckCircle2, AlertCircle,
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { KpiCard } from "@/components/common/KpiCard";
import { toast } from "sonner";

type Price = {
  id: string;
  itemCode: string;
  item: string;
  uom: string;
  supplier: string;
  unitPrice: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: "Active" | "Expired" | "Scheduled";
};

const SUPPLIERS = ["Agro Fresh Ltd.", "Meat & Co.", "Dairy Plus", "Packaging BD", "Pure Water Co."];
const ITEMS: { code: string; name: string; uom: string }[] = [
  { code: "RM-RICE-BSMT", name: "Basmati Rice",  uom: "Kg" },
  { code: "RM-CHK-BRST",  name: "Chicken Breast", uom: "Kg" },
  { code: "RM-VEG-TOM",   name: "Tomato",         uom: "Kg" },
  { code: "RM-OIL-CKG",   name: "Cooking Oil",    uom: "Litre" },
  { code: "PK-BOX-MEAL",  name: "Meal Box",       uom: "Piece" },
  { code: "BV-WTR-250",   name: "Mineral Water 250ml", uom: "Bottle" },
];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const SEED: Price[] = [
  { id: "PRC-001", itemCode: "RM-RICE-BSMT", item: "Basmati Rice",   uom: "Kg",     supplier: "Agro Fresh Ltd.", unitPrice: 145.00, currency: "BDT", effectiveFrom: "2026-04-01", effectiveTo: "2026-06-30", status: "Active"    },
  { id: "PRC-002", itemCode: "RM-CHK-BRST",  item: "Chicken Breast",  uom: "Kg",     supplier: "Meat & Co.",      unitPrice: 380.00, currency: "BDT", effectiveFrom: "2026-04-15", effectiveTo: "2026-07-15", status: "Active"    },
  { id: "PRC-003", itemCode: "RM-VEG-TOM",   item: "Tomato",          uom: "Kg",     supplier: "Agro Fresh Ltd.", unitPrice: 65.00,  currency: "BDT", effectiveFrom: "2026-05-01", effectiveTo: "2026-05-31", status: "Active"    },
  { id: "PRC-004", itemCode: "RM-OIL-CKG",   item: "Cooking Oil",     uom: "Litre",  supplier: "Agro Fresh Ltd.", unitPrice: 195.50, currency: "BDT", effectiveFrom: "2026-04-01", effectiveTo: "2026-06-30", status: "Active"    },
  { id: "PRC-005", itemCode: "PK-BOX-MEAL",  item: "Meal Box",        uom: "Piece",  supplier: "Packaging BD",    unitPrice: 18.00,  currency: "BDT", effectiveFrom: "2026-06-01", effectiveTo: "2026-12-31", status: "Scheduled" },
  { id: "PRC-006", itemCode: "BV-WTR-250",   item: "Mineral Water 250ml", uom: "Bottle", supplier: "Pure Water Co.", unitPrice: 12.00, currency: "BDT", effectiveFrom: "2026-01-01", effectiveTo: "2026-03-31", status: "Expired"   },
];

export default function ConfigPricePage() {
  const [rows, setRows] = usePersistedState<Price[]>("config-price-rows", SEED);
  const [view, setView] = useState<"list" | "create" | "bulk">("list");

  const add = (p: Price) => { setRows((prev) => [p, ...prev]); setView("list"); };
  const addBulk = (priceRows: Price[]) => {
    setRows((prev) => [...priceRows, ...prev]);
    setView("list");
  };
  const active = rows.filter((r) => r.status === "Active").length;
  const scheduled = rows.filter((r) => r.status === "Scheduled").length;

  const nextSeq = rows.length + 1;

  return (
    <>
      <PageHeader
        title="Price Setup"
        subtitle="Define supplier-wise item rates and effective date ranges used in PRs and POs"
        actions={
          view === "list" ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setView("bulk")}>
                <Upload className="h-4 w-4 mr-1" /> Bulk Upload
              </Button>
              <Button onClick={() => setView("create")}>
                <Plus className="h-4 w-4 mr-1" /> Create Price
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
            <KpiCard label="Total Prices" value={rows.length} icon={BadgeDollarSign} tone="navy" />
            <KpiCard label="Active" value={active} icon={TrendingUp} tone="success" />
            <KpiCard label="Scheduled" value={scheduled} icon={Calendar} tone="warning" />
          </div>
          <PriceList data={rows} />
        </>
      )}
      {view === "create" && (
        <PriceCreate nextId={`PRC-${String(nextSeq).padStart(3, "0")}`} onSave={add} />
      )}
      {view === "bulk" && (
        <PriceBulkUpload nextSeq={nextSeq} onImport={addBulk} onCancel={() => setView("list")} />
      )}
    </>
  );
}

function PriceList({ data }: { data: Price[] }) {
  const cols: Column<Price>[] = [
    { key: "id", header: "Price #" },
    { key: "itemCode", header: "Item Code", render: (r) => <span className="font-mono text-xs">{r.itemCode}</span> },
    { key: "item", header: "Item" },
    { key: "supplier", header: "Supplier" },
    {
      key: "unitPrice",
      header: "Unit Price",
      className: "text-right",
      render: (r) => (
        <span className="font-semibold tabular-nums">
          {r.currency} {r.unitPrice.toFixed(2)} <span className="text-xs text-muted-foreground font-normal">/ {r.uom}</span>
        </span>
      ),
    },
    {
      key: "effectiveFrom",
      header: "Effective",
      render: (r) => <span className="text-xs text-muted-foreground">{r.effectiveFrom} → {r.effectiveTo}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const cls =
          r.status === "Active" ? "bg-success/15 text-success border-success/30"
          : r.status === "Scheduled" ? "bg-warning/15 text-warning-foreground border-warning/40"
          : "bg-muted text-muted-foreground border-border";
        return <Badge className={`${cls} font-medium`} variant="outline">{r.status}</Badge>;
      },
    },
  ];
  return (
    <DataTable
      title="prices"
      data={data}
      columns={cols}
      searchKeys={["id", "itemCode", "item", "supplier"]}
      selectable={false}
      actions={(r) => <RowActions row={r} actions={["view", "edit", "print"]} />}
    />
  );
}

function PriceCreate({ nextId, onSave }: { nextId: string; onSave: (p: Price) => void }) {
  const [itemIdx, setItemIdx] = useState(0);
  const [supplier, setSupplier] = useState(SUPPLIERS[0]);
  const [unitPrice, setUnitPrice] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const save = () => {
    const price = Number(unitPrice);
    if (!price || price <= 0) { toast.error("Enter a valid unit price."); return; }
    if (!from || !to) { toast.error("Effective dates are required."); return; }
    const it = ITEMS[itemIdx];
    onSave({
      id: nextId,
      itemCode: it.code,
      item: it.name,
      uom: it.uom,
      supplier,
      unitPrice: price,
      currency: "BDT",
      effectiveFrom: from,
      effectiveTo: to,
      status: new Date(from) > new Date() ? "Scheduled" : "Active",
    });
    toast.success(`Price for ${it.name} saved.`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Create Price</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Price #</Label>
            <Input value={nextId} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Item <span className="text-destructive">*</span></Label>
            <select value={itemIdx} onChange={(e) => setItemIdx(Number(e.target.value))} className={selectCls}>
              {ITEMS.map((i, idx) => <option key={i.code} value={idx}>{i.code} — {i.name} ({i.uom})</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Supplier <span className="text-destructive">*</span></Label>
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className={selectCls}>
              {SUPPLIERS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Unit Price (BDT) <span className="text-destructive">*</span></Label>
            <Input type="number" step="0.01" min={0} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Effective From <span className="text-destructive">*</span></Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Effective To <span className="text-destructive">*</span></Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk upload
// ─────────────────────────────────────────────────────────────────────────────

type ParsedPrice = {
  rowNo: number;
  raw: string;
  itemCode: string;
  item: string;
  uom: string;
  supplier: string;
  unitPrice: number;
  effectiveFrom: string;
  effectiveTo: string;
  errors: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const TEMPLATE_HEADER = "ItemCode,Supplier,UnitPrice,EffectiveFrom,EffectiveTo";
const TEMPLATE_SAMPLE = [
  TEMPLATE_HEADER,
  "RM-RICE-BSMT,Agro Fresh Ltd.,145.00,2026-07-01,2026-09-30",
  "RM-CHK-BRST,Meat & Co.,395.00,2026-07-01,2026-09-30",
  "RM-VEG-TOM,Agro Fresh Ltd.,70.00,2026-07-01,2026-07-31",
].join("\n");

function parsePriceRows(text: string): ParsedPrice[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  // Skip header row if it matches the template column names
  const startIdx = lines[0].toLowerCase().includes("itemcode") ? 1 : 0;
  const itemByCode = new Map(ITEMS.map((i) => [i.code.toUpperCase(), i]));
  const supplierSet = new Set(SUPPLIERS.map((s) => s.toLowerCase()));
  return lines.slice(startIdx).map((line, i) => {
    const parts = line.split(/[,\t]/).map((p) => p.trim());
    const [itemCode = "", supplier = "", unitPriceRaw = "", from = "", to = ""] = parts;
    const errors: string[] = [];
    const codeUpper = itemCode.toUpperCase();
    const item = itemByCode.get(codeUpper);
    if (!itemCode) errors.push("Missing item code");
    else if (!item) errors.push(`Unknown item code "${itemCode}"`);
    if (!supplier) errors.push("Missing supplier");
    else if (!supplierSet.has(supplier.toLowerCase())) errors.push(`Unknown supplier "${supplier}"`);
    const unitPrice = Number(unitPriceRaw);
    if (!unitPriceRaw) errors.push("Missing unit price");
    else if (!Number.isFinite(unitPrice) || unitPrice <= 0) errors.push("Unit price must be > 0");
    if (!ISO_DATE.test(from)) errors.push("Effective From must be YYYY-MM-DD");
    if (!ISO_DATE.test(to)) errors.push("Effective To must be YYYY-MM-DD");
    if (ISO_DATE.test(from) && ISO_DATE.test(to) && from > to) errors.push("From > To");
    return {
      rowNo: i + 1,
      raw: line,
      itemCode: codeUpper,
      item: item?.name ?? "—",
      uom: item?.uom ?? "—",
      supplier,
      unitPrice,
      effectiveFrom: from,
      effectiveTo: to,
      errors,
    };
  });
}

function PriceBulkUpload({
  nextSeq, onImport, onCancel,
}: {
  nextSeq: number;
  onImport: (rows: Price[]) => void;
  onCancel: () => void;
}) {
  const [paste, setPaste] = useState("");
  const parsed = parsePriceRows(paste);
  const validRows = parsed.filter((r) => r.errors.length === 0);
  const invalidRows = parsed.filter((r) => r.errors.length > 0);
  const today = new Date().toISOString().slice(0, 10);

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_SAMPLE], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "price-setup-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    if (validRows.length === 0) {
      toast.error("No valid rows to import.");
      return;
    }
    const priceRows: Price[] = validRows.map((r, i) => ({
      id: `PRC-${String(nextSeq + i).padStart(3, "0")}`,
      itemCode: r.itemCode,
      item: r.item,
      uom: r.uom,
      supplier: r.supplier,
      unitPrice: r.unitPrice,
      currency: "BDT",
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      status:
        r.effectiveTo < today ? "Expired"
        : r.effectiveFrom > today ? "Scheduled"
        : "Active",
    }));
    onImport(priceRows);
    toast.success(`Imported ${priceRows.length} price${priceRows.length === 1 ? "" : "s"}.${invalidRows.length ? ` ${invalidRows.length} row(s) skipped.` : ""}`);
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setPaste(text);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider">Bulk Upload Prices</h3>
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
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Paste CSV / TSV
              </Label>
              <p className="text-[11px] text-muted-foreground font-mono mt-0.5 mb-1.5">
                ItemCode, Supplier, UnitPrice, EffectiveFrom, EffectiveTo
              </p>
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                rows={12}
                placeholder={`RM-RICE-BSMT, Agro Fresh Ltd., 145.00, 2026-07-01, 2026-09-30\nRM-CHK-BRST, Meat & Co., 395.00, 2026-07-01, 2026-09-30`}
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
                  <button
                    type="button"
                    onClick={() => setPaste("")}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Preview
                </Label>
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
                      <TableHead className="text-[10px] uppercase tracking-wider">Item</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Supplier</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-right w-24">Price</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Effective</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider w-20">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">
                          Paste rows on the left to preview them here.
                        </TableCell>
                      </TableRow>
                    ) : (
                      parsed.map((r) => {
                        const ok = r.errors.length === 0;
                        return (
                          <TableRow key={r.rowNo} className={ok ? "" : "bg-destructive/5"}>
                            <TableCell className="text-xs tabular-nums text-muted-foreground">{r.rowNo}</TableCell>
                            <TableCell className="text-xs">
                              <div className="font-mono">{r.itemCode || "—"}</div>
                              <div className="text-muted-foreground">{r.item}</div>
                            </TableCell>
                            <TableCell className="text-xs">{r.supplier || "—"}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {Number.isFinite(r.unitPrice) && r.unitPrice > 0 ? r.unitPrice.toFixed(2) : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground tabular-nums">
                              {r.effectiveFrom || "?"} → {r.effectiveTo || "?"}
                            </TableCell>
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
                <ul className="mt-2 space-y-0.5 text-[11px] text-destructive">
                  {invalidRows.slice(0, 4).map((r) => (
                    <li key={r.rowNo}>Row {r.rowNo}: {r.errors.join("; ")}</li>
                  ))}
                  {invalidRows.length > 4 && (
                    <li className="text-muted-foreground">…and {invalidRows.length - 4} more</li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
