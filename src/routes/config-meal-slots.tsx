import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Pencil, Trash2, Clock, RotateCcw, Save, Utensils,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useMealSlots,
  setMealSlots,
  formatSlotRange,
  DEFAULT_MEAL_SLOTS,
  type MealSlotConfig,
} from "@/lib/meal-slot-settings";
import {
  useSpecialMealCountConfig,
  setSpecialMealCountConfig,
  applySpecialMealMode,
  type SpecialMealMode,
} from "@/lib/special-meal-count-settings";

type Draft = { name: string; from: string; to: string };

const SPECIAL_MEAL_MODES: { value: SpecialMealMode; label: string }[] = [
  { value: "additional", label: "Addition" },
  { value: "deducted", label: "Deduction" },
];

const EMPTY_DRAFT: Draft = { name: "", from: "", to: "" };

function isValidHour(s: string): boolean {
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 24;
}

export default function ConfigMealSlotsPage() {
  const slots = useMealSlots();
  const specialMealCfg = useSpecialMealCountConfig();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null); // null = adding
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const openAdd = () => {
    setEditingName(null);
    setDraft(EMPTY_DRAFT);
    setDialogOpen(true);
  };

  const openEdit = (s: MealSlotConfig) => {
    setEditingName(s.name);
    setDraft({ name: s.name, from: String(s.from), to: String(s.to) });
    setDialogOpen(true);
  };

  const handleSave = () => {
    const name = draft.name.trim();
    if (!name) { toast.error("Meal name is required."); return; }
    if (!isValidHour(draft.from) || !isValidHour(draft.to)) {
      toast.error("Start and end hours must be whole numbers between 0 and 24.");
      return;
    }
    const fromH = Number(draft.from);
    const toH = Number(draft.to);
    if (toH <= fromH) {
      toast.error("End hour must be greater than start hour.");
      return;
    }
    // Reject duplicate names (when adding) or duplicate names that aren't this slot (when editing)
    const clash = slots.find(
      (s) => s.name.toLowerCase() === name.toLowerCase() && s.name !== editingName,
    );
    if (clash) {
      toast.error(`A slot named "${clash.name}" already exists.`);
      return;
    }
    const next: MealSlotConfig = { name, from: fromH, to: toH };
    if (editingName === null) {
      setMealSlots([...slots, next]);
      toast.success(`Added "${name}" (${formatSlotRange(next)}).`);
    } else {
      setMealSlots(slots.map((s) => (s.name === editingName ? next : s)));
      toast.success(`Updated "${name}".`);
    }
    setDialogOpen(false);
  };

  const handleDelete = (name: string) => {
    if (slots.length <= 1) {
      toast.error("Cannot delete the last remaining slot — at least one slot must exist.");
      return;
    }
    if (!window.confirm(`Delete the "${name}" slot? Flights whose ETD falls in this window will be regrouped into the next matching slot.`)) {
      return;
    }
    setMealSlots(slots.filter((s) => s.name !== name));
    toast.success(`Deleted "${name}".`);
  };

  const handleRestoreDefaults = () => {
    if (!window.confirm("Replace the current slot list with the four built-in defaults (Breakfast, Heavy Snacks, Lunch, Dinner)? Your custom slots will be removed.")) {
      return;
    }
    setMealSlots(DEFAULT_MEAL_SLOTS);
    toast.success("Restored default meal slots.");
  };

  // Detect overlaps for an in-page warning banner (slots are sorted by start
  // hour by the store, so neighbours are the only candidates).
  const overlaps = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < slots.length - 1; i++) {
      const a = slots[i];
      const b = slots[i + 1];
      if (a.to > b.from) {
        out.push(`"${a.name}" (${formatSlotRange(a)}) overlaps "${b.name}" (${formatSlotRange(b)}).`);
      }
    }
    return out;
  }, [slots]);

  return (
    <>
      <PageHeader
        title="Meal Config"
        subtitle="Define the meals (day-parts) available across Menu Planning. Each meal has a time window; flights are grouped by ETD using these windows."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleRestoreDefaults} title="Replace the list with the four built-in defaults">
              <RotateCcw className="h-4 w-4 mr-1.5" /> Defaults
            </Button>
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4 mr-1.5" /> Add Meal
            </Button>
          </div>
        }
      />

      {overlaps.length > 0 && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground space-y-0.5">
          <div className="font-semibold uppercase tracking-wider text-warning text-[10px]">Overlap warning</div>
          {overlaps.map((msg, i) => <div key={i}>{msg}</div>)}
        </div>
      )}

      <Card>
        <CardContent className="pt-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Meal Name</TableHead>
                <TableHead className="text-right w-32">Start Hour</TableHead>
                <TableHead className="text-right w-32">End Hour</TableHead>
                <TableHead className="w-48">Window</TableHead>
                <TableHead className="text-right w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slots.map((s, i) => (
                <TableRow key={s.name}>
                  <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{String(s.from).padStart(2, "0")}:00</TableCell>
                  <TableCell className="text-right tabular-nums">{String(s.to % 24).padStart(2, "0")}:00</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] tabular-nums">
                      <Clock className="h-3 w-3 mr-1" /> {formatSlotRange(s)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEdit(s)} aria-label={`Edit ${s.name}`} title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleDelete(s.name)} aria-label={`Delete ${s.name}`} title="Delete">
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Special Meal Count Configuration ─────────────────────────────────
          Special meals are alternative meals. On meal-order upload the total
          order number is auto-calculated using these rules — independently for
          passengers and crew — so specials can be treated as an alternative
          (deducted, total unchanged) or as extra covers (additional). */}
      <Card className="mt-4">
        <CardContent className="pt-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Utensils className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Special Meal Count Configuration</h3>
              <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
                Special meals are <span className="font-medium text-foreground">alternative meals</span>. When meal orders are uploaded, the
                system auto-calculates the <span className="font-medium text-foreground">regular meal count</span> (Regular = Base − Special)
                and the total order for passengers and crew, based on the option enabled for each below. There are{" "}
                <span className="font-medium text-foreground">four conditions</span> in total — Passenger and Crew each choose one:
              </p>
              <ul className="mt-2 max-w-3xl space-y-1 text-xs text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">Addition</span> — the special meals are added back to the regular count, so the
                  order total stays equal to the uploaded head-count. <span className="tabular-nums">e.g. 180 → 172 regular + 8 special = 180</span>.
                </li>
                <li>
                  <span className="font-medium text-foreground">Deduction</span> — the special meals are deducted from the base count and excluded
                  from the order total. <span className="tabular-nums">e.g. 180 → 172 regular, 8 special deducted = 172</span>.
                </li>
              </ul>
            </div>
          </div>

          {/* Passenger + Crew mode selectors */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {([
              { key: "passenger" as const, label: "Passenger · Regular & Special Meal Count" },
              { key: "crew" as const, label: "Crew · Regular & Special Meal Count" },
            ]).map(({ key, label }) => {
              const mode = specialMealCfg[key];
              return (
                <div key={key} className="rounded-md border px-3 py-3">
                  <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
                  <div className="inline-flex overflow-hidden rounded-md border">
                    {SPECIAL_MEAL_MODES.map((m) => {
                      const active = mode === m.value;
                      return (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => {
                            if (active) return;
                            setSpecialMealCountConfig({ ...specialMealCfg, [key]: m.value });
                            toast.success(`${label}: counted as ${m.label.toLowerCase()}.`);
                          }}
                          className={cn(
                            "px-4 py-1.5 text-xs font-semibold transition-colors",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "bg-transparent text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {mode === "additional"
                      ? "Addition — specials added back to the regular count; the order total stays the same (Regular + Special = Base)."
                      : "Deduction — specials deducted from the base and excluded from the order total (Base − Special)."}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Live example — reflects the current configuration */}
          {(() => {
            const paxBase = 180, paxSpecial = 8, crewBase = 10, crewSpecial = 2;
            const paxRegular = Math.max(0, paxBase - paxSpecial);
            const crewRegular = Math.max(0, crewBase - crewSpecial);
            const paxTotal = applySpecialMealMode(paxBase, paxSpecial, specialMealCfg.passenger);
            const crewTotal = applySpecialMealMode(crewBase, crewSpecial, specialMealCfg.crew);
            return (
              <div className="mt-4 rounded-md border bg-muted/20 px-3 py-3">
                <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  Auto-calculated total on upload · example (Total Special Meal: {paxSpecial + crewSpecial})
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Passengers: {paxBase}</span>
                      <span className="font-medium tabular-nums text-foreground">{paxTotal.toLocaleString()}</span>
                    </div>
                    <div className="pl-3 mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                      {specialMealCfg.passenger === "additional"
                        ? `${paxRegular} regular meal + ${paxSpecial} special meal = ${paxTotal}`
                        : `${paxBase} − ${paxSpecial} special meal deducted = ${paxTotal}`}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Crew: {crewBase}</span>
                      <span className="font-medium tabular-nums text-foreground">{crewTotal.toLocaleString()}</span>
                    </div>
                    <div className="pl-3 mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                      {specialMealCfg.crew === "additional"
                        ? `${crewRegular} regular crew meal + ${crewSpecial} special crew meal = ${crewTotal}`
                        : `${crewBase} − ${crewSpecial} special crew meal deducted = ${crewTotal}`}
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t pt-1.5">
                    <span className="text-muted-foreground">Total Meals (PAX + Crew)</span>
                    <span className="font-semibold tabular-nums text-foreground">{(paxTotal + crewTotal).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              {editingName === null ? "Add Meal" : `Edit "${editingName}"`}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Meal Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="mt-1"
                placeholder="e.g. Afternoon Tea"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Start Hour <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={24}
                  value={draft.from}
                  onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                  className="mt-1 tabular-nums"
                  placeholder="0-24"
                />
                <p className="text-[10px] text-muted-foreground mt-1">24-hour clock; whole hours only.</p>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  End Hour <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={24}
                  value={draft.to}
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                  className="mt-1 tabular-nums"
                  placeholder="0-24"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Exclusive — a 06–11 slot includes ETD 06:00 but not 11:00.</p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-1.5" /> {editingName === null ? "Add Meal" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
