import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Boxes, LayoutGrid, Plane, Container } from "lucide-react";
import { galleyAircraftTypes } from "@/lib/galley-standards";
import { buildStowagePlan } from "@/lib/galley-sheet";
import { buildInitialGalley, flights, type DispatchEntry, type FlightOption } from "@/routes/dispatch-monitoring";

// Aircraft Stowage Plan — a reference view of how a standard load stows on each
// aircraft type: which ATLAS unit (trolley / standard unit / oven case) sits at
// which galley position and what it carries. Derived from that type's Loading
// Standard + Meal Mix for a sample PAX/crew, so it always reflects live scales.

/** Synthesize a representative galley plan for an aircraft type at a given
 *  load — reuses the same builder the real planner uses. */
function representativePlan(aircraft: string, pax: number, crew: number, child: number) {
  const sample = flights.find((f) => f.aircraft === aircraft);
  const flight: FlightOption = {
    id: "STOWAGE-SAMPLE",
    flight: sample?.flight ?? "—",
    sector: sample?.sector ?? "—",
    aircraft,
    dep: "—", arr: "—",
    pax, adult: Math.max(0, pax - child), child, infant: 0, crew,
    type: "—", window: "—", duration: "—", status: "Sample",
  };
  const entry = { id: "STOWAGE-SAMPLE", flightId: flight.id, packagingDate: "—", mealLines: [] } as unknown as DispatchEntry;
  return buildInitialGalley(entry, flight);
}

export default function GalleyStowagePage() {
  const aircraftTypes = useMemo(() => galleyAircraftTypes(), []);
  const [aircraft, setAircraft] = useState(() => aircraftTypes[0] ?? "");
  const [pax, setPax] = useState(72);
  const [crew, setCrew] = useState(7);
  const [child, setChild] = useState(3);

  const galleys = useMemo(
    () => (aircraft ? buildStowagePlan(representativePlan(aircraft, pax, crew, child), aircraft) : []),
    [aircraft, pax, crew, child],
  );

  const allUnits = galleys.flatMap((g) => g.units);
  const countUnit = (needle: string) => allUnits.filter((u) => u.unit.toLowerCase().includes(needle)).length;

  return (
    <>
      <PageHeader
        title="Aircraft Stowage Plan"
        subtitle="Reference galley layout per aircraft type — where each trolley, standard unit and oven case is positioned and what it carries. Derived from the type's Loading Standard and the Meal Mix for a sample load."
      />

      <Card className="mb-4">
        <CardContent className="pt-5 pb-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">Aircraft Type</span>
              <Select value={aircraft} onValueChange={setAircraft}>
                <SelectTrigger className="h-8 w-56 text-sm">
                  <SelectValue placeholder="Select aircraft type" />
                </SelectTrigger>
                <SelectContent>
                  {aircraftTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Sample load</span>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                PAX
                <Input type="number" min={0} value={pax}
                  onChange={(e) => setPax(Math.max(0, Number(e.target.value) || 0))}
                  className="h-7 w-16 text-xs tabular-nums" />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Child
                <Input type="number" min={0} value={child}
                  onChange={(e) => setChild(Math.max(0, Number(e.target.value) || 0))}
                  className="h-7 w-14 text-xs tabular-nums" />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Crew
                <Input type="number" min={0} value={crew}
                  onChange={(e) => setCrew(Math.max(0, Number(e.target.value) || 0))}
                  className="h-7 w-14 text-xs tabular-nums" />
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Galleys"        value={galleys.length}     icon={LayoutGrid} tone="navy" />
        <KpiCard label="Total Units"    value={allUnits.length}    icon={Boxes}      tone="info" />
        <KpiCard label="Trolleys"       value={countUnit("trolley")} icon={Container} tone="warning" />
        <KpiCard label="Standard Units" value={countUnit("standard")} icon={Plane}    tone="success" />
      </div>

      {galleys.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {aircraftTypes.length === 0
              ? "No aircraft types available. Add an aircraft under Configuration › Aircraft."
              : "No stowage units for this load — increase the sample PAX/crew."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {galleys.map((g) => (
            <Card key={g.galley}>
              <CardContent className="pt-5">
                <p className="text-[11px] font-bold uppercase tracking-widest text-sky-700 mb-3 flex items-center gap-1.5">
                  <LayoutGrid className="h-3.5 w-3.5" /> {g.galley}
                </p>
                <div className="border border-border rounded-md overflow-x-auto">
                  <Table className="min-w-[520px]">
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-xs uppercase tracking-wider w-20">Pos</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider w-32">Unit</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Contents</TableHead>
                        <TableHead className="text-right text-xs uppercase tracking-wider w-28">Qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.units.map((u) => (
                        <TableRow key={u.pos} className="hover:bg-muted/30">
                          <TableCell className="font-mono text-xs font-semibold">{u.pos}</TableCell>
                          <TableCell className="text-xs font-medium">{u.unit}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{u.contents}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{u.qty}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
