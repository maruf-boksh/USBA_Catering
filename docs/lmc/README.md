# Last-Minute Changes (LMC) — verified flow

End-to-end walkthrough captured from the running app (2026-06-28). Each step is a real
screenshot driven through the UI.

| # | Process | Screenshot |
|---|---------|-----------|
| 1 | **Create LMC** — amending an in-window order (dep in 2.0 h) shows the rose "Last-Minute Change" banner, locks identity fields, and requires a reason | [01-amend-lmc-dialog.png](01-amend-lmc-dialog.png) |
| 2 | **LMC badge** appears on the order row | [02-lmc-badge-row.png](02-lmc-badge-row.png) |
| 3 | **Change history + revert guard** — revisions logged as LMC·CRITICAL; reverting an older same-field change is disabled | [03-change-history-revert-guard.png](03-change-history-revert-guard.png) |
| 4 | **Dashboard alert** — "3 last-minute changes today · 3 critical" (no post-departure false positives) | [04-dashboard-lmc-banner.png](04-dashboard-lmc-banner.png) |
| 5 | **Review → LMC-only filter** — only the affected orders, "LMC only" chip | [05-lmc-only-filter.png](05-lmc-only-filter.png) |
| 6 | **Production awareness** banner links to the LMC filter | [06-production-awareness.png](06-production-awareness.png) |
| 7a | **Dispatch list** shows the ⚠ LMC chip | [07a-dispatch-list-lmc-chip.png](07a-dispatch-list-lmc-chip.png) |
| 7b | **Dispatch detail** — "Order amended… Special Meals 20→30" + Re-sync (a special-meals-only change the old PAX-only logic missed) | [07b-dispatch-amended-banner.png](07b-dispatch-amended-banner.png) |
| 7c | **After Re-sync** — VGML 20→30, total 80→90, warning cleared | [07c-dispatch-after-resync.png](07c-dispatch-after-resync.png) |
