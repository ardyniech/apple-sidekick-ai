import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore, type ChatMessage } from "@/lib/store";
import { chatCompletion } from "@/lib/chat-api";
import { ArrowUp, Cloud, Cpu, Sparkles, Trash2, User } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chat — Aurora AI Assistant" },
      { name: "description", content: "Chat with your local or cloud AI model." },
    ],
  }),
  component: ChatPage,
});

function ChatPage() {
  const messages = useAppStore((s) => s.messages);
  const addMessage = useAppStore((s) => s.addMessage);
  const clearChat = useAppStore((s) => s.clearChat);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const settings = useAppStore((s) => s.settings);

  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, thinking]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || thinking) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    addMessage(userMsg);
    setInput("");
    setThinking(true);

    try {
      const reply = await chatCompletion({
        apiUrl: settings.apiUrl,
        apiKey: settings.apiKey,
        model: mode === "local" ? settings.localModel : settings.cloudModel,
        systemPrompt: settings.systemPrompt,
        messages: [...messages, userMsg],
      });
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: reply,
        createdAt: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      toast.error(message);
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `⚠️ **Error:** ${message}`,
        createdAt: Date.now(),
      });
    } finally {
      setThinking(false);
    }
  }

  return (
    <AppLayout title="Personal AI Chat" subtitle="Direct line to your assistant">
      <div className="mx-auto flex h-[calc(100vh-3.5rem)] w-full max-w-4xl flex-col">
        {/* Mode toggle */}
        <div className="flex items-center justify-between gap-3 px-6 pt-4">
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v as "local" | "cloud")}
            className="rounded-full border border-border bg-card/60 p-1"
          >
            <ToggleGroupItem
              value="local"
              className="rounded-full px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              <Cpu className="mr-1.5 h-3.5 w-3.5" />
              Local (Llama.cpp)
            </ToggleGroupItem>
            <ToggleGroupItem
              value="cloud"
              className="rounded-full px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              <Cloud className="mr-1.5 h-3.5 w-3.5" />
              Cloud Model
            </ToggleGroupItem>
          </ToggleGroup>

          <Button
            variant="ghost"
            size="sm"
            onClick={clearChat}
            disabled={messages.length === 0}
            className="text-xs text-muted-foreground"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Clear
          </Button>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1" viewportRef={scrollRef}>
          <div className="space-y-6 px-6 py-6">
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              messages.map((m) => <MessageBubble key={m.id} msg={m} />)
            )}
            {thinking && <ThinkingBubble />}
          </div>
        </ScrollArea>

        {/* Composer */}
        <form onSubmit={handleSubmit} className="border-t border-border p-4">
          <div className="glass-card flex items-end gap-2 rounded-2xl p-2 transition-smooth focus-within:border-primary/50 focus-within:shadow-[var(--shadow-glow)]">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder={`Message ${mode === "local" ? "Llama.cpp" : "Cloud model"}…`}
              rows={1}
              className="min-h-[40px] max-h-40 resize-none border-0 bg-transparent px-3 py-2 text-sm shadow-none focus-visible:ring-0"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || thinking}
              className="h-9 w-9 shrink-0 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 px-1 text-center text-[10px] text-muted-foreground">
            Press Enter to send · Shift + Enter for new line
          </p>
        </form>
      </div>
    </AppLayout>
  );
}

function EmptyState() {
  const suggestions = [
    "Summarize my last meeting notes",
    "Draft a polite follow-up email",
    "Explain my server health metrics",
    "What's stored in my knowledge base?",
  ];
  return (
    <div className="flex flex-col items-center justify-center pt-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent shadow-[var(--shadow-glow)]">
        <Sparkles className="h-6 w-6 text-primary-foreground" />
      </div>
      <h2 className="font-display text-2xl font-semibold tracking-tight">
        How can I help you today?
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Your personal assistant — connected to your private model.
      </p>
      <div className="mt-8 grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <div
            key={s}
            className="glass-card cursor-default rounded-xl px-4 py-3 text-left text-sm text-muted-foreground transition-smooth hover:border-primary/40 hover:text-foreground"
          >
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
          isUser
            ? "bg-secondary text-secondary-foreground"
            : "bg-gradient-to-br from-primary to-accent text-primary-foreground"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      </div>
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "glass-card text-foreground"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div className="prose-chat">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="glass-card flex items-center gap-1.5 rounded-2xl px-4 py-3.5">
        <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "0s" }} />
        <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "0.2s" }} />
        <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "0.4s" }} />
        <span className="ml-2 text-xs text-muted-foreground">thinking…</span>
      </div>
    </div>
  );
}
