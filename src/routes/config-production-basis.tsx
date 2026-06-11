import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Scale, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { loadMealPlanningConfig } from "@/lib/meal-planning-data";
import {
  useProductionBasisSettings,
  setDefaultProductionBasis,
  setProductionItemOverride,
  setProductionBasisSettings,
  PRODUCTION_BASIS_LABEL,
  DEFAULT_PRODUCTION_BASIS_SETTINGS,
  type ProductionBasis,
} from "@/lib/production-basis-settings";

const BASIS_HELP: Record<ProductionBasis, string> = {
  required: "Produce the full required quantity, ignoring stock on hand.",
  shortfall: "Produce only the gap: required quantity minus current stock.",
};

/** Two-button segmented selector shared by the default card and the add dialog. */
function BasisToggle({
  value, onChange, size = "default",
}: {
  value: ProductionBasis;
  onChange: (b: ProductionBasis) => void;
  size?: "default" | "sm";
}) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden">
      {(["required", "shortfall"] as ProductionBasis[]).map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => onChange(b)}
          className={cn(
            "px-3 font-medium transition-colors",
            size === "sm" ? "h-7 text-xs" : "h-9 text-sm",
            value === b
              ? "bg-primary text-primary-foreground"
              : "bg-transparent text-muted-foreground hover:bg-muted/50",
          )}
        >
          {PRODUCTION_BASIS_LABEL[b]}
        </button>
      ))}
    </div>
  );
}

/** Every unique menu item name across the current meal-planning config. */
function useMenuItemNames(): string[] {
  return useMemo(() => {
    const names = new Set<string>();
    for (const card of loadMealPlanningConfig()) {
      for (const ch of card.choices) for (const it of ch.items) names.add(it.name);
      for (const sp of card.specialMeals) for (const it of sp.items) names.add(it.name);
      if (card.dessert?.name) names.add(card.dessert.name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, []);
}

export default function ConfigProductionBasisPage() {
  const settings = useProductionBasisSettings();
  const menuItemNames = useMenuItemNames();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftItem, setDraftItem] = useState("");
  const [draftBasis, setDraftBasis] = useState<ProductionBasis>("shortfall");

  // Override rows, sorted by item name for stable display.
  const overrideRows = useMemo(
    () =>
      Object.entries(settings.overrides)
        .map(([key, basis]) => ({
          key,
          // Prefer the catalog's original casing; fall back to the stored key.
          name: menuItemNames.find((n) => n.toLowerCase() === key) ?? key,
          basis,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [settings.overrides, menuItemNames],
  );

  // Items not yet overridden — candidates for the add dialog.
  const addableItems = useMemo(
    () => menuItemNames.filter((n) => !(n.toLowerCase() in settings.overrides)),
    [menuItemNames, settings.overrides],
  );

  const openAdd = () => {
    setDraftItem("");
    setDraftBasis(settings.default === "required" ? "shortfall" : "required");
    setDialogOpen(true);
  };

  const handleSaveOverride = () => {
    const name = draftItem.trim();
    if (!name) { toast.error("Pick an item to override."); return; }
    setProductionItemOverride(name, draftBasis);
    toast.success(`"${name}" will produce by ${PRODUCTION_BASIS_LABEL[draftBasis]}.`);
    setDialogOpen(false);
  };

  const handleRemoveOverride = (name: string) => {
    setProductionItemOverride(name, null);
    toast.success(`Removed override for "${name}" — now uses the default.`);
  };

  const handleReset = () => {
    if (!window.confirm("Reset to the default (produce by Required Qty for every item) and clear all per-item overrides?")) {
      return;
    }
    setProductionBasisSettings(DEFAULT_PRODUCTION_BASIS_SETTINGS);
    toast.success("Production basis reset to defaults.");
  };

  return (
    <>
      <PageHeader
        title="Production Basis"
        subtitle="Decide whether items are produced for the full Required Qty or only the Shortfall (required minus current stock). Set an app-wide default, then override individual items."
        actions={
          <Button variant="outline" onClick={handleReset} title="Reset default and clear all overrides">
            <RotateCcw className="h-4 w-4 mr-1.5" /> Reset
          </Button>
        }
      />

      {/* App-wide default */}
      <Card className="mb-4">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Default basis (all items)
              </Label>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                {BASIS_HELP[settings.default]}
              </p>
            </div>
            <BasisToggle
              value={settings.default}
              onChange={(b) => {
                setDefaultProductionBasis(b);
                toast.success(`Default basis set to ${PRODUCTION_BASIS_LABEL[b]}.`);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Per-item overrides */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">Per-item overrides</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Items listed here ignore the default and use their own basis.
              </p>
            </div>
            <Button onClick={openAdd} disabled={addableItems.length === 0}>
              <Plus className="h-4 w-4 mr-1.5" /> Add Override
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="w-64">Basis</TableHead>
                <TableHead className="text-right w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overrideRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">
                    No overrides — every item uses the default ({PRODUCTION_BASIS_LABEL[settings.default]}).
                  </TableCell>
                </TableRow>
              ) : (
                overrideRows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      <BasisToggle
                        size="sm"
                        value={row.basis}
                        onChange={(b) => setProductionItemOverride(row.name, b)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => handleRemoveOverride(row.name)}
                        aria-label={`Remove override for ${row.name}`}
                        title="Remove override"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-primary" /> Add Override
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Item <span className="text-destructive">*</span>
              </Label>
              <select
                value={draftItem}
                onChange={(e) => setDraftItem(e.target.value)}
                className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="">Select an item…</option>
                {addableItems.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Produce by
              </Label>
              <div className="mt-1">
                <BasisToggle value={draftBasis} onChange={setDraftBasis} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">{BASIS_HELP[draftBasis]}</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveOverride}>
              <Plus className="h-4 w-4 mr-1.5" /> Add Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mt-4">
        <Badge variant="outline" className="text-[10px]">
          Applied when creating Production Orders from the Meal Plan review dialog.
        </Badge>
      </div>
    </>
  );
}
