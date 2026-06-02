import { useMemo, useRef, useState } from "react";
import {
  Palette, Check, RotateCcw, Layout as LayoutIcon, Type, Settings,
  Download, Upload, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useThemeSettings, patchThemeSettings, setThemeSettings, applyThemeToDOM,
  DEFAULT_THEME_SETTINGS, FONT_FAMILY_STACK, FONT_SIZE_PX,
  normalizeHex, readableForeground, shadeHex,
  type ThemeSettings,
} from "@/lib/theme-settings";

// Re-exported so AppShell can still call it from one place.
export function useApplyStoredTheme() {
  // Settings are already applied at module load; calling this just guarantees
  // a re-paint if anything stale leaked through. Cheap no-op otherwise.
  const s = useThemeSettings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemoApply(s);
}

// Tiny memo to avoid re-applying on every render.
function useMemoApply(s: ThemeSettings) {
  useMemo(() => { applyThemeToDOM(s); return null; }, [s]);
}

type Preset = { name: string; hex: string };

const PRESETS: Preset[] = [
  { name: "Teal",     hex: "#0F766E" }, { name: "Blue",     hex: "#2563EB" },
  { name: "Violet",   hex: "#7C3AED" }, { name: "Rose",     hex: "#E11D48" },
  { name: "Amber",    hex: "#D97706" }, { name: "Indigo",   hex: "#4F46E5" },
  { name: "Emerald",  hex: "#059669" }, { name: "Sky",      hex: "#0284C7" },
  { name: "Pink",     hex: "#DB2777" }, { name: "Orange",   hex: "#EA580C" },
  { name: "Fuchsia",  hex: "#C026D3" }, { name: "Slate",    hex: "#475569" },
];

const MORE_PRESETS: Preset[] = [
  { name: "Cyan",        hex: "#0891B2" }, { name: "Lime",       hex: "#65A30D" },
  { name: "Green",       hex: "#16A34A" }, { name: "Yellow",     hex: "#CA8A04" },
  { name: "Red",         hex: "#DC2626" }, { name: "Zinc",       hex: "#52525B" },
  { name: "Stone",       hex: "#57534E" }, { name: "Neutral",    hex: "#525252" },
  { name: "Gray",        hex: "#4B5563" }, { name: "Deep Teal",  hex: "#115E59" },
  { name: "Deep Blue",   hex: "#1D4ED8" }, { name: "Royal",      hex: "#4338CA" },
  { name: "Midnight",    hex: "#1E3A8A" }, { name: "Plum",       hex: "#86198F" },
  { name: "Mulberry",    hex: "#9D174D" }, { name: "Maroon",     hex: "#7F1D1D" },
  { name: "Brick",       hex: "#9A3412" }, { name: "Pumpkin",    hex: "#C2410C" },
  { name: "Mustard",     hex: "#A16207" }, { name: "Olive",      hex: "#3F6212" },
  { name: "Forest",      hex: "#15803D" }, { name: "Pine",       hex: "#166534" },
  { name: "Mint",        hex: "#10B981" }, { name: "Spring",     hex: "#22C55E" },
  { name: "Aqua",        hex: "#06B6D4" }, { name: "Ocean",      hex: "#0E7490" },
  { name: "Periwinkle",  hex: "#6366F1" }, { name: "Lavender",   hex: "#8B5CF6" },
  { name: "Orchid",      hex: "#A21CAF" }, { name: "Magenta",    hex: "#BE185D" },
  { name: "Coral",       hex: "#F43F5E" }, { name: "Cherry",     hex: "#BE123C" },
];

