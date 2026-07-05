import { useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { rowEditors } from "@/lib/row-editors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Plus, ArrowLeft, Save, PlaneTakeoff, CheckCircle, XCircle, Building2 } from "lucide-react";
import { KpiCard } from "@/components/common/KpiCard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  aircraftFleet as SEED, airlines as AIRLINE_SEED,
  type Aircraft, type Airline,
} from "@/lib/sample-data";

const AIRCRAFT_TYPES = ["ATR 72-600", "DASH 8", "Q400", "B737-800", "B737 MAX 8", "A320", "A330-300"];
const MANUFACTURERS = ["Boeing", "Airbus", "ATR", "De Havilland", "Embraer", "Bombardier"];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function ConfigAircraftPage() {
  const [rows, setRows] = usePersistedState<Aircraft[]>("config-aircraft-rows", SEED);
  // Airline tags come from the Airline config module (same persisted list), so
  // the dropdown and labels reflect any airlines maintained there.
  const [airlines] = usePersistedState<Airline[]>("config-airline-rows", AIRLINE_SEED);
  const [view, setView] = useState<"list" | "create">("list");

  const airlineById = useMemo(
    () => new Map(airlines.map((a) => [a.id, a])),
    [airlines],
  );

  const toggle = (id: string) =>
    setRows((p) =>
      p.map((r) => (r.id === id ? { ...r, status: r.status === "Active" ? "Inactive" : "Active" } : r)),
    );

  const add = (a: Aircraft) => {
    setRows((p) => [a, ...p]);
    setView("list");
  };

  const total = rows.length;
  const active = rows.filter((r) => r.status === "Active").length;
  const airlinesTagged = new Set(rows.map((r) => r.airlineId)).size;

  return (
    <>
      <PageHeader
        title="Aircraft"
        subtitle="Fleet register — each aircraft is tagged to the airline that operates it, and feeds flight scheduling & galley planning"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create" ? (
              <><ArrowLeft className="h-4 w-4 mr-1" /> Back</>
            ) : (
              <><Plus className="h-4 w-4 mr-1" /> Create Aircraft</>
            )}
          </Button>
        }
      />
      {view === "list" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Total Aircraft"  value={total}          icon={PlaneTakeoff} tone="navy"    />
            <KpiCard label="Active"          value={active}         icon={CheckCircle}  tone="success" />
            <KpiCard label="Inactive"        value={total - active} icon={XCircle}      tone="warning" />
            <KpiCard label="Airlines Tagged" value={airlinesTagged} icon={Building2}    tone="info"    />
          </div>
          <AircraftList
            data={rows}
            airlineById={airlineById}
            airlines={airlines}
            onToggle={toggle}
            editors={rowEditors(setRows)}
          />
        </>
      ) : (
        <AircraftCreate
          nextId={`ACF-${String(rows.length + 1).padStart(3, "0")}`}
          airlines={airlines}
          onSave={add}
        />
      )}
    </>
  );
}

function airlineLabel(a: Airline | undefined) {
  return a ? `${a.name} (${a.iata})` : "—";
}

function AircraftList({
  data, airlineById, airlines, onToggle, editors,
}: {
  data: Aircraft[];
  airlineById: Map<string, Airline>;
  airlines: Airline[];
  onToggle: (id: string) => void;
  editors: { onSave: (u: Record<string, unknown>) => void; onDelete: (u: Record<string, unknown>) => void };
}) {
  const cols: Column<Aircraft>[] = [
    { key: "id", header: "ID" },
    {
      key: "registration", header: "Registration",
      render: (r) => <span className="font-mono text-xs font-semibold">{r.registration}</span>,
    },
    { key: "type", header: "Type" },
    { key: "manufacturer", header: "Manufacturer" },
    {
      key: "airlineId", header: "Airline",
      render: (r) => {
        const a = airlineById.get(r.airlineId);
        return (
          <div className="flex items-center gap-2">
            <span>{a?.name ?? "—"}</span>
            {a && <span className="font-mono text-[10px] text-muted-foreground border border-border rounded px-1">{a.iata}</span>}
          </div>
        );
      },
    },
    {
      key: "seats", header: "Seats",
      render: (r) => <span className="tabular-nums">{r.seats}</span>,
    },
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
      title="aircraft"
      data={data}
      columns={cols}
      searchKeys={["id", "registration", "type", "manufacturer"]}
      selectable={false}
      actions={(r) => (
        <RowActions
          row={r}
          actions={["view", "edit", "print"]}
          onSave={editors.onSave}
          editDetail={({ save, close }) => (
            <AircraftFields mode="edit" initial={r} airlines={airlines} onSubmit={save} onClose={close} />
          )}
        />
      )}
    />
  );
}

