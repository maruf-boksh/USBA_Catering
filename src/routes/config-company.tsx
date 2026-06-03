import { useState, type ComponentType, type ReactNode } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Save, Building2, Mail, Phone, MapPin, Globe } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_COMPANY = {
  legalName: "US-Bangla Airlines Ltd.",
  tradeName: "US-Bangla Catering",
  registrationNo: "C-12345/2018",
  taxId: "TIN-908123456",
  vatId: "VAT-7654321",
  bin: "001234567-0101",
  email: "catering@us-bangla.com",
  phone: "+880 2-555 110 110",
  website: "https://www.us-bangla.com",
  baseCurrency: "BDT",
  fiscalYearStart: "07-01",
  address: "Madina Bhaban, Baunia, Battola, Turag, Dhaka-1230, Bangladesh",
  logoText: "USB Catering",
};

export default function ConfigCompanyPage() {
  const [c, setC] = usePersistedState("config-company", DEFAULT_COMPANY);

  const set = <K extends keyof typeof DEFAULT_COMPANY>(k: K, v: (typeof DEFAULT_COMPANY)[K]) =>
    setC((prev) => ({ ...prev, [k]: v }));

  const save = () => {
    if (!c.legalName.trim()) { toast.error("Legal name is required."); return; }
    toast.success("Company profile saved.");
  };

  return (
    <>
      <PageHeader
        title="Company Profile"
        subtitle="Legal entity information used on documents, invoices and statutory filings"
        actions={<Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save Changes</Button>}
      />

      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-6">
              <Building2 className="h-4 w-4 text-primary" />
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
              <Building2 className="h-4 w-4 text-primary" />
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
      </div>
    </>
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
