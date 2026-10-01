"use client";

import {
  DatabaseBackup,
  Globe2,
  Activity,
  Mail,
  Settings,
  Palette,
  BadgeDollarSign,
  Users,
  Route,
  Webhook,
  KeyRound,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/use-current-user";
import { NavItem } from "./components-nav";
import { SidebarFooter } from "./sidebar-footer";
import { useBranding } from "./branding-provider";
import { SidebarHeader } from "./sidebar-header";
import { useSidebar } from "./sidebar-state";

type AdminLinkPermission = "primary" | "domains" | "users";

type AdminNavLink = {
  href: string;
  label: string;
  icon: typeof Settings;
  permission?: AdminLinkPermission;
};

const sections: { label?: string; links: AdminNavLink[] }[] = [
  {
    // label: "Overview",
    links: [{ href: "/admin", label: "Overview", icon: Settings }],
  },
  {
    label: "Email",
    links: [
      { href: "/mailboxes", label: "Mailboxes", icon: Mail },
      { href: "/domains", label: "Domains", icon: Globe2, permission: "domains" },
      { href: "/routing", label: "Routing", icon: Route },
      { href: "/webhooks", label: "Webhooks", icon: Webhook, permission: "primary" },
    ],
  },
  {
    label: "Administration",
    links: [
      { href: "/api-keys", label: "API keys", icon: KeyRound, permission: "primary" },
      { href: "/general", label: "General", icon: Settings, permission: "primary" },
      { href: "/agent", label: "Agent", icon: Bot, permission: "primary" },
      { href: "/accounts", label: "Accounts", icon: Users },
      { href: "/activity", label: "Activity", icon: Activity, permission: "primary" },
      { href: "/backups", label: "Backups", icon: DatabaseBackup, permission: "primary" },
    ],
  },
  {
    label: "Product",
    links: [
      { href: "/branding", label: "Branding", icon: Palette, permission: "primary" },
      { href: "/licenses", label: "Licenses", icon: BadgeDollarSign, permission: "primary" },
    ],
  },
];

export function AdminNav({ className }: { className?: string }) {
  const branding = useBranding();
  const { minimal } = useSidebar();
  const user = useCurrentUser();

  function canSee(link: AdminNavLink): boolean {
    if (link.href === "/branding" && !branding.canCustomizeBranding) return false;
    if (!link.permission) return true;
    if (!user) return false;
    if (link.permission === "primary") return user.isPrimaryAdmin;
    if (link.permission === "domains") return user.isPrimaryAdmin || user.canManageDomains;
    return user.isPrimaryAdmin || user.canManageUsers;
  }

  return (
    <nav className={cn("flex min-h-full flex-col gap-1", className)}>
      <SidebarHeader href="/inbox" label="Admin" />
      <div className={cn("space-y-4", minimal && "space-y-2 pl-1")}>
        {sections.map((section, sectionIndex) => {
          const links = section.links.filter(canSee);
          if (links.length === 0) return null;

          return (
            // The first section has no label, so fall back to its first href for a stable key.
            <section key={section.label ?? links[0].href}>
              {minimal && sectionIndex > 0 && <hr className="mx-3 mb-3 border-neutral-200/70" />}
              {!minimal && section.label && (
                <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  {section.label}
                </p>
              )}
              <div className="space-y-1">
                {links.map((link) => (
                  <NavItem link={link} key={link.href} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <span className="flex-1" />
      <SidebarFooter />
    </nav>
  );
}
