import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Status color semantics (design spec):
 *   Green   — approved, completed, operational, ready, ok
 *   Amber   — pending, draft, in-progress, delayed warning
 *   Teal    — scheduled, dispatched, active, ordered (info/active state)
 *   Red     — rejected, failed, critical, destructive
 *   Gray    — closed, departed, muted / terminal states
 */
const MAP: Record<string, string> = {
  /* ── Green: completed / ok ── */
  ok:                    "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]",
  approved:              "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]",
  delivered:             "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]",
  pass:                  "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]",
  imported:              "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]",
  operational:           "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]",
  ready:                 "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]",
  completed:             "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]",
  fulfilled:             "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]",
  acknowledged:          "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]",
  issued:                "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]",
  loaded:                "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]",
  "sent to packaging":   "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]",

  /* ── Teal: active / scheduled / in-transit ── */
  scheduled:             "bg-[#f0fdfa] text-[#0f766e] border border-[#99f6e4]",
  boarding:              "bg-[#f0fdfa] text-[#0f766e] border border-[#99f6e4]",
  ordered:               "bg-[#f0fdfa] text-[#0f766e] border border-[#99f6e4]",
  dispatched:            "bg-[#f0fdfa] text-[#0f766e] border border-[#99f6e4]",
  inside:                "bg-[#f0fdfa] text-[#0f766e] border border-[#99f6e4]",
  "en route":            "bg-[#f0fdfa] text-[#0f766e] border border-[#99f6e4]",
  "issued to vendor":    "bg-[#f0fdfa] text-[#0f766e] border border-[#99f6e4]",

  /* ── Amber: pending / in-progress / warning ── */
  pending:               "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  draft:                 "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  "pending approval":    "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  production:            "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  cooking:               "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  baking:                "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  "in preparation":      "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  preparing:             "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  cooling:               "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  "ready for qc":        "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  partial:               "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  "partially issued":    "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  "service due":         "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  maintenance:           "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  "partially available": "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  "escalated to supply chain": "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  "pending acknowledgment":    "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  "pending store review":      "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",
  low:                   "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]",

  /* ── Red: destructive / failed ── */
  critical:  "bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]",
  delayed:   "bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]",
  fail:      "bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]",
  failed:    "bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]",

  /* ── Gray: terminal / muted ── */
  closed:    "bg-[#F8FAFC] text-[#64748b] border border-[#E2E8F0]",
  departed:  "bg-[#F8FAFC] text-[#64748b] border border-[#E2E8F0]",
  exited:    "bg-[#F8FAFC] text-[#64748b] border border-[#E2E8F0]",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = MAP[status.toLowerCase()] ?? "bg-[#F8FAFC] text-[#64748b] border border-[#E2E8F0]";
  return (
    <Badge className={cn("font-medium rounded-full px-2.5 py-0.5 text-[11px] pointer-events-none", cls)}>
      {status}
    </Badge>
  );
}
