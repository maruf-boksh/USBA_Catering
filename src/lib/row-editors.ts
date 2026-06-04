import type { Dispatch, SetStateAction } from "react";

/**
 * Build the generic `onSave` / `onDelete` handlers that RowActions needs to
 * persist edits and deletes for a list backed by a useState/usePersistedState
 * setter. Spread the result onto <RowActions {...rowEditors(setRows)} /> so the
 * built-in Edit and Delete modals write back into the list (matched by `id`).
 */
export function rowEditors<T extends { id: string }>(
  setRows: Dispatch<SetStateAction<T[]>>,
) {
  return {
    onSave: (u: Record<string, unknown>) =>
      setRows((prev) =>
        prev.map((r) => (r.id === (u.id as string) ? ({ ...r, ...(u as Partial<T>) }) : r)),
      ),
    onDelete: (u: Record<string, unknown>) =>
      setRows((prev) => prev.filter((r) => r.id !== (u.id as string))),
  };
}
