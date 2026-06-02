# Harvest Catering — Design System

Design language and UI conventions for the **Harvest Catering** management
console (US-Bangla Airlines Flight Catering). This document describes the
tokens, components, and patterns actually implemented in the codebase so that
new screens stay visually and behaviourally consistent.

> Source of truth for tokens: [`src/index.css`](src/index.css) (shadcn/Tailwind
> layer, `oklch`) and [`src/styles/globals.css`](src/styles/globals.css) (Harvest
> brand layer, hex). Sidebar specifics live in
> [`src/layouts/AppLayout/Sidebar.css`](src/layouts/AppLayout/Sidebar.css).

---

## 1. Product context

A back-office console for airline flight-catering operations: order management,
meal planning, production, QC / food safety, packaging & dispatch, inventory,
procurement, and a GM/Admin dashboard. Density-first, data-heavy, desktop-led.
Tone: operational, precise, calm — colour is used to signal status, not to
decorate.

---

## 2. Tech stack

| Concern            | Choice |
|--------------------|--------|
| Framework          | React 18 + TypeScript |
| Build              | Vite 5 |
| Styling            | Tailwind CSS v4 (`@theme inline`) + CSS custom properties |
| Component kits     | **Two, intentionally:** Ant Design 5 (`antd`) and shadcn/ui (Radix primitives in `src/components/ui`) |
| Icons              | `lucide-react` (primary) and `@ant-design/icons` |
| Charts             | `recharts` |
| Routing            | `react-router-dom` v6 (`BrowserRouter`) |
| State              | In-memory stores (`zustand`-style hooks + context); `@tanstack/react-query` available |
| Toasts             | `sonner` |
| Tables/lists       | native tables + Radix; `@dnd-kit` for sortable |

Two component systems coexist. Ant Design powers chrome-heavy controls (buttons,
date pickers, dropdowns, modals); shadcn/Radix powers composable primitives
(Tabs, Dialog, Badge, Table). Keep a given screen consistent — don't mix a shadcn
`Button` next to an antd `Button` in the same control group.

---

## 3. Brand & visual language

- **Brand:** Harvest Catering — a warm, confident, **red-led** identity.
- **Lead colour:** Harvest red `#E10101`, expressed most strongly through the
  **CTA gradient** (`#ff2d2d → #E10101 → #a60303`) applied to primary action
  buttons.
- **Shell:** warm near-white page background with pure-white surfaces and a
  fine warm border (`--line #e6e2e0`).
- **Accent / focus:** teal `#0f766e` is the shadcn `--primary` token, used for
  focus rings, links, and some secondary accents (the original "Vizyon" base
  palette that the Harvest red layer sits on top of).
- **Status semantics:** green = success/done, amber = warning/in-progress,
  red = delayed/critical/destructive, navy = scheduled/dispatched (info),
  slate = neutral/pending.

---

## 4. Colour system

### 4.1 Two token layers (important)

There are **two** custom-property layers, and they must not collide:

1. **shadcn/Tailwind layer** — [`src/index.css`](src/index.css), values in
   `oklch`. These back every Tailwind utility (`bg-muted`, `text-foreground`,
   `border-border`, …) via the `@theme inline` map (`--color-* → var(--*)`).
2. **Harvest brand layer** — [`src/styles/globals.css`](src/styles/globals.css),
   values in hex. Brand-specific tokens for hand-styled markup.

> ⚠️ **Naming rule — do not redefine shadcn tokens in the brand layer.**
> `--muted` is the shadcn **muted *background*** (a light tint); `--muted-foreground`
> is the **text** colour. A previous regression redefined `--muted` to a dark
> grey in the brand layer, which turned every `bg-muted` surface dark while
> `text-muted-foreground` stayed grey → invisible "gray-on-gray" labels (empty
> badges, unreadable tab strips). **Muted text uses `var(--muted-foreground)`,
> never `var(--muted)`.** See §10.

### 4.2 Brand tokens (`globals.css`)

| Token            | Value      | Use |
|------------------|------------|-----|
| `--red`          | `#E10101`  | Brand red |
| `--red-bright`   | `#ff2d2d`  | Gradient top |
| `--red-deep`     | `#a60303`  | Gradient bottom |
| `--ink`          | `#1a0204`  | Primary text / numbers |
| `--line`         | `#e6e2e0`  | Hairline borders |
| `--paper`        | `#ffffff`  | Surfaces |
| `--paper-warm`   | `#f7f3f1`  | Warm subsurface |
| `--gradient-button` | `linear-gradient(120deg,#ff2d2d 0%,#E10101 55%,#a60303 100%)` | Primary CTA fill |

