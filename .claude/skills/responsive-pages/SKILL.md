---
name: responsive-pages
description: Make Harvest Catering pages responsive (mobile → desktop). Use whenever building or editing a route/page/dialog/table in this app so it works at 375px phone width up to wide desktop. Covers the shell drawer, breakpoints, grids, tables, and dialogs, plus how to verify on a phone viewport.
---

# Responsive pages — Harvest Catering

The app shell is already responsive: at **≤1023px the sidebar becomes an
off-canvas drawer** (hamburger toggles it, backdrop dismisses) and the main
column takes full width. So your job per page is to make the **content** fluid.
Don't re-implement the shell.

## Breakpoints (match these)
- **≤1023px** — tablet/mobile: sidebar is a drawer; content is full width.
- **≤600px** — phone: topbar trims optional buttons; tighter padding.
- Tailwind is available — prefer its responsive prefixes: `sm:` (640), `md:`
  (768), `lg:` (1024), `xl:` (1280).

## Rules for page content

1. **Grids stack on mobile.** Never hard-code multi-column. Use
   `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3` (KPI rows) or
   `grid-cols-1 lg:grid-cols-3` (panels). The dashboard is the reference.

2. **Wide tables scroll, they don't break the layout.** Wrap any table that can
   exceed the viewport in a horizontal-scroll container:
   ```tsx
   <div className="overflow-x-auto -mx-1 px-1">
     <table className="min-w-[640px] w-full">…</table>
   </div>
   ```
   For antd `<Table>`, pass `scroll={{ x: "max-content" }}`. Never let a table
   force the whole page to scroll sideways.

3. **Flex children must be allowed to shrink.** Add `min-w-0` (or
   `style={{ minWidth: 0 }}`) to flex items that contain text/tables, or they
   overflow on narrow screens. Use `flex-wrap` on toolbars/filter rows.

4. **Dialogs fit the viewport.** Cap width with a vw fallback and the height:
   `className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto"`. Avoid
   bare `max-w-5xl` with no vw cap — it overflows phones.

5. **No fixed pixel widths for layout.** Replace `width: 320` with `w-full`,
   `max-w-*`, or `clamp(...)`. Fixed widths are fine only for things like icon
   chips and avatars.

6. **Filter / action bars wrap.** Toolbars with selects + buttons:
   `flex flex-wrap items-center gap-2`. Buttons keep a min tap target (~36px).

7. **Hide non-essential chrome on phones**, don't shrink it to illegibility.
   Use Tailwind `hidden sm:flex` (or the `.app-topbar-optional` pattern in the
   shell) for secondary elements.

## Verify (always, on a real viewport)
Run the app and drive it at phone width before claiming responsive:
- Launch dev server, headless Chrome `setViewport({ width: 375, height: 740 })`.
- Check: (a) no horizontal page scroll, (b) hamburger opens the drawer + backdrop
  dismisses, (c) grids stacked to one column, (d) tables scroll inside their card,
  (e) dialogs fit. Screenshot at 375px **and** ~1280px.
- Probe files go in the repo root as `probe-*.cjs`; delete them after.

## Keep the baseline
`npx tsc -p tsconfig.app.json --noEmit` must stay at **17** pre-existing errors —
introduce none.
