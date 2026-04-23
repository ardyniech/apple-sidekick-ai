import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { useAppStore } from "@/lib/store";
import { Cloud, Cpu } from "lucide-react";

interface AppLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AppLayout({ title, subtitle, children }: AppLayoutProps) {
  const mode = useAppStore((s) => s.mode);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="glass-panel sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border px-4">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <div className="flex min-w-0 flex-col leading-tight">
              <h1 className="truncate text-sm font-semibold">{title}</h1>
              {subtitle && (
                <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-full border border-border bg-card/50 px-2.5 py-1 text-[11px]">
                {mode === "local" ? (
                  <>
                    <Cpu className="h-3 w-3 text-success" />
                    <span className="text-muted-foreground">Local</span>
                  </>
                ) : (
                  <>
                    <Cloud className="h-3 w-3 text-primary" />
                    <span className="text-muted-foreground">Cloud</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5 rounded-full border border-border bg-card/50 px-2.5 py-1 text-[11px]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
                </span>
                <span className="text-muted-foreground">Online</span>
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
