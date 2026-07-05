import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Replace } from "lucide-react";

// Last Minute Change (LMC) — placeholder. Content to be added later.
export default function LmcPage() {
  return (
    <>
      <PageHeader
        title="Last Minute Change (LMC)"
        subtitle="Capture last-minute changes to orders and dispatches"
      />
      <Card>
        <CardContent className="py-16 flex flex-col items-center justify-center text-center gap-3">
          <Replace className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">This module is coming soon.</p>
        </CardContent>
      </Card>
    </>
  );
}
