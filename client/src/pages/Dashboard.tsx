import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  StatusResponse, PersonRow, Task, Contract, Activity, TaskDetail,
  isOverdue, relTime, initials,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search, ChevronDown, AlertTriangle, ArrowDown, Circle, Mail,
  CheckCircle2, X, Users, FileSignature, Activity as ActivityIcon,
  ListChecks, RefreshCw, CornerDownRight,
} from "lucide-react";

const REFRESH_MS = 5 * 60 * 1000;

// Force Jarvis (dark) mode — single-page HUD.
function useDark() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

type Filter = "all" | "high" | "overdue" | "contracts";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "high", label: "HIGH" },
  { key: "overdue", label: "OVERDUE" },
  { key: "contracts", label: "CONTRACTS" },
];

function assigneeLabel(name: string | null): string {
  return name && name.trim() ? name : "You";
}

// Short, clean deadline label for the chip row.
function shortDue(dueDate: string | null, status: string): { text: string; tone: "overdue" | "soon" | "none" | "normal" } {
  if (!dueDate) return { text: "NO DEADLINE", tone: "none" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  const fmt = due.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (status !== "done" && days < 0) return { text: "OVERDUE", tone: "overdue" };
  if (status !== "done" && days <= 2) return { text: "DUE SOON", tone: "soon" };
  return { text: fmt, tone: "normal" };
}

export default function Dashboard() {
  useDark();
  const now = useClock();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const status = useQuery<StatusResponse>({ queryKey: ["/api/status"], refetchInterval: REFRESH_MS });
  const tasksQ = useQuery<Task[]>({ queryKey: ["/api/tasks"], refetchInterval: REFRESH_MS });
  const peopleQ = useQuery<PersonRow[]>({ queryKey: ["/api/people"], refetchInterval: REFRESH_MS });
  const contractsQ = useQuery<Contract[]>({ queryKey: ["/api/contracts"], refetchInterval: REFRESH_MS });
  const activityQ = useQuery<Activity[]>({ queryKey: ["/api/activity"], refetchInterval: REFRESH_MS });

  const runNow = useMutation({
    mutationFn: () => apiRequest("POST", "/api/watcher/run"),
    onSuccess: () => {
      ["/api/status", "/api/tasks", "/api/people", "/api/contracts", "/api/activity"].forEach(
        (k) => queryClient.invalidateQueries({ queryKey: [k] })
      );
    },
  });

  const w = status.data?.watcher;
  const live = w?.source === "microsoft_graph";

  const tasks = tasksQ.data ?? [];
  const q = query.trim().toLowerCase();

  const filteredTasks = useMemo(() => {
    let list = tasks.filter((t) => t.status !== "done");
    if (filter === "high") list = list.filter((t) => t.priority === "high");
    if (filter === "overdue") list = list.filter((t) => isOverdue(t.dueDate, t.status));
    if (q) {
      list = list.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        assigneeLabel(t.assigneeName).toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const ao = isOverdue(a.dueDate, a.status), bo = isOverdue(b.dueDate, b.status);
      if (ao !== bo) return ao ? -1 : 1;
      const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
      if (a.priority !== b.priority) return order[a.priority] - order[b.priority];
      return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
    });
  }, [tasks, filter, q]);

  const openCount = tasks.filter((t) => t.status !== "done").length;
  const showContracts = filter === "contracts";

  return (
    <div className="hud-canvas min-h-[100dvh] bg-background text-foreground">
      <div className="relative z-10 mx-auto max-w-[1180px] px-6 py-7">
        {/* ── Header ── */}
        <header className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <h1
              className="font-mono font-bold text-4xl sm:text-5xl tracking-[0.34em] text-primary text-glow leading-none"
              data-testid="text-app-title"
            >
              HERMES
            </h1>
            <div className="hud-label text-muted-foreground mt-3">EMAIL-TO-TASK COMMAND CENTER</div>
          </div>
          <div className="flex items-center gap-3">
            <span
              data-testid="pill-system-status"
              className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 hud-label ${
                live
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                  : "border-amber-400/40 bg-amber-400/10 text-amber-300"
              }`}
            >
              <span className={`hud-pulse inline-block w-2 h-2 rounded-full ${live ? "bg-emerald-400" : "bg-amber-400"}`} />
              {live ? "SYSTEM ONLINE" : "DEMO FEED"}
            </span>
            <span
              className="font-mono tabular-nums text-lg text-foreground/90 tracking-wider"
              data-testid="text-clock"
            >
              {now.toLocaleTimeString("en-GB")}
            </span>
            <Button
              variant="outline" size="sm" data-testid="button-scan-now"
              onClick={() => runNow.mutate()} disabled={runNow.isPending}
              className="border-primary/30 text-primary hover:bg-primary/10"
            >
              <RefreshCw size={14} className={runNow.isPending ? "animate-spin" : ""} />
              {runNow.isPending ? "Scanning…" : "Scan"}
            </Button>
          </div>
        </header>

        {/* ── Search + filter pills ── */}
        <div className="mt-7 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[260px]">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              data-testid="input-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks, people, contracts..."
              className="w-full rounded-lg border border-border bg-card/50 backdrop-blur-md pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div className="flex items-center gap-2">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  data-testid={`pill-filter-${f.key}`}
                  onClick={() => setFilter(f.key)}
                  className={`hud-label rounded-md border px-3 py-2 transition-all ${
                    active
                      ? "border-primary/60 bg-primary/15 text-primary hud-glow"
                      : "border-border bg-card/40 text-muted-foreground hover:text-foreground hover:border-primary/30"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Main content ── */}
        {showContracts ? (
          <ContractsSection query={query} q={q} queryState={contractsQ} />
        ) : (
          <TasksSection
            tasks={filteredTasks}
            isLoading={tasksQ.isLoading}
            openCount={openCount}
          />
        )}

        {/* ── People + Activity (always available below) ── */}
        {!showContracts && (
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <PeopleSection queryState={peopleQ} q={q} />
            <ActivitySection queryState={activityQ} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tasks section + accordion cards ────────────────────
function TasksSection({ tasks, isLoading, openCount }: {
  tasks: Task[]; isLoading: boolean; openCount: number;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/tasks/${id}`, patch),
    onSuccess: (_d, vars) => {
      ["/api/tasks", "/api/status", "/api/people", "/api/activity"].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }));
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", vars.id, "detail"] });
    },
  });

  return (
    <section className="mt-9">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="hud-label text-foreground/80 text-[12px] tracking-[0.22em]">
          TASKS <span className="text-primary/70">//</span> PRIORITY STACK
        </h2>
        <span className="hud-label rounded-full border border-primary/30 bg-primary/10 text-primary px-2.5 py-1" data-testid="chip-open-count">
          {openCount} OPEN
        </span>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
        </div>
      ) : tasks.length === 0 ? (
        <Empty icon={ListChecks} text="No matching directives. Forward an email to hermes@angelsestate.bg to spin one up." />
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              expanded={expandedId === t.id}
              onToggle={() => setExpandedId((id) => (id === t.id ? null : t.id))}
              onComplete={() => update.mutate({ id: t.id, patch: { status: "done" } })}
              completing={update.isPending}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function priorityBar(p: string): string {
  if (p === "high") return "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.6)]";
  if (p === "low") return "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]";
  return "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]";
}

function PriorityIcon({ p }: { p: string }) {
  if (p === "high") return <AlertTriangle size={13} />;
  if (p === "low") return <ArrowDown size={13} />;
  return <Circle size={9} className="fill-current" />;
}

function priorityIconBox(p: string): string {
  if (p === "high") return "border-rose-500/40 bg-rose-500/10 text-rose-400";
  if (p === "low") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
  return "border-amber-400/40 bg-amber-400/10 text-amber-300";
}

function TaskCard({ task: t, expanded, onToggle, onComplete, completing }: {
  task: Task; expanded: boolean; onToggle: () => void; onComplete: () => void; completing: boolean;
}) {
  const due = shortDue(t.dueDate, t.status);
  const [showEmail, setShowEmail] = useState(false);

  const dueClass =
    due.tone === "overdue" ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
    : due.tone === "soon" ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
    : due.tone === "none" ? "border-border bg-card/40 text-muted-foreground"
    : "border-border bg-card/40 text-foreground/80";

  return (
    <div
      data-testid={`card-task-${t.id}`}
      className={`hud-panel relative overflow-hidden rounded-lg transition-all ${
        expanded ? "!border-primary/50 hud-glow" : "hover:border-primary/40"
      }`}
    >
      {/* priority color bar */}
      <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${priorityBar(t.priority)}`} />

      {/* header (click to expand) */}
      <button
        type="button"
        onClick={onToggle}
        data-testid={`button-task-toggle-${t.id}`}
        className="w-full text-left flex items-start gap-3.5 pl-5 pr-4 py-3.5"
      >
        <span className={`mt-0.5 grid place-items-center w-7 h-7 shrink-0 rounded-md border ${priorityIconBox(t.priority)}`}>
          <PriorityIcon p={t.priority} />
        </span>

        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold leading-snug text-foreground" data-testid={`text-task-title-${t.id}`}>
            {t.title}
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
              data-testid={`chip-assignee-${t.id}`}
            >
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary/20 text-[8px] font-semibold">
                {initials(assigneeLabel(t.assigneeName))}
              </span>
              {assigneeLabel(t.assigneeName)}
            </span>
            <span className={`hud-label rounded-md border px-2 py-1 ${dueClass}`} data-testid={`chip-due-${t.id}`}>
              {due.text}
            </span>
            <span className="hud-label text-muted-foreground/70 px-1">
              {t.status === "in_progress" ? "ACTIVE" : t.status.toUpperCase()}
            </span>
          </div>
        </div>

        <ChevronDown
          size={18}
          className={`mt-1 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180 text-primary" : ""}`}
        />
      </button>

      {/* expanded body */}
      {expanded && (
        <div className="pl-5 pr-4 pb-4 pt-1 ml-[1.625rem]" data-testid={`expand-task-${t.id}`}>
          <div className="border-t border-border/60 pt-3.5">
            <div className="hud-label text-muted-foreground mb-2">EMAIL BODY</div>
            <p
              className="text-sm leading-relaxed text-foreground/85 whitespace-pre-wrap"
              data-testid={`text-task-description-${t.id}`}
            >
              {t.description || "No description captured for this directive."}
            </p>

            <div className="mt-4 flex items-center gap-2.5 flex-wrap">
              <Button
                variant="outline" size="sm"
                data-testid={`button-view-email-${t.id}`}
                onClick={() => setShowEmail(true)}
                className="border-primary/30 text-primary hover:bg-primary/10"
              >
                <Mail size={14} /> View Full Email
              </Button>
              <Button
                size="sm"
                data-testid={`button-mark-complete-${t.id}`}
                onClick={onComplete}
                disabled={completing}
                className="bg-emerald-500/90 text-white hover:bg-emerald-500"
              >
                <CheckCircle2 size={14} /> Mark Complete
              </Button>
            </div>
          </div>
        </div>
      )}

      {showEmail && <EmailModal taskId={t.id} onClose={() => setShowEmail(false)} />}
    </div>
  );
}

// ── Full email modal ───────────────────────────────────
function EmailModal({ taskId, onClose }: { taskId: number; onClose: () => void }) {
  const { data, isLoading } = useQuery<TaskDetail>({
    queryKey: ["/api/tasks", taskId, "detail"],
    refetchInterval: false,
  });

  let toList: string[] = [];
  if (data?.sourceEmail?.toRecipients) {
    try { toList = JSON.parse(data.sourceEmail.toRecipients); } catch { toList = []; }
  }
  const email = data?.sourceEmail;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 backdrop-blur-sm p-4 sm:p-8"
      onClick={onClose}
      data-testid={`modal-email-${taskId}`}
    >
      <div
        className="hud-panel hud-bracket relative w-full max-w-2xl rounded-lg p-6 mt-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="hud-label text-primary text-glow flex items-center gap-2">
            <Mail size={13} /> SOURCE EMAIL
          </div>
          <button onClick={onClose} data-testid="button-close-email" className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-40 w-full" />
          </div>
        ) : !email ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No source email is linked to this directive.</p>
        ) : (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold leading-snug" data-testid="text-email-subject">{email.subject}</h3>
            <div className="rounded-lg border border-border/60 bg-card/40 p-3.5 text-xs text-muted-foreground space-y-1.5">
              <div>
                <span className="hud-label mr-2 opacity-70">FROM</span>
                <span className="text-foreground/90">{email.fromName}</span>{" "}
                <span className="font-mono opacity-70">&lt;{email.fromEmail}&gt;</span>
              </div>
              {toList.length > 0 && (
                <div className="flex gap-2">
                  <span className="hud-label mt-0.5 opacity-70 shrink-0">TO</span>
                  <span className="font-mono break-all opacity-80">{toList.join(", ")}</span>
                </div>
              )}
              <div>
                <span className="hud-label mr-2 opacity-70">SENT</span>
                <span className="font-mono tabular-nums">{new Date(email.receivedAt).toLocaleString("en-GB")}</span>
              </div>
            </div>
            <p
              className="text-sm leading-relaxed text-foreground/85 whitespace-pre-wrap border-t border-border/50 pt-4 max-h-[45vh] overflow-y-auto"
              data-testid="text-email-body"
            >
              {email.body || email.bodyPreview}
            </p>

            {data?.thread && data.thread.length > 0 && (
              <div className="border-t border-border/60 pt-4">
                <div className="hud-label text-muted-foreground mb-2 flex items-center gap-1.5">
                  <CornerDownRight size={12} /> THREAD · {data.thread.length} {data.thread.length === 1 ? "REPLY" : "REPLIES"}
                </div>
                <ul className="space-y-2">
                  {data.thread.map((m) => (
                    <li key={m.id} className="rounded-md border border-border/50 bg-card/30 p-2.5">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-medium">{m.fromName}</span>
                        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">{relTime(m.receivedAt)}</span>
                      </div>
                      {m.summary && <p className="text-xs text-muted-foreground leading-relaxed">{m.summary}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Contracts ──────────────────────────────────────────
function ContractsSection({ query, q, queryState }: {
  query: string; q: string; queryState: ReturnType<typeof useQuery<Contract[]>>;
}) {
  const { data, isLoading } = queryState;
  const list = (data ?? []).filter((ct) =>
    !q ||
    ct.title.toLowerCase().includes(q) ||
    (ct.counterparty ?? "").toLowerCase().includes(q)
  );

  const statusChip = (s: string) => {
    if (s === "signed") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    if (s === "expired") return "border-border bg-card/40 text-muted-foreground";
    return "border-amber-400/40 bg-amber-400/10 text-amber-300";
  };

  return (
    <section className="mt-9">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="hud-label text-foreground/80 text-[12px] tracking-[0.22em]">
          CONTRACTS <span className="text-primary/70">//</span> SIGNATURE QUEUE
        </h2>
        <span className="hud-label rounded-full border border-primary/30 bg-primary/10 text-primary px-2.5 py-1">
          {list.length} DOCS
        </span>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
      ) : list.length === 0 ? (
        <Empty icon={FileSignature} text="No documents in queue. Contracts needing signature surface here." />
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((ct) => (
            <div key={ct.id} className="hud-panel rounded-lg p-4 flex items-center gap-4" data-testid={`card-contract-${ct.id}`}>
              <div className="grid place-items-center rounded-md w-11 h-11 bg-primary/10 text-primary shrink-0">
                <FileSignature size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{ct.title}</div>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    {ct.counterparty || "Unknown party"}
                  </span>
                  {ct.attachmentName && (
                    <span className="text-[11px] font-mono text-muted-foreground truncate">{ct.attachmentName}</span>
                  )}
                </div>
              </div>
              <span className={`hud-label rounded-md border px-2.5 py-1 shrink-0 ${statusChip(ct.status)}`} data-testid={`chip-contract-status-${ct.id}`}>
                {ct.status.replace(/_/g, " ").toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── People ─────────────────────────────────────────────
function PeopleSection({ queryState, q }: {
  queryState: ReturnType<typeof useQuery<PersonRow[]>>; q: string;
}) {
  const { data, isLoading } = queryState;
  const list = (data ?? []).filter((p) =>
    !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
  );

  return (
    <section>
      <h2 className="hud-label text-foreground/80 text-[12px] tracking-[0.22em] mb-4">
        PEOPLE <span className="text-primary/70">//</span> CREW
      </h2>
      {isLoading ? (
        <div className="flex flex-col gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
      ) : list.length === 0 ? (
        <Empty icon={Users} text="No crew assigned yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((p) => (
            <div key={p.id} className="hud-panel rounded-lg p-4" data-testid={`card-person-${p.id}`}>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-primary/15 text-primary text-xs font-semibold ring-1 ring-primary/25 shrink-0">
                  {initials(p.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  {!p.email.endsWith("@team") && (
                    <div className="text-xs text-muted-foreground font-mono truncate">{p.email}</div>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular-nums text-primary text-glow leading-none">{p.openCount}</div>
                    <div className="hud-label text-muted-foreground mt-1">OPEN</div>
                  </div>
                  {p.overdueCount > 0 && (
                    <div className="text-right">
                      <div className="text-lg font-semibold tabular-nums text-rose-400 leading-none">{p.overdueCount}</div>
                      <div className="hud-label text-rose-400/70 mt-1">OVERDUE</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Activity ───────────────────────────────────────────
function ActivitySection({ queryState }: {
  queryState: ReturnType<typeof useQuery<Activity[]>>;
}) {
  const { data, isLoading } = queryState;

  const icon = (type: string) => {
    if (type === "task_created") return <ListChecks size={14} className="text-primary" />;
    if (type === "contract_created") return <FileSignature size={14} className="text-amber-300" />;
    if (type === "reply_linked") return <Mail size={14} className="text-primary" />;
    if (type === "watcher_run") return <RefreshCw size={14} className="text-muted-foreground" />;
    if (type === "task_updated") return <CheckCircle2 size={14} className="text-emerald-400" />;
    return <ActivityIcon size={14} className="text-muted-foreground" />;
  };

  return (
    <section>
      <h2 className="hud-label text-foreground/80 text-[12px] tracking-[0.22em] mb-4">
        ACTIVITY <span className="text-primary/70">//</span> LOG
      </h2>
      {isLoading ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : !data?.length ? (
        <Empty icon={ActivityIcon} text="Telemetry log empty." />
      ) : (
        <div className="hud-panel rounded-lg overflow-hidden divide-y divide-border/60">
          {data.slice(0, 12).map((a) => (
            <div key={a.id} className="flex items-start gap-3 px-4 py-3" data-testid={`activity-${a.id}`}>
              <div className="mt-0.5 shrink-0">{icon(a.type)}</div>
              <p className="flex-1 min-w-0 text-sm text-foreground/85">{a.message}</p>
              <span className="text-xs text-muted-foreground shrink-0 font-mono tabular-nums">{relTime(a.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Shared ─────────────────────────────────────────────
function Empty({ icon: Icon, text }: { icon: typeof ListChecks; text: string }) {
  return (
    <div className="hud-panel rounded-lg flex flex-col items-center justify-center text-center py-14 px-6 text-muted-foreground">
      <Icon size={34} className="opacity-40 text-primary mb-3" />
      <p className="text-sm max-w-sm">{text}</p>
    </div>
  );
}
