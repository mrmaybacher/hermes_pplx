import type { Express } from "express";
import type { Server } from "node:http";
import { storage } from "./storage";
import { runWatcherOnce, getWatcherStatus, startWatcher } from "./watcher";
import { updateTaskSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Kick off the background watcher (idempotent first-sync inside).
  startWatcher().catch((e) => console.error("startWatcher error", e));

  // ── Overview / status ──
  app.get("/api/status", async (_req, res) => {
    const [tasks, people] = await Promise.all([
      storage.listTasks(),
      storage.listPeople(),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    // "active" = open or in_progress (not done/deleted/cancelled).
    const active = tasks.filter((t) => t.status === "open" || t.status === "in_progress");
    const overdue = active.filter((t) => t.dueDate && t.dueDate < today);
    res.json({
      watcher: getWatcherStatus(),
      counts: {
        openTasks: active.length,
        overdueTasks: overdue.length,
        doneTasks: tasks.filter((t) => t.status === "done").length,
        archivedTasks: tasks.filter((t) => t.status === "deleted" || t.status === "cancelled").length,
        people: people.length,
      },
    });
  });

  // Manual "check now" trigger.
  app.post("/api/watcher/run", async (_req, res) => {
    const result = await runWatcherOnce();
    res.json(result);
  });

  // ── Tasks ──
  app.get("/api/tasks", async (_req, res) => {
    res.json(await storage.listTasks());
  });

  app.patch("/api/tasks/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid update", errors: parsed.error.flatten() });
    }
    const updated = await storage.updateTask(id, parsed.data);
    if (!updated) return res.status(404).json({ message: "Task not found" });
    await storage.logActivity({
      type: "task_updated",
      message: `Task "${updated.title}" → ${parsed.data.status || parsed.data.priority}`,
      entityType: "task",
      entityId: updated.id,
      createdAt: new Date().toISOString(),
    });
    res.json(updated);
  });

  // ── Task detail: task + its source email + linked thread replies ──
  app.get("/api/tasks/:id/detail", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const task = await storage.getTask(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    const sourceEmail = task.sourceEmailId ? await storage.getEmail(task.sourceEmailId) : null;
    const thread = task.conversationId
      ? await storage.listThreadMessages(task.conversationId)
      : [];
    res.json({ task, sourceEmail, thread });
  });

  // ── People (who owes the user) ──
  app.get("/api/people", async (_req, res) => {
    const [people, tasks] = await Promise.all([storage.listPeople(), storage.listTasks()]);
    const today = new Date().toISOString().slice(0, 10);
    const enriched = people.map((p) => {
      const theirs = tasks.filter(
        (t) => t.assigneeEmail === p.email && (t.status === "open" || t.status === "in_progress")
      );
      return {
        ...p,
        openCount: theirs.length,
        overdueCount: theirs.filter((t) => t.dueDate && t.dueDate < today).length,
        tasks: theirs,
      };
    }).sort((a, b) => b.openCount - a.openCount);
    res.json(enriched);
  });

  // ── Contracts (retired) ──
  // Contracts are no longer a separate concept; contract-like emails become
  // tasks. The route stays for backwards compatibility but always returns [].
  app.get("/api/contracts", async (_req, res) => {
    res.json([]);
  });

  // ── Activity ──
  app.get("/api/activity", async (_req, res) => {
    res.json(await storage.listActivity(120));
  });

  // ── Threads for a conversation ──
  app.get("/api/threads/:conversationId", async (req, res) => {
    res.json(await storage.listThreadMessages(req.params.conversationId));
  });

  return httpServer;
}
