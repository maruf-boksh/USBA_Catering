import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ThemePreset {
  name: string;
  label: string;
  primary: string;
  dark: string;
  light: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { name: 'harvest',   label: 'Harvest',   primary: '#E10101', dark: '#a60303', light: '#fff0f0' },
  { name: 'teal',      label: 'Teal',      primary: '#0f766e', dark: '#115e59', light: '#f0fdfa' },
  { name: 'blue',      label: 'Blue',      primary: '#2563eb', dark: '#1d4ed8', light: '#eff6ff' },
  { name: 'violet',    label: 'Violet',    primary: '#7c3aed', dark: '#6d28d9', light: '#f5f3ff' },
  { name: 'rose',      label: 'Rose',      primary: '#e11d48', dark: '#be123c', light: '#fff1f2' },
  { name: 'amber',     label: 'Amber',     primary: '#d97706', dark: '#b45309', light: '#fffbeb' },
  { name: 'indigo',    label: 'Indigo',    primary: '#4f46e5', dark: '#4338ca', light: '#eef2ff' },
  { name: 'emerald',   label: 'Emerald',   primary: '#059669', dark: '#047857', light: '#ecfdf5' },
  { name: 'sky',       label: 'Sky',       primary: '#0284c7', dark: '#0369a1', light: '#f0f9ff' },
  { name: 'pink',      label: 'Pink',      primary: '#db2777', dark: '#be185d', light: '#fdf2f8' },
  { name: 'orange',    label: 'Orange',    primary: '#ea580c', dark: '#c2410c', light: '#fff7ed' },
  { name: 'fuchsia',   label: 'Fuchsia',   primary: '#a21caf', dark: '#86198f', light: '#fdf4ff' },
  { name: 'slate',     label: 'Slate',     primary: '#475569', dark: '#334155', light: '#f8fafc' },
  { name: 'cyan',      label: 'Cyan',      primary: '#0891b2', dark: '#0e7490', light: '#ecfeff' },
  { name: 'lime',      label: 'Lime',      primary: '#65a30d', dark: '#4d7c0f', light: '#f7fee7' },
  { name: 'red',       label: 'Red',       primary: '#dc2626', dark: '#b91c1c', light: '#fef2f2' },
  { name: 'purple',    label: 'Purple',    primary: '#9333ea', dark: '#7e22ce', light: '#faf5ff' },
  { name: 'mint',      label: 'Mint',      primary: '#10b981', dark: '#059669', light: '#d1fae5' },
  { name: 'coral',     label: 'Coral',     primary: '#f43f5e', dark: '#e11d48', light: '#ffe4e6' },
  { name: 'navy',      label: 'Navy',      primary: '#1e3a8a', dark: '#1e40af', light: '#dbeafe' },
  { name: 'gold',      label: 'Gold',      primary: '#ca8a04', dark: '#a16207', light: '#fef9c3' },
  { name: 'ruby',      label: 'Ruby',      primary: '#9f1239', dark: '#881337', light: '#ffe4e6' },
  { name: 'forest',    label: 'Forest',    primary: '#166534', dark: '#14532d', light: '#dcfce7' },
  { name: 'plum',      label: 'Plum',      primary: '#86198f', dark: '#701a75', light: '#fae8ff' },
  { name: 'graphite',  label: 'Graphite',  primary: '#27272a', dark: '#18181b', light: '#e4e4e7' },
  { name: 'turquoise', label: 'Turquoise', primary: '#14b8a6', dark: '#0d9488', light: '#ccfbf1' },
  { name: 'jade',      label: 'Jade',      primary: '#15803d', dark: '#166534', light: '#dcfce7' },
  { name: 'lavender',  label: 'Lavender',  primary: '#8b5cf6', dark: '#7c3aed', light: '#ede9fe' },
  { name: 'peach',     label: 'Peach',     primary: '#fb923c', dark: '#f97316', light: '#ffedd5' },
  { name: 'magenta',   label: 'Magenta',   primary: '#c026d3', dark: '#a21caf', light: '#fae8ff' },
  { name: 'crimson',   label: 'Crimson',   primary: '#b91c1c', dark: '#991b1b', light: '#fee2e2' },
  { name: 'ocean',     label: 'Ocean',     primary: '#0369a1', dark: '#075985', light: '#e0f2fe' },
  { name: 'aqua',      label: 'Aqua',      primary: '#06b6d4', dark: '#0891b2', light: '#cffafe' },
  { name: 'sunset',    label: 'Sunset',    primary: '#f97316', dark: '#ea580c', light: '#ffedd5' },
  { name: 'copper',    label: 'Copper',    primary: '#b45309', dark: '#92400e', light: '#fef3c7' },
  { name: 'sage',      label: 'Sage',      primary: '#84cc16', dark: '#65a30d', light: '#ecfccb' },
  { name: 'lilac',     label: 'Lilac',     primary: '#a855f7', dark: '#9333ea', light: '#f3e8ff' },
  { name: 'cherry',    label: 'Cherry',    primary: '#e11d48', dark: '#be123c', light: '#ffe4e6' },
  { name: 'cobalt',    label: 'Cobalt',    primary: '#1d4ed8', dark: '#1e40af', light: '#dbeafe' },
  { name: 'mocha',     label: 'Mocha',     primary: '#78350f', dark: '#451a03', light: '#fef3c7' },
  { name: 'azure',     label: 'Azure',     primary: '#0ea5e9', dark: '#0284c7', light: '#e0f2fe' },
  { name: 'periwinkle',label: 'Periwinkle',primary: '#6366f1', dark: '#4f46e5', light: '#e0e7ff' },
  { name: 'apricot',   label: 'Apricot',   primary: '#fb923c', dark: '#ea580c', light: '#fed7aa' },
  { name: 'rust',      label: 'Rust',      primary: '#9a3412', dark: '#7c2d12', light: '#ffedd5' },
  { name: 'olive',     label: 'Olive',     primary: '#4d7c0f', dark: '#365314', light: '#ecfccb' },
  { name: 'pine',      label: 'Pine',      primary: '#064e3b', dark: '#022c22', light: '#d1fae5' },
  { name: 'denim',     label: 'Denim',     primary: '#3b82f6', dark: '#2563eb', light: '#dbeafe' },
  { name: 'salmon',    label: 'Salmon',    primary: '#fb7185', dark: '#f43f5e', light: '#ffe4e6' },
  { name: 'mauve',     label: 'Mauve',     primary: '#a78bfa', dark: '#8b5cf6', light: '#ede9fe' },
  { name: 'mustard',   label: 'Mustard',   primary: '#eab308', dark: '#ca8a04', light: '#fef08a' },
  { name: 'pearl',     label: 'Pearl',     primary: '#64748b', dark: '#475569', light: '#f1f5f9' },
  { name: 'flamingo',  label: 'Flamingo',  primary: '#ec4899', dark: '#db2777', light: '#fce7f3' },
  { name: 'sapphire',  label: 'Sapphire',  primary: '#1e40af', dark: '#1e3a8a', light: '#dbeafe' },
  { name: 'tangerine', label: 'Tangerine', primary: '#f97316', dark: '#ea580c', light: '#ffedd5' },
  { name: 'celadon',   label: 'Celadon',   primary: '#5eead4', dark: '#14b8a6', light: '#ccfbf1' },
  { name: 'orchid',    label: 'Orchid',    primary: '#d946ef', dark: '#a21caf', light: '#fae8ff' },
  { name: 'wine',      label: 'Wine',      primary: '#7f1d1d', dark: '#450a0a', light: '#fee2e2' },
];

