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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    done: { bg: "#E8F8ED", fg: "#1D7F3A", label: "Done" },
    deleted: { bg: "#FFECEC", fg: "#C21807", label: "Deleted" },
    cancelled: { bg: "#F2F2F7", fg: "#6E6E73", label: "Cancelled" },
  };
  const s = map[status];
  if (!s) return null;
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
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
            <h3 className="flex-1 min-w-0 text-[17px] font-semibold leading-6 tracking-[-0.01em] text-foreground line-clamp-2">
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
              <span className="rounded-full bg-[#FFECEC] px-2 py-0.5 text-[12px] font-semibold text-[#C21807]">
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
                className={`${actionBtn} text-white`}
                style={{ backgroundColor: "#34C759" }}
              >
                <Check size={16} /> <span className="hidden sm:inline">Done</span>
              </button>
              <button
                type="button" onClick={onCancel} aria-label={`Cancel "${task.title}"`}
                className={`${actionBtn} bg-secondary text-[#3A3A3C] hover:bg-[#E8E8ED]`}
              >
                <Ban size={16} /> <span className="hidden sm:inline">Cancel</span>
              </button>
              <button
                type="button" onClick={onDelete} aria-label={`Delete "${task.title}"`}
                className={`${actionBtn}`}
                style={{ backgroundColor: "#FFF2F2", color: "#D70015" }}
              >
                <Trash2 size={16} /> <span className="hidden sm:inline">Delete</span>
              </button>
            </>
          )}
          {mode !== "inbox" && (
            <button
              type="button" onClick={onRestore} aria-label={`Restore "${task.title}" to Inbox`}
              className={`${actionBtn} bg-secondary text-foreground hover:bg-[#E8E8ED]`}
            >
              <RotateCcw size={15} /> <span className="hidden sm:inline">Restore</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
