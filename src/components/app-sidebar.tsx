import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Inbox,
  Users,
  Megaphone,
  Smartphone,
  BarChart3,
  Settings,
  Zap,
  LogOut,
  SlidersHorizontal,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const navGroups = [
  {
    label: "Operação",
    items: [
      { title: "Caixa de entrada", url: "/inbox", icon: Inbox },
      { title: "Contatos", url: "/contacts", icon: Users },
    ],
  },
  {
    label: "Crescimento",
    items: [
      { title: "Campanhas", url: "/campaigns", icon: Megaphone },
      { title: "Painel de envios", url: "/sending-panel", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Análise",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Relatórios", url: "/reports", icon: BarChart3 },
    ],
  },
  {
    label: "Sistema",
    items: [
      { title: "Canais", url: "/channels", icon: Smartphone },
      { title: "Configurações", url: "/settings", icon: Settings },
    ],
  },
] as const;

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { fullName, user, role, signOut } = useAuth();

  const isActive = (url: string) =>
    pathname === url || pathname.startsWith(url + "/");

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="px-4 py-5">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-sidebar-primary flex items-center justify-center shrink-0 shadow-sm">
            <Zap className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="font-display text-lg text-sidebar-foreground tracking-tight">
                Denis Envia Flow
              </span>
              <span className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
                Plataforma WhatsApp
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 gap-1">
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            {!collapsed && (
              <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50 font-semibold px-3">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActive(item.url);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        className="relative h-10 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground hover:bg-sidebar-accent/60"
                      >
                        <Link to={item.url} className="flex items-center gap-3">
                          {active && (
                            <span
                              aria-hidden
                              className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-sidebar-primary"
                            />
                          )}
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span className="text-sm">{item.title}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-3 border-t border-sidebar-border/60">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 shrink-0 ring-1 ring-sidebar-border">
            <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground text-xs font-medium">
              {(fullName ?? user?.email ?? "?").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                {fullName ?? user?.email}
              </p>
              {role && (
                <Badge
                  variant="outline"
                  className="text-[10px] mt-0.5 border-sidebar-border/60 text-sidebar-foreground/70 bg-transparent capitalize px-1.5 py-0"
                >
                  {role}
                </Badge>
              )}
            </div>
          )}
          {!collapsed && (
            <Button
              size="icon"
              variant="ghost"
              className="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground h-9 w-9"
              onClick={() => signOut()}
              aria-label="Sair"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}