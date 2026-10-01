"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { AgentPanel } from "@/components/agent/agent-panel";
import { AssistantOpenContext } from "@/components/agent/assistant-open-state";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { LicenseIndicator } from "@/components/license-indicator";
import { MailSearchProvider } from "@/components/mail-search/mail-search-context";
import { MailboxProvider } from "@/components/mailbox-provider";
import { MailboxSelector } from "@/components/mailbox-selector";
import { SidebarHeader } from "@/components/sidebar-header";
import { SidebarProvider } from "@/components/sidebar-state";
import { ShortcutsProvider } from "@/components/shortcuts";
import { Button } from "@/components/ui/button";
import clsx from "clsx";
import { useDashboardState } from "../(dashboard)/dashboard-state";
import { useAssistantAvailability } from "../(dashboard)/use-assistant-availability";

export default function CalendarLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { assistantOpen, setAssistantOpen, assistantFullSize, setAssistantFullSize } = useDashboardState();
  const assistantEnabled = useAssistantAvailability();
  const assistantVisible = assistantEnabled === true && assistantOpen;

  useEffect(() => {
    if (assistantEnabled === false && (assistantOpen || assistantFullSize)) {
      setAssistantOpen(false);
      setAssistantFullSize(false);
    }
  }, [assistantEnabled, assistantOpen, assistantFullSize, setAssistantOpen, setAssistantFullSize]);

  return (
    <AuthGuard>
      <SidebarProvider>
        <MailboxProvider>
          <ComposeProvider>
            <MailSearchProvider>
              <ShortcutsProvider>
              <div className="grid h-dvh grid-cols-[minmax(0,1fr)] overflow-hidden bg-[#f6f8fc]">
                <div className="flex min-h-0 min-w-0 flex-col">
                  <header className="flex h-16 w-full shrink-0 items-center gap-3 pr-4 text-sm">
                    <div className="shrink-0 px-3 [&>div]:mb-0" style={{ width: "calc(var(--sidebar-width) + 1.5rem)" }}><SidebarHeader href="/inbox" /></div>
                    <nav aria-label="Calendar sections" className="flex shrink-0 items-center rounded-full bg-white p-1">
                      <Link href="/booking" aria-current={pathname === "/booking" ? "page" : undefined} className={clsx("rounded-full px-4 py-2 text-sm font-medium transition-colors", pathname === "/booking" ? "bg-blue-600 text-white" : "text-neutral-600 hover:bg-neutral-100")}>Bookings</Link>
                      <Link href="/calendar" aria-current={pathname === "/calendar" ? "page" : undefined} className={clsx("rounded-full px-4 py-2 text-sm font-medium transition-colors", pathname === "/calendar" ? "bg-blue-600 text-white" : "text-neutral-600 hover:bg-neutral-100")}>Calendar</Link>
                    </nav>
                    <div id="calendar-header-slot" className="flex min-w-0 flex-1 items-center" />
                    <LicenseIndicator />
                    {assistantEnabled && <Button type="button" variant="ghost" size="sm" className={assistantOpen ? "bg-blue-50 text-blue-700" : "text-neutral-600"} onClick={() => { setAssistantOpen((current) => !current); setAssistantFullSize(false); }} aria-label={assistantOpen ? "Close email assistant" : "Open email assistant"} aria-expanded={assistantOpen} aria-controls="email-assistant-panel"><Sparkles className="h-5 w-5" /></Button>}
                    <MailboxSelector />
                  </header>
                  <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                    <AssistantOpenContext.Provider value={assistantVisible}>
                      <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-[#f6f8fc] overscroll-contain scrollbar-gutter-stable" aria-hidden={assistantVisible && assistantFullSize} inert={assistantVisible && assistantFullSize}>
                        <div key={pathname} className="page-transition-enter h-full min-h-0">{children}</div>
                      </main>
                    </AssistantOpenContext.Provider>
                    <aside className={clsx(assistantFullSize ? "pl-0" : "pl-4", "min-h-0 min-w-0 shrink-0 overflow-hidden pb-2 pr-2 transition-[width] duration-300 ease-in-out motion-reduce:transition-none", assistantVisible ? "" : "opacity-0")} style={{ width: assistantVisible ? assistantFullSize ? "100%" : "min(390px, 100%)" : "0px" }} aria-hidden={!assistantVisible} inert={!assistantVisible}>
                      {assistantEnabled && <AgentPanel open={assistantVisible} fullSize={assistantFullSize} onToggleFullSize={() => setAssistantFullSize((current) => !current)} onClose={() => { setAssistantOpen(false); setAssistantFullSize(false); }} />}
                    </aside>
                  </div>
                </div>
                <FloatingComposer />
              </div>
              </ShortcutsProvider>
            </MailSearchProvider>
          </ComposeProvider>
        </MailboxProvider>
      </SidebarProvider>
    </AuthGuard>
  );
}
