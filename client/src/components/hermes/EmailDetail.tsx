import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Trash2, Ban, MailX, CornerDownRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { TaskDetail, Task, ThreadSegment } from "@/lib/api";
import {
  assigneeLabel, initials, createdLabel, fullDateTime, relTime, parseRecipients,
} from "@/lib/api";

const headerBtn =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-4 text-[15px] font-semibold transition-colors";

interface Props {
  taskId: number;
  task: Task | undefined;
  onBack: () => void;
  onDone: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-[14px]">
      <span className="w-16 shrink-0 font-medium text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground">{value}</span>
    </div>
  );
}

// One message in a parsed forwarded chain. The header (From/Sent/To/Subject) is
// rendered as a compact muted row above the message body.
function ChainCard({ seg, top }: { seg: ThreadSegment; top: boolean }) {
  const hasHeader = seg.from || seg.sent || seg.to || seg.subject;
  return (
    <div className="rounded-2xl border border-border bg-secondary/40 p-4">
      {top && !hasHeader ? (
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Top message
        </div>
      ) : hasHeader ? (
        <div className="mb-2 space-y-0.5 border-b border-border pb-2 text-[13px]">
          {seg.from && <ChainHeader label="From" value={seg.from} />}
          {seg.sent && <ChainHeader label="Sent" value={seg.sent} />}
          {seg.to && <ChainHeader label="To" value={seg.to} />}
          {seg.subject && <ChainHeader label="Subject" value={seg.subject} />}
        </div>
      ) : null}
      {seg.text ? (
        <p className="whitespace-pre-wrap text-[15px] leading-[24px] text-foreground">{seg.text}</p>
      ) : (
        <p className="text-[14px] italic text-muted-foreground">No body text.</p>
      )}
    </div>
  );
}

function ChainHeader({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 font-semibold text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground">{value}</span>
    </div>
  );
}

export function EmailDetail({ taskId, task, onBack, onDone, onDelete, onCancel }: Props) {
  const { data, isLoading } = useQuery<TaskDetail>({
    queryKey: ["/api/tasks", taskId, "detail"],
    refetchInterval: false,
  });

  const email = data?.sourceEmail;
  const to = parseRecipients(email?.toRecipients);
  const cc = parseRecipients(email?.ccRecipients);
  const body = (email?.body || "").trim() || (email?.bodyPreview || "").trim();
  const segments: ThreadSegment[] = data?.threadSegments ?? [];
  const hasChain = segments.length > 1;
  const isActive = task ? (task.status === "open" || task.status === "in_progress") : false;

  return (
    <div className="apple-detail detail-enter apple-scroll-col" key={taskId}>
      <div className="flex flex-col gap-4 p-6 sm:p-8">
        {/* Mobile back + actions header */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button" onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[15px] font-semibold text-primary lg:hidden"
            aria-label="Back to task list"
          >
            <ArrowLeft size={18} /> Back
          </button>
          {isActive && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button type="button" onClick={onDone} className={`${headerBtn} bg-success text-white hover:opacity-90`} aria-label="Mark done">
                <Check size={17} /> Done
              </button>
              <button type="button" onClick={onCancel} className={`${headerBtn} bg-secondary text-foreground hover:opacity-80`} aria-label="Cancel task">
                <Ban size={16} /> Cancel
              </button>
              <button type="button" onClick={onDelete} className={`${headerBtn} bg-destructive/12 text-destructive hover:bg-destructive/20`} aria-label="Delete task">
                <Trash2 size={16} /> Delete
              </button>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <>
            <h2 className="text-[24px] font-[650] leading-8 tracking-[-0.025em] text-foreground">
              {email?.subject || task?.title || "Untitled"}
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[13px] font-medium text-foreground">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
                  {initials(assigneeLabel(task?.assigneeName ?? null))}
                </span>
                {assigneeLabel(task?.assigneeName ?? null)}
              </span>
              <span className="text-[14px] font-medium text-muted-foreground">
                Created {createdLabel(task?.createdAt ?? null)}
              </span>
            </div>

            {email && (
              <div className="space-y-1.5 rounded-2xl border border-border bg-secondary/50 p-4">
                <MetaRow label="From" value={`${email.fromName} <${email.fromEmail}>`} />
                {to.length > 0 && <MetaRow label="To" value={to.join(", ")} />}
                {cc.length > 0 && <MetaRow label="Cc" value={cc.join(", ")} />}
                <MetaRow label="Received" value={fullDateTime(email.receivedAt)} />
              </div>
            )}

            {/* Body — full chain when the forwarded email holds several messages,
                otherwise the single body. Never blank when content exists. */}
            {hasChain ? (
              <div className="max-w-[760px]">
                <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
                  <CornerDownRight size={14} /> Thread — {segments.length} messages
                </div>
                <div className="flex flex-col gap-3">
                  {segments.map((seg, i) => (
                    <ChainCard key={i} seg={seg} top={i === 0} />
                  ))}
                </div>
              </div>
            ) : body ? (
              <div className="max-w-[760px] text-[16px] leading-[26px] text-foreground">
                <p className="whitespace-pre-wrap">{segments[0]?.text || body}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-secondary/50 py-12 text-center">
                <MailX size={28} className="text-muted-foreground/60" />
                <p className="text-[15px] font-medium text-foreground">Email body could not be extracted</p>
                <p className="max-w-sm text-[14px] text-muted-foreground">
                  The metadata above is everything we received for this message.
                </p>
              </div>
            )}

            {/* Thread replies */}
            {data?.thread && data.thread.length > 0 && (
              <div className="border-t border-border pt-4">
                <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
                  <CornerDownRight size={14} /> {data.thread.length} {data.thread.length === 1 ? "reply" : "replies"}
                </div>
                <ul className="space-y-2">
                  {data.thread.map((m) => (
                    <li key={m.id} className="rounded-2xl border border-border bg-card p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[14px] font-semibold text-foreground">{m.fromName}</span>
                        <span className="text-[13px] text-muted-foreground">{relTime(m.receivedAt)}</span>
                      </div>
                      {m.summary && <p className="text-[14px] leading-5 text-muted-foreground">{m.summary}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
