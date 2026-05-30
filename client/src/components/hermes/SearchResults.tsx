import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmailDetail } from "@/components/hermes/EmailDetail";
import { StatusChip } from "@/components/hermes/TaskRow";
import { useTaskActions } from "@/components/hermes/useTaskActions";
import type { SearchResult } from "@/lib/api";
import { assigneeLabel, initials, createdLabel } from "@/lib/api";

// Search view: lists tasks matching `query` across ALL statuses, with a status
// chip so the user knows where each result lives. Clicking a result opens it in
// the detail pane (reusing EmailDetail).
export function SearchResults({ query }: { query: string }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const actions = useTaskActions();

  // queryClient joins the queryKey with "/", so a single fully-formed URL key
  // (with the encoded query string) is the simplest correct approach.
  const url = `/api/search?q=${encodeURIComponent(query)}`;
  const { data, isLoading } = useQuery<SearchResult[]>({
    queryKey: [url],
    enabled: query.length > 0,
  });

  const results = data ?? [];
  const selected = results.find((r) => r.id === selectedId);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(420px,0.92fr)_minmax(560px,1.25fr)]">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2 px-1 text-[14px] font-medium text-muted-foreground">
          <SearchIcon size={15} />
          {isLoading
            ? "Searching…"
            : `${results.length} result${results.length === 1 ? "" : "s"} for “${query}”`}
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-[18px]" />)}
          </div>
        ) : results.length === 0 ? (
          <div className="apple-surface flex flex-col items-center justify-center px-6 py-16 text-center">
            <SearchIcon size={30} className="mb-3 text-muted-foreground/50" />
            <p className="max-w-sm text-[15px] text-muted-foreground">
              No tasks match “{query}”.
            </p>
          </div>
        ) : (
          results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className={`apple-surface apple-surface-hover ${selectedId === r.id ? "apple-surface-selected" : ""} w-full px-5 py-4 text-left`}
            >
              <div className="flex items-start gap-2">
                <h3 className="flex-1 min-w-0 text-[16px] font-semibold leading-6 tracking-[-0.01em] text-foreground line-clamp-2">
                  {r.title}
                </h3>
                <StatusChip status={r.status} />
              </div>
              {r.snippet && (
                <p className="mt-1.5 line-clamp-2 text-[14px] leading-5 text-muted-foreground">
                  {r.snippet}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-1 text-[13px] font-medium text-foreground">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">
                    {initials(assigneeLabel(r.assigneeName))}
                  </span>
                  {assigneeLabel(r.assigneeName)}
                </span>
                <span className="text-[14px] font-medium text-muted-foreground">
                  {createdLabel(r.createdAt)}
                </span>
              </div>
            </button>
          ))
        )}
      </section>

      <section className="hidden lg:block">
        {selected ? (
          <EmailDetail
            taskId={selected.id}
            task={selected}
            onBack={() => setSelectedId(null)}
            onDone={() => actions.markDone(selected.id)}
            onDelete={() => actions.remove(selected.id)}
            onCancel={() => actions.cancel(selected.id)}
          />
        ) : (
          <div className="apple-detail flex h-full min-h-[320px] flex-col items-center justify-center gap-3 p-10 text-center">
            <SearchIcon size={32} className="text-muted-foreground/50" />
            <p className="text-[16px] font-medium text-foreground">Select a result to view the task.</p>
          </div>
        )}
      </section>
    </div>
  );
}
