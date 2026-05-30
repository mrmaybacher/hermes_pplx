import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Task, TaskStatus } from "@/lib/api";

const TASK_KEYS = ["/api/tasks", "/api/status", "/api/people", "/api/activity"];

// Optimistic Done / Delete / Cancel. The row is removed from its current list
// immediately by writing the new status into the cached /api/tasks array; on
// error we roll back to the snapshot and surface a toast.
export function useTaskActions() {
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TaskStatus }) =>
      apiRequest("PATCH", `/api/tasks/${id}`, { status }),

    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/tasks"] });
      const previous = queryClient.getQueryData<Task[]>(["/api/tasks"]);
      queryClient.setQueryData<Task[]>(["/api/tasks"], (old) =>
        (old ?? []).map((t) => (t.id === id ? { ...t, status } : t)),
      );
      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["/api/tasks"], ctx.previous);
      toast({
        title: "Something went wrong",
        description: "We couldn't update that task. Please try again.",
        variant: "destructive",
      });
    },

    onSuccess: (_data, vars) => {
      const labels: Record<TaskStatus, string> = {
        done: "Task marked done.",
        deleted: "Task deleted.",
        cancelled: "Task cancelled.",
        open: "Task moved to Inbox.",
        in_progress: "Task updated.",
      };
      toast({ title: labels[vars.status] ?? "Task updated." });
    },

    onSettled: () => {
      TASK_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    },
  });

  return {
    isPending: mutation.isPending,
    markDone: (id: number) => mutation.mutate({ id, status: "done" }),
    remove: (id: number) => mutation.mutate({ id, status: "deleted" }),
    cancel: (id: number) => mutation.mutate({ id, status: "cancelled" }),
    restore: (id: number) => mutation.mutate({ id, status: "open" }),
  };
}
