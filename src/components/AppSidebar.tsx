import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard,
  MessagesSquare,
  Database,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Personal AI Chat", url: "/chat", icon: MessagesSquare },
  { title: "Knowledge Base", url: "/knowledge", icon: Database },
  { title: "Settings", url: "/settings", icon: SettingsIcon },
] as const;

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="px-3 pt-4 pb-2">
        <Link to="/" className="flex items-center gap-2.5 px-2 py-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-[var(--shadow-glow)]">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight">Aurora</span>
              <span className="text-[10px] text-muted-foreground">AI Assistant</span>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
              Workspace
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      className={
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "hover:bg-sidebar-accent/60"
                      }
                    >
                      <Link to={item.url} className="flex items-center gap-3">
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-3 py-3">
        {!collapsed ? (
          <div className="flex items-center gap-2.5 px-1">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-accent" />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-xs font-medium">Local Operator</span>
              <span className="truncate text-[10px] text-muted-foreground">
                tunnel connected
              </span>
            </div>
          </div>
        ) : (
          <div className="mx-auto h-8 w-8 rounded-full bg-gradient-to-br from-primary to-accent" />
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
