import { useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Plus, ArrowLeft, Save, Plane, CheckCircle, XCircle } from "lucide-react";
import { KpiCard } from "@/components/common/KpiCard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { airlines as SEED, type Airline } from "@/lib/sample-data";

const COUNTRIES = ["Bangladesh", "India", "United Arab Emirates", "Qatar", "Singapore", "Thailand", "Malaysia", "Saudi Arabia", "United Kingdom"];

export default function ConfigAirlinePage() {
  const [rows, setRows] = usePersistedState<Airline[]>("config-airline-rows", SEED);
  const [view, setView] = useState<"list" | "create">("list");

  const toggle = (id: string) =>
    setRows((p) =>
      p.map((r) => (r.id === id ? { ...r, status: r.status === "Active" ? "Inactive" : "Active" } : r)),
    );

  const add = (a: Airline) => {
    setRows((p) => [a, ...p]);
    setView("list");
  };

  const total = rows.length;
  const active = rows.filter((r) => r.status === "Active").length;

  return (
    <>
      <PageHeader
        title="Airline"
        subtitle="Airlines we cater for — used to tag flight orders, special meals and revenue reports"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create" ? (
              <><ArrowLeft className="h-4 w-4 mr-1" /> Back</>
            ) : (
              <><Plus className="h-4 w-4 mr-1" /> Create Airline</>
            )}
          </Button>
        }
      />
      {view === "list" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <KpiCard label="Total Airlines" value={total}            icon={Plane}       tone="navy"    />
            <KpiCard label="Active"         value={active}           icon={CheckCircle} tone="success" />
            <KpiCard label="Inactive"       value={total - active}   icon={XCircle}     tone="warning" />
          </div>
          <AirlineList data={rows} onToggle={toggle} />
        </>
      ) : (
        <AirlineCreate
          nextId={`AIR-${String(rows.length + 1).padStart(3, "0")}`}
          onSave={add}
        />
      )}
    </>
  );
}

function AirlineList({ data, onToggle }: { data: Airline[]; onToggle: (id: string) => void }) {
  const cols: Column<Airline>[] = [
    { key: "id", header: "ID" },
    {
      key: "code", header: "Code",
      render: (r) => <span className="font-mono text-xs">{r.code}</span>,
    },
    {
      key: "iata", header: "IATA",
      render: (r) => <span className="font-mono text-xs">{r.iata}</span>,
    },
    { key: "name", header: "Airline Name" },
    { key: "country", header: "Country" },
    {
      key: "status", header: "Status",
      render: (r) => {
        const a = r.status === "Active";
        return (
          <div className="flex items-center gap-2">
            <Switch checked={a} onCheckedChange={() => onToggle(r.id)} />
            <span className={cn("text-xs font-medium", a ? "text-success" : "text-muted-foreground")}>
              {r.status}
            </span>
          </div>
        );
      },
    },
  ];
  return (
    <DataTable
      title="airlines"
      data={data}
      columns={cols}
      searchKeys={["id", "code", "iata", "name", "country"]}
      selectable={false}
      actions={(r) => <RowActions row={r} actions={["view", "edit", "print"]} />}
    />
  );
}

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function AirlineCreate({ nextId, onSave }: { nextId: string; onSave: (a: Airline) => void }) {
  const [code, setCode] = useState("");
  const [iata, setIata] = useState("");
  const [name, setName] = useState("");
  const [country, setCountry] = useState(COUNTRIES[0]);

  const save = () => {
    if (!name.trim()) { toast.error("Airline name is required."); return; }
    if (!code.trim()) { toast.error("Code is required."); return; }
    if (!iata.trim() || iata.trim().length !== 2) { toast.error("IATA code must be 2 characters."); return; }
    onSave({
      id: nextId,
      code: code.trim().toUpperCase(),
      iata: iata.trim().toUpperCase(),
      name: name.trim(),
      country,
      status: "Active",
    });
    toast.success(`Airline "${name.trim()}" created.`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Create Airline</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Airline ID</Label>
            <Input value={nextId} disabled className="mt-1 font-mono" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Code <span className="text-destructive">*</span>
            </Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 font-mono" placeholder="e.g. USB" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              IATA Code <span className="text-destructive">*</span>
            </Label>
            <Input
              value={iata}
              onChange={(e) => setIata(e.target.value.toUpperCase().slice(0, 2))}
              className="mt-1 font-mono"
              placeholder="e.g. BS"
              maxLength={2}
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Country</Label>
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={selectCls}>
              {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Airline Name <span className="text-destructive">*</span>
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" placeholder="e.g. US-Bangla Airlines" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
