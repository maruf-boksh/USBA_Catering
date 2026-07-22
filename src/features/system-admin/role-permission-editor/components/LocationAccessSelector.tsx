import { useMemo, useState, type ComponentType } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Building2, Warehouse as WarehouseIcon, ChevronsUpDown, X, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  offices as OFFICE_SEED,
  warehouses as WAREHOUSE_SEED,
  type Office, type Warehouse,
} from "@/lib/sample-data";

/** The set of offices & warehouses a role is granted access to. */
export type LocationAccess = { officeIds: string[]; warehouseIds: string[] };
export const EMPTY_ACCESS: LocationAccess = { officeIds: [], warehouseIds: [] };

type Opt = { value: string; label: string; hint?: string; group?: string };

/**
 * Role-level Office & Warehouse access. A role may be granted multiple offices
 * and multiple warehouses; both are independent multi-selects. Options are read
 * from the same persisted lists the Office / Warehouse config pages manage.
 */
export function LocationAccessSelector({
  value, onChange, disabled,
}: {
  value: LocationAccess;
  onChange: (v: LocationAccess) => void;
  disabled?: boolean;
}) {
  const [offices] = usePersistedState<Office[]>("config-office-rows", OFFICE_SEED);
  const [warehouses] = usePersistedState<Warehouse[]>("config-warehouse-rows", WAREHOUSE_SEED);

  const officeName = useMemo(() => Object.fromEntries(offices.map((o) => [o.id, o.name])), [offices]);
  const whName = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w.name])), [warehouses]);

  const officeOpts: Opt[] = useMemo(
    () => offices.filter((o) => o.status === "Active").map((o) => ({ value: o.id, label: o.name, hint: o.code })),
    [offices],
  );
  const whOpts: Opt[] = useMemo(
    () => warehouses.filter((w) => w.status === "Active").map((w) => ({
      value: w.id, label: w.name, hint: `${w.code} · ${w.type}`,
      group: officeName[w.officeId] ?? "Unassigned",
    })),
    [warehouses, officeName],
  );

  const setOffices = (ids: string[]) => onChange({ ...value, officeIds: ids });
  const setWarehouses = (ids: string[]) => onChange({ ...value, warehouseIds: ids });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold uppercase tracking-wider">Office &amp; Warehouse Access</h3>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-1">
        Scope this role to specific locations. Grants apply within the selected offices and warehouses.
        Leave empty for organization-wide (all locations).
      </p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <MultiSelect
          triggerLabel="Offices" icon={Building2}
          options={officeOpts} selected={value.officeIds} onChange={setOffices}
          disabled={disabled} searchPlaceholder="Search offices…" emptyText="No offices."
        />
        <MultiSelect
          triggerLabel="Warehouses" icon={WarehouseIcon}
          options={whOpts} selected={value.warehouseIds} onChange={setWarehouses}
          disabled={disabled} searchPlaceholder="Search warehouses…" emptyText="No warehouses."
        />
        {value.officeIds.length === 0 && value.warehouseIds.length === 0 && (
          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
            Organization-wide (all locations)
          </Badge>
        )}
      </div>

      {(value.officeIds.length > 0 || value.warehouseIds.length > 0) && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {value.officeIds.map((id) => (
            <Chip key={id} icon={Building2} label={officeName[id] ?? id} disabled={disabled}
              onRemove={() => setOffices(value.officeIds.filter((x) => x !== id))} />
          ))}
          {value.warehouseIds.map((id) => (
            <Chip key={id} icon={WarehouseIcon} label={whName[id] ?? id} disabled={disabled}
              onRemove={() => setWarehouses(value.warehouseIds.filter((x) => x !== id))} />
          ))}
        </div>
      )}
    </div>
  );
}

function MultiSelect({
  triggerLabel, icon: Icon, options, selected, onChange, disabled, searchPlaceholder, emptyText,
}: {
  triggerLabel: string;
  icon: ComponentType<{ className?: string }>;
  options: Opt[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  searchPlaceholder: string;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const filtered = options.filter(
    (o) => !q || o.label.toLowerCase().includes(q.toLowerCase()) || (o.hint ?? "").toLowerCase().includes(q.toLowerCase()),
  );
  // Preserve insertion order of groups.
  const groups = filtered.reduce<Record<string, Opt[]>>((acc, o) => {
    const g = o.group ?? "";
    (acc[g] ??= []).push(o);
    return acc;
  }, {});
  const groupKeys = Object.keys(groups);

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="h-8 justify-between gap-2 min-w-[150px]">
          <span className="inline-flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5" /> {triggerLabel}
          </span>
          <span className="inline-flex items-center gap-1">
            {selected.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] tabular-nums">{selected.length}</Badge>
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="p-2 border-b border-border">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="h-8" />
        </div>
        <div className="flex items-center justify-between px-2.5 py-1.5 text-[11px] border-b border-border">
          <button className="text-primary hover:underline" onClick={() => onChange(options.map((o) => o.value))}>Select all</button>
          <button className="text-muted-foreground hover:underline" onClick={() => onChange([])}>Clear</button>
        </div>
        <div className="max-h-56 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-3 py-5 text-center text-xs text-muted-foreground">{emptyText}</div>
          )}
          {groupKeys.map((g) => (
            <div key={g || "_"}>
              {g && (
                <div className="px-2.5 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{g}</div>
              )}
              {groups[g].map((o) => {
                const checked = selected.includes(o.value);
                return (
                  <button
                    key={o.value}
                    onClick={() => toggle(o.value)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-muted/60"
                  >
                    <Checkbox checked={checked} className="pointer-events-none" />
                    <span className="min-w-0 flex-1">
                      <span className="text-[13px] block truncate">{o.label}</span>
                      {o.hint && <span className="text-[10px] text-muted-foreground font-mono block truncate">{o.hint}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Chip({
  icon: Icon, label, onRemove, disabled,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 pl-2 pr-1 py-0.5 text-[11px]",
    )}>
      <Icon className="h-3 w-3 text-muted-foreground" />
      <span className="max-w-[160px] truncate">{label}</span>
      {!disabled && (
        <button onClick={onRemove} className="rounded-full hover:bg-muted p-0.5" aria-label={`Remove ${label}`}>
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