export const FEATURED_PRESET_COUNT = 12;

export type ThemeMode        = 'light' | 'dark' | 'system';
export type BorderRadiusMode = 'sharp' | 'default' | 'rounded';
export type DensityMode      = 'compact' | 'default' | 'spacious';
export type FontFamilyMode   = 'manrope' | 'inter' | 'system';
export type TopbarStyle      = 'gradient' | 'minimal';
export type FontSizeMode     = 'sm' | 'md' | 'lg';
export type SidebarStyle     = 'default' | 'elevated';
export type SidebarColor     = 'primary' | 'white' | 'slate' | 'dark' | 'midnight' | 'custom';
export type PresetName       = string;

export interface SidebarColorPreset {
  name: SidebarColor;
  label: string;
  bg: string;
  tone: 'light' | 'dark';
}

export const SIDEBAR_COLOR_PRESETS: SidebarColorPreset[] = [
  { name: 'primary',  label: 'Primary',  bg: '',         tone: 'light' },
  { name: 'white',    label: 'White',    bg: '#ffffff',  tone: 'light' },
  { name: 'slate',    label: 'Slate',    bg: '#f1f5f9',  tone: 'light' },
  { name: 'dark',     label: 'Dark',     bg: '#1e293b',  tone: 'dark'  },
  { name: 'midnight', label: 'Midnight', bg: '#0f172a',  tone: 'dark'  },
];

