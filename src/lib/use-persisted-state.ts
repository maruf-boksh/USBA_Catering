import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Drop-in replacement for `useState` that persists the value to localStorage so
 * records created / edited in a module survive a page reload (demo data has no
 * backend). Same signature as `useState` plus a stable `key`.
 *
 * Each module passes a unique key; the value is namespaced under a versioned
 * prefix so a data-shape change can be invalidated by bumping the version.
 *
 * Reads are best-effort: a missing / corrupt / unparsable entry falls back to
 * the seed `initial`. Writes are best-effort too (localStorage can be
 * unavailable in private mode or hit quota) and never throw.
 */
const PREFIX = "harvest-data-v1:";

export function usePersistedState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = PREFIX + key;

  const [state, setState] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw != null) return JSON.parse(raw) as T;
    } catch {
      /* unavailable / corrupt — fall through to seed */
    }
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* quota / serialization errors are non-fatal */
    }
  }, [storageKey, state]);

  return [state, setState];
}
