/**
 * MutationGate: global confirm-modal singleton for mutating actions.
 *
 * Anywhere in the app, call `requestMutationConfirm({ title, ... })` and await
 * a boolean. The hook below renders the dialog and resolves the promise.
 *
 * Used by:
 *   - Service start/stop/restart (Dashboard)
 *   - 1-click action recipes (Action Center)
 *   - ReAct agent's mutating tools (write_file)
 *   - Rollback button
 */
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DiffViewer } from "./DiffViewer";
import { AlertTriangle, Server, FileEdit, RotateCcw, Terminal } from "lucide-react";
import { useAppStore, type ConfirmPolicy } from "@/lib/store";

export type MutationKind = "exec" | "write" | "service" | "rollback";

export interface MutationRequest {
  kind: MutationKind;
  title: string;
  description?: string;
  /** Body content shown to user — string text, JSON, or shell command. */
  detail?: string;
  /** Unified-diff text to render with DiffViewer (for write actions). */
  diff?: string;
  /** Destructive label colors. */
  destructive?: boolean;
}

interface PendingRequest extends MutationRequest {
  id: number;
  resolve: (ok: boolean) => void;
}

let pushPending: ((req: PendingRequest) => void) | null = null;
let counter = 0;

/** Imperative API. Returns true if user confirmed, false if cancelled. */
export function requestMutationConfirm(req: MutationRequest): Promise<boolean> {
  return new Promise((resolve) => {
    if (!pushPending) {
      // No host mounted → safe-fail to "deny"
      resolve(false);
      return;
    }
    pushPending({ ...req, id: ++counter, resolve });
  });
}

const ICONS: Record<MutationKind, React.ReactNode> = {
  exec: <Terminal className="h-5 w-5" />,
  write: <FileEdit className="h-5 w-5" />,
  service: <Server className="h-5 w-5" />,
  rollback: <RotateCcw className="h-5 w-5" />,
};

const POLICY_KEYS: Record<MutationKind, keyof import("@/lib/store").SafetyConfig> = {
  exec: "exec",
  write: "write",
  service: "serviceMutate",
  rollback: "rollback",
};

/** Mount once near the app root. */
export function MutationGateHost() {
  const [queue, setQueue] = useState<PendingRequest[]>([]);
  const safety = useAppStore((s) => s.settings.safety);

  useEffect(() => {
    pushPending = (req) => {
      const policy: ConfirmPolicy = safety[POLICY_KEYS[req.kind]] ?? "ask";
      if (policy === "auto") {
        // Auto-allowed — resolve immediately, no UI
        req.resolve(true);
        return;
      }
      setQueue((q) => [...q, req]);
    };
    return () => {
      pushPending = null;
    };
  }, [safety]);

  const current = queue[0];

  function answer(ok: boolean) {
    if (!current) return;
    current.resolve(ok);
    setQueue((q) => q.slice(1));
  }

  if (!current) return null;
  const Icon = ICONS[current.kind];

  return (
    <AlertDialog open onOpenChange={(o) => !o && answer(false)}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                current.destructive
                  ? "bg-destructive/15 text-destructive"
                  : "bg-warning/15 text-warning"
              }`}
            >
              {Icon}
            </span>
            <div className="flex-1">
              <AlertDialogTitle className="flex items-center gap-2">
                {current.title}
                {current.destructive && <AlertTriangle className="h-4 w-4 text-destructive" />}
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-1">
                {current.description ?? "This action will modify state on your server. Review before continuing."}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        {current.diff ? (
          <DiffViewer diff={current.diff} maxHeight="50vh" />
        ) : current.detail ? (
          <pre className="max-h-60 overflow-auto rounded-lg border border-border bg-background/60 p-3 font-mono text-[11px] leading-relaxed text-foreground/85 whitespace-pre-wrap break-all">
            {current.detail}
          </pre>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => answer(true)}
            className={
              current.destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : ""
            }
          >
            Apply
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
