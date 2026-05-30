import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  StatusResponse, PersonRow, Task, Activity,
  isActive, isOverdue, relTime, initials, createdLabel,
} from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskRow } from "@/components/hermes/TaskRow";
import { EmailDetail } from "@/components/hermes/EmailDetail";
import { useTaskActions } from "@/components/hermes/useTaskActions";
import {
  RefreshCw, Inbox, CheckCircle2, Archive, Activity as ActivityIcon,
  Users, ListChecks, Mail, Reply,
} from "lucide-react";

const REFRESH_MS = 5 * 60 * 1000;
const LEAVE_MS = 200;

type Tab = "inbox" | "done" | "deleted" | "activity" | "people";
type ArchiveFilter = "all" | "deleted" | "cancelled";

const TABS: { key: Tab; label: string; icon: typeof Inbox }[] = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "done", label: "Done", icon: CheckCircle2 },
  { key: "deleted", label: "Deleted", icon: Archive },
  { key: "activity", label: "Activity", icon: ActivityIcon },
  { key: "people", label: "People", icon: Users },
];

function sortTasks(list: Task[]): Task[] {
  return [...list].sort((a, b) => {
    const ao = isOverdue(a.dueDate, a.status), bo = isOverdue(b.dueDate, b.status);
    if (ao !== bo) return ao ? -1 : 1;
    const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    if (a.priority !== b.priority) return order[a.priority] - order[b.priority];
    return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
  });
}

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("inbox");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [leavingId, setLeavingId] = useState<number | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);

  const status = useQuery<StatusResponse>({ queryKey: ["/api/status"], refetchInterval: REFRESH_MS });
  const tasksQ = useQuery<Task[]>({ queryKey: ["/api/tasks"], refetchInterval: REFRESH_MS });
  const peopleQ = useQuery<PersonRow[]>({ queryKey: ["/api/people"], refetchInterval: REFRESH_MS });
  const activityQ = useQuery<Activity[]>({ queryKey: ["/api/activity"], refetchInterval: REFRESH_MS });

  const actions = useTaskActions();

  const runNow = useMutation({
    mutationFn: () => apiRequest("POST", "/api/watcher/run"),
    onSuccess: () => {
      ["/api/status", "/api/tasks", "/api/people", "/api/activity"].forEach(
        (k) => queryClient.invalidateQueries({ queryKey: [k] }),
      );
    },
  });

  const w = status.data?.watcher;
  const live = w?.source === "microsoft_graph";
  const tasks = tasksQ.data ?? [];

  const inboxTasks = useMemo(() => sortTasks(tasks.filter((t) => isActive(t.status))), [tasks]);
  const doneTasks = useMemo(() => tasks.filter((t) => t.status === "done"), [tasks]);
  const archiveTasks = useMemo(() => {
    let list = tasks.filter((t) => t.status === "deleted" || t.status === "cancelled");
    if (archiveFilter === "deleted") list = list.filter((t) => t.status === "deleted");
    if (archiveFilter === "cancelled") list = list.filter((t) => t.status === "cancelled");
    return list;
  }, [tasks, archiveFilter]);

  const counts = {
    inbox: inboxTasks.length,
    done: doneTasks.length,
    deleted: tasks.filter((t) => t.status === "deleted" || t.status === "cancelled").length,
  };

  // The list shown in the current list-bearing tab.
  const listForTab: Task[] =
    tab === "inbox" ? inboxTasks : tab === "done" ? doneTasks : tab === "deleted" ? archiveTasks : [];

  // Keep a valid selection within the active list; default to first.
  useEffect(() => {
    if (tab !== "inbox" && tab !== "done" && tab !== "deleted") return;
    if (selectedId && listForTab.some((t) => t.id === selectedId)) return;
    setSelectedId(listForTab[0]?.id ?? null);
  }, [tab, listForTab, selectedId]);

  const selectedTask = tasks.find((t) => t.id === selectedId);

  // Optimistic action: animate row out, then run the mutation and advance.
  function act(id: number, fn: (id: number) => void) {
    setLeavingId(id);
    window.setTimeout(() => {
      const remaining = listForTab.filter((t) => t.id !== id);
      if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
      setLeavingId(null);
      fn(id);
    }, LEAVE_MS);
  }

  const rowMode = tab === "done" ? "done" : tab === "deleted" ? "archive" : "inbox";

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      {/* ── Header ── */}
      <header className="apple-glass sticky top-0 z-30">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3 px-4 py-3 sm:px-8">
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-foreground">Hermes</h1>
          <span className="hidden text-[14px] font-medium text-muted-foreground sm:inline">
            Email-to-task command center
          </span>
          <div className="ml-auto flex items-center gap-2.5">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold"
              style={live
                ? { borderColor: "#34C75955", background: "#E8F8ED", color: "#1D7F3A" }
                : { borderColor: "#FF9F0A55", background: "#FFF6E5", color: "#9A6200" }}
              title={w?.lastRunAt ? `Last run ${relTime(w.lastRunAt)}` : "No runs yet"}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: live ? "#34C759" : "#FF9F0A" }} />
              {live ? "Live inbox" : "Demo feed"}
            </span>
            <button
              type="button"
              onClick={() => runNow.mutate()}
              disabled={runNow.isPending}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#0066D6] disabled:opacity-60"
            >
              <RefreshCw size={16} className={runNow.isPending ? "animate-spin" : ""} />
              {runNow.isPending ? "Scanning…" : "Scan Inbox"}
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="mx-auto max-w-[1440px] px-4 pb-3 sm:px-8">
          <div
            role="tablist"
            aria-label="Views"
            className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1"
          >
            {TABS.map((t) => {
              const activeTab = tab === t.key;
              const badge =
                t.key === "inbox" ? counts.inbox : t.key === "done" ? counts.done : t.key === "deleted" ? counts.deleted : null;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={activeTab}
                  onClick={() => { setTab(t.key); setMobileDetail(false); }}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[15px] font-semibold transition-colors ${
                    activeTab ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  <t.icon size={16} />
                  {t.label}
                  {badge !== null && badge > 0 && (
                    <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[12px] font-semibold tabular-nums ${
                      activeTab ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
                    }`}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8 sm:py-8">
        {(tab === "inbox" || tab === "done" || tab === "deleted") && (
          <TaskTab
            tab={tab}
            rowMode={rowMode}
            list={listForTab}
            loading={tasksQ.isLoading}
            selectedId={selectedId}
            selectedTask={selectedTask}
            leavingId={leavingId}
            mobileDetail={mobileDetail}
            archiveFilter={archiveFilter}
            setArchiveFilter={setArchiveFilter}
            onSelect={(id) => { setSelectedId(id); setMobileDetail(true); }}
            onBack={() => setMobileDetail(false)}
            onDone={(id) => act(id, actions.markDone)}
            onDelete={(id) => act(id, actions.remove)}
            onCancel={(id) => act(id, actions.cancel)}
            onRestore={(id) => act(id, actions.restore)}
          />
        )}
        {tab === "activity" && <ActivityTab q={activityQ} />}
        {tab === "people" && <PeopleTab q={peopleQ} />}
      </main>
    </div>
  );
}

// ── Inbox / Done / Deleted master-detail ───────────────
function TaskTab(props: {
  tab: Tab; rowMode: "inbox" | "done" | "archive"; list: Task[]; loading: boolean;
  selectedId: number | null; selectedTask: Task | undefined; leavingId: number | null;
  mobileDetail: boolean; archiveFilter: ArchiveFilter;
  setArchiveFilter: (f: ArchiveFilter) => void;
  onSelect: (id: number) => void; onBack: () => void;
  onDone: (id: number) => void; onDelete: (id: number) => void;
  onCancel: (id: number) => void; onRestore: (id: number) => void;
}) {
  const {
    tab, rowMode, list, loading, selectedId, selectedTask, leavingId, mobileDetail,
    archiveFilter, setArchiveFilter, onSelect, onBack, onDone, onDelete, onCancel, onRestore,
  } = props;

  const emptyText =
    tab === "inbox" ? "Inbox zero. New tasks appear here as Hermes reads incoming mail."
    : tab === "done" ? "No completed tasks yet."
    : "Nothing deleted or cancelled.";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(420px,0.92fr)_minmax(560px,1.25fr)]">
      {/* List column */}
      <section className={`flex flex-col gap-3 ${mobileDetail ? "hidden lg:flex" : "flex"}`}>
        {tab === "deleted" && (
          <div className="flex gap-1.5">
            {(["all", "deleted", "cancelled"] as ArchiveFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setArchiveFilter(f)}
                className={`rounded-full px-3 py-1.5 text-[14px] font-semibold capitalize transition-colors ${
                  archiveFilter === f ? "bg-accent text-accent-foreground" : "bg-card text-muted-foreground hover:bg-secondary border border-border"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-[18px]" />)}
          </div>
        ) : list.length === 0 ? (
          <Empty icon={ListChecks} text={emptyText} />
        ) : (
          list.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              mode={rowMode}
              selected={selectedId === t.id}
              leaving={leavingId === t.id}
              onSelect={() => onSelect(t.id)}
              onDone={() => onDone(t.id)}
              onDelete={() => onDelete(t.id)}
              onCancel={() => onCancel(t.id)}
              onRestore={() => onRestore(t.id)}
            />
          ))
        )}
      </section>

      {/* Detail column */}
      <section className={`${mobileDetail ? "block" : "hidden lg:block"}`}>
        {selectedId && selectedTask ? (
          <EmailDetail
            taskId={selectedId}
            task={selectedTask}
            onBack={onBack}
            onDone={() => onDone(selectedId)}
            onDelete={() => onDelete(selectedId)}
            onCancel={() => onCancel(selectedId)}
          />
        ) : (
          <div className="apple-detail flex h-full min-h-[320px] flex-col items-center justify-center gap-3 p-10 text-center">
            <Mail size={32} className="text-muted-foreground/50" />
            <p className="text-[16px] font-medium text-foreground">Select a task to view the email.</p>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Activity ────────────────────────────────────────────
function ActivityTab({ q }: { q: ReturnType<typeof useQuery<Activity[]>> }) {
  const { data, isLoading } = q;
  const icon = (type: string) => {
    if (type === "task_created") return <ListChecks size={16} className="text-primary" />;
    if (type === "reply_linked") return <Reply size={16} className="text-primary" />;
    if (type === "watcher_run") return <RefreshCw size={16} className="text-muted-foreground" />;
    if (type === "task_updated") return <CheckCircle2 size={16} className="text-success" />;
    if (type === "email_ignored") return <Mail size={16} className="text-muted-foreground" />;
    return <ActivityIcon size={16} className="text-muted-foreground" />;
  };
  return (
    <div className="mx-auto max-w-[760px]">
      <h2 className="mb-4 text-[24px] font-[650] tracking-[-0.025em]">Activity</h2>
      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-[18px]" />
      ) : !data?.length ? (
        <Empty icon={ActivityIcon} text="No activity yet." />
      ) : (
        <ul className="apple-surface divide-y divide-border overflow-hidden">
          {data.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-5 py-3.5">
              <span className="mt-0.5 shrink-0">{icon(a.type)}</span>
              <p className="flex-1 min-w-0 text-[15px] leading-5 text-foreground">{a.message}</p>
              <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">{relTime(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── People ──────────────────────────────────────────────
function PeopleTab({ q }: { q: ReturnType<typeof useQuery<PersonRow[]>> }) {
  const { data, isLoading } = q;
  return (
    <div className="mx-auto max-w-[900px]">
      <h2 className="mb-4 text-[24px] font-[650] tracking-[-0.025em]">People</h2>
      {isLoading ? (
        <div className="flex flex-col gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-28 w-full rounded-[18px]" />)}</div>
      ) : !data?.length ? (
        <Empty icon={Users} text="No people assigned yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((p) => (
            <div key={p.id} className="apple-surface p-5">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent text-[14px] font-semibold text-accent-foreground">
                  {initials(p.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-semibold text-foreground">{p.name}</div>
                  {!p.email.endsWith("@team") && (
                    <div className="truncate text-[14px] text-muted-foreground">{p.email}</div>
                  )}
                </div>
                <div className="flex items-center gap-5 text-right">
                  <div>
                    <div className="text-[20px] font-semibold tabular-nums text-primary leading-none">{p.openCount}</div>
                    <div className="mt-1 text-[12px] font-medium text-muted-foreground">Open</div>
                  </div>
                  {p.overdueCount > 0 && (
                    <div>
                      <div className="text-[20px] font-semibold tabular-nums leading-none" style={{ color: "#FF3B30" }}>{p.overdueCount}</div>
                      <div className="mt-1 text-[12px] font-medium" style={{ color: "#C21807" }}>Overdue</div>
                    </div>
                  )}
                </div>
              </div>
              {p.tasks.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                  {p.tasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 text-[14px]">
                      <span className="min-w-0 truncate text-foreground">{t.title}</span>
                      <span className="shrink-0 text-muted-foreground">{createdLabel(t.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof ListChecks; text: string }) {
  return (
    <div className="apple-surface flex flex-col items-center justify-center px-6 py-16 text-center">
      <Icon size={30} className="mb-3 text-muted-foreground/50" />
      <p className="max-w-sm text-[15px] text-muted-foreground">{text}</p>
    </div>
  );
}
