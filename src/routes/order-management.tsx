import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Progress } from "@/components/ui/progress";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Upload, Download, Save, FileSpreadsheet, FileText, FileType,
  History, CheckCircle2, AlertCircle, Eye, CalendarRange, X, Plane, ArrowLeft, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  recentUploads,
  FLIGHT_ORDER_STATUS_FLOW, nextFlightStatus,
  isDomesticSector,
  SPECIAL_MEAL_CODES, SPECIAL_MEAL_BY_CODE,
  type FlightDirection, type FlightOrderStatus, type MealSlot,
  type SpecialMealEntry, type SpecialMealCategory,
} from "@/lib/sample-data";
import { useMealSlots, resolveMealSlot, formatSlotRange } from "@/lib/meal-slot-settings";
import {
  useFlightOrders, addFlightOrders, updateFlightOrderStatus,
} from "@/lib/flight-orders-store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useArrivalFlash } from "@/lib/arrival-flash";

// Coloured 3px left edge on an order-group band, keyed to its status — green
// family for done/approved, amber for production, gold for pending. (Design:
// `.g-done/.g-appr/.g-prod/.g-pend` accents in order-management.css.)
function orderBarColor(status: FlightOrderStatus): string {
  switch (status) {
    case "Production": return "#b45309"; // --warn
    case "Pending":    return "#b88a12"; // --gold-bright
    case "Completed":  return "#0f7a40"; // --ok
    default:           return "#1f9d57"; // --ok-bright (Approved / Dispatched)
  }
}

// Status pill on the group band — matches the design's `.om-stat` palette, which
// deliberately keeps Pending a distinct *gold* so it reads apart from Production's
// amber (the shared StatusBadge collapses both to amber, so this stays page-local).
const OM_STAT_CLS: Record<FlightOrderStatus, string> = {
  Completed:  "text-[#0f7a40] bg-[#ecf5ef] border-[#c4e3cf]",
  Approved:   "text-[#1f9d57] bg-[#ecf5ef] border-[#c4e3cf]",
  Dispatched: "text-[#1f9d57] bg-[#ecf5ef] border-[#c4e3cf]",
  Production: "text-[#b45309] bg-[#fbf1e6] border-[#f0d9bf]",
  Pending:    "text-[#8a6400] bg-[#fbf4e2] border-[#ecdcae]",
};

function OmStatusPill({ status }: { status: FlightOrderStatus }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full border px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.04em] " +
        OM_STAT_CLS[status]
      }
    >
      {status}
    </span>
  );
}

function OrderStatusBadges({ legs }: { legs: { status: FlightOrderStatus }[] }) {
  if (legs.length === 0) return null;
  return <OmStatusPill status={legs[0].status} />;
}

type FlightOrder = {
  id: string;        // unique row id (one row = one flight)
  orderNo: string;   // the displayed Order # — repeats across legs of the same order
  flight: string;
  airline: string;
  sector: string;
  date: string;
  etd: string;
  pax: number;
  crew: number;
  specialMeals: number;
  status: FlightOrderStatus;
  direction: FlightDirection;
  specialMealRoster?: SpecialMealEntry[];
};

const AIRLINES = ["US-Bangla", "Air Astra"];
const AIRPORTS: { code: string; name: string }[] = [
  { code: "DAC", name: "Dhaka" },
  { code: "CXB", name: "Cox's Bazar" },
  { code: "CGP", name: "Chattogram" },
  { code: "ZYL", name: "Sylhet" },
  { code: "JSR", name: "Jashore" },
  { code: "DXB", name: "Dubai" },
  { code: "DOH", name: "Doha" },
  { code: "LHR", name: "London Heathrow" },
  { code: "KUL", name: "Kuala Lumpur" },
  { code: "BKK", name: "Bangkok" },
  { code: "SIN", name: "Singapore" },
  { code: "CCU", name: "Kolkata" },
  { code: "DEL", name: "Delhi" },
  { code: "KTM", name: "Kathmandu" },
];

type ParsedRow = {
  row: number;
  id: string;
  flight: string;
  airline: string;
  sector: string;
  etd: string;
  pax: number;
  specialMeals: number;
  valid: boolean;
  type: "Domestic" | "International";
  zenLoad?: number;
  totalMeal?: number;
  specMeal?: number;
  crewMeal?: number;
  bcLoad?: number;
  ecLoad?: number;
  bcMeal?: number;
  ecMeal?: number;
  chml?: number;
  vgml?: number;
  returnFlight?: string;
  returnSector?: string;
  date?: string;
};

const SAMPLE_PARSED_DOM: ParsedRow[] = [
  { row: 1, id: "ORD-3501", flight: "BS-141", airline: "US-Bangla", sector: "DAC → CXB", etd: "08:15", pax: 72, specialMeals: 4, valid: true,  type: "Domestic", zenLoad: 72, totalMeal: 72, specMeal: 4, crewMeal: 4, returnFlight: "BS-142", returnSector: "CXB → DAC", date: "2026-05-24" },
  { row: 2, id: "ORD-3502", flight: "BS-203", airline: "US-Bangla", sector: "DAC → CGP", etd: "10:30", pax: 88, specialMeals: 2, valid: true,  type: "Domestic", zenLoad: 88, totalMeal: 88, specMeal: 2, crewMeal: 4, returnFlight: "BS-204", returnSector: "CGP → DAC", date: "2026-05-24" },
  { row: 3, id: "ORD-3503", flight: "AA-101", airline: "Air Astra", sector: "DAC → ZYL", etd: "13:00", pax: 0,  specialMeals: 0, valid: false, type: "Domestic", date: "2026-05-24" },
  { row: 4, id: "ORD-3504", flight: "AA-202", airline: "Air Astra", sector: "DAC → CXB", etd: "15:45", pax: 66, specialMeals: 3, valid: true,  type: "Domestic", zenLoad: 66, totalMeal: 66, specMeal: 3, crewMeal: 4, returnFlight: "AA-203", returnSector: "CXB → DAC", date: "2026-05-24" },
  { row: 5, id: "ORD-3511", flight: "BS-143", airline: "US-Bangla", sector: "DAC → CXB", etd: "07:30", pax: 80, specialMeals: 3, valid: true,  type: "Domestic", zenLoad: 80, totalMeal: 80, specMeal: 3, crewMeal: 4, returnFlight: "BS-144", returnSector: "CXB → DAC", date: "2026-05-25" },
  { row: 6, id: "ORD-3512", flight: "BS-205", airline: "US-Bangla", sector: "DAC → CGP", etd: "11:00", pax: 76, specialMeals: 2, valid: true,  type: "Domestic", zenLoad: 76, totalMeal: 76, specMeal: 2, crewMeal: 4, returnFlight: "BS-206", returnSector: "CGP → DAC", date: "2026-05-25" },
  { row: 7, id: "ORD-3513", flight: "AA-103", airline: "Air Astra", sector: "DAC → ZYL", etd: "14:00", pax: 55, specialMeals: 1, valid: true,  type: "Domestic", zenLoad: 55, totalMeal: 55, specMeal: 1, crewMeal: 2, returnFlight: "AA-104", returnSector: "ZYL → DAC", date: "2026-05-25" },
  { row: 8, id: "ORD-3514", flight: "AA-204", airline: "Air Astra", sector: "DAC → CXB", etd: "16:30", pax: 70, specialMeals: 2, valid: true,  type: "Domestic", zenLoad: 70, totalMeal: 70, specMeal: 2, crewMeal: 4, returnFlight: "AA-205", returnSector: "CXB → DAC", date: "2026-05-25" },
  { row: 9, id: "ORD-3515", flight: "BS-167", airline: "US-Bangla", sector: "DAC → JSR", etd: "09:45", pax: 0,  specialMeals: 0, valid: false, type: "Domestic", date: "2026-05-25" },
];

const SAMPLE_PARSED_INTL: ParsedRow[] = [
  { row: 1, id: "ORD-3601", flight: "BS-225", airline: "US-Bangla", sector: "DAC → DXB", etd: "12:30", pax: 174, specialMeals: 14, valid: true,  type: "International", bcLoad: 12, ecLoad: 162, bcMeal: 12, ecMeal: 162, chml: 8,  vgml: 6, date: "2026-05-24" },
  { row: 2, id: "ORD-3602", flight: "BS-307", airline: "US-Bangla", sector: "DAC → KUL", etd: "23:50", pax: 282, specialMeals: 18, valid: true,  type: "International", bcLoad: 24, ecLoad: 258, bcMeal: 24, ecMeal: 258, chml: 10, vgml: 8, date: "2026-05-24" },
  { row: 3, id: "ORD-3603", flight: "BS-411", airline: "US-Bangla", sector: "CGP → DXB", etd: "18:25", pax: 162, specialMeals: 10, valid: true,  type: "International", bcLoad: 10, ecLoad: 152, bcMeal: 10, ecMeal: 152, chml: 6,  vgml: 4, date: "2026-05-24" },
  { row: 4, id: "ORD-3604", flight: "BS-???", airline: "US-Bangla", sector: "DAC → DOH", etd: "15:00", pax: 0,   specialMeals: 0,  valid: false, type: "International", date: "2026-05-24" },
  { row: 5, id: "ORD-3611", flight: "BS-227", airline: "US-Bangla", sector: "DAC → DXB", etd: "10:30", pax: 188, specialMeals: 12, valid: true,  type: "International", bcLoad: 16, ecLoad: 172, bcMeal: 16, ecMeal: 172, chml: 9,  vgml: 5, date: "2026-05-25" },
  { row: 6, id: "ORD-3612", flight: "BS-309", airline: "US-Bangla", sector: "DAC → KUL", etd: "22:00", pax: 270, specialMeals: 16, valid: true,  type: "International", bcLoad: 20, ecLoad: 250, bcMeal: 20, ecMeal: 250, chml: 8,  vgml: 6, date: "2026-05-25" },
  { row: 7, id: "ORD-3613", flight: "BS-413", airline: "US-Bangla", sector: "CGP → DXB", etd: "17:50", pax: 150, specialMeals: 8,  valid: true,  type: "International", bcLoad: 8,  ecLoad: 142, bcMeal: 8,  ecMeal: 142, chml: 5,  vgml: 3, date: "2026-05-25" },
  { row: 8, id: "ORD-3614", flight: "BS-501", airline: "US-Bangla", sector: "DAC → SIN", etd: "20:15", pax: 0,   specialMeals: 0,  valid: false, type: "International", date: "2026-05-25" },
];

type MealPlan = Record<string, number>;
type ActivityEntry = { message: string; user: string; role: string; at: string };
type RecentUploadRow = (typeof recentUploads)[number];

export default function OrderManagementPage() {
  useArrivalFlash();
  const orders = useFlightOrders();
  const [view, setView] = useState<"list" | "create" | "bulk" | "crew-create">("list");
  const [selectedOrder, setSelectedOrder] = useState<FlightOrder | null>(null);
  const [activeTab, setActiveTab] = useState<"flights" | "crew">("flights");

  // Clicking View on a row surfaces THAT individual flight's details.
  const selectedLegs = selectedOrder ? [selectedOrder] : [];

  const addOrder = (legs: FlightOrder[]) => {
    addFlightOrders(legs);
    setView("list");
  };

  const addOrdersBulk = (newOrders: FlightOrder[]) => {
    addFlightOrders(newOrders);
    setView("list");
  };

  const advanceStatus = (rowId: string) => {
    const target = orders.find((o) => o.id === rowId);
    if (!target) return;
    const next = nextFlightStatus(target.status);
    if (!next) {
      toast.info(`${target.flight} is already Completed.`);
      return;
    }
    updateFlightOrderStatus(rowId, next);
    toast.success(`${target.flight} moved to ${next}.`);
  };

  const advanceOrderStatus = (orderNo: string) => {
    const legs = orders.filter((o) => o.orderNo === orderNo);
    let moved = 0;
    for (const leg of legs) {
      const next = nextFlightStatus(leg.status);
      if (next) {
        updateFlightOrderStatus(leg.id, next);
        moved += 1;
      }
    }
    if (moved > 0) toast.success(`${orderNo} — advanced ${moved} ${moved === 1 ? "flight" : "flights"}.`);
    else toast.info(`${orderNo} is already Completed.`);
  };

  return (
    <>
      <PageHeader
        title="Order Management"
        subtitle="Create, import and track flight orders"
        actions={
          view === "list" ? (
            <>
              <Button variant="outline" className="no-brand" onClick={() => setView("bulk")}>
                <Upload className="h-4 w-4 mr-1 text-primary" /> Bulk Upload
              </Button>
              <Button
                onClick={() => {
                  setView(activeTab === "crew" ? "crew-create" : "create");
                }}
              >
                <Plus className="h-4 w-4 mr-1" /> Create Order
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setView("list")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          )
        }
      />

      {view === "list" && (
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "flights" | "crew")}
          className="space-y-4 mt-4"
        >
          <TabsList className="h-auto bg-transparent p-0 border-b border-border w-full justify-start rounded-none">
            <TabsTrigger
              value="flights"
              className="text-xs uppercase tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-4 pb-3"
            >
              Flight Orders
            </TabsTrigger>
            <TabsTrigger
              value="crew"
              className="text-xs uppercase tracking-wider rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-4 pb-3"
            >
              Crew Meals
            </TabsTrigger>
          </TabsList>

          <TabsContent value="flights" className="mt-0">
            <OrdersList orders={orders} onView={setSelectedOrder} />
          </TabsContent>

          <TabsContent value="crew" className="mt-0">
            <CrewMealsView orders={orders} />
          </TabsContent>
        </Tabs>
      )}
      {view === "create" && (
        <OrderCreate
          onSave={addOrder}
          nextOrderNo={`ORD-${(Math.max(
            3410,
            ...orders.map((o) => Number(o.orderNo.split("-").pop()) || 0),
          )) + 1}`}
          nextRowSeq={orders.length + 1}
        />
      )}
      {view === "crew-create" && (
        <CrewMealCreate
          onSave={addOrder}
          nextOrderNo={`ORD-${(Math.max(
            3410,
            ...orders.map((o) => Number(o.orderNo.split("-").pop()) || 0),
          )) + 1}`}
          nextRowSeq={orders.length + 1}
        />
      )}
      {view === "bulk" && <BulkUpload onImport={addOrdersBulk} />}

      <FlightOrderDetailsDialog
        order={selectedOrder}
        legs={selectedLegs}
        onAdvanceLeg={advanceStatus}
        onAdvanceOrder={advanceOrderStatus}
        onClose={() => setSelectedOrder(null)}
      />
    </>
  );
}

