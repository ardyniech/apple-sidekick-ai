/**
 * Pretty diff viewer for unified-diff strings (- / + / context lines).
 * Color-coded, monospace, scrollable. Stateless presentation only.
 */

interface DiffViewerProps {
  diff: string;
  maxHeight?: string;
}

export function DiffViewer({ diff, maxHeight = "60vh" }: DiffViewerProps) {
  if (!diff) {
    return (
      <div className="rounded-lg border border-border bg-secondary/20 p-4 text-center text-xs text-muted-foreground">
        No changes detected.
      </div>
    );
  }
  const lines = diff.split("\n");
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.startsWith("+") && !l.startsWith("+++")) added++;
    else if (l.startsWith("-") && !l.startsWith("---")) removed++;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background/60">
      <div className="flex items-center justify-between border-b border-border bg-secondary/40 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>Unified diff</span>
        <span className="font-mono">
          <span className="text-success">+{added}</span>{" "}
          <span className="text-destructive">−{removed}</span>
        </span>
      </div>
      <pre
        className="overflow-auto p-2 font-mono text-[11px] leading-relaxed"
        style={{ maxHeight }}
      >
        {lines.map((l, i) => {
          let cls = "text-foreground/80";
          let bg = "";
          if (l.startsWith("+++") || l.startsWith("---")) {
            cls = "text-muted-foreground font-semibold";
          } else if (l.startsWith("+")) {
            cls = "text-success";
            bg = "bg-success/10";
          } else if (l.startsWith("-")) {
            cls = "text-destructive";
            bg = "bg-destructive/10";
          } else if (l.startsWith("@@")) {
            cls = "text-accent font-semibold";
            bg = "bg-accent/5";
          }
          return (
            <div key={i} className={`whitespace-pre-wrap break-all px-2 ${cls} ${bg}`}>
              {l || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
