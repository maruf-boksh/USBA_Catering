import { useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, RotateCcw, Save, Scale } from "lucide-react";
import { toast } from "sonner";
import {
  BASIS_LABEL, STOCK_DEFAULT_STANDARDS, computeStandard, isMealMixKey, galleyAircraftTypes,
  loadStandardsForAircraft, saveStandardsForAircraft, resetStandardsForAircraft,
  type LoadingStandard, type StandardBasis,
} from "@/lib/galley-standards";
import { loadGalleyItems } from "@/lib/galley-items";
import { GALLEY_STOCK_KEYS, isStockGroup } from "@/lib/galley-catalog";
import { AircraftFields } from "@/routes/config-aircraft";
import {
  aircraftFleet as AIRCRAFT_SEED, airlines as AIRLINE_SEED,
  type Aircraft, type Airline,
} from "@/lib/sample-data";

// Loading Standards (loading scales) master — the rules that auto-fill each
// new galley plan on the Galley Plan page. Rows are grouped by Handing/Taking
// sheet section, Meal Mix parameters first.
//
// Stock-item scales are CONNECTED to the airline-consumables inventory: a rule
// is shown for exactly the beverage/amenity/equipment items that exist in
// inventory (with their live name/unit), so removing an item from inventory
// drops its scale and adding one gives it a fresh rule.
function connectToInventory(saved: LoadingStandard[]): LoadingStandard[] {
  const items = loadGalleyItems();
  const itemByKey = new Map(items.map((i) => [i.key, i]));
  const savedByKey = new Set(saved.map((s) => s.key));
  const out: LoadingStandard[] = [];

  for (const s of saved) {
    if (isMealMixKey(s.key)) { out.push(s); continue; }           // meal-mix params
    if (!GALLEY_STOCK_KEYS.has(s.key)) { out.push(s); continue; } // meal-service (non-stock)
    const it = itemByKey.get(s.key);
    if (!it) continue;                                            // stock item removed from inventory → drop scale
    out.push({ ...s, label: it.label, unit: it.unit, group: it.section }); // refresh from inventory
  }
  // Stock items in inventory without a saved rule yet → add a fixed-0 rule.
  for (const it of items) {
    if (!isStockGroup(it.group) || it.auto || savedByKey.has(it.key)) continue;
    out.push({ key: it.key, label: it.label, group: it.section, unit: it.unit, basis: "fixed", factor: 0 });
  }
  return out;
}