function CrewMealsView({ orders }: { orders: FlightOrder[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState<string>(today);
  const [scope, setScope] = useState<"Domestic" | "International" | "All">("Domestic");
  const [airline, setAirline] = useState<string>("All");
  const slots = useMealSlots();

  const airlineOptions = Array.from(new Set(orders.map((o) => o.airline))).sort();

  const filtered = orders.filter((o) => {
    if (date && o.date !== date) return false;
    if (scope === "Domestic" && !isDomesticSector(o.sector)) return false;
    if (scope === "International" && isDomesticSector(o.sector)) return false;
    if (airline !== "All" && o.airline !== airline) return false;
    return true;
  });

  // Group by meal slot (using the user's current slot configuration)
  const groups = new Map<MealSlot, FlightOrder[]>();
  slots.forEach((s) => groups.set(s.name, []));
  filtered.forEach((o) => {
    const slotName = resolveMealSlot(o.etd, slots).name;
    groups.get(slotName)!.push(o);
  });
  slots.forEach((s) => {
    groups.get(s.name)!.sort((a, b) => a.etd.localeCompare(b.etd));
  });

  const grandCrew = filtered.reduce((s, o) => s + o.crew, 0);
  const grandPax = filtered.reduce((s, o) => s + o.pax, 0);

  return (
    <Card>
      <CardContent className="pt-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
              Meal for {scope === "All" ? "All" : scope} Flights
              {airline !== "All" && <span className="text-muted-foreground normal-case font-normal"> · {airline}</span>}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cabin-crew meal orders grouped by meal slot — derived from each flight's ETD.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 shadow-sm">
              <CalendarRange className="h-3.5 w-3.5 text-primary" />
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-7 w-[140px] border-0 shadow-none px-1 focus-visible:ring-0"
              />
            </div>
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 shadow-sm">
              <Plane className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Airline</Label>
              <select
                value={airline}
                onChange={(e) => setAirline(e.target.value)}
                className="h-7 bg-transparent border-0 text-sm focus:outline-none focus:ring-0 pr-1"
                aria-label="Filter Crew Meals by airline"
              >
                <option value="All">All</option>
                {airlineOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="inline-flex rounded-md border border-input bg-background p-0.5 shadow-sm">
              {(["Domestic", "International", "All"] as const).map((s) => {
                const active = scope === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    className={
                      "px-3 py-1.5 text-xs font-medium rounded-sm transition-colors " +
                      (active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No {scope.toLowerCase()} flights on {date || "the selected date"}.
          </div>
        ) : (
          <>
            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="text-xs uppercase tracking-wider w-44">Flight No</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-20">ETD</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right w-24">PAX</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right w-28">No of Crew</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slots.map((slot) => {
                    const slotRows = groups.get(slot.name)!;
                    if (slotRows.length === 0) return null;
                    const slotCrew = slotRows.reduce((s, o) => s + o.crew, 0);

                    // Group rows in this slot by Order #
                    const slotOrderGroups = new Map<string, FlightOrder[]>();
                    slotRows.forEach((o) => {
                      const list = slotOrderGroups.get(o.orderNo);
                      if (list) list.push(o);
                      else slotOrderGroups.set(o.orderNo, [o]);
                    });

                    return (
                      <Fragment key={slot.name}>
                        <TableRow className="bg-primary/5 border-t-2 border-t-primary/40 hover:bg-primary/10">
                          <TableCell colSpan={5} className="py-2">
                            <span className="font-semibold text-primary uppercase tracking-wider text-xs">
                              {slot.name}
                            </span>
                            <span className="ml-2 text-[10px] text-muted-foreground tabular-nums">
                              {formatSlotRange(slot)}
                            </span>
                          </TableCell>
                        </TableRow>
                        {Array.from(slotOrderGroups.entries()).map(([orderNo, legs]) => (
                          <Fragment key={`${slot.name}-${orderNo}`}>
                            <TableRow className="bg-muted/40 hover:bg-muted/50">
                              <TableCell colSpan={5} className="pl-4 py-1.5">
                                <div className="flex items-center flex-wrap gap-2">
                                  <span className="font-mono text-sm font-semibold text-primary">{orderNo}</span>
                                  {legs.length > 1 && (
                                    <Badge
                                      variant="outline"
                                      className="h-5 px-1.5 text-[10px] tabular-nums border-primary/30 bg-card text-primary"
                                    >
                                      {legs.length} flights
                                    </Badge>
                                  )}
                                  <OrderStatusBadges legs={legs} />
                                </div>
                              </TableCell>
                            </TableRow>
                            {legs.map((o) => (
                              <TableRow key={o.id} data-arrival-row-id={o.id} className="hover:bg-muted/30">
                                <TableCell className="font-mono text-xs pl-8 whitespace-nowrap">
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="whitespace-nowrap">{o.flight}</span>
                                    <DirectionBadge direction={o.direction} />
                                  </span>
                                </TableCell>
                                <TableCell>{o.sector}</TableCell>
                                <TableCell className="tabular-nums">{o.etd}</TableCell>
                                <TableCell className="text-right tabular-nums">{o.pax}</TableCell>
                                <TableCell className="text-right tabular-nums font-semibold">{o.crew}</TableCell>
                              </TableRow>
                            ))}
                          </Fragment>
                        ))}
                        <TableRow className="bg-muted/30 font-semibold">
                          <TableCell colSpan={4} className="text-right uppercase text-[10px] tracking-wider">
                            {slot.name} Total
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-primary">{slotCrew}</TableCell>
                        </TableRow>
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Flights</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{filtered.length}</div>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Passenger Meals</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{grandPax}</div>
              </div>
              <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Crew Meals</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-primary">{grandCrew}</div>
              </div>
            </div>
          </>
        )}
      </CardContent>

    </Card>
  );
}

function WorkflowStrip({
  statuses, counts,
}: {
  statuses: FlightOrderStatus[];
  counts: Record<FlightOrderStatus, number>;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
        Status Workflow
      </div>
      <div className="flex items-center gap-1 overflow-x-auto">
        {statuses.map((s, i) => {
          const count = counts[s] ?? 0;
          const active = count > 0;
          return (
            <div key={s} className="flex items-center gap-1 flex-shrink-0">
              <div
                className={
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs border " +
                  (active
                    ? "bg-primary/5 border-primary/30 text-foreground font-medium"
                    : "bg-muted/40 border-border text-muted-foreground")
                }
              >
                <span
                  className={
                    "inline-flex items-center justify-center h-4 w-4 rounded-full text-[9px] font-semibold " +
                    (active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
                  }
                >
                  {i + 1}
                </span>
                {s}
                {count > 0 && (
                  <span className="text-[10px] tabular-nums text-muted-foreground ml-0.5">
                    ({count})
                  </span>
                )}
              </div>
              {i < statuses.length - 1 && (
                <span className="text-muted-foreground text-xs">→</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: FlightDirection }) {
  const isReturn = direction === "Return";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border " +
        (isReturn
          ? "text-[#2b5f8a] bg-[#eef4f9] border-[#cfe0ec]"
          : "text-[#0f7a40] bg-[#ecf5ef] border-[#cbe6d5]")
      }
      title={isReturn ? "Return flight" : "Outbound flight"}
    >
      <span aria-hidden>{isReturn ? "↺" : "↗"}</span>
      <span>{direction}</span>
    </span>
  );
}

function OrdersList({
  orders, onView,
}: {
  orders: FlightOrder[];
  onView: (o: FlightOrder) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [airline, setAirline] = useState<string>("All");
  const [scope, setScope] = useState<"All" | "Domestic" | "International">("All");

  const airlineOptions = Array.from(new Set(orders.map((o) => o.airline))).sort();

  const filteredOrders = useMemo(
    () =>
      orders
        .filter((o) => {
          if (from && o.date < from) return false;
          if (to && o.date > to) return false;
          if (airline !== "All" && o.airline !== airline) return false;
          if (scope === "Domestic" && !isDomesticSector(o.sector)) return false;
          if (scope === "International" && isDomesticSector(o.sector)) return false;
          return true;
        })
        .sort((a, b) => b.date.localeCompare(a.date) || b.etd.localeCompare(a.etd)),
    [orders, from, to, airline, scope],
  );

  // Group filtered rows by Order # — memoised so we don't redo this work each
  // render (with 3k+ rows the grouping cost was visible during page switches).
  const groupedOrders = useMemo(() => {
    const map = new Map<string, FlightOrder[]>();
    for (const o of filteredOrders) {
      const list = map.get(o.orderNo);
      if (list) list.push(o);
      else map.set(o.orderNo, [o]);
    }
    return Array.from(map.entries());
  }, [filteredOrders]);

  // Pagination — paginate by order group, not by flight row, so an order's
  // legs stay together on one page. Capped at 3 orders per page on user
  // request (each order can fan out to 30-40 legs, so 3 already produces a
  // ~100-row table).
  const [page, setPage] = useState(1);
  const pageSize = 3;
  const totalPages = Math.max(1, Math.ceil(groupedOrders.length / pageSize));

  // Whenever the filter/sort inputs change the result set, jump back to page 1.
  useEffect(() => { setPage(1); }, [from, to, airline, scope]);
  // Defensive: if `page` is now past the last page (e.g. after a filter
  // narrowed the list), clamp it.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  // Deep-link: when arriving with ?ord=ORD-XXXX (e.g. from the dashboard's
  // Active Orders panel or the "Delayed Flights" KPI), find that order in the
  // grouped list, jump to its page so the row exists in the DOM, scroll it into
  // view, then strip the param so a manual refresh doesn't keep re-triggering.
  const [searchParams, setSearchParams] = useSearchParams();
  const ordParam = searchParams.get("ord");
  // Row id to scroll to after a deep-link page jump. Set here, consumed by the
  // scroll effect below — kept separate so stripping ?ord doesn't tear down the
  // pending scroll before the target page has rendered.
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  useEffect(() => {
    if (!ordParam) return;
    const idx = groupedOrders.findIndex(([no]) => no === ordParam);
    if (idx < 0) return;
    const targetPage = Math.floor(idx / pageSize) + 1;
    if (targetPage !== page) setPage(targetPage);
    setPendingScrollId(groupedOrders[idx]?.[1]?.[0]?.id ?? null);
    const next = new URLSearchParams(searchParams);
    next.delete("ord");
    setSearchParams(next, { replace: true });
  }, [ordParam, groupedOrders, page, searchParams, setSearchParams]);

  // Scroll the deep-linked order's first row into view once it renders on the
  // freshly selected page. Retries because the page switch re-renders the table
  // asynchronously; re-runs when `page` settles on the target.
  useEffect(() => {
    if (!pendingScrollId) return;
    const sel = `[data-arrival-row-id="${CSS.escape(pendingScrollId)}"]`;
    let done = false;
    const timers = [0, 120, 300, 600, 1000].map((delay) =>
      setTimeout(() => {
        if (done) return;
        const el = document.querySelector<HTMLElement>(sel);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          done = true;
          setPendingScrollId(null);
        }
      }, delay),
    );
    return () => timers.forEach((t) => clearTimeout(t));
  }, [pendingScrollId, page]);

  const pageStart = (page - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, groupedOrders.length);
  const pageGroups = groupedOrders.slice(pageStart, pageEnd);

  const pendingCount = filteredOrders.filter((o) => o.status === "Pending").length;
  const rangeActive = from !== "" || to !== "";
  const filtersActive = rangeActive || airline !== "All" || scope !== "All";
  const rangeLabel =
    from && to
      ? from === to
        ? from === today ? "Today" : from
        : `${from} → ${to}`
      : from
      ? `From ${from}`
      : to
      ? `Until ${to}`
      : "All Dates";

  const clearRange = () => { setFrom(""); setTo(""); };
  const setToday = () => { setFrom(today); setTo(today); };
  const clearAll = () => { setFrom(""); setTo(""); setAirline("All"); setScope("All"); };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Flight Orders — {rangeLabel}
            {airline !== "All" && <span className="normal-case font-normal"> · {airline}</span>}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 shadow-sm">
              <CalendarRange className="h-3.5 w-3.5 text-primary" />
              <Plane className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Scope</Label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as "All" | "Domestic" | "International")}
                className="h-7 bg-transparent border-0 text-sm focus:outline-none focus:ring-0 pr-1"
                aria-label="Filter by domestic or international"
              >
                <option value="All">All</option>
                <option value="Domestic">Domestic</option>
                <option value="International">International</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 shadow-sm">
              <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">From</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                max={to || undefined}
                className="h-7 w-[140px] border-0 shadow-none px-1 focus-visible:ring-0"
              />
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">To</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                min={from || undefined}
                className="h-7 w-[140px] border-0 shadow-none px-1 focus-visible:ring-0"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2.5 text-xs"
              onClick={setToday}
            >
              Today
            </Button>
            {rangeActive && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs text-muted-foreground"
                onClick={clearRange}
                aria-label="Clear date range"
              >
                <X className="h-3.5 w-3.5 mr-1" /> Date
              </Button>
            )}
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 shadow-sm">
              <Plane className="h-3.5 w-3.5 text-primary" />
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Airline</Label>
              <select
                value={airline}
                onChange={(e) => setAirline(e.target.value)}
                className="h-7 bg-transparent border-0 text-sm focus:outline-none focus:ring-0 pr-1"
              >
                <option value="All">All</option>
                {airlineOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            {filtersActive && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs text-muted-foreground"
                onClick={clearAll}
                aria-label="Clear all filters"
              >
                <X className="h-3.5 w-3.5 mr-1" /> Clear All
              </Button>
            )}
            {pendingCount > 0 && (
              <Badge className="bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/10">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive mr-1.5" />
                {pendingCount} Pending
              </Badge>
            )}
          </div>
        </div>

        <div className="text-xs text-muted-foreground mb-2">
          Showing <strong className="text-foreground tabular-nums">{filteredOrders.length}</strong> of {orders.length} order{orders.length === 1 ? "" : "s"} ·{" "}
          <strong className="text-foreground tabular-nums">{groupedOrders.length}</strong> Order #{groupedOrders.length === 1 ? "" : "s"}{" "}
          {groupedOrders.length > 0 && (
            <>· Page <strong className="text-foreground tabular-nums">{page}</strong> of <strong className="text-foreground tabular-nums">{totalPages}</strong></>
          )}
        </div>

        <div data-arrival-id="active-orders" className="border border-border rounded-md overflow-hidden">
          <Table>
            <TableHeader style={{ backgroundColor: "#F6F2EF" }}>
              <TableRow>
                <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Airline</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Date</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">ETD</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-right">PAX</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-right">Spec. Meals</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                    No flight orders match the selected filters.
                  </TableCell>
                </TableRow>
              ) : (() => {
                const rows: React.ReactNode[] = [];
                pageGroups.forEach(([orderNo, legs]) => {
                  // Decorative status accent stripe on the order group header.
                  const barStatus = legs[0]?.status;
                  const barColor =
                    barStatus === "Completed"  ? "#0f7a40" :
                    barStatus === "Dispatched" ? "#0f766e" :
                    barStatus === "Production" ? "#d97316" :
                    barStatus === "Approved"   ? "#3c3a40" :
                    "#E10101"; // Pending / default — brand red
                  rows.push(
                    <TableRow key={`grp-${orderNo}`} className="border-0 hover:bg-transparent">
                      <TableCell colSpan={8} className="p-0">
                        <div
                          className="relative flex items-center flex-wrap gap-[11px] border-t border-b py-3 pl-[18px] pr-4"
                          style={{
                            background: "#f6f2ef",
                            borderTopColor: "#e9e4e1",
                            borderBottomColor: "#f0ebe8",
                          }}
                        >
                          <span
                            className="absolute inset-y-0 left-0 w-[3px]"
                            style={{ background: barColor }}
                          />
                          <span className="text-sm font-bold tracking-[0.01em] text-[#E10101]">
                            {orderNo}
                          </span>
                          {legs.length > 1 && (
                            <span className="rounded-md border border-[#e9e4e1] bg-white px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.05em] text-[#6b6b72]">
                              {legs.length} flights
                            </span>
                          )}
                          <OrderStatusBadges legs={legs} />
                        </div>
                      </TableCell>
                    </TableRow>,
                  );
                  legs.forEach((o) => {
                    const isReturn = o.direction === "Return";
                    rows.push(
                      <TableRow key={o.id} data-arrival-row-id={o.id} className="hover:bg-muted/30">
                        <TableCell className="font-medium pl-6">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center rounded-[7px] bg-[#2a2528] px-[9px] py-1 text-xs font-bold tabular-nums text-white">
                              {o.flight}
                            </span>
                            <DirectionBadge direction={o.direction} />
                          </div>
                        </TableCell>
                        <TableCell>{o.airline}</TableCell>
                        <TableCell>
                          <span className={isReturn ? "text-muted-foreground" : undefined}>
                            {o.sector}
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums text-xs">{o.date}</TableCell>
                        <TableCell>{o.etd}</TableCell>
                        <TableCell className="text-right tabular-nums">{o.pax}</TableCell>
                        <TableCell className={"text-right tabular-nums" + (o.specialMeals === 0 ? " text-muted-foreground/60" : "")}>{o.specialMeals}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            onClick={() => onView(o)}
                          >
                            <Eye className="h-3 w-3 mr-1" /> View
                          </Button>
                        </TableCell>
                      </TableRow>,
                    );
                  });
                });
                return rows;
              })()}
            </TableBody>
          </Table>
        </div>

        {groupedOrders.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              Showing orders{" "}
              <strong className="text-foreground tabular-nums">{pageStart + 1}</strong>–
              <strong className="text-foreground tabular-nums">{pageEnd}</strong>{" "}
              of <strong className="text-foreground tabular-nums">{groupedOrders.length}</strong>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => setPage(1)}
                disabled={page === 1}
                aria-label="First page"
                title="First page"
              >
                «
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Previous page"
                title="Previous page"
              >
                ‹
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums min-w-[80px] text-center">
                Page {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                aria-label="Next page"
                title="Next page"
              >
                ›
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                aria-label="Last page"
                title="Last page"
              >
                »
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

type LegDraft = {
  flight: string;
  sector: string;
  etd: string;
  pax: number;
  specialMeals: number;
  status: FlightOrderStatus;
  direction: FlightDirection;
  roster: SpecialMealEntry[];
};

type RosterDraft = Omit<SpecialMealEntry, "id">;

const EMPTY_ROSTER_ROW: RosterDraft = { pnr: "", passengerName: "", seat: "", mealCode: "AVML" };

let rosterIdSeq = 9000;
const nextRosterId = () => `SM-${++rosterIdSeq}`;

function OrderCreate({
  onSave, nextOrderNo, nextRowSeq,
}: {
  onSave: (legs: FlightOrder[]) => void;
  nextOrderNo: string;
  nextRowSeq: number;
}) {
  const [scope, setScope] = useState<"Domestic" | "International">("Domestic");
  const [flight, setFlight] = useState("");
  const [airline, setAirline] = useState(AIRLINES[0]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [etd, setEtd] = useState("");
  const [pax, setPax] = useState("");
  const [direction, setDirection] = useState<FlightDirection>("Outbound");
  const [roster, setRoster] = useState<SpecialMealEntry[]>([]);
  const [bulkPaste, setBulkPaste] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [legs, setLegs] = useState<LegDraft[]>([]);

  const domesticCodes = ["DAC", "CGP", "CXB", "ZYL", "JSR"];
  const airportChoices = scope === "Domestic"
    ? AIRPORTS.filter((a) => domesticCodes.includes(a.code))
    : AIRPORTS;

  const onScopeChange = (next: "Domestic" | "International") => {
    setScope(next);
    // If the currently-picked airport doesn't belong to the new scope, clear it.
    const isDomCode = (code: string) => domesticCodes.includes(code);
    if (next === "Domestic") {
      if (from && !isDomCode(from)) setFrom("");
      if (to && !isDomCode(to)) setTo("");
    }
    // For International we keep whatever was selected — all codes are valid.
  };

  const resetForm = () => {
    setFlight(""); setFrom(""); setTo("");
    setEtd(""); setPax("");
    setDirection("Outbound");
    setRoster([]);
    setBulkPaste("");
    setShowBulk(false);
  };

  const addRosterRow = () =>
    setRoster((prev) => [...prev, { id: nextRosterId(), ...EMPTY_ROSTER_ROW }]);

  const updateRosterRow = (id: string, patch: Partial<RosterDraft>) =>
    setRoster((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeRosterRow = (id: string) =>
    setRoster((prev) => prev.filter((r) => r.id !== id));

  // Bulk paste: TSV/CSV in column order PNR, Name, Seat, Code
  const applyBulkPaste = () => {
    const lines = bulkPaste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast.error("Paste at least one row.");
      return;
    }
    const validCodes = new Set(SPECIAL_MEAL_CODES.map((m) => m.code));
    const parsed: SpecialMealEntry[] = [];
    let skipped = 0;
    lines.forEach((line) => {
      const parts = line.split(/[,\t]/).map((p) => p.trim());
      if (parts.length < 4) { skipped += 1; return; }
      const [pnr, passengerName, seat, mealCode] = parts;
      const code = mealCode.toUpperCase();
      if (!validCodes.has(code)) { skipped += 1; return; }
      parsed.push({ id: nextRosterId(), pnr, passengerName, seat, mealCode: code });
    });
    if (parsed.length === 0) {
      toast.error("No valid rows. Format: PNR, Name, Seat, Code (one per line).");
      return;
    }
    setRoster((prev) => [...prev, ...parsed]);
    setBulkPaste("");
    setShowBulk(false);
    toast.success(`Imported ${parsed.length} passenger${parsed.length === 1 ? "" : "s"}.${skipped ? ` ${skipped} skipped.` : ""}`);
  };

  const addLeg = () => {
    if (!flight.trim()) { toast.error("Flight number is required."); return; }
    if (!from || !to) { toast.error("Sector (From → To) is required."); return; }
    if (from === to) { toast.error("From and To must be different airports."); return; }
    const paxNum = Number(pax);
    if (!paxNum || paxNum <= 0) { toast.error("PAX must be greater than zero."); return; }
    // Drop any roster rows the user left blank
    const cleanRoster = roster.filter((r) => r.pnr.trim() && r.passengerName.trim() && r.seat.trim() && r.mealCode);
    setLegs((prev) => [
      ...prev,
      {
        flight: flight.trim().toUpperCase(),
        sector: `${from} → ${to}`,
        etd: etd || "—",
        pax: paxNum,
        specialMeals: cleanRoster.length,
        status: "Pending",
        direction,
        roster: cleanRoster,
      },
    ]);
    resetForm();
  };

  const removeLeg = (i: number) =>
    setLegs((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = () => {
    if (legs.length === 0) {
      toast.error("Add at least one flight.");
      return;
    }
    const rows: FlightOrder[] = legs.map((l, i) => ({
      id: `FO-${String(nextRowSeq + i).padStart(3, "0")}`,
      orderNo: nextOrderNo,
      flight: l.flight,
      airline,
      sector: l.sector,
      date,
      etd: l.etd,
      pax: l.pax,
      crew: 16,
      specialMeals: l.specialMeals,
      status: l.status,
      direction: l.direction,
      specialMealRoster: l.roster.length > 0 ? l.roster : undefined,
    }));
    onSave(rows);
    toast.success(`${nextOrderNo} created with ${legs.length} ${legs.length === 1 ? "flight" : "flights"}.`);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
              Create Flight Order
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              All flights added below share this Order # — each flight becomes its own row in the list.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={addLeg}>
              <Plus className="h-4 w-4 mr-1.5" /> Add Flight
            </Button>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-1.5" /> Save
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 mb-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Scope</Label>
            <div className="mt-1 flex w-fit rounded-md border border-input bg-background p-0.5 shadow-sm">
              {(["Domestic", "International"] as const).map((s) => {
                const active = scope === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onScopeChange(s)}
                    className={
                      "px-3 py-1.5 text-xs font-medium rounded-sm transition-colors " +
                      (active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Airline
            </Label>
            <select
              value={airline}
              onChange={(e) => setAirline(e.target.value)}
              className={selectCls}
            >
              {AIRLINES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Date
            </Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>

        <div className="border-t border-border pt-4 mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            New Flight
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Flight Number <span className="text-destructive">*</span>
            </Label>
            <Input
              value={flight}
              onChange={(e) => setFlight(e.target.value)}
              placeholder="e.g. BS-203"
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              From <span className="text-destructive">*</span>
            </Label>
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={selectCls}
            >
              <option value="">Select origin</option>
              {airportChoices.map((a) => (
                <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              To <span className="text-destructive">*</span>
            </Label>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={selectCls}
            >
              <option value="">Select destination</option>
              {airportChoices.map((a) => (
                <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              ETD
            </Label>
            <Input
              type="time"
              value={etd}
              onChange={(e) => setEtd(e.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              PAX <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              min={0}
              value={pax}
              onChange={(e) => setPax(e.target.value)}
              placeholder="0"
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Special Meals
            </Label>
            <div className="mt-1 h-9 rounded-md border border-input bg-muted/40 px-3 flex items-center justify-between text-sm">
              <span className="tabular-nums font-semibold text-foreground">{roster.length}</span>
              <span className="text-[11px] text-muted-foreground">auto from roster below</span>
            </div>
          </div>

          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Direction
            </Label>
            <div className="mt-1 flex w-fit rounded-md border border-input bg-background p-0.5 shadow-sm">
              {(["Outbound", "Return"] as FlightDirection[]).map((d) => {
                const active = direction === d;
                const isReturn = d === "Return";
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(d)}
                    className={
                      "px-3 py-1.5 text-xs font-medium rounded-sm transition-colors " +
                      (active
                        ? isReturn
                          ? "bg-navy/10 text-navy"
                          : "bg-success/10 text-success"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {isReturn ? "↺" : "↗"} {d}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Special Meal Roster (per leg) ──────────────────────────────── */}
        <div className="mt-6 border-t border-border pt-4">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Special Meal Roster
              </h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Optional — one row per passenger requiring a special meal on this flight.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => setShowBulk((v) => !v)}
              >
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
                {showBulk ? "Hide Paste" : "Bulk Paste"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={addRosterRow}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Passenger
              </Button>
            </div>
          </div>

          {showBulk && (
            <div className="mb-3 rounded-md border border-dashed border-border bg-muted/30 p-3">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Paste from spreadsheet — one passenger per line
              </Label>
              <p className="text-[10px] text-muted-foreground mt-0.5 mb-1.5 font-mono">
                PNR, Passenger Name, Seat, Meal Code   (comma or tab separated)
              </p>
              <textarea
                value={bulkPaste}
                onChange={(e) => setBulkPaste(e.target.value)}
                rows={4}
                className="w-full text-xs font-mono rounded-md border border-input bg-background px-3 py-2 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={"09QIBQ, NILAVRO SARKAR DIP, 21A, AVML\n09QI6J1, MD SHOJIB, 22A, FPML"}
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setBulkPaste(""); setShowBulk(false); }}>
                  Cancel
                </Button>
                <Button size="sm" className="h-7 text-xs" onClick={applyBulkPaste}>
                  Import {bulkPaste.split(/\r?\n/).filter((l) => l.trim()).length || 0} Rows
                </Button>
              </div>
            </div>
          )}

          <div className="border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-10 text-[10px] uppercase tracking-wider">SL</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider w-32">PNR</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">Passenger Name</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider w-20">Seat</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider w-40">Meal Type</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">
                      No special meals on this flight. Click <strong className="text-foreground">+ Add Passenger</strong> or <strong className="text-foreground">Bulk Paste</strong> to attach a manifest.
                    </TableCell>
                  </TableRow>
                ) : (
                  roster.map((r, i) => {
                    const meta = SPECIAL_MEAL_BY_CODE[r.mealCode];
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          <Input
                            value={r.pnr}
                            onChange={(e) => updateRosterRow(r.id, { pnr: e.target.value.toUpperCase() })}
                            placeholder="09QIBQ"
                            className="h-8 font-mono text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={r.passengerName}
                            onChange={(e) => updateRosterRow(r.id, { passengerName: e.target.value })}
                            placeholder="PASSENGER NAME"
                            className="h-8 text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={r.seat}
                            onChange={(e) => updateRosterRow(r.id, { seat: e.target.value.toUpperCase() })}
                            placeholder="21A"
                            className="h-8 font-mono text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <select
                            value={r.mealCode}
                            onChange={(e) => updateRosterRow(r.id, { mealCode: e.target.value })}
                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            title={meta?.name}
                          >
                            {SPECIAL_MEAL_CODES.map((m) => (
                              <option key={m.code} value={m.code}>{m.code} — {m.name}</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => removeRosterRow(r.id)}
                            aria-label="Remove passenger"
                          >
                            <X className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Flights
            </h4>
            <span className="text-xs text-muted-foreground">
              {legs.length === 0 ? "No flights added yet" : `${legs.length} ${legs.length === 1 ? "flight" : "flights"} on this order`}
            </span>
          </div>
          <div className="border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-14 text-xs uppercase tracking-wider">#</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">ETD</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">PAX</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Spec. Meals</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {legs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                      Fill the form above and click <strong className="text-foreground">Add Flight</strong> to attach a flight to this order.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {legs.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell className="tabular-nums text-xs">{i + 1}</TableCell>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1.5">
                            {l.flight}
                            <DirectionBadge direction={l.direction} />
                          </div>
                        </TableCell>
                        <TableCell>{l.sector}</TableCell>
                        <TableCell>{l.etd}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.pax}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.specialMeals}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => removeLeg(i)}
                            aria-label={`Remove flight${i + 1}`}
                          >
                            <X className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell colSpan={4} className="text-right uppercase text-xs tracking-wider">
                        Total
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {legs.reduce((s, l) => s + l.pax, 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {legs.reduce((s, l) => s + l.specialMeals, 0)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CrewMealCreate({
  onSave, nextOrderNo, nextRowSeq,
}: {
  onSave: (legs: FlightOrder[]) => void;
  nextOrderNo: string;
  nextRowSeq: number;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const slots = useMealSlots();
  const [scope, setScope] = useState<"Domestic" | "International">("Domestic");
  const [airline, setAirline] = useState(AIRLINES[0]);
  const [date, setDate] = useState(today);

  const [mealSlot, setMealSlot] = useState<MealSlot>(slots[0]?.name ?? "Breakfast");
  const [flight, setFlight] = useState("");
  const [from, setFrom] = useState("DAC");
  const [to, setTo] = useState("CGP");
  const [etd, setEtd] = useState("");
  const [pax, setPax] = useState("");
  const [crew, setCrew] = useState("4");
  const [specialMeals, setSpecialMeals] = useState("0");
  const [direction, setDirection] = useState<FlightDirection>("Outbound");

  const [legs, setLegs] = useState<LegDraft[]>([]);

  const domesticCodes = ["DAC", "CGP", "CXB", "ZYL", "JSR"];
  const airports = scope === "Domestic"
    ? AIRPORTS.filter((a) => domesticCodes.includes(a.code))
    : AIRPORTS;

  // Slot derived from ETD wins for display once the user has typed a time;
  // before that the explicit Meal Slot picker drives the badge.
  const derivedSlot = etd ? resolveMealSlot(etd, slots).name : null;
  const slotForBadge = derivedSlot ?? mealSlot;
  const slotMismatch = derivedSlot && derivedSlot !== mealSlot;

  const slotStartTime = (slot: MealSlot): string => {
    const def = slots.find((s) => s.name === slot);
    if (!def) return "";
    return `${String(def.from).padStart(2, "0")}:00`;
  };

  const onPickSlot = (slot: MealSlot) => {
    setMealSlot(slot);
    // Auto-seed ETD to that slot's start time (user can fine-tune)
    setEtd(slotStartTime(slot));
  };

  const resetForm = () => {
    setFlight(""); setEtd(""); setPax(""); setSpecialMeals("0");
    setCrew(scope === "Domestic" ? "4" : "14");
    setDirection("Outbound");
    // Keep the same mealSlot so the user can add several flights to one slot
    // in a row without re-picking it each time.
  };

  const onScopeChange = (next: "Domestic" | "International") => {
    setScope(next);
    setFrom(next === "Domestic" ? "DAC" : "DAC");
    setTo(next === "Domestic" ? "CGP" : "DXB");
    setCrew(next === "Domestic" ? "4" : "14");
  };

  const addLeg = () => {
    if (!flight.trim()) { toast.error("Flight number is required."); return; }
    if (!from || !to) { toast.error("Sector (From → To) is required."); return; }
    if (from === to) { toast.error("From and To must be different airports."); return; }
    if (!etd) { toast.error("ETD is required."); return; }
    const crewNum = Number(crew);
    if (!crewNum || crewNum <= 0) { toast.error("No of Crew must be greater than zero."); return; }
    setLegs((prev) => [
      ...prev,
      {
        flight: flight.trim().toUpperCase(),
        sector: `${from} → ${to}`,
        etd,
        pax: Number(pax) || 0,
        specialMeals: Number(specialMeals) || 0,
        status: "Pending",
        direction,
        roster: [],
      },
    ]);
    // Carry the crew count forward (usually constant across legs of the same order)
    resetForm();
  };

  const removeLeg = (i: number) =>
    setLegs((prev) => prev.filter((_, idx) => idx !== i));

  const handleSave = () => {
    if (legs.length === 0) {
      toast.error("Add at least one flight.");
      return;
    }
    // crew count needs to be captured per leg — read from each LegDraft entry.
    // Since LegDraft already covers status/etd/etc, append crew via a parallel
    // map by using the current `crew` input as a fallback when needed.
    const rows: FlightOrder[] = legs.map((l, i) => ({
      id: `FO-${String(nextRowSeq + i).padStart(3, "0")}`,
      orderNo: nextOrderNo,
      flight: l.flight,
      airline,
      sector: l.sector,
      date,
      etd: l.etd,
      pax: l.pax,
      crew: Number(crew) || (scope === "Domestic" ? 4 : 14),
      specialMeals: l.specialMeals,
      status: l.status,
      direction: l.direction,
    }));
    onSave(rows);
    toast.success(`${nextOrderNo} created with ${legs.length} ${legs.length === 1 ? "flight" : "flights"}.`);
  };

  // Build groups for the in-form preview table (uses the user's current slots)
  const groups = new Map<MealSlot, LegDraft[]>();
  slots.forEach((s) => groups.set(s.name, []));
  legs.forEach((l) => {
    groups.get(resolveMealSlot(l.etd, slots).name)!.push(l);
  });

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
              Create Crew Meal Order
              <span className="ml-2 font-mono text-xs text-primary normal-case tracking-normal">
                {nextOrderNo}
              </span>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add flights under this Order #. The meal slot (Breakfast / Heavy Snacks / Lunch / Dinner) is derived from each flight's ETD.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={addLeg}>
              <Plus className="h-4 w-4 mr-1.5" /> Add Flight
            </Button>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-1.5" /> Save
            </Button>
          </div>
        </div>

        {/* Order-level fields */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 mb-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Scope</Label>
            <div className="mt-1 flex w-fit rounded-md border border-input bg-background p-0.5 shadow-sm">
              {(["Domestic", "International"] as const).map((s) => {
                const active = scope === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onScopeChange(s)}
                    className={
                      "px-3 py-1.5 text-xs font-medium rounded-sm transition-colors " +
                      (active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Airline</Label>
            <select value={airline} onChange={(e) => setAirline(e.target.value)} className={selectCls}>
              {AIRLINES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </div>
        </div>

        <div className="border-t border-border pt-4 mb-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              New Flight
              <Badge
                variant="outline"
                className="ml-2 h-5 px-1.5 text-[10px] border-primary/30 bg-primary/5 text-primary"
              >
                {slotForBadge}
              </Badge>
            </h4>
            <p className="text-[11px] text-muted-foreground">
              Pick a meal slot — ETD will auto-seed to that slot's start time. You can still fine-tune the time below.
            </p>
          </div>

          <div className="inline-flex flex-wrap rounded-md border border-input bg-background p-0.5 shadow-sm">
            {slots.map((s) => {
              const active = mealSlot === s.name;
              return (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => onPickSlot(s.name)}
                  className={
                    "px-3 py-1.5 text-xs font-medium rounded-sm transition-colors " +
                    (active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground")
                  }
                  title={`${s.name} (${s.range})`}
                >
                  {s.name}
                  <span className="ml-1.5 text-[10px] opacity-70 tabular-nums">
                    {s.range}
                  </span>
                </button>
              );
            })}
          </div>

          {slotMismatch && (
            <div className="mt-2 text-[11px] text-warning flex items-center gap-1.5">
              <AlertCircle className="h-3 w-3" />
              ETD {etd} falls in <strong>{derivedSlot}</strong>, not the selected <strong>{mealSlot}</strong> slot. The entry will be grouped under {derivedSlot}.
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Flight Number <span className="text-destructive">*</span>
            </Label>
            <Input value={flight} onChange={(e) => setFlight(e.target.value)} placeholder="e.g. BS-141" className="mt-1" />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              ETD <span className="text-destructive">*</span>
            </Label>
            <Input type="time" value={etd} onChange={(e) => setEtd(e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              From <span className="text-destructive">*</span>
            </Label>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls}>
              {airports.map((a) => (
                <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              To <span className="text-destructive">*</span>
            </Label>
            <select value={to} onChange={(e) => setTo(e.target.value)} className={selectCls}>
              {airports.map((a) => (
                <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              No of Crew <span className="text-destructive">*</span>
            </Label>
            <Input type="number" min={0} value={crew} onChange={(e) => setCrew(e.target.value)} className="mt-1" />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">PAX</Label>
            <Input type="number" min={0} value={pax} onChange={(e) => setPax(e.target.value)} placeholder="0" className="mt-1" />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Special Meals</Label>
            <Input type="number" min={0} value={specialMeals} onChange={(e) => setSpecialMeals(e.target.value)} placeholder="0" className="mt-1" />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Direction</Label>
            <div className="mt-1 flex w-fit rounded-md border border-input bg-background p-0.5 shadow-sm">
              {(["Outbound", "Return"] as FlightDirection[]).map((d) => {
                const active = direction === d;
                const isReturn = d === "Return";
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(d)}
                    className={
                      "px-3 py-1.5 text-xs font-medium rounded-sm transition-colors " +
                      (active
                        ? isReturn
                          ? "bg-navy/10 text-navy"
                          : "bg-success/10 text-success"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {isReturn ? "↺" : "↗"} {d}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Legs grouped by meal slot */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Flights by Meal Slot
            </h4>
            <span className="text-xs text-muted-foreground">
              {legs.length === 0 ? "No flights added yet" : `${legs.length} ${legs.length === 1 ? "flight" : "flights"} on this order`}
            </span>
          </div>

          <div className="border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-12 text-xs uppercase tracking-wider">SL</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider w-28">Order #</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Flight</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Sector</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider w-20">ETD</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right w-20">PAX</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right w-24">Crew</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {legs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                      Add flights above and they'll appear here grouped by meal slot.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {slots.map((slot) => {
                      const rows = groups.get(slot.name)!;
                      if (rows.length === 0) return null;
                      const slotCrew = rows.reduce((s, l) => s + (Number(crew) || 0), 0);
                      return (
                        <Fragment key={slot.name}>
                          <TableRow className="bg-primary/5 border-t-2 border-t-primary/40 hover:bg-primary/10">
                            <TableCell colSpan={8} className="py-2">
                              <span className="font-semibold text-primary uppercase tracking-wider text-xs">
                                {slot.name}
                              </span>
                              <span className="ml-2 text-[10px] text-muted-foreground tabular-nums">
                                {formatSlotRange(slot)}
                              </span>
                            </TableCell>
                          </TableRow>
                          {rows.map((l) => {
                            const originalIndex = legs.indexOf(l);
                            return (
                              <TableRow key={originalIndex}>
                                <TableCell className="tabular-nums text-xs">{originalIndex + 1}</TableCell>
                                <TableCell className="font-mono text-xs text-primary">{nextOrderNo}</TableCell>
                                <TableCell className="font-medium">
                                  <div className="flex items-center gap-1.5">
                                    {l.flight}
                                    <DirectionBadge direction={l.direction} />
                                  </div>
                                </TableCell>
                                <TableCell>{l.sector}</TableCell>
                                <TableCell className="tabular-nums">{l.etd}</TableCell>
                                <TableCell className="text-right tabular-nums">{l.pax}</TableCell>
                                <TableCell className="text-right tabular-nums font-semibold">{Number(crew) || 0}</TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() => removeLeg(originalIndex)}
                                    aria-label={`Remove flight${originalIndex + 1}`}
                                  >
                                    <X className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          <TableRow className="bg-muted/30 font-semibold">
                            <TableCell colSpan={6} className="text-right uppercase text-[10px] tracking-wider">
                              {slot.name} Total
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-primary">{slotCrew}</TableCell>
                            <TableCell />
                          </TableRow>
                        </Fragment>
                      );
                    })}
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function groupByDate(rows: ParsedRow[]): { date: string; rows: ParsedRow[] }[] {
  const map = new Map<string, ParsedRow[]>();
  for (const r of rows) {
    const d = r.date ?? "Unknown";
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(r);
  }
  return Array.from(map.entries()).map(([date, rows]) => ({ date, rows }));
}

function formatDayLabel(dateStr: string) {
  if (dateStr === "Unknown") return "Unknown Date";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function BulkUpload({ onImport }: { onImport: (orders: FlightOrder[]) => void }) {
  const domFileRef = useRef<HTMLInputElement>(null);
  const [domFile, setDomFile] = useState<File | null>(null);
  const [domProgress, setDomProgress] = useState(0);
  const [domDone, setDomDone] = useState(false);
  const [domParsed, setDomParsed] = useState<ParsedRow[]>(SAMPLE_PARSED_DOM);

  const intlFileRef = useRef<HTMLInputElement>(null);
  const [intlFile, setIntlFile] = useState<File | null>(null);
  const [intlProgress, setIntlProgress] = useState(0);
  const [intlDone, setIntlDone] = useState(false);
  const [intlParsed, setIntlParsed] = useState<ParsedRow[]>(SAMPLE_PARSED_INTL);

  const [importConfirmed, setImportConfirmed] = useState(false);
  const [showFinalReview, setShowFinalReview] = useState(false);
  const [mealEditMode, setMealEditMode] = useState(false);
  const [summaryEdit, setSummaryEdit] = useState<{
    intlDepMeal: number; intlDepChml: number; intlRetMeal: number; intlRetChml: number; intlRetVgml: number;
    usbaZenith: number; usbaPax: number; usbaBreakfast: number; usbaLunch: number;
    aaaZenith: number; aaaPax: number;
    crewHSnacks: number; crewLunch: number; crewDinner: number;
  } | null>(null);
  const [showCrewMenuModal, setShowCrewMenuModal] = useState(false);
  const [crewMenuContext, setCrewMenuContext] = useState<"intl" | "dom">("dom");
  const [showViewMenuModal, setShowViewMenuModal] = useState<"intl" | "dom" | null>(null);
  const [crewMenuQty, setCrewMenuQty] = useState({
    hSnacks: 8, lunch: 0, dinner: 4,
    bcBreakfast: 12, bcLunch: 12, ecSnack: 270, ecMeal: 0,
  });
  const [importedOrders, setImportedOrders] = useState<FlightOrder[]>([]);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderSent, setOrderSent] = useState(false);

  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([
    { message: "Bulk upload ready for validation", user: "ops.user", role: "Flight Ops", at: "2026-05-19 06:12" },
  ]);

  const [editRow, setEditRow] = useState<{ source: "dom" | "intl"; data: ParsedRow } | null>(null);

  const addLog = (message: string) => {
    const now = new Date();
    setActivityLog((current) => [
      { message, user: "GM/Admin", role: "General Manager", at: `${now.toLocaleDateString()} ${now.toLocaleTimeString()}` },
      ...current,
    ]);
  };

  const bothDone = domDone && intlDone;

  const startDomUpload = (f: File) => {
    setDomFile(f);
    setDomDone(false);
    setDomProgress(0);
    setDomParsed(SAMPLE_PARSED_DOM);
    const t = setInterval(() => {
      setDomProgress((p) => {
        if (p >= 100) {
          clearInterval(t);
          setDomDone(true);
          toast.success(`Domestic file parsed — ${SAMPLE_PARSED_DOM.filter((r) => r.valid).length}/${SAMPLE_PARSED_DOM.length} rows valid.`);
          addLog("Domestic orders file parsed and validated");
          return 100;
        }
        return p + 10;
      });
    }, 100);
  };

  const startIntlUpload = (f: File) => {
    setIntlFile(f);
    setIntlDone(false);
    setIntlProgress(0);
    setIntlParsed(SAMPLE_PARSED_INTL);
    const t = setInterval(() => {
      setIntlProgress((p) => {
        if (p >= 100) {
          clearInterval(t);
          setIntlDone(true);
          toast.success(`International file parsed — ${SAMPLE_PARSED_INTL.filter((r) => r.valid).length}/${SAMPLE_PARSED_INTL.length} rows valid.`);
          addLog("International orders file parsed and validated");
          return 100;
        }
        return p + 10;
      });
    }, 100);
  };

  const updateDomField = (rowNum: number, field: keyof ParsedRow, value: string) => {
    setDomParsed((prev) => prev.map((r) => (r.row === rowNum ? { ...r, [field]: value } : r)));
  };

  const updateIntlField = (rowNum: number, field: keyof ParsedRow, value: string) => {
    setIntlParsed((prev) => prev.map((r) => (r.row === rowNum ? { ...r, [field]: value } : r)));
  };

  const confirmImport = () => {
    const allParsed = [...domParsed, ...intlParsed];
    const valid = allParsed.filter((r) => r.valid);
    const today = new Date().toISOString().slice(0, 10);
    const orders: FlightOrder[] = valid.map((r, i) => ({
      id: `FO-IMP-${String(Date.now()).slice(-4)}-${i + 1}`,
      orderNo: r.id,
      flight: r.flight,
      airline: r.airline,
      sector: r.sector,
      date: today,
      etd: r.etd,
      pax: r.pax,
      crew: 16,
      specialMeals: r.specialMeals,
      status: "Pending",
      direction: "Outbound",
    }));
    setImportedOrders(orders);
    setImportConfirmed(true);
    addLog(`Confirmed import of ${orders.length} orders`);
    toast.success(`${orders.length} orders confirmed. ${allParsed.length - valid.length} skipped.`);
  };

  // Summary values derived from parsed data
  const validDom = domParsed.filter((r) => r.valid);
  const validIntl = intlParsed.filter((r) => r.valid);
  const usbaDom = validDom.filter((r) => r.airline === "US-Bangla");
  const aaaDom = validDom.filter((r) => r.airline === "Air Astra");
  const usbaZenith = usbaDom.reduce((s, r) => s + (r.zenLoad ?? 0), 0);
  const usbaPax = usbaDom.reduce((s, r) => s + r.pax, 0);
  const usbaBreakfast = usbaDom.filter((r) => r.etd <= "10:30").reduce((s, r) => s + (r.totalMeal ?? 0), 0);
  const usbaLunch = usbaDom.filter((r) => r.etd > "10:30" && r.etd <= "14:30").reduce((s, r) => s + (r.totalMeal ?? 0), 0);
  const aaaZenith = aaaDom.reduce((s, r) => s + r.pax, 0);
  const aaaPax = aaaDom.reduce((s, r) => s + r.pax, 0);
  const totalZenith = usbaZenith + aaaZenith;
  const crewHSnacks = validDom.filter((r) => r.etd <= "10:30").reduce((s, r) => s + (r.crewMeal ?? 0), 0);
  const crewLunch = validDom.filter((r) => r.etd > "10:30" && r.etd <= "14:30").reduce((s, r) => s + (r.crewMeal ?? 0), 0);
  const crewDinner = validDom.filter((r) => r.etd > "14:30").reduce((s, r) => s + (r.crewMeal ?? 0), 0);
  const intlDepMeal = validIntl.reduce((s, r) => s + (r.bcMeal ?? 0) + (r.ecMeal ?? 0), 0);
  const intlDepChml = validIntl.reduce((s, r) => s + (r.chml ?? 0), 0);
  const intlDepTotal = intlDepMeal + intlDepChml;
  const intlRetVgml = validIntl.reduce((s, r) => s + (r.vgml ?? 0), 0);
  const intlRetTotal = intlRetVgml;
  const intlGrandTotal = intlDepTotal + intlRetTotal;
  const totalFlights = importedOrders.length;
  const totalMeals = importedOrders.reduce((s, o) => s + o.pax + o.specialMeals, 0);
  const importDate = new Date().toISOString().slice(0, 10);

  const handleOrderMeal = () => {
    setOrderLoading(true);
    setTimeout(() => {
      setOrderLoading(false);
      setOrderSent(true);
      const refId = `OMR-${Date.now().toString().slice(-6)}`;
      addLog(
        `Meal order for next 24 hours has been created and forwarded to Meal Planner — Ref: ${refId} · ${totalFlights} flights · ${totalMeals} meals · Confirmed by system`,
      );
      onImport(importedOrders);
      toast.success("Meal order forwarded to Meal Planner.");
    }, 1500);
  };

  const domValidCount = domParsed.filter((r) => r.valid).length;
  const domInvalidCount = domParsed.length - domValidCount;
  const intlValidCount = intlParsed.filter((r) => r.valid).length;
  const intlInvalidCount = intlParsed.length - intlValidCount;
  const allInvalidCount = domInvalidCount + intlInvalidCount;

  const uploadCols: Column<RecentUploadRow>[] = [
    { key: "id", header: "Upload ID" },
    { key: "file", header: "File" },
    { key: "rows", header: "Rows" },
    { key: "valid", header: "Valid" },
    { key: "errors", header: "Errors", render: (r) => <span className={r.errors > 0 ? "text-destructive font-medium" : ""}>{r.errors}</span> },
    { key: "by", header: "Uploaded By" },
    { key: "at", header: "Date" },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-6">
      {/* Upload section */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
              Bulk Upload
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => toast.success("Sample template downloaded.")}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Sample Template
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <History className="h-3.5 w-3.5 mr-1.5" /> Upload History
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  {recentUploads.map((u) => (
                    <DropdownMenuItem key={u.id} className="flex justify-between">
                      <span className="truncate">{u.file}</span>
                      <span className="text-xs text-muted-foreground ml-2">{u.at.split(" ")[0]}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <input
            ref={domFileRef}
            type="file"
            accept=".xlsx,.xls,.csv,.doc,.docx"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) startDomUpload(f); }}
          />
          <input
            ref={intlFileRef}
            type="file"
            accept=".xlsx,.xls,.csv,.doc,.docx"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) startIntlUpload(f); }}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Domestic upload slot */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) startDomUpload(f); }}
              className="rounded-lg border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 to-transparent py-8 text-center"
            >
              <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 grid place-items-center mb-3">
                <FileSpreadsheet className="h-6 w-6 text-primary" />
              </div>
              <h4 className="text-sm font-semibold">Domestic Flights</h4>
              <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls, .csv, .doc, .docx</p>
              <Button size="sm" className="mt-3" onClick={() => domFileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Select File
              </Button>
              {domFile && (
                <div className="mt-4 max-w-xs mx-auto text-left px-4">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium truncate">{domFile.name}</span>
                    <span className="text-muted-foreground">{domProgress}%</span>
                  </div>
                  <Progress value={domProgress} />
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                    {domDone ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        <span className={domInvalidCount > 0 ? "text-warning" : "text-success"}>
                          {domValidCount}/{domParsed.length} rows valid
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Parsing…</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* International upload slot */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) startIntlUpload(f); }}
              className="rounded-lg border-2 border-dashed border-navy/30 bg-gradient-to-br from-navy/5 to-transparent py-8 text-center"
            >
              <div className="mx-auto h-12 w-12 rounded-full bg-navy/10 grid place-items-center mb-3">
                <FileSpreadsheet className="h-6 w-6 text-navy" />
              </div>
              <h4 className="text-sm font-semibold">International Flights</h4>
              <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls, .csv, .doc, .docx</p>
              <Button size="sm" variant="outline" className="mt-3 border-navy/30 text-navy hover:bg-navy/5" onClick={() => intlFileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Select File
              </Button>
              {intlFile && (
                <div className="mt-4 max-w-xs mx-auto text-left px-4">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium truncate">{intlFile.name}</span>
                    <span className="text-muted-foreground">{intlProgress}%</span>
                  </div>
                  <Progress value={intlProgress} />
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                    {intlDone ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        <span className={intlInvalidCount > 0 ? "text-warning" : "text-success"}>
                          {intlValidCount}/{intlParsed.length} rows valid
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Parsing…</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {!bothDone && (domDone || intlDone) && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Upload both Domestic and International files to continue
            </p>
          )}
        </CardContent>
      </Card>

      {/* Per-file preview — Domestic */}
      {domDone && !importConfirmed && !showFinalReview && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary uppercase tracking-wider">
                  Domestic Flights
                </span>
                <span className="text-xs text-muted-foreground">Zenith PAX Load</span>
              </div>
              {domInvalidCount > 0 && (
                <span className="inline-flex items-center text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5 text-warning mr-1" />
                  {domInvalidCount} invalid row{domInvalidCount > 1 ? "s" : ""} highlighted
                </span>
              )}
            </div>
            <div className="space-y-3">
              {groupByDate(domParsed).map(({ date, rows: dayRows }) => (
                <div key={date} className="border border-border rounded-md overflow-hidden overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow className="bg-primary/5 border-b border-primary/20">
                        <TableHead colSpan={15} className="py-2">
                          <span className="font-semibold text-primary text-xs">{formatDayLabel(date)}</span>
                        </TableHead>
                      </TableRow>
                      <TableRow>
                        <TableHead colSpan={7} className="text-xs uppercase tracking-wider text-center border-r border-border bg-primary/5 text-primary py-1.5">
                          Departure Flight
                        </TableHead>
                        <TableHead colSpan={8} className="text-xs uppercase tracking-wider text-center bg-navy/5 text-navy py-1.5">
                          Return Flight
                        </TableHead>
                      </TableRow>
                      <TableRow>
                        <TableHead className="text-xs uppercase tracking-wider">AIRLINE NAME</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">FLT NO</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">SECTOR</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">DEP TIME</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">B/C</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">E/C</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right border-r border-border">TOTAL MEAL</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">FLT NO</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">SECTOR</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">B/C</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">E/C</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">CHML</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">VGML</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">CREW MEAL</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">ACTIONS</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dayRows.map((r) => (
                        <TableRow key={`dom-${r.row}`} className={!r.valid ? "bg-destructive/10" : ""}>
                          <TableCell className="text-xs">{r.airline}</TableCell>
                          <TableCell>
                            <input
                              value={r.flight}
                              onChange={(e) => updateDomField(r.row, "flight", e.target.value)}
                              className="bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none w-full text-sm font-medium"
                            />
                          </TableCell>
                          <TableCell className="text-xs">{r.sector}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.etd}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                          <TableCell className="text-right tabular-nums text-xs border-r border-border">{r.totalMeal ?? "—"}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.returnFlight ?? "—"}</TableCell>
                          <TableCell className="text-xs">{r.returnSector ?? "—"}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{r.crewMeal ?? "—"}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <StatusBadge status={r.valid ? "OK" : "Failed"} />
                              {!r.valid && (
                                <Button size="sm" variant="outline" className="h-6 px-2 text-xs"
                                  onClick={() => setEditRow({ source: "dom", data: { ...r } })}>
                                  <Pencil className="h-3 w-3 mr-1" />Edit
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-file preview — International */}
      {intlDone && !importConfirmed && !showFinalReview && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center rounded-md bg-navy/10 px-2.5 py-1 text-xs font-semibold text-navy uppercase tracking-wider">
                  International Flights
                </span>
                <span className="text-xs text-muted-foreground">Zenith PAX Load</span>
              </div>
              {intlInvalidCount > 0 && (
                <span className="inline-flex items-center text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5 text-warning mr-1" />
                  {intlInvalidCount} invalid row{intlInvalidCount > 1 ? "s" : ""} highlighted
                </span>
              )}
            </div>
            <div className="space-y-3">
              {groupByDate(intlParsed).map(({ date, rows: dayRows }) => (
                <div key={date} className="border border-border rounded-md overflow-hidden overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow className="bg-navy/5 border-b border-navy/20">
                        <TableHead colSpan={15} className="py-2">
                          <span className="font-semibold text-navy text-xs">{formatDayLabel(date)}</span>
                        </TableHead>
                      </TableRow>
                      <TableRow>
                        <TableHead colSpan={7} className="text-xs uppercase tracking-wider text-center border-r border-border bg-primary/5 text-primary py-1.5">
                          Departure Flight
                        </TableHead>
                        <TableHead colSpan={8} className="text-xs uppercase tracking-wider text-center bg-navy/5 text-navy py-1.5">
                          Return Flight
                        </TableHead>
                      </TableRow>
                      <TableRow>
                        <TableHead className="text-xs uppercase tracking-wider">AIRLINE NAME</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">FLT NO</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">SECTOR</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">DEP TIME</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">B/C</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">E/C</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right border-r border-border">TOTAL MEAL</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">FLT NO</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">SECTOR</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">B/C</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">E/C</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">CHML</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">VGML</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-right">CREW MEAL</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">ACTIONS</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dayRows.map((r) => (
                        <TableRow key={`intl-${r.row}`} className={!r.valid ? "bg-destructive/10" : ""}>
                          <TableCell className="text-xs">{r.airline}</TableCell>
                          <TableCell>
                            <input
                              value={r.flight}
                              onChange={(e) => updateIntlField(r.row, "flight", e.target.value)}
                              className="bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none w-full text-sm font-medium"
                            />
                          </TableCell>
                          <TableCell className="text-xs">{r.sector}</TableCell>
                          <TableCell className="text-xs tabular-nums">{r.etd}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{r.bcLoad ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{r.ecLoad ?? "—"}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground border-r border-border">—</TableCell>
                          <TableCell className="text-xs text-muted-foreground">—</TableCell>
                          <TableCell className="text-xs text-muted-foreground">—</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{r.bcMeal ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{r.ecMeal ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{r.chml ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{r.vgml ?? "—"}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <StatusBadge status={r.valid ? "OK" : "Failed"} />
                              {!r.valid && (
                                <Button size="sm" variant="outline" className="h-6 px-2 text-xs"
                                  onClick={() => setEditRow({ source: "intl", data: { ...r } })}>
                                  <Pencil className="h-3 w-3 mr-1" />Edit
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirm Import — available when both files are done */}
      {bothDone && !importConfirmed && !showFinalReview && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => toast.success("Error report downloaded.")}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Error Report
          </Button>
          <Button onClick={() => setShowFinalReview(true)}>Confirm Import</Button>
        </div>
      )}

      {/* Final review — combined read-only table + Save and Continue */}
      {showFinalReview && !importConfirmed && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground">
                Final Review
              </h3>
              {allInvalidCount > 0 && (
                <span className="inline-flex items-center text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5 text-warning mr-1" />
                  {allInvalidCount} invalid row{allInvalidCount > 1 ? "s" : ""} highlighted
                </span>
              )}
            </div>
            <div className="border border-border rounded-md overflow-hidden overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead colSpan={7} className="text-xs uppercase tracking-wider text-center border-r border-border bg-primary/5 text-primary py-1.5">
                      Departure Flight
                    </TableHead>
                    <TableHead colSpan={8} className="text-xs uppercase tracking-wider text-center bg-navy/5 text-navy py-1.5">
                      Return Flight
                    </TableHead>
                  </TableRow>
                  <TableRow>
                    <TableHead className="text-xs uppercase tracking-wider">AIRLINE NAME</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">FLT NO</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">SECTOR</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">DEP TIME</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">B/C</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">E/C</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right border-r border-border">TOTAL MEAL</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">FLT NO</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">SECTOR</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">B/C</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">E/C</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">CHML</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">VGML</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-right">CREW MEAL</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">STATUS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-primary/5 border-t-2 border-t-primary/40 hover:bg-primary/10">
                    <TableCell colSpan={15} className="py-2">
                      <span className="font-semibold text-primary uppercase tracking-wider text-xs">Domestic</span>
                    </TableCell>
                  </TableRow>
                  {domParsed.map((r) => (
                    <TableRow key={`final-dom-${r.row}`} className={!r.valid ? "bg-destructive/10" : ""}>
                      <TableCell className="text-xs">{r.airline}</TableCell>
                      <TableCell className="text-sm font-medium">{r.flight}</TableCell>
                      <TableCell className="text-xs">{r.sector}</TableCell>
                      <TableCell className="text-xs tabular-nums">{r.etd}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                      <TableCell className="text-right tabular-nums text-xs border-r border-border">{r.totalMeal ?? "—"}</TableCell>
                      <TableCell className="text-xs tabular-nums">{r.returnFlight ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.returnSector ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{r.crewMeal ?? "—"}</TableCell>
                      <TableCell><StatusBadge status={r.valid ? "OK" : "Failed"} /></TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-navy/5 border-t-2 border-t-navy/40 hover:bg-navy/10">
                    <TableCell colSpan={15} className="py-2">
                      <span className="font-semibold text-navy uppercase tracking-wider text-xs">International</span>
                    </TableCell>
                  </TableRow>
                  {intlParsed.map((r) => (
                    <TableRow key={`final-intl-${r.row}`} className={!r.valid ? "bg-destructive/10" : ""}>
                      <TableCell className="text-xs">{r.airline}</TableCell>
                      <TableCell className="text-sm font-medium">{r.flight}</TableCell>
                      <TableCell className="text-xs">{r.sector}</TableCell>
                      <TableCell className="text-xs tabular-nums">{r.etd}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{r.bcLoad ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{r.ecLoad ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground border-r border-border">—</TableCell>
                      <TableCell className="text-xs text-muted-foreground">—</TableCell>
                      <TableCell className="text-xs text-muted-foreground">—</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{r.bcMeal ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{r.ecMeal ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{r.chml ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{r.vgml ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>
                      <TableCell><StatusBadge status={r.valid ? "OK" : "Failed"} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end mt-4">
              <Button onClick={confirmImport}>Save and Continue</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit failed row dialog */}
      <Dialog open={editRow !== null} onOpenChange={(open) => { if (!open) setEditRow(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Row — {editRow?.data.flight}</DialogTitle>
          </DialogHeader>
          {editRow && (
            <div className="grid grid-cols-2 gap-3 py-2">
              <div className="col-span-2">
                <Label className="text-xs">Flight No</Label>
                <Input className="mt-1 h-8 text-sm" value={editRow.data.flight}
                  onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, flight: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-xs">Sector</Label>
                <Input className="mt-1 h-8 text-sm" value={editRow.data.sector}
                  onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, sector: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-xs">DEP Time</Label>
                <Input className="mt-1 h-8 text-sm" value={editRow.data.etd}
                  onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, etd: e.target.value } }))} />
              </div>
              {editRow.source === "dom" ? (
                <>
                  <div>
                    <Label className="text-xs">ZEN Load</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.zenLoad ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, zenLoad: Number(e.target.value), totalMeal: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <Label className="text-xs">SPEC MEAL</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.specMeal ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, specMeal: Number(e.target.value), specialMeals: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <Label className="text-xs">CREW MEAL</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.crewMeal ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, crewMeal: Number(e.target.value) } }))} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label className="text-xs">B/C Load</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.bcLoad ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, bcLoad: Number(e.target.value), bcMeal: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <Label className="text-xs">E/C Load</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.ecLoad ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, ecLoad: Number(e.target.value), ecMeal: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <Label className="text-xs">CHML</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.chml ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, chml: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <Label className="text-xs">VGML</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.vgml ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, vgml: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <Label className="text-xs">SPEC MEAL</Label>
                    <Input type="number" min={0} className="mt-1 h-8 text-sm" value={editRow.data.specMeal ?? ""}
                      onChange={(e) => setEditRow((prev) => prev && ({ ...prev, data: { ...prev.data, specMeal: Number(e.target.value), specialMeals: Number(e.target.value) } }))} />
                  </div>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button onClick={() => {
              if (!editRow) return;
              const updated = { ...editRow.data, valid: true,
                pax: editRow.source === "dom"
                  ? (editRow.data.zenLoad ?? editRow.data.pax)
                  : (editRow.data.bcLoad ?? 0) + (editRow.data.ecLoad ?? 0),
              };
              if (editRow.source === "dom") {
                setDomParsed((prev) => prev.map((r) => r.row === updated.row ? updated : r));
              } else {
                setIntlParsed((prev) => prev.map((r) => r.row === updated.row ? updated : r));
              }
              setEditRow(null);
              toast.success(`Row ${updated.row} updated and marked valid.`);
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Menu Modal */}
      <Dialog open={showViewMenuModal !== null} onOpenChange={(open) => { if (!open) setShowViewMenuModal(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {showViewMenuModal === "intl" ? "International" : "Domestic"} Meal Configuration — {formatDayLabel(importDate)}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {showViewMenuModal === "intl" ? (
              <>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-navy mb-2">Departure Meals</div>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Meal Type</th>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Menu Item</th>
                          <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold">Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">B/C Departure</td>
                          <td className="px-3 py-2">Grilled Chicken + Rice</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.intlDepMeal ?? intlDepMeal}</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">E/C Departure</td>
                          <td className="px-3 py-2">Standard Box Meal</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.intlDepMeal ?? intlDepMeal}</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">Departure CHML</td>
                          <td className="px-3 py-2">Children's Meal</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.intlDepChml ?? intlDepChml}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-navy mb-2">Return Meals</div>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Meal Type</th>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Menu Item</th>
                          <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold">Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">Return VGML</td>
                          <td className="px-3 py-2">Vegetarian Meal</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.intlRetVgml ?? intlRetVgml}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">US-Bangla</div>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Meal Type</th>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Menu Item</th>
                          <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold">Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">Breakfast</td>
                          <td className="px-3 py-2">JBR + CKN Buggati</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.usbaBreakfast ?? usbaBreakfast}</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">Lunch</td>
                          <td className="px-3 py-2">Rice + Mutton Curry</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.usbaLunch ?? usbaLunch}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Air Astra</div>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Meal Type</th>
                          <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Menu Item</th>
                          <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold">Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">Zenith Load</td>
                          <td className="px-3 py-2">Standard Allocation</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.aaaZenith ?? aaaZenith}</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 text-muted-foreground">Pax Load</td>
                          <td className="px-3 py-2">Standard Allocation</td>
                          <td className="px-3 py-2 text-right tabular-nums">{summaryEdit?.aaaPax ?? aaaPax}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setCrewMenuContext(showViewMenuModal === "intl" ? "intl" : "dom");
                setShowViewMenuModal(null);
                setShowCrewMenuModal(true);
              }}
            >
              + Add Crew Meal
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowViewMenuModal(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Crew Menu Modal */}
      <Dialog open={showCrewMenuModal} onOpenChange={setShowCrewMenuModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Crew Meal Configuration — {formatDayLabel(importDate)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {crewMenuContext === "dom" && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">Domestic Crew Meals</div>
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Meal Type</th>
                        <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Menu Item</th>
                        <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">H. Snacks</td>
                        <td className="px-3 py-2">Sandwich + Orange Juice</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={crewMenuQty.hSnacks}
                            onChange={(e) => setCrewMenuQty((p) => ({ ...p, hSnacks: Number(e.target.value) }))}
                            className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                        </td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">Lunch</td>
                        <td className="px-3 py-2">Rice + Mutton Curry</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={crewMenuQty.lunch}
                            onChange={(e) => setCrewMenuQty((p) => ({ ...p, lunch: Number(e.target.value) }))}
                            className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                        </td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">Dinner</td>
                        <td className="px-3 py-2">Noodles + Soup + Juice</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={crewMenuQty.dinner}
                            onChange={(e) => setCrewMenuQty((p) => ({ ...p, dinner: Number(e.target.value) }))}
                            className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {crewMenuContext === "intl" && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-navy mb-2">International Crew Meals</div>
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Meal Type</th>
                        <th className="text-left px-3 py-2 text-xs uppercase tracking-wider font-semibold">Menu Item</th>
                        <th className="text-right px-3 py-2 text-xs uppercase tracking-wider font-semibold">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">B/C Breakfast</td>
                        <td className="px-3 py-2">Continental Breakfast Platter</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={crewMenuQty.bcBreakfast}
                            onChange={(e) => setCrewMenuQty((p) => ({ ...p, bcBreakfast: Number(e.target.value) }))}
                            className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                        </td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">B/C Lunch</td>
                        <td className="px-3 py-2">Chef's Special — Rice + Fish</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={crewMenuQty.bcLunch}
                            onChange={(e) => setCrewMenuQty((p) => ({ ...p, bcLunch: Number(e.target.value) }))}
                            className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                        </td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">E/C Snack</td>
                        <td className="px-3 py-2">Biscuit + Coffee / Tea</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={crewMenuQty.ecSnack}
                            onChange={(e) => setCrewMenuQty((p) => ({ ...p, ecSnack: Number(e.target.value) }))}
                            className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                        </td>
                      </tr>
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">E/C Meal</td>
                        <td className="px-3 py-2">Standard Box Meal</td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={crewMenuQty.ecMeal}
                            onChange={(e) => setCrewMenuQty((p) => ({ ...p, ecMeal: Number(e.target.value) }))}
                            className="w-20 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCrewMenuModal(false)}>Close</Button>
            <Button variant="secondary" onClick={() => {
              if (summaryEdit) {
                setSummaryEdit((p) => p && { ...p,
                  crewHSnacks: crewMenuQty.hSnacks,
                  crewLunch: crewMenuQty.lunch,
                  crewDinner: crewMenuQty.dinner,
                });
              }
              toast.success("Crew meal quantities saved.");
            }}>
              Save
            </Button>
            <Button onClick={() => {
              if (summaryEdit) {
                setSummaryEdit((p) => p && { ...p,
                  crewHSnacks: crewMenuQty.hSnacks,
                  crewLunch: crewMenuQty.lunch,
                  crewDinner: crewMenuQty.dinner,
                });
              }
              setShowCrewMenuModal(false);
              toast.success("Crew meal quantities updated.");
            }}>
              Order Meal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post-import: success banner, meal summary, order meal action bar */}
      {importConfirmed && (
        <>
          <div className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Import confirmed — {importedOrders.length} orders
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {importDate} · {domParsed.filter((r) => r.valid).length} domestic · {intlParsed.filter((r) => r.valid).length} international
              </p>
            </div>
          </div>

          <Card>
            <CardContent className="pt-6">
              <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground mb-4">
                Meal Order Summary — Next 24 Hours
                <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground">{importDate} · From Zenith PAX Load</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* International column */}
                <div className="rounded-lg border border-navy/20 bg-navy/5 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-navy">International</h4>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowViewMenuModal("intl")}>View Menu</Button>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Departure</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Departure Meal</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlDepMeal}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlDepMeal: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{intlDepMeal}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Departure CHML</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlDepChml}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlDepChml: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{intlDepChml}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm font-semibold border-t border-navy/20 pt-1">
                      <span>Departure Total</span>
                      <span className="tabular-nums">
                        {mealEditMode && summaryEdit ? summaryEdit.intlDepMeal + summaryEdit.intlDepChml : intlDepTotal}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Return</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Return Meal</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlRetMeal}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlRetMeal: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">0</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Return CHML</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlRetChml}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlRetChml: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">0</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Return VGML</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.intlRetVgml}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, intlRetVgml: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{intlRetVgml}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm font-semibold border-t border-navy/20 pt-1">
                      <span>Return Total</span>
                      <span className="tabular-nums">
                        {mealEditMode && summaryEdit ? summaryEdit.intlRetMeal + summaryEdit.intlRetChml + summaryEdit.intlRetVgml : intlRetTotal}
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-between text-sm font-bold border-t-2 border-navy/30 pt-2 mt-1">
                    <span>Total Meal (Departure+Return)</span>
                    <span className="tabular-nums">
                      {mealEditMode && summaryEdit
                        ? summaryEdit.intlDepMeal + summaryEdit.intlDepChml + summaryEdit.intlRetMeal + summaryEdit.intlRetChml + summaryEdit.intlRetVgml
                        : intlGrandTotal}
                    </span>
                  </div>
                </div>

                {/* Domestic column */}
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-primary">Domestic</h4>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowViewMenuModal("dom")}>View Menu</Button>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">US-Bangla</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Zenith Load</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.usbaZenith}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, usbaZenith: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{usbaZenith}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Pax Load</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.usbaPax}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, usbaPax: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{usbaPax}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Breakfast (JBR + CKN Buggati)</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.usbaBreakfast}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, usbaBreakfast: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{usbaBreakfast}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Lunch</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.usbaLunch}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, usbaLunch: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{usbaLunch}</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Air Astra</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Zenith Load</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.aaaZenith}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, aaaZenith: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{aaaZenith}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Pax Load</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.aaaPax}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, aaaPax: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{aaaPax}</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Crew Meals</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">H. Snacks</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.crewHSnacks}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, crewHSnacks: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{crewHSnacks}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Lunch</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.crewLunch}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, crewLunch: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{crewLunch}</span>
                      )}
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Dinner</span>
                      {mealEditMode && summaryEdit ? (
                        <input type="number" min={0} value={summaryEdit.crewDinner}
                          onChange={(e) => setSummaryEdit((p) => p && { ...p, crewDinner: Number(e.target.value) })}
                          className="w-24 h-7 rounded border border-input bg-background text-right text-sm px-2 tabular-nums" />
                      ) : (
                        <span className="font-medium tabular-nums">{crewDinner}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between text-sm font-semibold border-t border-primary/20 pt-2">
                    <span>Total Zenith (USBA + Air Astra)</span>
                    <span className="tabular-nums">
                      {mealEditMode && summaryEdit ? summaryEdit.usbaZenith + summaryEdit.aaaZenith : totalZenith}
                    </span>
                  </div>
                </div>
              </div>

              {/* Order Meal action bar */}
              <div className={cn(
                "mt-6 rounded-lg border p-4 flex items-center justify-between gap-4",
                orderSent ? "border-success/40 bg-success/5" : "border-border bg-muted/30",
              )}>
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{importDate}</span>
                  <span className="mx-2">·</span>
                  <span>{totalFlights} flight{totalFlights !== 1 ? "s" : ""}</span>
                  <span className="mx-2">·</span>
                  <span>{totalMeals.toLocaleString()} meals</span>
                </div>
                <div className="flex items-center gap-2">
                  {!orderSent && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (mealEditMode) {
                          setMealEditMode(false);
                          setSummaryEdit(null);
                        } else {
                          setSummaryEdit({
                            intlDepMeal, intlDepChml, intlRetMeal: 0, intlRetChml: 0, intlRetVgml,
                            usbaZenith, usbaPax, usbaBreakfast, usbaLunch,
                            aaaZenith, aaaPax,
                            crewHSnacks, crewLunch, crewDinner,
                          });
                          setMealEditMode(true);
                        }
                      }}
                    >
                      {mealEditMode ? "Cancel Editing" : "Set Meal Numbers"}
                    </Button>
                  )}
                  <Button
                    onClick={handleOrderMeal}
                    disabled={orderLoading || orderSent}
                    className={cn(orderSent && "bg-success hover:bg-success text-white")}
                  >
                    {orderLoading ? "Sending…" : orderSent ? (
                      <><CheckCircle2 className="h-4 w-4 mr-1.5" />Sent</>
                    ) : "Order meal"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Recent Activity */}
      {(bothDone || importConfirmed) && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground mb-4">
              Recent Activity
            </h3>
            <div className="space-y-3">
              {activityLog.map((entry, index) => (
                <div key={index} className="rounded-lg border border-border p-3 bg-muted/40">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{entry.user} — {entry.role}</span>
                    <span>{entry.at}</span>
                  </div>
                  <div className="mt-1 text-sm text-foreground">{entry.message}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-semibold tracking-wider uppercase text-foreground mb-4">
            Recent Uploads
          </h3>
          <DataTable
            title="uploads"
            data={recentUploads}
            columns={uploadCols}
            searchKeys={["file", "by", "status"]}
            actions={(row) => <RowActions row={row} actions={["view", "export", "delete"]} />}
          />
        </CardContent>
      </Card>
    </div>
  );
}

const SPECIAL_MEAL_CATEGORY_COLOR: Record<SpecialMealCategory, string> = {
  Religious:  "border-navy/30 bg-navy/5 text-navy",
  Medical:    "border-destructive/30 bg-destructive/5 text-destructive",
  Vegetarian: "border-success/30 bg-success/5 text-success",
  Other:      "border-border bg-muted text-muted-foreground",
};

function SpecialMealRosterPanel({ legs }: { legs: FlightOrder[] }) {
  const allEntries = legs.flatMap((l) =>
    (l.specialMealRoster ?? []).map((e) => ({ ...e, flight: l.flight, sector: l.sector })),
  );
  const plannedCount = legs.reduce((s, l) => s + l.specialMeals, 0);

  if (allEntries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
        {plannedCount > 0 ? (
          <>
            <span className="font-medium text-foreground">{plannedCount}</span> special meal{plannedCount === 1 ? "" : "s"} planned on this flight — passenger-level manifest (PNR / Seat / Meal) not yet imported.
          </>
        ) : (
          <>No special meals on this flight.</>
        )}
      </div>
    );
  }

  // Count per meal code across all legs
  const counts = new Map<string, number>();
  allEntries.forEach((e) => counts.set(e.mealCode, (counts.get(e.mealCode) ?? 0) + 1));
  const summary = Array.from(counts.entries())
    .map(([code, count]) => ({ code, count, meta: SPECIAL_MEAL_BY_CODE[code] }))
    .filter((s) => s.meta)
    .sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {summary.map((s) => (
          <Badge
            key={s.code}
            variant="outline"
            className={cn(
              "h-6 px-2 text-[11px] font-medium tabular-nums",
              SPECIAL_MEAL_CATEGORY_COLOR[s.meta.category],
            )}
            title={s.meta.name}
          >
            <span className="font-mono mr-1">{s.code}</span>
            <span className="opacity-70">·</span>
            <span className="ml-1">{s.count}</span>
          </Badge>
        ))}
      </div>
      <div className="border border-border rounded-md overflow-hidden max-h-[260px] overflow-y-auto">
        <Table>
          <TableHeader className="bg-muted/40 sticky top-0">
            <TableRow>
              <TableHead className="w-10 text-[10px] uppercase tracking-wider">SL</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider w-24">PNR</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Passenger</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider w-14">Seat</TableHead>
              {legs.length > 1 && (
                <TableHead className="text-[10px] uppercase tracking-wider">Flight</TableHead>
              )}
              <TableHead className="text-[10px] uppercase tracking-wider w-24">Meal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allEntries.map((e, i) => {
              const meta = SPECIAL_MEAL_BY_CODE[e.mealCode];
              return (
                <TableRow key={e.id} className="hover:bg-muted/30">
                  <TableCell className="text-xs tabular-nums text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{e.pnr}</TableCell>
                  <TableCell className="text-xs">{e.passengerName}</TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">{e.seat}</TableCell>
                  {legs.length > 1 && (
                    <TableCell className="font-mono text-xs">{e.flight}</TableCell>
                  )}
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-5 px-1.5 text-[10px] font-mono",
                        meta ? SPECIAL_MEAL_CATEGORY_COLOR[meta.category] : "",
                      )}
                      title={meta?.name ?? e.mealCode}
                    >
                      {e.mealCode}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function FlightOrderDetailsDialog({
  order, legs, onClose, onAdvanceLeg, onAdvanceOrder,
}: {
  order: FlightOrder | null;
  legs: FlightOrder[];
  onClose: () => void;
  onAdvanceLeg: (rowId: string) => void;
  onAdvanceOrder: (orderNo: string) => void;
}) {
  const isMulti = legs.length > 1;
  const hasRoster = legs.some((l) => (l.specialMealRoster ?? []).length > 0);
  const totalPax = legs.reduce((s, l) => s + l.pax, 0);
  const totalSpec = legs.reduce((s, l) => s + l.specialMeals, 0);

  // ── Individual flight detail (clicking View on a single row) ──────────────
  if (order && !isMulti) {
    const leg = legs[0] ?? order;
    const rosterCount = leg.specialMealRoster?.length ?? 0;
    return (
      <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className={rosterCount > 0 ? "max-w-2xl" : "max-w-lg"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              Flight Details
              <span className="font-mono text-sm text-muted-foreground">— {leg.flight}</span>
              <DirectionBadge direction={leg.direction} />
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <DetailRow label="Order #" value={leg.orderNo} mono />
              <DetailRow label="Flight" value={leg.flight} bold />
              <DetailRow label="Airline" value={leg.airline} />
              <DetailRow label="Sector" value={leg.sector} />
              <DetailRow label="Date" value={leg.date} />
              <DetailRow label="ETD" value={leg.etd} />
              <DetailRow label="Passengers" value={leg.pax.toLocaleString()} />
              <DetailRow label="Crew" value={leg.crew.toString()} />
              <DetailRow label="Special Meals" value={leg.specialMeals.toString()} />
            </div>

            <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</span>
              <StatusBadge status={leg.status} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  Special Meal Roster
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
                    {rosterCount > 0 ? `${rosterCount} pax` : `${leg.specialMeals} planned`}
                  </Badge>
                </div>
                {!isDomesticSector(leg.sector) && (
                  <span className="text-[10px] uppercase tracking-wider text-navy">International</span>
                )}
              </div>
              <SpecialMealRosterPanel legs={[leg]} />
            </div>

            <div className="rounded-md bg-muted/40 px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Total Meals (PAX + Special)</span>
              <span className="text-sm font-semibold text-foreground tabular-nums">
                {(leg.pax + leg.specialMeals).toLocaleString()}
              </span>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={isMulti || hasRoster ? "max-w-3xl" : "max-w-2xl"}>
        <DialogHeader>
          <DialogTitle>
            Order Details
            {order && (
              <span className="font-mono text-sm text-muted-foreground ml-1">
                — {order.orderNo}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        {order && (
          <div className="mt-2 space-y-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <DetailRow label="Order #" value={order.orderNo} mono />
              <DetailRow label="Airline" value={order.airline} />
              <DetailRow label="Date" value={order.date} />
              <DetailRow label="Flights" value={legs.length.toString()} />
              <DetailRow label="Total Passengers" value={totalPax.toLocaleString()} />
              <DetailRow label="Total Special Meals" value={totalSpec.toString()} />
            </div>

            <WorkflowStrip
              statuses={FLIGHT_ORDER_STATUS_FLOW}
              counts={
                FLIGHT_ORDER_STATUS_FLOW.reduce<Record<FlightOrderStatus, number>>(
                  (acc, s) => {
                    acc[s] = legs.filter((l) => l.status === s).length;
                    return acc;
                  },
                  { Pending: 0, Approved: 0, Production: 0, Dispatched: 0, Completed: 0 },
                )
              }
            />

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  Flights
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
                    {legs.length} {legs.length === 1 ? "flight" : "flights"}
                  </Badge>
                </div>
                {legs.some((l) => nextFlightStatus(l.status) !== null) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => onAdvanceOrder(order.orderNo)}
                  >
                    Advance All Flights →
                  </Button>
                )}
              </div>
              <div className="border border-border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="w-12 text-[10px] uppercase tracking-wider">#</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Flight</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Sector</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">ETD</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-right">PAX</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider text-right">Spec. Meals</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider w-28">Workflow</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {legs.map((leg, i) => {
                      const next = nextFlightStatus(leg.status);
                      return (
                        <TableRow key={leg.id}>
                          <TableCell className="tabular-nums text-xs">{i + 1}</TableCell>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-1.5">
                              {leg.flight}
                              <DirectionBadge direction={leg.direction} />
                            </div>
                          </TableCell>
                          <TableCell>{leg.sector}</TableCell>
                          <TableCell>{leg.etd}</TableCell>
                          <TableCell className="text-right tabular-nums">{leg.pax}</TableCell>
                          <TableCell className="text-right tabular-nums">{leg.specialMeals}</TableCell>
                          <TableCell><StatusBadge status={leg.status} /></TableCell>
                          <TableCell>
                            {next ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[11px] text-primary hover:text-primary"
                                onClick={() => onAdvanceLeg(leg.id)}
                                title={`Move to ${next}`}
                              >
                                → {next}
                              </Button>
                            ) : (
                              <span className="text-[10px] text-success">Done</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  Special Meal Roster
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
                    {legs.reduce((s, l) => s + (l.specialMealRoster?.length ?? 0), 0)} pax
                  </Badge>
                </div>
                {!isDomesticSector(order.sector) && (
                  <span className="text-[10px] uppercase tracking-wider text-navy">International</span>
                )}
              </div>
              <SpecialMealRosterPanel legs={legs} />
            </div>

            <div className="rounded-md bg-muted/40 px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Total Meals (PAX + Special)</span>
              <span className="text-sm font-semibold text-foreground tabular-nums">
                {(totalPax + totalSpec).toLocaleString()}
              </span>
            </div>
          </div>
        )}
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  label, value, mono, bold,
}: { label: string; value: string; mono?: boolean; bold?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={
          "mt-1 text-sm text-foreground" +
          (mono ? " font-mono text-xs" : "") +
          (bold ? " font-semibold" : "")
        }
      >
        {value}
      </div>
    </div>
  );
}