export function ThemeCenterButton() {
  const [open, setOpen] = useState(false);
  const settings = useThemeSettings();
  const [customHex, setCustomHex] = useState<string>(settings.primary);
  const [showMore, setShowMore] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const update = <K extends keyof ThemeSettings>(key: K, value: ThemeSettings[K]) =>
    patchThemeSettings({ [key]: value } as Partial<ThemeSettings>);

  const activeColorName = useMemo(() => {
    const hit = [...PRESETS, ...MORE_PRESETS].find((p) => p.hex.toUpperCase() === settings.primary.toUpperCase());
    return hit?.name ?? "Custom";
  }, [settings.primary]);

  const reset = () => {
    setThemeSettings(DEFAULT_THEME_SETTINGS);
    setCustomHex(DEFAULT_THEME_SETTINGS.primary);
    toast.success("Theme reset to defaults.");
  };

  const applyCustom = () => {
    const n = normalizeHex(customHex);
    if (!n) { toast.error("Enter a valid 6-character hex colour (e.g. #7C3AED)."); return; }
    update("primary", n);
    toast.success(`Primary colour set to ${n}.`);
  };

  const exportTheme = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `theme-${activeColorName.toLowerCase()}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Theme exported.");
  };

  const importTheme = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(String(e.target?.result ?? "")) as Partial<ThemeSettings>;
        if (!parsed.primary || !normalizeHex(parsed.primary)) throw new Error("Missing/invalid primary colour.");
        const next: ThemeSettings = { ...DEFAULT_THEME_SETTINGS, ...parsed };
        setThemeSettings(next);
        setCustomHex(next.primary);
        toast.success("Theme imported.");
      } catch (err) {
        toast.error(`Invalid theme file: ${err instanceof Error ? err.message : "parse error"}`);
      }
    };
    reader.onerror = () => toast.error("Failed to read file.");
    reader.readAsText(file);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Theme Center"
          title={`Theme Center — ${activeColorName}`}
          className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-white/95 hover:bg-white shadow-sm transition-colors"
          style={{ color: settings.primary }}
        >
          <Palette className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[380px] p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
          <div className="flex items-start gap-2">
            <div className="h-8 w-8 rounded-md grid place-items-center" style={{ background: settings.primary }}>
              <Palette className="h-4 w-4" style={{ color: readableForeground(settings.primary) }} />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">Theme Center</div>
              <div className="text-[11px] text-muted-foreground leading-tight">Personalize your workspace</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={reset} className="h-7 w-7" aria-label="Reset to default" title="Reset to default">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Live preview */}
        <div className="px-4 pt-3 pb-2">
          <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
            <div className="flex items-stretch h-[88px]">
              <div className="w-3" style={{ background: settings.primary }} />
              <div className="flex-1 flex flex-col">
                <div className="h-5 m-2 rounded-sm" style={{ background: settings.primary }} />
                <div className="flex-1 px-2 pb-2 grid grid-cols-3 gap-1.5">
                  <div className="h-3 rounded-sm bg-muted-foreground/15" />
                  <div className="h-3 rounded-sm bg-muted-foreground/15" />
                  <div className="h-3 rounded-sm" style={{ background: `${settings.primary}33` }} />
                  <div className="h-3 rounded-sm bg-muted-foreground/15" />
                  <div className="h-3 rounded-sm" style={{ background: `${settings.primary}55` }} />
                  <div className="h-6 rounded-sm" style={{ background: settings.primary }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <Tabs defaultValue="colors" className="flex flex-col">
          <TabsList className="mx-4 mt-1 grid grid-cols-4 h-8 bg-transparent p-0 gap-0 border-b border-border rounded-none">
            <TabHeader value="colors" icon={Palette}    label="Colors" />
            <TabHeader value="layout" icon={LayoutIcon} label="Layout" />
            <TabHeader value="type"   icon={Type}       label="Type" />
            <TabHeader value="system" icon={Settings}   label="System" />
          </TabsList>

          {/* ── Colors ─────────────────────────────────────────────────── */}
          <TabsContent value="colors" className="px-4 pt-3 pb-4 mt-0 max-h-[440px] overflow-y-auto">
            <SectionLabel>Color Presets <span className="font-normal text-muted-foreground/70">({PRESETS.length + MORE_PRESETS.length})</span></SectionLabel>
            <div className="grid grid-cols-6 gap-2">
              {PRESETS.map((p) => (
                <SwatchButton key={p.hex} preset={p} active={settings.primary.toUpperCase() === p.hex.toUpperCase()} onPick={(hex) => { update("primary", hex); setCustomHex(hex); }} />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowMore((s) => !s)}
              className="mt-3 w-full rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-foreground/80 hover:bg-muted/40 inline-flex items-center justify-center gap-2"
            >
              <span>{showMore ? "Fewer" : "More"} Colors</span>
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground" style={{ background: settings.primary }}>
                +{MORE_PRESETS.length}
              </span>
            </button>
            {showMore && (
              <div className="grid grid-cols-6 gap-2 mt-3">
                {MORE_PRESETS.map((p) => (
                  <SwatchButton key={p.hex} preset={p} active={settings.primary.toUpperCase() === p.hex.toUpperCase()} onPick={(hex) => { update("primary", hex); setCustomHex(hex); }} />
                ))}
              </div>
            )}
            <div className="mt-4">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Custom Color</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-9 w-9 rounded-md border border-border shrink-0" style={{ background: normalizeHex(customHex) ?? "transparent" }} />
                <Input value={customHex} onChange={(e) => setCustomHex(e.target.value)} placeholder="#7c3aed" className="font-mono h-9" onKeyDown={(e) => { if (e.key === "Enter") applyCustom(); }} />
                <Button onClick={applyCustom} className="h-9 shrink-0">Apply</Button>
              </div>
            </div>
          </TabsContent>

          {/* ── Layout ─────────────────────────────────────────────────── */}
          <TabsContent value="layout" className="px-4 pt-3 pb-4 mt-0 max-h-[440px] overflow-y-auto space-y-4">
            <div>
              <SectionLabel>Header Style</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                <OptionCard active={settings.headerStyle === "gradient"} onClick={() => update("headerStyle", "gradient")}
                  title="Gradient" subtitle="Vivid branded header"
                  preview={<div className="h-5 rounded-sm" style={{ background: `linear-gradient(90deg, ${settings.primary} 0%, ${shadeHex(settings.primary, 0.78)} 100%)` }} />} />
                <OptionCard active={settings.headerStyle === "minimal"} onClick={() => update("headerStyle", "minimal")}
                  title="Minimal" subtitle="Clean flat surface"
                  preview={<div className="h-5 rounded-sm bg-card border border-border" />} />
              </div>
            </div>

            <div>
              <SectionLabel>Sidebar Style</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                <OptionCard active={settings.sidebarStyle === "default"} onClick={() => update("sidebarStyle", "default")}
                  title="Default" subtitle="Flat sidebar"
                  preview={<div className="flex gap-1"><div className="h-5 w-5 rounded-sm bg-muted" /><div className="h-5 w-10 rounded-sm bg-muted-foreground/15" /></div>} />
                <OptionCard active={settings.sidebarStyle === "elevated"} onClick={() => update("sidebarStyle", "elevated")}
                  title="Elevated" subtitle="Shadow depth effect"
                  preview={<div className="h-5 w-10 rounded-sm bg-card shadow-md" />} />
              </div>
            </div>

            <div>
              <SectionLabel>Sidebar Color</SectionLabel>
              <div className="grid grid-cols-6 gap-2">
                <SidebarSwatch active={settings.sidebarColor === "primary"} bg={`${settings.primary}10`} border={settings.primary} onClick={() => update("sidebarColor", "primary")} />
                <SidebarSwatch active={settings.sidebarColor === "white"} bg="#FFFFFF" border="#E2E8F0" onClick={() => update("sidebarColor", "white")} />
                <SidebarSwatch active={settings.sidebarColor === "gray"} bg="#F1F5F9" border="#E2E8F0" onClick={() => update("sidebarColor", "gray")} />
                <SidebarSwatch active={settings.sidebarColor === "dark"} bg="#1E293B" border="#0F172A" onClick={() => update("sidebarColor", "dark")} />
                <SidebarSwatch active={settings.sidebarColor === "midnight"} bg="#0F172A" border="#020617" onClick={() => update("sidebarColor", "midnight")} />
                <SidebarSwatch active={settings.sidebarColor === "gradient"} bg="linear-gradient(135deg, #6366F1 0%, #EC4899 50%, #F59E0B 100%)" border="transparent" onClick={() => update("sidebarColor", "gradient")} />
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Active: <span className="font-semibold text-foreground capitalize">{settings.sidebarColor}</span>
              </div>
            </div>

            <div>
              <SectionLabel>Corner Radius</SectionLabel>
              <div className="grid grid-cols-3 gap-2">
                <OptionCard active={settings.cornerRadius === "sharp"} onClick={() => update("cornerRadius", "sharp")}
                  title="Sharp" preview={<div className="h-5 w-10 mx-auto bg-muted-foreground/30" />} />
                <OptionCard active={settings.cornerRadius === "default"} onClick={() => update("cornerRadius", "default")}
                  title="Default" preview={<div className="h-5 w-10 mx-auto rounded-md bg-muted-foreground/30" />} />
                <OptionCard active={settings.cornerRadius === "rounded"} onClick={() => update("cornerRadius", "rounded")}
                  title="Rounded" preview={<div className="h-5 w-10 mx-auto rounded-full bg-muted-foreground/30" />} />
              </div>
            </div>

            <div>
              <SectionLabel>UI Density</SectionLabel>
              <div className="grid grid-cols-3 gap-2">
                <OptionCard active={settings.density === "compact"} onClick={() => update("density", "compact")}
                  title="Compact" preview={<DensityPreview gap={1} />} />
                <OptionCard active={settings.density === "default"} onClick={() => update("density", "default")}
                  title="Default" preview={<DensityPreview gap={2} />} />
                <OptionCard active={settings.density === "spacious"} onClick={() => update("density", "spacious")}
                  title="Spacious" preview={<DensityPreview gap={4} />} />
              </div>
            </div>
          </TabsContent>

          {/* ── Type ───────────────────────────────────────────────────── */}
          <TabsContent value="type" className="px-4 pt-3 pb-4 mt-0 max-h-[440px] overflow-y-auto space-y-4">
            <div>
              <SectionLabel>Font Family</SectionLabel>
              <div className="space-y-2">
                {([
                  { value: "manrope", label: "Manrope", subtitle: "Modern & geometric" },
                  { value: "inter",   label: "Inter",   subtitle: "Clean & neutral" },
                  { value: "system",  label: "System UI", subtitle: "Native & familiar" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update("fontFamily", opt.value)}
                    className={cn(
                      "w-full rounded-md border px-3 py-2.5 flex items-center justify-between gap-3 text-left transition-colors",
                      settings.fontFamily === opt.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-semibold leading-none" style={{ fontFamily: FONT_FAMILY_STACK[opt.value] }}>Aa</span>
                      <div>
                        <div className="text-xs text-muted-foreground">{opt.subtitle}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground/80" style={{ fontFamily: FONT_FAMILY_STACK[opt.value] }}>{opt.label}</span>
                      {settings.fontFamily === opt.value && (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel>Font Size</SectionLabel>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: "small",  label: "Small",  size: "text-xs"   },
                  { value: "medium", label: "Medium", size: "text-base" },
                  { value: "large",  label: "Large",  size: "text-2xl"  },
                ] as const).map((opt) => (
                  <OptionCard key={opt.value} active={settings.fontSize === opt.value} onClick={() => update("fontSize", opt.value)}
                    title={opt.label}
                    preview={<span className={cn("font-semibold", opt.size)}>A</span>} />
                ))}
              </div>
            </div>

            <div>
              <SectionLabel>Preview</SectionLabel>
              <div className="rounded-md border border-border bg-card p-3 space-y-2">
                <div className="text-base font-bold" style={{ fontFamily: FONT_FAMILY_STACK[settings.fontFamily], fontSize: settings.fontSize === "small" ? 14 : settings.fontSize === "large" ? 18 : 16 }}>
                  US-Bangla Catering ERP
                </div>
                <div className="text-xs text-muted-foreground" style={{ fontFamily: FONT_FAMILY_STACK[settings.fontFamily] }}>
                  Manage flight kitchens, production orders, and supply chain in one consolidated workspace.
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button className="h-7 px-3 rounded-md text-xs font-semibold" style={{ background: settings.primary, color: readableForeground(settings.primary) }}>Primary</button>
                  <button className="h-7 px-3 rounded-md text-xs font-semibold border" style={{ borderColor: settings.primary, color: settings.primary }}>Outline</button>
                  <span className="h-6 px-2 rounded inline-flex items-center text-[10px] font-semibold" style={{ background: `${settings.primary}1A`, color: settings.primary }}>Badge</span>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── System ─────────────────────────────────────────────────── */}
          <TabsContent value="system" className="px-4 pt-3 pb-4 mt-0 max-h-[440px] overflow-y-auto space-y-4">
            <div>
              <SectionLabel>Accessibility</SectionLabel>
              <div className="rounded-md border border-border bg-card px-3 py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5" style={{ color: settings.primary }} />
                  <div>
                    <div className="text-xs font-semibold">Reduce Motion</div>
                    <div className="text-[10px] text-muted-foreground">
                      {settings.reduceMotion ? "Animations disabled" : "Smooth animations enabled"}
                    </div>
                  </div>
                </div>
                <Switch checked={settings.reduceMotion} onCheckedChange={(v) => update("reduceMotion", v)} />
              </div>
            </div>

            <div>
              <SectionLabel>Export &amp; Import</SectionLabel>
              <div className="space-y-2">
                <button type="button" onClick={exportTheme}
                  className="w-full rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 flex items-center gap-2.5 hover:bg-primary/10 transition-colors text-left">
                  <Download className="h-4 w-4 text-primary" />
                  <div>
                    <div className="text-xs font-semibold text-primary">Export Theme</div>
                    <div className="text-[10px] text-muted-foreground">Download settings as JSON</div>
                  </div>
                </button>
                <button type="button" onClick={() => importInputRef.current?.click()}
                  className="w-full rounded-md border border-border bg-card px-3 py-2.5 flex items-center gap-2.5 hover:bg-muted/40 transition-colors text-left">
                  <Upload className="h-4 w-4" />
                  <div>
                    <div className="text-xs font-semibold">Import Theme</div>
                    <div className="text-[10px] text-muted-foreground">Load from a JSON file</div>
                  </div>
                </button>
                <input ref={importInputRef} type="file" accept="application/json,.json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importTheme(f);
                    e.target.value = "";
                  }}
                  className="hidden"
                />
              </div>
            </div>

            <div>
              <SectionLabel>Active Settings</SectionLabel>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <SettingCell label="Color"         value={activeColorName} />
                <SettingCell label="Font"          value={settings.fontFamily === "system" ? "System UI" : settings.fontFamily[0].toUpperCase() + settings.fontFamily.slice(1)} />
                <SettingCell label="Size"          value={`${FONT_SIZE_PX[settings.fontSize]}px`} />
                <SettingCell label="Radius"        value={settings.cornerRadius[0].toUpperCase() + settings.cornerRadius.slice(1)} />
                <SettingCell label="Density"       value={settings.density[0].toUpperCase() + settings.density.slice(1)} />
                <SettingCell label="Header"        value={settings.headerStyle[0].toUpperCase() + settings.headerStyle.slice(1)} />
                <SettingCell label="Sidebar"       value={settings.sidebarStyle[0].toUpperCase() + settings.sidebarStyle.slice(1)} />
                <SettingCell label="Sidebar Color" value={settings.sidebarColor[0].toUpperCase() + settings.sidebarColor.slice(1)} />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function TabHeader({ value, icon: Icon, label }: { value: string; icon: typeof Palette; label: string }) {
  return (
    <TabsTrigger value={value}
      className="h-8 text-[11px] rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none">
      <Icon className="h-3 w-3 mr-1" /> {label}
    </TabsTrigger>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
      {children}
    </div>
  );
}

function SwatchButton({ preset, active, onPick }: { preset: Preset; active: boolean; onPick: (hex: string) => void }) {
  return (
    <button type="button" title={`${preset.name} · ${preset.hex}`} onClick={() => onPick(preset.hex)}
      className={cn(
        "group flex flex-col items-center gap-1 rounded-md p-1.5 hover:bg-muted/40 transition-colors",
        active && "bg-muted/60 ring-1 ring-primary/40",
      )}>
      <span className="relative h-9 w-9 rounded-md shadow-sm grid place-items-center" style={{ background: preset.hex }}>
        {active && <Check className="h-4 w-4" style={{ color: readableForeground(preset.hex) }} />}
      </span>
      <span className="text-[10px] text-foreground/80 leading-tight">{preset.name}</span>
    </button>
  );
}

function OptionCard({
  active, onClick, title, subtitle, preview,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
  preview: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-2.5 text-left transition-colors relative",
        active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
      )}>
      <div className="mb-1.5">{preview}</div>
      <div className="text-xs font-semibold">{title}</div>
      {subtitle && <div className="text-[10px] text-muted-foreground">{subtitle}</div>}
      {active && (
        <span className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full grid place-items-center" style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
          <Check className="h-2.5 w-2.5" />
        </span>
      )}
    </button>
  );
}

function SidebarSwatch({ active, bg, border, onClick }: { active: boolean; bg: string; border: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        "h-10 rounded-md border-2 flex items-center justify-center transition-all",
        active ? "ring-2 ring-primary ring-offset-1" : "hover:scale-105",
      )}
      style={{ background: bg, borderColor: border }}>
      {active && <Check className="h-3.5 w-3.5" style={{ color: bg.includes("#0F") || bg.includes("#1E") || bg.startsWith("linear") ? "#FFFFFF" : "var(--primary)" }} />}
    </button>
  );
}

function DensityPreview({ gap }: { gap: number }) {
  return (
    <div className="flex flex-col items-stretch" style={{ gap: `${gap}px` }}>
      <div className="h-1 rounded-full bg-muted-foreground/40" style={{ width: "70%" }} />
      <div className="h-1 rounded-full bg-muted-foreground/40" style={{ width: "100%" }} />
      <div className="h-1 rounded-full bg-muted-foreground/40" style={{ width: "55%" }} />
    </div>
  );
}

function SettingCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xs font-semibold text-foreground truncate">{value}</div>
    </div>
  );
}
