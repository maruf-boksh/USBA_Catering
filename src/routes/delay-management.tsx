import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Clock } from "lucide-react";

// Delay Management — placeholder. Content to be added later.
export default function DelayManagementPage() {
  return (
    <>
      <PageHeader
        title="Delay Management"
        subtitle="Track and manage flight / catering delays"
      />
      <Card>
        <CardContent className="py-16 flex flex-col items-center justify-center text-center gap-3">
          <Clock className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">This module is coming soon.</p>
        </CardContent>
      </Card>
    </>
  );
}