export interface ThemeState {
  mode: ThemeMode;
  presetName: PresetName;
  primaryColor: string;
  primaryDark: string;
  primaryLight: string;
  borderRadius: BorderRadiusMode;
  density: DensityMode;
  fontFamily: FontFamilyMode;
  topbarStyle: TopbarStyle;
  fontSize: FontSizeMode;
  sidebarStyle: SidebarStyle;
  sidebarColor: SidebarColor;
  sidebarCustomBg: string;
  sidebarCustomFg: string;
  motionReduced: boolean;

  setMode: (mode: ThemeMode) => void;
  applyPreset: (name: string) => void;
  setCustomColor: (primary: string, dark: string, light: string) => void;
  setBorderRadius: (r: BorderRadiusMode) => void;
  setDensity: (d: DensityMode) => void;
  setFontFamily: (f: FontFamilyMode) => void;
  setTopbarStyle: (s: TopbarStyle) => void;
  setFontSize: (f: FontSizeMode) => void;
  setSidebarStyle: (s: SidebarStyle) => void;
  setSidebarColor: (c: SidebarColor) => void;
  setSidebarCustomBg: (bg: string) => void;
  setSidebarCustomFg: (fg: string) => void;
  resetSidebarCustomFg: () => void;
  setMotionReduced: (v: boolean) => void;
  reset: () => void;
}

const DEFAULT_PRESET = THEME_PRESETS[0];

const DEFAULT_STATE = {
  mode:          'light'    as ThemeMode,
  presetName:    DEFAULT_PRESET.name,
  primaryColor:  DEFAULT_PRESET.primary,
  primaryDark:   DEFAULT_PRESET.dark,
  primaryLight:  DEFAULT_PRESET.light,
  borderRadius:  'default'  as BorderRadiusMode,
  density:       'default'  as DensityMode,
  fontFamily:    'manrope'  as FontFamilyMode,
  topbarStyle:   'gradient' as TopbarStyle,
  fontSize:      'md'       as FontSizeMode,
  sidebarStyle:    'default' as SidebarStyle,
  sidebarColor:    'white'   as SidebarColor,
  sidebarCustomBg: '#ffffff',
  sidebarCustomFg: '',
  motionReduced:   false,
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setMode: (mode) => set({ mode }),

      applyPreset: (name) => {
        const preset = THEME_PRESETS.find((p) => p.name === name);
        if (!preset) return;
        set({
          presetName:  preset.name,
          primaryColor: preset.primary,
          primaryDark:  preset.dark,
          primaryLight: preset.light,
        });
      },

      setCustomColor: (primary, dark, light) =>
        set({ presetName: 'custom', primaryColor: primary, primaryDark: dark, primaryLight: light }),

      setBorderRadius:  (borderRadius)  => set({ borderRadius }),
      setDensity:       (density)       => set({ density }),
      setFontFamily:    (fontFamily)    => set({ fontFamily }),
      setTopbarStyle:   (topbarStyle)   => set({ topbarStyle }),
      setFontSize:      (fontSize)      => set({ fontSize }),
      setSidebarStyle:    (sidebarStyle)    => set({ sidebarStyle }),
      setSidebarColor:    (sidebarColor)    => set({ sidebarColor }),
      setSidebarCustomBg: (sidebarCustomBg) => set({ sidebarCustomBg, sidebarColor: 'custom' }),
      setSidebarCustomFg: (sidebarCustomFg) => set({ sidebarCustomFg }),
      resetSidebarCustomFg: ()              => set({ sidebarCustomFg: '' }),
      setMotionReduced:   (motionReduced)   => set({ motionReduced }),

      reset: () => set({ ...DEFAULT_STATE }),
    }),
    { name: 'vizyon-theme-v2' },
  ),
);