### 4.3 Semantic tokens (`index.css`, light theme)

| Token                | Approx.        | Meaning |
|----------------------|----------------|---------|
| `--background`       | warm gray `#F4F5F8` | Page shell |
| `--card` / `--popover` | white        | Surfaces |
| `--foreground`       | near-black ink | Text |
| `--primary`          | teal `#0f766e` | Focus, links, accent |
| `--muted`            | light teal-gray | Muted **background** |
| `--muted-foreground` | mid-gray `≈#6b7280` | Muted **text** |
| `--success` / `--leaf` | green        | Done / positive |
| `--warning` / `--amber` | amber       | Warning / in-progress |
| `--destructive`      | red            | Errors / critical |
| `--navy`             | navy           | Scheduled / dispatched (info) |
| `--border` / `--input` | teal-tinted gray | Lines, field borders |

A `.dark` theme variant is defined in `index.css` (deep slate shell, lighter
teal). New components must read tokens (not hardcode hex) so dark mode keeps
working.

### 4.4 Chart palette

`--chart-1..5` = teal, brand red, green, amber, navy. On the dashboard, charts
also use brand-led hex (`#E10101`, `#7e0206`, `#d97316`, `#3c3a40`). Keep series
colours drawn from this set.

---

## 5. Typography

Font families (loaded via Google Fonts in `index.css`):

| Role        | `--font-*` | Family |
|-------------|------------|--------|
| Body / UI   | `--font-sans`, `--font-ui` | Manrope / Mulish / Inter |
| Headings    | `--font-heading` | Space Grotesk |
| Display numbers | `--serif` | Newsreader (serif) — KPI hero numbers |
| Brand mark  | `--font-brand` | Orbitron |
| Mono / codes| `--font-mono` | JetBrains Mono — IDs, PNRs, quantities |

**Type scale** (`--text-*`): 11 / 12 / 13 / 14 / 16 / 20 / 24 px.
**Tracking:** labels and table headers use `uppercase` + `tracking-wider`/`widest`.
**Numbers:** tabular figures (`font-variant-numeric: tabular-nums`) for any
column of quantities, times, or counts. KPI hero values use the Newsreader serif.

---

## 6. Spacing, radius, elevation

- **Radius scale** (`--radius` base 8px): `sm 4px` (chips/badges) · `md 8px`
  (buttons/inputs) · `lg 12px` (cards) · `xl 16px` (hero panels) · `2xl 24px`
  (large modals).
- **Shadows:** `--shadow-sm` (hairline), `--shadow-md` (cards), `--shadow-lg`
  (overlays). CTA buttons add a soft red glow.
- **Grid gaps:** dashboards/forms use `gap-4`; KPI grid is
  `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`. Form field grids use
  `gap-x-6 gap-y-4`.

---

## 7. Components & patterns

### 7.1 Primary buttons / CTAs
Labeled action buttons render with the **red CTA gradient** globally (a rule in
`globals.css` paints `.ant-btn-primary`, non-icon `.ant-btn-default`, `.hc-cta`,
etc.). Consequences:
- Icon-only, `text`, `link`, and `dangerous` buttons are deliberately **excluded**
  and stay neutral — use those types for utility/secondary controls.
- To make a labeled button render **white/neutral** (e.g. an unselected toggle),
  you must override with sufficient specificity. See the `.period-toggle-idle`
  pattern in `index.tsx` + `globals.css` (it repeats the CTA `:not()` chain plus
  its own class so it can win the cascade). Don't fight the gradient with an
  inline `background` — an inline style can't beat the `!important` gradient.

### 7.2 KPI cards — [`KpiCard`](src/components/common/KpiCard.tsx)
White (or soft status-wash) card, left accent bar, uppercase muted label, large
serif value, and a sub-line. **Tones:** `navy` (brand red accent), `red`,
`success`, `warning`, `info`, `ink`. A leading signed/`%` token in the sub-line
is auto-coloured (down→red, up→green); plain counts stay muted.

### 7.3 Status & meal badges
Pill badges (`rounded-full px-2 py-0.5 text-xs font-semibold`). Encode state by
**tinted bg + readable text of the same hue**, e.g.:
- Done / QC Done → `bg-emerald-100 text-emerald-700` (or emerald outline)
- In-progress → `bg-amber-100 text-amber-700`
- Pending / neutral → `bg-slate-100 text-slate-600`
- Info → blue/navy tints
Never pair a tinted background with `text-muted-foreground` (see §10).

### 7.4 Tabs — [`src/components/ui/tabs.tsx`](src/components/ui/tabs.tsx)
shadcn Tabs: `TabsList` is `bg-muted` (light), inactive `TabsTrigger` is
`text-muted-foreground`, active is `bg-background text-foreground` with a shadow.
Used e.g. for the Meal Planning day strip.

