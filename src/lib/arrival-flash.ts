import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";

const STORAGE_KEY = "arrival-flash";
const STORAGE_ROWS_KEY = "arrival-flash-rows";

export type ArrivalPayload =
  | string
  | { target: string; ids?: string[] };

/**
 * Stash the target id (and optionally a list of row ids) before navigating.
 * The destination page's `useArrivalFlash()` will:
 *   • flash the container at `[data-arrival-id="<target>"]` (green ring)
 *   • flash each row at `[data-arrival-row-id="<id>"]` (amber row tint)
 */
export function flagArrival(payload: ArrivalPayload) {
  if (typeof window === "undefined") return;
  try {
    if (typeof payload === "string") {
      sessionStorage.setItem(STORAGE_KEY, payload);
      sessionStorage.removeItem(STORAGE_ROWS_KEY);
      // eslint-disable-next-line no-console
      console.log("[arrival-flash] flagged →", payload);
    } else {
      sessionStorage.setItem(STORAGE_KEY, payload.target);
      if (payload.ids && payload.ids.length > 0) {
        sessionStorage.setItem(STORAGE_ROWS_KEY, payload.ids.join("|"));
      } else {
        sessionStorage.removeItem(STORAGE_ROWS_KEY);
      }
      // eslint-disable-next-line no-console
      console.log("[arrival-flash] flagged →", payload.target, "rows:", payload.ids?.length ?? 0);
    }
  } catch {
    /* sessionStorage unavailable — silently no-op */
  }
}

/**
 * Read the stashed arrival row ids WITHOUT consuming them, so a destination page
 * can react before the flash runs — e.g. jump its (paginated) table to the page
 * holding the first target row so `useArrivalFlash` can then find and flash it.
 */
export function peekArrivalRows(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_ROWS_KEY);
    return raw ? raw.split("|").filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Drop-in hook for destination pages. Reads the stashed arrival target from
 * sessionStorage, finds `[data-arrival-id="<id>"]`, scrolls it into view, and
 * flashes a green ring for ~2.5s. If row ids were also stashed, flashes each
 * matching row at `[data-arrival-row-id="<id>"]` with an amber row tint.
 * Re-runs whenever the pathname changes.
 */
export function useArrivalFlash() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    let target: string | null = null;
    let rowIds: string[] = [];
    try {
      target = sessionStorage.getItem(STORAGE_KEY);
      const rawRows = sessionStorage.getItem(STORAGE_ROWS_KEY);
      if (rawRows) rowIds = rawRows.split("|").filter(Boolean);
    } catch {
      return;
    }
    if (!target && rowIds.length === 0) return;
    // eslint-disable-next-line no-console
    console.log("[arrival-flash] reading on", pathname, "→ target:", target, "rows:", rowIds.length);

    // IMPORTANT: do NOT consume the stashed payload synchronously here. Under
    // React StrictMode (dev) the effect runs → cleans up → runs again; consuming
    // up-front leaves the second pass with nothing, while the first pass's retry
    // timers are cleared by the cleanup. A row that only renders after a deep-link
    // page jump (e.g. the "Delayed Flights" KPI → ORD-3410) would then never get
    // flashed. Consume once we've actually flashed everything we can (or at the
    // final cleanup as a fallback) so a manual refresh still won't re-trigger it.
    let consumed = false;
    const consume = () => {
      if (consumed) return;
      consumed = true;
      try {
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(STORAGE_ROWS_KEY);
      } catch {
        /* sessionStorage unavailable — ignore */
      }
    };

    // ── Container flash ────────────────────────────────────────────────────
    // When specific rows are targeted, the per-row amber tint is the focused
    // cue — flashing the whole section green on top of it is visual noise, so we
    // detect the container (for the toast fallback / consume check) but only
    // paint + scroll it when no rows were requested.
    let foundContainer: HTMLElement | null = null;
    const flashContainer = (): HTMLElement | null => {
      if (!target) return null;
      const el = document.querySelector<HTMLElement>(`[data-arrival-id="${target}"]`);
      if (!el) return null;
      if (el === foundContainer) return el;
      foundContainer = el;
      if (rowIds.length === 0) {
        el.classList.remove("arrival-flash");
        void el.offsetWidth;
        el.classList.add("arrival-flash");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return el;
    };

    // ── Row flash ──────────────────────────────────────────────────────────
    const flashedRows = new Set<HTMLElement>();
    let firstRow: HTMLElement | null = null;
    const flashRows = () => {
      if (rowIds.length === 0) return 0;
      let count = 0;
      for (const id of rowIds) {
        const el = document.querySelector<HTMLElement>(`[data-arrival-row-id="${cssEscape(id)}"]`);
        if (!el || flashedRows.has(el)) continue;
        el.classList.remove("arrival-row-flash");
        void el.offsetWidth;
        el.classList.add("arrival-row-flash");
        flashedRows.add(el);
        if (!firstRow) firstRow = el;
        count++;
      }
      if (firstRow && count > 0) {
        firstRow.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return count;
    };

    // Consume the stashed payload only once everything we can flash has been
    // flashed (container found + every requested row that exists on the page).
    const consumeIfDone = () => {
      const containerDone = !target || !!foundContainer;
      const rowsDone = rowIds.length === 0 || flashedRows.size >= rowIds.length;
      if (containerDone && rowsDone) consume();
    };

    // First attempt synchronously, then retry up to ~1.5s in case the list
    // renders lazily (e.g. after a deep-link pagination jump).
    const initialContainer = flashContainer();
    const initialRows = flashRows();
    consumeIfDone();

    // Toast fallback so the user always gets a visible cue even if the
    // target element renders later or is somehow missing.
    if (!initialContainer && initialRows === 0) {
      toast.success(`Linked from dashboard → ${target ?? "rows"}`, { duration: 2500 });
    } else if (rowIds.length > 0 && initialRows < rowIds.length) {
      // Show how many rows we found vs requested (helps when paginated).
      // Suppress for trivial counts.
      if (rowIds.length >= 3) {
        toast.success(`Highlighted ${initialRows} of ${rowIds.length} ${rowIds.length === 1 ? "row" : "rows"}.`, { duration: 2000 });
      }
    }

    const retries: ReturnType<typeof setTimeout>[] = [];
    [80, 200, 500, 900, 1400].forEach((delay) => {
      retries.push(setTimeout(() => {
        flashContainer();
        flashRows();
        consumeIfDone();
      }, delay));
    });

    // Long enough for the full row-flash animation (4s) to finish even when the
    // row is found late (retries run up to 1.4s after mount). The animation ends
    // transparent, so the extra tail is invisible.
    const cleanup = setTimeout(() => {
      consume(); // fallback: never leave a stale payload if a target never rendered
      foundContainer?.classList.remove("arrival-flash");
      flashedRows.forEach((el) => el.classList.remove("arrival-row-flash"));
    }, 5600);

    return () => {
      retries.forEach((t) => clearTimeout(t));
      clearTimeout(cleanup);
    };
  }, [pathname]);
}

/** Escape special CSS selector characters in user-supplied ids. */
function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
