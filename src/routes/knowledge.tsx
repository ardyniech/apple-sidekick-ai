import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAppStore } from "@/lib/store";
import { Database, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge Base — Aurora AI Assistant" },
      { name: "description", content: "Stored contexts and long-term memory." },
    ],
  }),
  component: KnowledgePage,
});

function KnowledgePage() {
  const memories = useAppStore((s) => s.memories);
  const addMemory = useAppStore((s) => s.addMemory);
  const removeMemory = useAppStore((s) => s.removeMemory);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ title: "", content: "", tags: "" });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return memories;
    return memories.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [memories, query]);

  function submit() {
    if (!draft.title.trim() || !draft.content.trim()) {
      toast.error("Title and content are required");
      return;
    }
    addMemory({
      title: draft.title.trim(),
      content: draft.content.trim(),
      tags: draft.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    toast.success("Context stored");
    setDraft({ title: "", content: "", tags: "" });
    setOpen(false);
  }

  return (
    <AppLayout title="Knowledge Base" subtitle="Stored contexts & long-term memory">
      <div className="mx-auto w-full max-w-5xl space-y-5 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search contexts, tags, content…"
              className="h-10 rounded-xl border-border bg-card/60 pl-9"
            />
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="h-10 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="mr-1.5 h-4 w-4" />
                New context
              </Button>
            </DialogTrigger>
            <DialogContent className="glass-panel border-border">
              <DialogHeader>
                <DialogTitle>Store new context</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input
                  placeholder="Title"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
                <Textarea
                  placeholder="Content / context to remember…"
                  rows={6}
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                />
                <Input
                  placeholder="Tags (comma separated)"
                  value={draft.tags}
                  onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={submit}>Store</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {filtered.length === 0 ? (
          <Card className="glass-card flex flex-col items-center justify-center p-12 text-center">
            <Database className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No contexts found</p>
            <p className="text-xs text-muted-foreground">
              Try a different search or add a new context.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((m) => (
              <Card key={m.id} className="glass-card group p-5 transition-smooth hover:border-primary/40">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold tracking-tight">{m.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {m.content}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {m.tags.map((t) => (
                        <Badge
                          key={t}
                          variant="secondary"
                          className="rounded-full bg-secondary/60 px-2 py-0 text-[10px] font-normal"
                        >
                          {t}
                        </Badge>
                      ))}
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        {new Date(m.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      removeMemory(m.id);
                      toast.success("Context removed");
                    }}
                    className="h-8 w-8 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
