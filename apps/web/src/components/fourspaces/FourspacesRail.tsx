import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ClockIcon,
  FlaskConicalIcon,
  FolderIcon,
  MessageCircleIcon,
  PackageIcon,
  SettingsIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { flushSync } from "react-dom";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { T3Wordmark } from "../T3Wordmark";
import {
  FOURSPACE_LABELS,
  resolveFourSpaceForPathname,
  type FourSpaceId,
  type FourSpaceWorkspaceId,
} from "../../fourspaces/spaces";
import {
  selectActiveWorkspaceSpace,
  useFourspacesNavStore,
} from "../../fourspaces/fourspacesNavStore";

interface RailItem {
  id: FourSpaceId;
  icon: ComponentType<{ className?: string }>;
  /** Muted accent so the spaces stay scannable without shouting. */
  iconClassName: string;
}

const WORKSPACE_ITEMS: ReadonlyArray<RailItem & { id: FourSpaceWorkspaceId }> = [
  { id: "chat", icon: MessageCircleIcon, iconClassName: "text-sky-600 dark:text-sky-400" },
  {
    id: "experiment",
    icon: FlaskConicalIcon,
    iconClassName: "text-violet-600 dark:text-violet-400",
  },
  { id: "project", icon: FolderIcon, iconClassName: "text-emerald-600 dark:text-emerald-400" },
  { id: "product", icon: PackageIcon, iconClassName: "text-amber-600 dark:text-amber-400" },
];

const SCHEDULED_ITEM: RailItem = {
  id: "scheduled",
  icon: ClockIcon,
  iconClassName: "text-slate-500 dark:text-slate-400",
};
const SETTINGS_ITEM: RailItem = {
  id: "settings",
  icon: SettingsIcon,
  iconClassName: "text-slate-500 dark:text-slate-400",
};

function RailButton({
  active,
  icon: Icon,
  iconClassName,
  label,
  onClick,
}: {
  active: boolean;
  icon: ComponentType<{ className?: string }>;
  iconClassName: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] outline-hidden transition-colors ring-ring focus-visible:ring-2",
        active
          ? "bg-sidebar-row-selected font-medium text-sidebar-foreground"
          : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground active:bg-sidebar-row-active",
      )}
      data-active={active}
      onClick={onClick}
      type="button"
    >
      <Icon className={cn("size-4 shrink-0", iconClassName)} />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function FourspacesRail() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const activeWorkspaceSpace = useFourspacesNavStore(selectActiveWorkspaceSpace);
  const setActiveWorkspaceSpace = useFourspacesNavStore((state) => state.setActiveWorkspaceSpace);
  const activeSpace = resolveFourSpaceForPathname(pathname, activeWorkspaceSpace);

  return (
    <nav
      aria-label="Four Spaces"
      className="hidden w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex"
      data-fourspaces-rail=""
    >
      <div
        className={cn(
          "flex h-[var(--workspace-topbar-height)] shrink-0 items-center",
          isElectron && "drag-region",
        )}
      >
        {/* Same inset token the sidebar brand uses, so the mark clears the
            macOS traffic lights in the desktop shell. */}
        <div className="ml-[var(--workspace-titlebar-content-left)] flex min-w-0 items-center gap-1.5">
          <T3Wordmark aria-label="T3" className="h-[1cap] w-auto shrink-0" />
          <span className="truncate text-[13px] font-medium tracking-tight text-muted-foreground [text-box:trim-both_cap_alphabetic]">
            Four Spaces
          </span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-3">
        {WORKSPACE_ITEMS.map((item) => (
          <RailButton
            active={activeSpace === item.id}
            icon={item.icon}
            iconClassName={item.iconClassName}
            key={item.id}
            label={FOURSPACE_LABELS[item.id]}
            onClick={() => {
              // Flush the space switch synchronously: the landing route reads
              // the active space on mount, and navigating first would start a
              // draft in the previous space's context.
              flushSync(() => {
                setActiveWorkspaceSpace(item.id);
              });
              if (pathname !== "/") {
                void navigate({ to: "/" });
              }
            }}
          />
        ))}
        <div aria-hidden className="mx-2 my-2 border-t border-sidebar-border" />
        <RailButton
          active={activeSpace === SCHEDULED_ITEM.id}
          icon={SCHEDULED_ITEM.icon}
          iconClassName={SCHEDULED_ITEM.iconClassName}
          label={FOURSPACE_LABELS.scheduled}
          onClick={() => {
            if (pathname !== "/scheduled") {
              void navigate({ to: "/scheduled" });
            }
          }}
        />
        <div className="flex-1" />
        <div aria-hidden className="mx-2 my-2 border-t border-sidebar-border" />
        <RailButton
          active={activeSpace === SETTINGS_ITEM.id}
          icon={SETTINGS_ITEM.icon}
          iconClassName={SETTINGS_ITEM.iconClassName}
          label={FOURSPACE_LABELS.settings}
          onClick={() => {
            if (pathname !== "/settings") {
              void navigate({ to: "/settings" });
            }
          }}
        />
      </div>
    </nav>
  );
}
