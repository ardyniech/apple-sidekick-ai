import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Brain,
  CheckCircle2,
  Circle,
  Cpu,
  HardDrive,
  Network,
  Sparkles,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Aurora AI Assistant" },
      { name: "description", content: "Tasks, server health and AI memory at a glance." },
    ],
  }),
  component: Dashboard,
});

const tasks = [
  { id: 1, title: "Summarize weekly metrics", done: true },
  { id: 2, title: "Draft response to investor email", done: true },
  { id: 3, title: "Review Llama.cpp tunnel health", done: false },
  { id: 4, title: "Update knowledge base with Q2 notes", done: false },
  { id: 5, title: "Generate release changelog", done: false },
];

function useFakeMetric(initial: number, range = 10) {
  const [v, setV] = useState(initial);
  useEffect(() => {
    const id = setInterval(() => {
      setV((curr) => {
        const next = curr + (Math.random() - 0.5) * range;
        return Math.max(5, Math.min(95, next));
      });
    }, 1800);
    return () => clearInterval(id);
  }, [range]);
  return Math.round(v);
}

function Dashboard() {
  const cpu = useFakeMetric(34);
  const ram = useFakeMetric(58);
  const gpu = useFakeMetric(22);
  const memories = useAppStore((s) => s.memories);
  const messages = useAppStore((s) => s.messages);

  const activeTasks = tasks.filter((t) => !t.done).length;
  const completedTasks = tasks.filter((t) => t.done).length;

  return (
    <AppLayout title="Dashboard" subtitle="Tasks overview & server status">
      <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
        {/* Hero stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            icon={<Zap className="h-4 w-4" />}
            label="Active Tasks"
            value={activeTasks}
            sub={`${completedTasks} completed today`}
            tint="primary"
          />
          <StatCard
            icon={<Brain className="h-4 w-4" />}
            label="AI Memories"
            value={memories.length}
            sub="contexts in knowledge base"
            tint="accent"
          />
          <StatCard
            icon={<Sparkles className="h-4 w-4" />}
            label="Conversations"
            value={messages.length}
            sub="messages this session"
            tint="success"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Server health */}
          <Card className="glass-card lg:col-span-2 p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Server Health</h2>
                <p className="text-xs text-muted-foreground">
                  Self-hosted node · Cloudflare Tunnel
                </p>
              </div>
              <Badge className="bg-success/15 text-success border border-success/30 hover:bg-success/15">
                <Activity className="mr-1 h-3 w-3" />
                Healthy
              </Badge>
            </div>

            <div className="space-y-5">
              <Metric icon={<Cpu className="h-3.5 w-3.5" />} label="CPU" value={cpu} />
              <Metric icon={<HardDrive className="h-3.5 w-3.5" />} label="RAM" value={ram} />
              <Metric icon={<Network className="h-3.5 w-3.5" />} label="GPU" value={gpu} />
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3 border-t border-border pt-5 text-xs">
              <Stat label="Uptime" value="14d 6h" />
              <Stat label="Latency" value="42ms" />
              <Stat label="Tokens/s" value="38.2" />
            </div>
          </Card>

          {/* Tasks */}
          <Card className="glass-card p-6">
            <h2 className="text-base font-semibold tracking-tight">Active Tasks</h2>
            <p className="text-xs text-muted-foreground">Updated continuously by your agent</p>
            <ul className="mt-4 space-y-2">
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start gap-2.5 rounded-lg p-2 text-sm transition-colors hover:bg-secondary/40"
                >
                  {t.done ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className={
                      t.done
                        ? "text-muted-foreground line-through"
                        : "text-foreground"
                    }
                  >
                    {t.title}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* Memory stats */}
        <Card className="glass-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold tracking-tight">AI Memory Stats</h2>
              <p className="text-xs text-muted-foreground">
                Vector store and recall performance
              </p>
            </div>
            <Brain className="h-4 w-4 text-accent" />
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <MemoryStat label="Stored" value={memories.length.toString()} hint="contexts" />
            <MemoryStat label="Embeddings" value="2,481" hint="vectors" />
            <MemoryStat label="Recall" value="98.4%" hint="last 24h" />
            <MemoryStat label="Index size" value="34 MB" hint="on disk" />
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub: string;
  tint: "primary" | "accent" | "success";
}) {
  const tintMap = {
    primary: "from-primary/30 to-primary/5 text-primary",
    accent: "from-accent/30 to-accent/5 text-accent",
    success: "from-success/30 to-success/5 text-success",
  } as const;
  return (
    <Card className="glass-card relative overflow-hidden p-5">
      <div
        className={`absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br ${tintMap[tint]} blur-2xl opacity-60`}
      />
      <div className="relative">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg bg-secondary/60 ${tintMap[tint].split(" ")[2]}`}>
            {icon}
          </span>
          {label}
        </div>
        <div className="mt-3 font-display text-3xl font-semibold tracking-tight">
          {value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </div>
    </Card>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="font-mono font-medium tabular-nums">{value}%</span>
      </div>
      <Progress value={value} className="h-1.5" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm font-medium">{value}</div>
    </div>
  );
}

function MemoryStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
