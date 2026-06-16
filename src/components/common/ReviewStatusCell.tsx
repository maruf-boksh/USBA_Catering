import { CornerUpLeft, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useRecordReview, clearReview } from "@/lib/approval-reviews";

// Drop-in wrapper for a record's status cell on any module's requester screen.
// When the approver has returned the record for correction, this shows an amber
// "Reviewed" badge, the reviewer's comment, and a "Resubmit" action that clears
// the review so the request re-enters the approval queue. Otherwise it renders
// the normal status badge passed as children.
//
// Usage:
//   <ReviewStatusCell category="Request for Quotation" refId={r.id}>
//     <StatusBadge status={r.status} />
//   </ReviewStatusCell>
export function ReviewStatusCell({
  category,
  refId,
  children,
}: {
  category: string;
  refId: string;
  children: React.ReactNode;
}) {
  const review = useRecordReview(category, refId);
  if (!review) return <>{children}</>;
  return (
    <div className="flex flex-col items-start gap-1">
      <span
        className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
        title={review.comment}
      >
        <CornerUpLeft className="h-3 w-3" /> Reviewed
      </span>
      <span className="flex items-start gap-1 text-[10.5px] leading-snug text-amber-700 max-w-[240px]">
        <MessageSquare className="h-3 w-3 mt-px shrink-0" />
        <span className="line-clamp-3" title={`${review.comment} — ${review.by}, ${review.at}`}>
          {review.comment}
        </span>
      </span>
      <button
        type="button"
        className="text-[10px] font-medium text-primary underline underline-offset-2 hover:opacity-80"
        onClick={() => {
          clearReview(category, refId);
          toast.success(`${refId} resubmitted for approval.`);
        }}
      >
        Resubmit for approval
      </button>
    </div>
  );
}