function AircraftCreate({
  nextId, airlines, onSave,
}: {
  nextId: string;
  airlines: Airline[];
  onSave: (a: Aircraft) => void;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <AircraftFields mode="create" nextId={nextId} airlines={airlines} onSave={onSave} />
      </CardContent>
    </Card>
  );
}

/**
 * Shared Aircraft form fields. Used by the Create page (mode="create") and the
 * row Edit modal (mode="edit", pre-filled from `initial`) so both share an
 * identical layout. The Airline select is the "airline data" tag. Also reused
 * by the Galley Loading Standards page ("Add Aircraft") so a new aircraft type
 * can be registered without leaving the module.
 */
export function AircraftFields({
  mode, nextId, initial, airlines, onSave, onSubmit, onClose,
}: {
  mode: "create" | "edit";
  nextId?: string;
  initial?: Aircraft;
  airlines: Airline[];
  onSave?: (a: Aircraft) => void;
  onSubmit?: (patch: Record<string, unknown>) => void;
  onClose?: () => void;
}) {
  const isEdit = mode === "edit";
  const [registration, setRegistration] = useState(initial?.registration ?? "");
  const [type, setType] = useState(initial?.type ?? AIRCRAFT_TYPES[0]);
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? MANUFACTURERS[0]);
  const [airlineId, setAirlineId] = useState(initial?.airlineId ?? airlines[0]?.id ?? "");
  const [seats, setSeats] = useState(String(initial?.seats ?? ""));

  const save = () => {
    if (!registration.trim()) { toast.error("Registration (tail number) is required."); return; }
    if (!airlineId) { toast.error("Select the operating airline."); return; }
    const seatCount = Number(seats);
    if (!Number.isFinite(seatCount) || seatCount <= 0) { toast.error("Enter a valid seat count."); return; }
    const payload = {
      registration: registration.trim().toUpperCase(),
      type,
      manufacturer,
      airlineId,
      seats: seatCount,
    };
    if (isEdit) {
      onSubmit?.(payload);
      onClose?.();
    } else {
      onSave?.({ id: nextId!, ...payload, status: "Active" });
      toast.success(`Aircraft "${registration.trim().toUpperCase()}" created.`);
    }
  };

  return (
    <>
      {!isEdit && (
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Create Aircraft</h3>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save</Button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Aircraft ID</Label>
          <Input value={initial?.id ?? nextId ?? ""} disabled className="mt-1 font-mono" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Registration <span className="text-destructive">*</span>
          </Label>
          <Input
            value={registration}
            onChange={(e) => setRegistration(e.target.value.toUpperCase())}
            className="mt-1 font-mono"
            placeholder="e.g. S2-AJA"
          />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Aircraft Type</Label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={selectCls}>
            {AIRCRAFT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Manufacturer</Label>
          <select value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className={selectCls}>
            {MANUFACTURERS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Airline <span className="text-destructive">*</span>
          </Label>
          <select value={airlineId} onChange={(e) => setAirlineId(e.target.value)} className={selectCls}>
            {airlines.length === 0 && <option value="">No airlines configured</option>}
            {airlines.map((a) => (
              <option key={a.id} value={a.id}>{airlineLabel(a)}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Seats <span className="text-destructive">*</span>
          </Label>
          <Input
            type="number"
            min={1}
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            className="mt-1 tabular-nums"
            placeholder="e.g. 164"
          />
        </div>
      </div>
      {isEdit && (
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save Changes</Button>
        </div>
      )}
    </>
  );
}