### 7.5 Segmented period toggles (dashboard)
Spaced (`gap-2`) row of **small** buttons; the selected one shows the red CTA
fill, the rest are white (`.period-toggle-idle`). Prefer this spaced pattern
over antd `Button.Group` (which joins buttons edge-to-edge).

### 7.6 Tables / lists
Native tables with `bg-muted/40` headers, hairline row borders, `tabular-nums`
for numeric columns. **Group-by rows** use `rowSpan` to merge repeated cells
(e.g. one ORDER cell spanning its flights in Packaging & Dispatch; a colour
accent stripe keyed to status). Row actions live in a trailing **Actions**
column (`View`, contextual primary action, `⋯` overflow menu).

### 7.7 Detail / config modals
Radix `Dialog`. Header band, scrollable body (`max-h-[…vh] overflow-y-auto`),
footer with `Cancel` + primary. Detail views use a 2-col label/value grid
(`DetailRow`), tinted summary strips (`bg-muted/40`), and an embedded table for
line items. Edit modals mirror the create-page layout.

### 7.8 Toasts
`sonner` — `toast.success/info/error`. Use for confirmations and validation
("Add at least one flight."), not for persistent state.

---

## 8. Layout

- **App shell:** sticky left **Sidebar** ([`Sidebar.tsx`](src/layouts/AppLayout/Sidebar.tsx)),
  white with teal/red accents, collapsible; animated brand mark; brand wordmark
  on one line (`HARVEST` ink + `CATERING` accent) above the tagline.
- **Top bar:** red gradient header with breadcrumb, clock, global search
  (`Ctrl K`), notifications, user menu.
- **Page header:** [`PageHeader`](src/components/layout/PageHeader.tsx) — title +
  subtitle on the left, actions on the right (filters, primary CTA).
- **Content:** white cards on the warm shell; a thin red livery stripe separates
  the page header from content on some pages.

---

## 9. Motion & interaction

- Subtle, fast easing; respect `prefers-reduced-motion` (and the Theme Center
  `data-motion="reduced"` flag, which disables sidebar/brand animations).
- **Arrival flash** ([`src/lib/arrival-flash.ts`](src/lib/arrival-flash.ts)): when
  navigating from a KPI/link to a target row, flash the row (~4s amber) and
  scroll it into view. Deep-link via `?ord=ORD-XXXX`; the destination page jumps
  to the right page and highlights `[data-arrival-row-id]`. Targeted rows flash;
  the surrounding container does **not** when specific rows are targeted.
- **Workflow strips:** horizontal status-flow indicators (Pending → Approved →
  Production → Dispatched → Completed) on order/flight details.

---

## 10. Accessibility & contrast rules

- **Every badge/pill must have readable contrast.** A tinted background pairs
  with a same-hue **dark** text token — never with `text-muted-foreground` on a
  muted/dark fill. The "gray-on-gray" bug (invisible labels) came from exactly
  this; the systemic fix was keeping `--muted` light and routing muted text to
  `--muted-foreground`.
- Prefer semantic tokens so light/dark themes both stay legible.
- Interactive controls keep visible focus rings (`--ring`, teal).
- Hit targets: small buttons are 30px tall (`size="small"` / `h-7`); keep clickable
  rows and icons comfortably tappable.

---

## 11. Conventions & gotchas

- **Tokens over hex.** Use Tailwind utilities / `var(--token)`; reserve raw hex
  for brand-layer values that have no token.
- **Don't shadow shadcn token names** (`--muted`, `--background`, `--foreground`,
  …) in the brand layer.
- **CTA gradient is global** — design around it (§7.1); use `text`/`link`/icon
  buttons for neutral controls.
- **`tabular-nums`** on all numeric columns.
- **Quality gate:** `tsc --noEmit` clean; verify UI changes live (the app's own
  rendering is the evidence), not just by typechecking.
- **Domain terminology:** flights are called **"flights"**, never "legs".

---

## 12. File map

| Area | Path |
|------|------|
| Tailwind/shadcn tokens, fonts, type scale | `src/index.css` |
| Harvest brand tokens, global CTA, popups | `src/styles/globals.css` |
| Sidebar styles & brand mark | `src/layouts/AppLayout/Sidebar.css` |
| shadcn primitives | `src/components/ui/*` |
| Shared components (KpiCard, DataTable, RowActions, …) | `src/components/common/*` |
| Layout (PageHeader, AppLayout, Sidebar) | `src/components/layout/*`, `src/layouts/AppLayout/*` |
| Routes / screens | `src/routes/*` |
