/**
 * Multi-server bridge profile switcher — dropdown in the header bar.
 */
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Server, Plus, Check, ChevronDown } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

export function BridgeProfileSwitcher() {
  const profiles = useAppStore((s) => s.settings.bridges);
  const activeId = useAppStore((s) => s.settings.activeBridgeId);
  const switchProfile = useAppStore((s) => s.switchBridgeProfile);
  const addProfile = useAppStore((s) => s.addBridgeProfile);

  const active = profiles.find((p) => p.id === activeId);
  const label = active ? active.label : profiles.length === 0 ? "No bridge" : "Select bridge";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-xl font-mono text-[11px]"
        >
          <Server className="h-3.5 w-3.5" />
          <span className="max-w-[120px] truncate">{label}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Bridge profiles
        </DropdownMenuLabel>
        {profiles.length === 0 && (
          <DropdownMenuItem disabled className="text-xs">
            No profiles configured
          </DropdownMenuItem>
        )}
        {profiles.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => {
              switchProfile(p.id);
              toast.success(`Switched to ${p.label}`);
            }}
            className="flex items-center justify-between gap-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{p.label}</div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {p.baseUrl || "(no URL)"}
              </div>
            </div>
            {p.id === activeId && <Check className="h-3.5 w-3.5 shrink-0 text-success" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            const id = addProfile(`server-${profiles.length + 1}`);
            switchProfile(id);
            toast.success("Profile added — fill its URL in Settings");
          }}
          className="text-xs"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add profile
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="text-xs">
          <Link to="/settings">Manage in Settings…</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
