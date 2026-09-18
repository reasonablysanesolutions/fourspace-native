import { createFileRoute, redirect } from "@tanstack/react-router";

import { isElectron } from "../env";
import { SidebarInset } from "../components/ui/sidebar";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";

// Global control center for scheduled jobs (FAS 11 fills in create/edit/run/
// pause/history). Scheduled is not a workspace type: every job belongs to a
// Chat, Experiment, Project or Product workspace.
function ScheduledRouteView() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              Scheduled
            </span>
          </div>
        </WorkspacePageHeader>
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 overflow-y-auto px-6 py-10">
          <ScheduledSection
            description="Jobs waiting for their next run."
            empty="No upcoming jobs."
            title="Upcoming"
          />
          <ScheduledSection
            description="Jobs that repeat on a daily, weekly or interval cadence."
            empty="No recurring jobs."
            title="Recurring"
          />
          <ScheduledSection
            description="Completed and failed runs, newest first."
            empty="No runs yet."
            title="History"
          />
        </div>
      </div>
    </SidebarInset>
  );
}

function ScheduledSection({
  description,
  empty,
  title,
}: {
  readonly description: string;
  readonly empty: string;
  readonly title: string;
}) {
  return (
    <section aria-label={title}>
      <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
      <Empty className="mt-3 border border-dashed border-border/70 bg-card/20 py-8">
        <EmptyHeader>
          <EmptyTitle className="text-sm font-normal text-muted-foreground">{empty}</EmptyTitle>
          <EmptyDescription className="text-xs text-muted-foreground/70">
            Scheduling arrives in a later phase; jobs will run through the normal T3 thread/provider
            flow.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </section>
  );
}

export const Route = createFileRoute("/scheduled")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ScheduledRouteView,
});
