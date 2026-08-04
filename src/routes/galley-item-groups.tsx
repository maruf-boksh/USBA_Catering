import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ChevronDown, ChevronRight, Search, Layers, Tag, Tags, Boxes, CupSoda, Sparkles,
  ExternalLink, EyeOff, RotateCcw, Package, Apple, Utensils, Coffee, ShoppingBag,
  BriefcaseMedical, FileText,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getAllGalleyGroups, setGalleyGroupActive, type GalleyGroupDef } from "@/lib/galley-groups";
import {
  classifyGalleyItems, readDisabledNodes, writeDisabledNodes, setNodeEnabled,
  subNodeId, minorNodeId, itemNodeId, UNCLASSIFIED, type GalleyItemClass,
} from "@/lib/galley-item-scope";

// ─────────────────────────────────────────────────────────────────────────────
// Galley Items Group — which galley lines a Galley Plan is allowed to load.
//
// Everything on this screen is derived, never typed: the categories are the
// galley groups in use, and the sub-category / minor-category / item levels come
// straight off each line's Item Profile. So the only thing a user does here is
// switch levels on and off, and the only way to ADD something is to tag an item
// in the Item Profile — which is what keeps one master in charge of the data.
//
// A switch is scope, not deletion. Switching off "Cutlery" keeps every knife and
// fork in stock, in the store and in history; it just stops the Galley Plan from
// offering them. That distinction is the whole reason this is not done by
// untagging items.
// ─────────────────────────────────────────────────────────────────────────────

const GROUP_ICONS: Record<string, typeof Boxes> = {
  CupSoda, Sparkles, Boxes, Package, Apple, Utensils, Coffee, ShoppingBag,
  BriefcaseMedical, FileText,
};

/** Category → Sub Category → Minor Category → Item, built from the classified lines. */
type MinorNode = { name: string; items: GalleyItemClass[] };
type SubNode = { name: string; minors: MinorNode[]; items: GalleyItemClass[] };
type CategoryNode = { group: GalleyGroupDef; subs: SubNode[]; items: GalleyItemClass[] };

function buildTree(groups: GalleyGroupDef[], classified: GalleyItemClass[]): CategoryNode[] {
  return groups.map((group) => {
    // Auto-subtotals are computed from the other lines, so they are not scope —
    // there is nothing meaningful to switch off.
    const items = classified.filter((c) => c.group === group.id && !c.auto);
    const subs: SubNode[] = [];
    const bySub = new Map<string, SubNode>();
    for (const it of items) {
      let sub = bySub.get(it.subCategory);
      if (!sub) {
        sub = { name: it.subCategory, minors: [], items: [] };
        bySub.set(it.subCategory, sub);
        subs.push(sub);
      }
      sub.items.push(it);
      let minor = sub.minors.find((m) => m.name === it.minorCategory);
      if (!minor) {
        minor = { name: it.minorCategory, items: [] };
        sub.minors.push(minor);
      }
      minor.items.push(it);
    }
    return { group, subs, items };
  });
}

