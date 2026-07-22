import { useState, type ComponentType, type ReactNode } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Save, Building2, Landmark, Mail, Phone, MapPin, Globe, Wallet,
  ChevronRight, Warehouse as WarehouseIcon, Snowflake, ChefHat,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  offices as OFFICE_SEED,
  warehouses as WAREHOUSE_SEED,
  type Office, type Warehouse, type WarehouseType,
} from "@/lib/sample-data";

/** The single legal entity — the org the whole app belongs to. */
type CompanyProfile = {
  id: string;
  code: string;
  legalName: string;
  tradeName: string;
  registrationNo: string;
  bin: string;
  taxId: string;
  vatId: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  baseCurrency: string;
  fiscalYearStart: string;
  logoText: string;
};

const DEFAULT_COMPANY: CompanyProfile = {
  id: "CMP-001",
  code: "USB-CAT",
  legalName: "US-Bangla Catering",
  tradeName: "US-Bangla Catering",
  registrationNo: "C-12345/2018",
  bin: "001234567-0101",
  taxId: "TIN-908123456",
  vatId: "VAT-7654321",
  email: "catering@us-bangla.com",
  phone: "+880 2-555 110 110",
  website: "https://www.us-bangla.com",
  address: "Madina Bhaban, Baunia, Battola, Turag, Dhaka-1230, Bangladesh",
  baseCurrency: "BDT",
  fiscalYearStart: "07-01",
  logoText: "USB Catering",
};

const WH_ICON: Record<WarehouseType, ComponentType<{ className?: string }>> = {
  Warehouse: WarehouseIcon,
  "Cold Store": Snowflake,
  Kitchen: ChefHat,
};

