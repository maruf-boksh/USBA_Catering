import type { ReactNode } from "react";
import { LogoTile } from "@/components/AviationLogo";

/**
 * DESIGN.md §8 — Module header bar:
 *   "White bar at the top of tabbed pages. Left: gradient teal icon square +
 *    title + subtitle. Right: action buttons."
 *
 * Layout is driven by CSS classes (.module-header__left / __actions) so the
 * left column grows + shrinks while the right column stays at natural width,
 * never wrapping the actions below the title on desktop widths.
 *
 * `icon` is optional; when absent we render the LogoTile so every page renders
 * with a consistent visual handle without requiring changes to existing call sites.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
  hideIcon = false,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  hideIcon?: boolean;
}) {
  return (
    <div className="module-header">
      <div className="module-header__left">
        {!hideIcon && (
          <div className="module-header__icon" style={{ fontSize: 18, background: 'none', padding: 0, boxShadow: 'none' }}>
            {icon ?? <LogoTile size={42} glow={false} />}
          </div>
        )}
        <div className="module-header__text">
          <div className="module-header__title">{title}</div>
          {subtitle && <div className="module-header__subtitle">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="module-header__actions">{actions}</div>}
    </div>
  );
}
