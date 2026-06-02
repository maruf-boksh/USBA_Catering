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
  Plus, Pencil, Trash2, Clock, RotateCcw, Save,
} from "lucide-react";
import { toast } from "sonner";
import {
  useMealSlots,
  setMealSlots,
  formatSlotRange,
  DEFAULT_MEAL_SLOTS,
  type MealSlotConfig,
} from "@/lib/meal-slot-settings";

type Draft = { name: string; from: string; to: string };

const EMPTY_DRAFT: Draft = { name: "", from: "", to: "" };

function isValidHour(s: string): boolean {
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 24;
}

export default function ConfigMealSlotsPage() {
  const slots = useMealSlots();
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
    if (!name) { toast.error("Slot name is required."); return; }
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
        title="Meal Slots"
        subtitle="Define the day-parts used by the Crew Meals views — flights are grouped by ETD using these windows."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleRestoreDefaults} title="Replace the list with the four built-in defaults">
              <RotateCcw className="h-4 w-4 mr-1.5" /> Defaults
            </Button>
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4 mr-1.5" /> Add Slot
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
                <TableHead>Slot Name</TableHead>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              {editingName === null ? "Add Meal Slot" : `Edit "${editingName}"`}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Slot Name <span className="text-destructive">*</span>
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
              <Save className="h-4 w-4 mr-1.5" /> {editingName === null ? "Add Slot" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