export default function ConfigCompanyPage() {
  const [c, setC] = usePersistedState<CompanyProfile>("config-company", DEFAULT_COMPANY);
  // Read the same persisted lists the Office / Warehouse config pages manage,
  // so the structure tree reflects edits made there.
  const [offices] = usePersistedState<Office[]>("config-office-rows", OFFICE_SEED);
  const [warehouses] = usePersistedState<Warehouse[]>("config-warehouse-rows", WAREHOUSE_SEED);

  const set = <K extends keyof CompanyProfile>(k: K, v: CompanyProfile[K]) =>
    setC((prev) => ({ ...prev, [k]: v }));

  const save = () => {
    if (!c.legalName.trim()) { toast.error("Legal name is required."); return; }
    toast.success("Company profile saved.");
  };

  const whByOffice = (officeId: string) => warehouses.filter((w) => w.officeId === officeId);
  const totalWh = offices.reduce((n, o) => n + whByOffice(o.id).length, 0);

  return (
    <>
      <PageHeader
        title="Company Profile"
        subtitle="The company and its offices & warehouses. Legal entity details are used on documents, invoices and statutory filings."
        actions={<Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save Changes</Button>}
      />

      <div className="space-y-6">
        {/* ── Legal entity profile ─────────────────────────────────────── */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-6">
              <Landmark className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold uppercase tracking-wider">Legal Entity</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Legal Name" required>
                <Input value={c.legalName} onChange={(e) => set("legalName", e.target.value)} />
              </Field>
              <Field label="Trade Name">
                <Input value={c.tradeName} onChange={(e) => set("tradeName", e.target.value)} />
              </Field>
              <Field label="Registration No.">
                <Input value={c.registrationNo} onChange={(e) => set("registrationNo", e.target.value)} />
              </Field>
              <Field label="BIN">
                <Input value={c.bin} onChange={(e) => set("bin", e.target.value)} />
              </Field>
              <Field label="Tax / TIN">
                <Input value={c.taxId} onChange={(e) => set("taxId", e.target.value)} />
              </Field>
              <Field label="VAT ID">
                <Input value={c.vatId} onChange={(e) => set("vatId", e.target.value)} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-6">
              <Phone className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold uppercase tracking-wider">Contact</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Email" icon={Mail}>
                <Input type="email" value={c.email} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <Field label="Phone" icon={Phone}>
                <Input value={c.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label="Website" icon={Globe}>
                <Input value={c.website} onChange={(e) => set("website", e.target.value)} />
              </Field>
              <div />
              <Field label="Registered Address" icon={MapPin} colSpan>
                <Textarea value={c.address} onChange={(e) => set("address", e.target.value)} rows={2} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-6">
              <Wallet className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold uppercase tracking-wider">Financial Defaults</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
              <Field label="Base Currency">
                <Input value={c.baseCurrency} onChange={(e) => set("baseCurrency", e.target.value)} />
              </Field>
              <Field label="Fiscal Year Start (MM-DD)">
                <Input value={c.fiscalYearStart} onChange={(e) => set("fiscalYearStart", e.target.value)} placeholder="07-01" />
              </Field>
              <Field label="Document Logo Text">
                <Input value={c.logoText} onChange={(e) => set("logoText", e.target.value)} />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* ── Organization structure: Company → Office → Warehouse ──────── */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold uppercase tracking-wider">Organization Structure</h3>
              </div>
              <span className="text-xs text-muted-foreground">
                {offices.length} office{offices.length === 1 ? "" : "s"} · {totalWh} warehouse{totalWh === 1 ? "" : "s"}
              </span>
            </div>

            {/* Company root */}
            <div className="rounded-md border border-border">
              <div className="flex items-center gap-2.5 px-3 py-2.5 bg-muted/40 rounded-t-md">
                <Landmark className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{c.tradeName || c.legalName}</div>
                  <div className="text-[11px] text-muted-foreground font-mono">{c.id} · {c.code}</div>
                </div>
              </div>

              {/* Offices under the company */}
              <div className="p-2 space-y-1.5">
                {offices.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-6">No offices configured.</div>
                )}
                {offices.map((o) => (
                  <OfficeNode key={o.id} office={o} warehouses={whByOffice(o.id)} />
                ))}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Offices and warehouses are maintained on their own Configuration pages — this view mirrors them.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function OfficeNode({ office, warehouses }: { office: Office; warehouses: Warehouse[] }) {
  const [open, setOpen] = useState(true);
  const active = office.status === "Active";
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/40 rounded-md"
      >
        <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0", open && "rotate-90")} />
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{office.name}</span>
            <span className="text-[11px] text-muted-foreground font-mono">{office.code}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">{office.city}{office.manager && office.manager !== "—" ? ` · ${office.manager}` : ""}</div>
        </div>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {warehouses.length} warehouse{warehouses.length === 1 ? "" : "s"}
        </Badge>
        <StatusDot active={active} />
      </button>

      {open && (
        <div className="pb-2 pl-9 pr-2 space-y-1">
          {warehouses.length === 0 ? (
            <div className="text-[11px] text-muted-foreground py-1.5">No warehouses under this office.</div>
          ) : (
            warehouses.map((w) => {
              const Icon = WH_ICON[w.type] ?? WarehouseIcon;
              const whActive = w.status === "Active";
              return (
                <div key={w.id} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md border border-border/60 bg-background">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="text-[13px] font-medium">{w.name}</span>
                    <span className="text-[11px] text-muted-foreground font-mono ml-2">{w.code}</span>
                  </div>
                  <Badge variant="secondary" className="text-[10px] shrink-0">{w.type}</Badge>
                  <StatusDot active={whActive} />
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-success" : "bg-muted-foreground/50")} />
      <span className={cn("text-[11px]", active ? "text-success" : "text-muted-foreground")}>
        {active ? "Active" : "Inactive"}
      </span>
    </span>
  );
}

function Field({
  label, required, icon: Icon, colSpan, children,
}: {
  label: string; required?: boolean;
  icon?: ComponentType<{ className?: string }>;
  colSpan?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={colSpan ? "md:col-span-2" : undefined}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