export default function GalleyLoadingStandardsPage() {
  const [aircraftTypes, setAircraftTypes] = useState(() => galleyAircraftTypes());
  const [aircraft, setAircraft] = useState(() => aircraftTypes[0] ?? "");
  const [standards, setStandards] = useState<LoadingStandard[]>(() => connectToInventory(loadStandardsForAircraft(aircraftTypes[0])));
  const [dirty, setDirty] = useState(false);
  // Sample flight used only to preview what each rule yields.
  const [previewPax, setPreviewPax] = useState(72);
  const [previewCrew, setPreviewCrew] = useState(7);

  // Aircraft fleet + airlines — shared with the Configuration > Aircraft module,
  // so aircraft added here are real fleet entries (and vice-versa).
  const [aircraftRows, setAircraftRows] = usePersistedState<Aircraft[]>("config-aircraft-rows", AIRCRAFT_SEED);
  const [airlines] = usePersistedState<Airline[]>("config-airline-rows", AIRLINE_SEED);
  const [showAddAircraft, setShowAddAircraft] = useState(false);

  // Category filter — narrows which sections show. User-added categories persist
  // (they join the filter list; items are put into them via the item add/edit
  // flow). "all" shows every section.
  const [customCategories, setCustomCategories] = usePersistedState<string[]>("galley-loading-categories", []);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");

  // Switch to another aircraft type's standard (discards unsaved edits).
  const changeAircraft = (type: string) => {
    setAircraft(type);
    setStandards(connectToInventory(loadStandardsForAircraft(type)));
    setDirty(false);
  };

  // Register a new aircraft (persists to the shared fleet) and jump to its
  // (default) loading standard so the manager can define scales right away.
  const onAircraftCreated = (a: Aircraft) => {
    setAircraftRows((prev) => [a, ...prev]);
    setAircraftTypes((prev) =>
      prev.includes(a.type) ? prev : [...prev, a.type].sort((x, y) => x.localeCompare(y)),
    );
    changeAircraft(a.type);
    setShowAddAircraft(false);
    toast.success(`Aircraft "${a.registration}" added — set its loading standard below.`);
  };

  const grouped = useMemo(() => {
    // Sheet sections in Galley Item Master order (beverages/amenities/equipment).
    const order: string[] = [];
    for (const it of loadGalleyItems()) if (!order.includes(it.section)) order.push(it.section);
    for (const s of standards) if (!order.includes(s.group)) order.push(s.group);
    return order
      .map((group) => ({ group, rules: standards.filter((s) => s.group === group) }))
      .filter((g) => g.rules.length > 0);
  }, [standards]);

  // Filter options = the sections in use + any user-added categories.
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of grouped) set.add(g.group);
    for (const c of customCategories) set.add(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [grouped, customCategories]);

  const visibleGroups = categoryFilter === "all"
    ? grouped
    : grouped.filter((g) => g.group === categoryFilter);

  const addCategory = (raw: string) => {
    const cat = raw.trim();
    if (!cat) { toast.error("Enter a category name."); return; }
    if (categoryOptions.includes(cat)) {
      toast.info(`Category "${cat}" already exists.`);
    } else {
      setCustomCategories((prev) => [...prev, cat]);
      toast.success(`Category "${cat}" added — assign items to it from the item's category.`);
    }
    setCategoryFilter(cat);
    setNewCategory("");
    setShowAddCategory(false);
  };

  const update = (key: string, patch: Partial<LoadingStandard>) => {
    setStandards((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    setDirty(true);
  };
  const numPatch = (field: "factor" | "offset" | "min") => (key: string, raw: string) => {
    const v = raw === "" ? 0 : Number(raw);
    if (Number.isNaN(v)) return;
    update(key, { [field]: v });
  };
  const setFactor = numPatch("factor");
  const setOffset = numPatch("offset");
  const setMin = numPatch("min");

  const onSave = () => {
    saveStandardsForAircraft(aircraft, standards);
    setDirty(false);
    toast.success(`Loading standard saved for ${aircraft} — new galley plans on this aircraft type use these scales.`);
  };
  const onReset = () => {
    resetStandardsForAircraft(aircraft);
    setStandards(connectToInventory(STOCK_DEFAULT_STANDARDS));
    setDirty(false);
    toast.info(`${aircraft} loading standard reset to defaults.`);
  };

  return (
    <>
      <PageHeader
        title="Loading Standards"
        subtitle="Beverage, amenity & equipment loading scales — defined separately per aircraft type. Meals are not set here; they flow from the order to Dispatch and into the galley."
      />

      <Card className="mb-4">
        <CardContent className="pt-5 pb-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">Aircraft Type</span>
              <Select value={aircraft} onValueChange={changeAircraft}>
                <SelectTrigger className="h-8 w-56 text-sm">
                  <SelectValue placeholder="Select aircraft type" />
                </SelectTrigger>
                <SelectContent>
                  {aircraftTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-8" onClick={() => setShowAddAircraft(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Aircraft
              </Button>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">Category</span>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-8 w-48 text-sm">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-8" onClick={() => { setNewCategory(""); setShowAddCategory(true); }}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Category
              </Button>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
              <Scale className="h-4 w-4 shrink-0 text-sky-700" />
              <span>
                Scales apply to <strong className="text-foreground">{aircraft || "this type"}</strong> only. Each aircraft type keeps its own standard;
                changing one affects newly created plans on that type.
              </span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Preview flight</span>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                PAX
                <Input
                  type="number" min={0} value={previewPax}
                  onChange={(e) => setPreviewPax(Math.max(0, Number(e.target.value) || 0))}
                  className="h-7 w-16 text-xs tabular-nums"
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Crew
                <Input
                  type="number" min={0} value={previewCrew}
                  onChange={(e) => setPreviewCrew(Math.max(0, Number(e.target.value) || 0))}
                  className="h-7 w-14 text-xs tabular-nums"
                />
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {visibleGroups.length === 0 && (
        <Card className="mb-4">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No loading-standard items in <strong className="text-foreground">{categoryFilter}</strong> yet.
            Assign items to this category from the item's category, then they'll appear here.
          </CardContent>
        </Card>
      )}

      {visibleGroups.map(({ group, rules }) => (
        <Card key={group} className="mb-4">
          <CardContent className="pt-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700 mb-3">{group}</p>
            <div className="border border-border rounded-md overflow-hidden">
              <Table className="min-w-[760px]">
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="text-xs uppercase tracking-wider">Item</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider w-44">Basis</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider w-24">Factor</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider w-24">+ Offset</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider w-20">Min</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider w-32">Preview</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((s) => (
                    <TableRow key={s.key} className="hover:bg-muted/30">
                      <TableCell>
                        <span className="font-medium text-sm">{s.label}</span>
                        <span className="block text-[10px] font-mono text-muted-foreground">{s.key}</span>
                      </TableCell>
                      <TableCell>
                        <Select value={s.basis} onValueChange={(v) => update(s.key, { basis: v as StandardBasis })}>
                          <SelectTrigger className="h-7 text-xs w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(BASIS_LABEL) as StandardBasis[]).map((b) => (
                              <SelectItem key={b} value={b}>{BASIS_LABEL[b]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number" step="0.5" min={0} value={s.factor}
                          onChange={(e) => setFactor(s.key, e.target.value)}
                          className="h-7 w-20 ml-auto text-right text-xs tabular-nums"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number" min={0} value={s.offset ?? 0}
                          onChange={(e) => setOffset(s.key, e.target.value)}
                          className="h-7 w-20 ml-auto text-right text-xs tabular-nums"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number" min={0} value={s.min ?? 0}
                          onChange={(e) => setMin(s.key, e.target.value)}
                          className="h-7 w-16 ml-auto text-right text-xs tabular-nums"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-semibold tabular-nums">{computeStandard(s, previewPax, previewCrew)}</span>
                        {s.unit && <span className="text-[10px] text-muted-foreground ml-1">{s.unit}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="flex flex-wrap items-center justify-end gap-2 mb-6">
        <Button variant="outline" onClick={onReset}>
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset to Defaults
        </Button>
        <Button onClick={onSave} disabled={!dirty}>
          <Save className="h-3.5 w-3.5 mr-1.5" /> Save Standards
        </Button>
      </div>

      {/* Add Aircraft — reuses the Configuration > Aircraft form; the new
          aircraft is a real fleet entry and its type becomes loadable here. */}
      <Dialog open={showAddAircraft} onOpenChange={setShowAddAircraft}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Aircraft</DialogTitle>
          </DialogHeader>
          <AircraftFields
            mode="create"
            nextId={`ACF-${String(aircraftRows.length + 1).padStart(3, "0")}`}
            airlines={airlines}
            onSave={onAircraftCreated}
          />
        </DialogContent>
      </Dialog>

      {/* Add Category — a new grouping the filter can select and items can be
          assigned to (via the item's category in the add/edit-item flow). */}
      <Dialog open={showAddCategory} onOpenChange={setShowAddCategory}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Category</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Category name</label>
              <Input
                autoFocus
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addCategory(newCategory); }}
                placeholder="e.g. Alcoholic Beverages"
                className="mt-1"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddCategory(false)}>Cancel</Button>
              <Button onClick={() => addCategory(newCategory)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Category
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
