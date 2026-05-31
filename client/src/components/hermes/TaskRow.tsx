import { Check, Trash2, Ban, RotateCcw } from "lucide-react";
import type { Task } from "@/lib/api";
import { assigneeLabel, initials, createdLabel, isOverdue } from "@/lib/api";

type RowMode = "inbox" | "done" | "archive";

interface Props {
  task: Task;
  selected: boolean;
  leaving: boolean;
  mode: RowMode;
  onSelect: () => void;
  onDone: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onRestore: () => void;
}

function AssigneeChip({ name }: { name: string | null }) {
  const label = assigneeLabel(name);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-1 text-[13px] font-medium text-foreground">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
        {initials(label)}
      </span>
      {label}
    </span>
  );
}

// Theme-aware status chip. Colours derive from CSS tokens so the dark palette
// recolours them automatically.
const STATUS_CHIP: Record<string, { cls: string; label: string }> = {
  open: { cls: "bg-primary/15 text-primary", label: "Open" },
  in_progress: { cls: "bg-primary/15 text-primary", label: "Open" },
  done: { cls: "bg-success/15 text-success", label: "Done" },
  deleted: { cls: "bg-destructive/15 text-destructive", label: "Deleted" },
  cancelled: { cls: "bg-secondary text-muted-foreground", label: "Cancelled" },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS_CHIP[status];
  if (!s) return null;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "open" || status === "in_progress") return null;
  return <StatusChip status={status} />;
}

const actionBtn =
  "inline-flex h-9 min-w-[36px] items-center justify-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold transition-colors";

export function TaskRow({
  task, selected, leaving, mode, onSelect, onDone, onDelete, onCancel, onRestore,
}: Props) {
  const overdue = isOverdue(task.dueDate, task.status);

  return (
    <div
      className={`apple-surface ${mode === "inbox" ? "apple-surface-hover" : ""} ${
        selected ? "apple-surface-selected" : ""
      } ${leaving ? "row-leaving" : ""} group`}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="flex-1 min-w-0 text-left px-5 py-[18px] rounded-l-[18px]"
        >
          <div className="flex items-start gap-2">
            <h3 className={`flex-1 min-w-0 text-[17px] font-semibold leading-6 tracking-[-0.01em] line-clamp-2 ${
              selected ? "text-primary" : "text-foreground"
            }`}>
              {task.title}
            </h3>
            {mode !== "inbox" && <StatusBadge status={task.status} />}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <AssigneeChip name={task.assigneeName} />
            <span className="text-[14px] font-medium text-muted-foreground">
              {createdLabel(task.createdAt)}
            </span>
            {overdue && (
              <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[12px] font-semibold text-destructive">
                Overdue
              </span>
            )}
          </div>
        </button>

        <div className="flex items-center gap-1.5 pr-3.5 pl-1">
          {mode === "inbox" && (
            <>
              <button
                type="button" onClick={onDone} aria-label={`Mark "${task.title}" done`}
                className={`${actionBtn} bg-success text-white hover:opacity-90`}
              >
                <Check size={16} /> <span className="hidden sm:inline">Done</span>
              </button>
              <button
                type="button" onClick={onCancel} aria-label={`Cancel "${task.title}"`}
                className={`${actionBtn} bg-secondary text-foreground hover:opacity-80`}
              >
                <Ban size={16} /> <span className="hidden sm:inline">Cancel</span>
              </button>
              <button
                type="button" onClick={onDelete} aria-label={`Delete "${task.title}"`}
                className={`${actionBtn} bg-destructive/12 text-destructive hover:bg-destructive/20`}
              >
                <Trash2 size={16} /> <span className="hidden sm:inline">Delete</span>
              </button>
            </>
          )}
          {mode !== "inbox" && (
            <button
              type="button" onClick={onRestore} aria-label={`Restore "${task.title}" to Inbox`}
              className={`${actionBtn} bg-secondary text-foreground hover:opacity-80`}
            >
              <RotateCcw size={15} /> <span className="hidden sm:inline">Restore</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
