/**
 * permissionKeys.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The permission catalog is generated at runtime from the app's nav tree and
 * page-content catalog (see data/catalog.ts), so permission keys are not a
 * closed compile-time union. `PermissionKey` is therefore a plain string; use
 * `allCatalogedPermissions()` from data/catalog.ts to enumerate real keys.
 */

export type PermissionKey = string;