export default function GalleyItemGroupsPage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GalleyGroupDef[]>(() => getAllGalleyGroups());
  const [disabled, setDisabled] = useState<Set<string>>(() => readDisabledNodes());
  const [search, setSearch] = useState("");
  const [openCats, setOpenCats] = useState<Set<string>>(() => new Set());
  const [openSubs, setOpenSubs] = useState<Set<string>>(() => new Set());

  const classified = useMemo(() => classifyGalleyItems(), []);
  const tree = useMemo(() => buildTree(groups, classified), [groups, classified]);

  // A search matches items, and keeps whatever branches hold them — so typing a
  // product name lands on the row that switches it, not on an empty category.
  const q = search.trim().toLowerCase();
  const matches = (it: GalleyItemClass) =>
    !q ||
    it.label.toLowerCase().includes(q) ||
    it.key.toLowerCase().includes(q) ||
    it.subCategory.toLowerCase().includes(q) ||
    it.minorCategory.toLowerCase().includes(q) ||
    (it.profileCode ?? "").toLowerCase().includes(q);

  const visibleTree = useMemo(() => {
    if (!q) return tree;
    return tree
      .map((cat) => ({
        ...cat,
        subs: cat.subs
          .map((s) => ({
            ...s,
            items: s.items.filter(matches),
            minors: s.minors
              .map((m) => ({ ...m, items: m.items.filter(matches) }))
              .filter((m) => m.items.length > 0),
          }))
          .filter((s) => s.items.length > 0),
      }))
      .filter((cat) => cat.subs.length > 0);
  }, [tree, q]);

  const persist = (next: Set<string>) => {
    setDisabled(next);
    writeDisabledNodes(next);
  };

  const toggleNode = (id: string, enabled: boolean, label: string) => {
    persist(setNodeEnabled(disabled, id, enabled));
    toast.success(`${label} ${enabled ? "enabled" : "disabled"} on the Galley Plan.`);
  };

  const toggleCategory = (group: GalleyGroupDef, active: boolean) => {
    setGroups(setGalleyGroupActive(group.id, active));
    toast.success(
      active
        ? `${group.label} will show as a tab on the Galley Plan.`
        : `${group.label} removed from the Galley Plan tabs.`,
    );
  };

  const resetAll = () => {
    persist(new Set());
    setGroups(getAllGalleyGroups().map((g) => {
      setGalleyGroupActive(g.id, true);
      return { ...g, active: true };
    }));
    toast.info("Every category, sub-category, minor category and item is back on the sheet.");
  };

  // ── Effective state ────────────────────────────────────────────────────────
  const catOn = (c: CategoryNode) => c.group.active !== false;
  const subOn = (c: CategoryNode, s: SubNode) => !disabled.has(subNodeId(c.group.id, s.name));
  const minorOn = (c: CategoryNode, s: SubNode, m: MinorNode) =>
    !disabled.has(minorNodeId(c.group.id, s.name, m.name));
  const itemOn = (it: GalleyItemClass) => !disabled.has(itemNodeId(it.key));
  const itemLoads = (c: CategoryNode, s: SubNode, m: MinorNode, it: GalleyItemClass) =>
    catOn(c) && subOn(c, s) && minorOn(c, s, m) && itemOn(it);

  // Counted off the tree, not off every classified line: the meal-summary lines
  // carry the computed Meals group, which is not a switchable category and has
  // no node here — counting them would report a total nobody can act on.
  const scoped = tree.flatMap((c) => c.subs.flatMap((s) => s.items));
  const totalItems = scoped.length;
  const loadableItems = tree.reduce(
    (n, c) => n + c.subs.reduce(
      (m, s) => m + s.minors.reduce(
        (k, mi) => k + mi.items.filter((it) => itemLoads(c, s, mi, it)).length, 0), 0), 0);
  const activeCats = tree.filter(catOn).length;
  const subCount = tree.reduce((n, c) => n + c.subs.length, 0);
  const unprofiled = scoped.filter((c) => !c.profileCode).length;

  const toggleOpen = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  };

  return (
    <>
      <PageHeader
        title="Galley Items Group"
        subtitle="Choose what the Galley Plan may load. Categories become the tabs beside Meals; switch a sub-category, minor category or single item off to keep it out of the sheet without removing it from stock."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate("/config-item")}>
              <ExternalLink className="h-4 w-4 mr-1.5" /> Item Profile
            </Button>
            <Button variant="outline" onClick={resetAll}>
              <RotateCcw className="h-4 w-4 mr-1.5" /> Enable All
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <KpiCard label="Categories On" value={`${activeCats}/${tree.length}`} icon={Layers} tone="navy" />
        <KpiCard label="Sub Categories" value={subCount} icon={Tags} tone="success" />
        <KpiCard label="Items On Sheet" value={`${loadableItems}/${totalItems}`} icon={Tag} tone="warning" />
        <KpiCard label="Without Item Profile" value={unprofiled} icon={Package} tone="navy" />
      </div>

      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Galley Item Groups</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Every level below comes from the Item Profile — a line appears here because an item is
                tagged into a galley group there. To add one, tag it on the{" "}
                <button type="button" onClick={() => navigate("/config-item")} className="underline decoration-dotted hover:text-foreground">
                  Item Profile
                </button>.
              </p>
            </div>
            <div className="relative w-full sm:w-72 shrink-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search item, code or category…"
                className="h-9 pl-8"
              />
            </div>
          </div>

          {visibleTree.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {q ? <>Nothing matches <strong className="text-foreground">{search}</strong>.</>
                 : <>No galley items yet — tag an item with a galley group on the Item Profile.</>}
            </div>
          ) : (
            <div className="space-y-3">
              {visibleTree.map((cat) => {
                const on = catOn(cat);
                const open = openCats.has(cat.group.id) || !!q;
                const Icon = GROUP_ICONS[cat.group.icon ?? ""] ?? Boxes;
                const catItems = cat.subs.reduce((n, s) => n + s.items.length, 0);
                const catLoadable = cat.subs.reduce(
                  (n, s) => n + s.minors.reduce(
                    (k, m) => k + m.items.filter((it) => itemLoads(cat, s, m, it)).length, 0), 0);
                return (
                  <div
                    key={cat.group.id}
                    className={cn(
                      "rounded-xl border overflow-hidden transition-colors",
                      on ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50/70",
                    )}
                  >
                    {/* ── Category ── */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
                      <button
                        type="button"
                        onClick={() => toggleOpen(openCats, setOpenCats, cat.group.id)}
                        className="h-6 w-6 shrink-0 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                        aria-label={open ? `Collapse ${cat.group.label}` : `Expand ${cat.group.label}`}
                      >
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <div className={cn(
                        "h-9 w-9 shrink-0 flex items-center justify-center rounded-lg",
                        on ? "bg-sky-100 text-sky-700" : "bg-slate-200 text-slate-400",
                      )}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className={cn("text-sm font-bold leading-tight", on ? "text-slate-800" : "text-slate-400")}>
                            {cat.group.label}
                          </p>
                          {!on && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-600">
                              <EyeOff className="h-2.5 w-2.5" /> Not a tab
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {cat.group.caption ?? `${cat.subs.length} sub categor${cat.subs.length === 1 ? "y" : "ies"}`}
                        </p>
                      </div>
                      <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
                        {catLoadable}/{catItems} items
                      </span>
                      <Switch
                        checked={on}
                        onCheckedChange={(next) => toggleCategory(cat.group, next)}
                        aria-label={`${cat.group.label} category`}
                      />
                    </div>

                    {/* ── Sub categories ── */}
                    {open && (
                      <div className="divide-y divide-slate-100">
                        {cat.subs.map((sub) => {
                          const sId = subNodeId(cat.group.id, sub.name);
                          const sOn = subOn(cat, sub);
                          const sOpen = openSubs.has(sId) || !!q;
                          return (
                            <div key={sId} className={cn(!sOn && "bg-slate-50/60")}>
                              <div className="flex items-center gap-2 pl-8 pr-4 py-2">
                                <button
                                  type="button"
                                  onClick={() => toggleOpen(openSubs, setOpenSubs, sId)}
                                  className="h-5 w-5 shrink-0 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                                  aria-label={sOpen ? `Collapse ${sub.name}` : `Expand ${sub.name}`}
                                >
                                  {sOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                </button>
                                <Tags className={cn("h-3.5 w-3.5 shrink-0", sOn ? "text-sky-600" : "text-slate-300")} />
                                <span className={cn(
                                  "text-xs font-semibold uppercase tracking-wider flex-1 min-w-0 truncate",
                                  sOn && on ? "text-slate-700" : "text-slate-400",
                                )}>
                                  {sub.name}
                                </span>
                                <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                                  {sub.items.length} item{sub.items.length === 1 ? "" : "s"}
                                </span>
                                <Switch
                                  checked={sOn}
                                  disabled={!on}
                                  onCheckedChange={(next) => toggleNode(sId, next, sub.name)}
                                  aria-label={`${sub.name} sub category`}
                                />
                              </div>

                              {/* ── Minor categories + items ── */}
                              {sOpen && (
                                <div className="pb-2">
                                  {sub.minors.map((minor) => {
                                    const mId = minorNodeId(cat.group.id, sub.name, minor.name);
                                    const mOn = minorOn(cat, sub, minor);
                                    return (
                                      <div key={mId}>
                                        <div className="flex items-center gap-2 pl-[4.5rem] pr-4 py-1.5">
                                          <Tag className={cn("h-3 w-3 shrink-0", mOn ? "text-violet-500" : "text-slate-300")} />
                                          <span className={cn(
                                            "text-[11px] font-medium flex-1 min-w-0 truncate",
                                            minor.name === UNCLASSIFIED && "italic",
                                            mOn && sOn && on ? "text-slate-600" : "text-slate-400",
                                          )}>
                                            {minor.name}
                                            {minor.name === UNCLASSIFIED && (
                                              <span className="ml-1.5 text-[10px] text-muted-foreground not-italic">
                                                — no minor category on the Item Profile
                                              </span>
                                            )}
                                          </span>
                                          <Switch
                                            checked={mOn}
                                            disabled={!on || !sOn}
                                            onCheckedChange={(next) => toggleNode(mId, next, minor.name)}
                                            aria-label={`${minor.name} minor category`}
                                          />
                                        </div>

                                        {minor.items.map((it) => {
                                          const iId = itemNodeId(it.key);
                                          const iOn = itemOn(it);
                                          const loads = itemLoads(cat, sub, minor, it);
                                          return (
                                            <div
                                              key={iId}
                                              className="flex items-center gap-2 pl-[6rem] pr-4 py-1.5 hover:bg-muted/30"
                                            >
                                              <div className="min-w-0 flex-1">
                                                <span className={cn("text-sm", loads ? "text-slate-700" : "text-slate-400 line-through")}>
                                                  {it.label}
                                                </span>
                                                {it.unit && (
                                                  <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                                                    {it.unit}
                                                  </span>
                                                )}
                                                <span className="ml-2 text-[10px] font-mono text-muted-foreground">
                                                  {it.profileCode ?? it.key}
                                                </span>
                                                {!it.profileCode && (
                                                  <span
                                                    className="ml-1.5 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800"
                                                    title="This galley line has no Item Profile, so it has no sub / minor category of its own — it is filed under its sheet section. Create a profile to classify it."
                                                  >
                                                    no profile
                                                  </span>
                                                )}
                                              </div>
                                              {iOn && !loads && (
                                                <span className="text-[10px] text-muted-foreground shrink-0">
                                                  off via {!on ? cat.group.label : !sOn ? sub.name : minor.name}
                                                </span>
                                              )}
                                              <Switch
                                                checked={iOn}
                                                disabled={!on || !sOn || !mOn}
                                                onCheckedChange={(next) => toggleNode(iId, next, it.label)}
                                                aria-label={it.label}
                                              />
                                            </div>
                                          );
                                        })}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
