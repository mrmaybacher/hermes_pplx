import type { Express } from "express";
import type { Server } from "node:http";
import { storage } from "./storage";
import { runWatcherOnce, getWatcherStatus, startWatcher } from "./watcher";
import { updateTaskSchema } from "@shared/schema";
import { z } from "zod";
import type { Person, Task } from "@shared/schema";
import { buildPersonDigestHtml, GraphMailError, sendGraphMail } from "./sendMail";
import { syncOpenTaskChecklists } from "./checklist";

const updateTaskItemSchema = z.object({ done: z.boolean() });

type PersonWithOpenTasks = Person & {
  openCount: number;
  overdueCount: number;
  tasks: Task[];
};

async function listPeopleWithOpenTasks(): Promise<PersonWithOpenTasks[]> {
  const [people, tasks] = await Promise.all([storage.listPeople(), storage.listTasks()]);
  const today = new Date().toISOString().slice(0, 10);
  return people.map((p) => {
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
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function findDigestPerson(people: PersonWithOpenTasks[], body: unknown): PersonWithOpenTasks | undefined {
  if (!body || typeof body !== "object") return undefined;
  const input = body as { personId?: unknown; personName?: unknown; personEmail?: unknown };
  if (typeof input.personId === "number" && Number.isFinite(input.personId)) {
    return people.find((p) => p.id === input.personId);
  }
  if (typeof input.personId === "string" && input.personId.trim()) {
    const id = Number(input.personId);
    if (Number.isFinite(id)) return people.find((p) => p.id === id);
  }
  const email = normalize(input.personEmail);
  if (email) return people.find((p) => p.email.toLowerCase() === email);
  const name = normalize(input.personName);
  if (name) return people.find((p) => p.name.toLowerCase() === name);
  return undefined;
}

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

  // Admin re-process: re-fetch + re-extract stored emails and refresh their
  // tasks in place. Idempotent and non-destructive.
  app.post("/api/admin/reprocess", async (_req, res) => {
    const { reprocessAll } = await import("./reprocess");
    const result = await reprocessAll();
    res.json(result);
  });

  // Admin checklist backfill: parse active Inbox tasks only. Idempotent and additive.
  app.post("/api/admin/sync-checklists", async (_req, res) => {
    const result = await syncOpenTaskChecklists();
    res.json(result);
  });

  // Admin/test trigger: send one person's open-task digest via Microsoft Graph.
  app.post("/api/admin/send-digest", async (req, res) => {
    try {
      const people = await listPeopleWithOpenTasks();
      const person = findDigestPerson(people, req.body);
      if (!person) {
        return res.status(404).json({
          ok: false,
          error: "Person not found. Provide personId, personName, or personEmail.",
        });
      }
      if (person.tasks.length === 0) {
        return res.status(400).json({
          ok: false,
          error: `No open tasks found for ${person.name}.`,
        });
      }

      const body = (req.body && typeof req.body === "object") ? req.body as { to?: unknown } : {};
      const to = typeof body.to === "string" && body.to.trim() ? body.to.trim() : person.email;
      const { subject, html, taskCount } = buildPersonDigestHtml(person);
      await sendGraphMail({ to, subject, html });
      res.json({ ok: true, to, personName: person.name, taskCount, subject });
    } catch (error) {
      if (error instanceof GraphMailError) {
        return res.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({
          ok: false,
          error: error.message,
          graphStatus: error.status,
          graphResponse: error.responseText,
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: message });
    }
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

  // ── Task detail: task + its source email + parsed chain + linked replies ──
  app.get("/api/tasks/:id/detail", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const task = await storage.getTask(id);
    if (!task) return res.status(404).json({ message: "Task not found" });
    const sourceEmail = task.sourceEmailId ? await storage.getEmail(task.sourceEmailId) : null;
    const thread = task.conversationId
      ? await storage.listThreadMessages(task.conversationId)
      : [];
    // Parsed in-body chain segments (3a). Defensive JSON parse → [].
    let threadSegments: unknown[] = [];
    if (sourceEmail?.threadJson) {
      try {
        const parsed = JSON.parse(sourceEmail.threadJson);
        if (Array.isArray(parsed)) threadSegments = parsed;
      } catch { /* ignore malformed JSON */ }
    }
    const items = (await storage.listTaskItems(id)).map((item) => ({
      id: item.id,
      position: item.position,
      text: item.text,
      done: item.done,
    }));
    res.json({ task, sourceEmail, thread, threadSegments, items });
  });

  app.patch("/api/tasks/:id/items/:itemId", async (req, res) => {
    const taskId = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);
    const parsed = updateTaskItemSchema.safeParse(req.body);
    if (!Number.isFinite(taskId) || !Number.isFinite(itemId)) {
      return res.status(400).json({ message: "Invalid task or item id" });
    }
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid update", errors: parsed.error.flatten() });
    }
    const updated = await storage.updateTaskItem(taskId, itemId, parsed.data.done);
    if (!updated) return res.status(404).json({ message: "Checklist item not found" });
    res.json({ id: updated.id, position: updated.position, text: updated.text, done: updated.done });
  });

  // ── Search across ALL tasks (any status) ──
  app.get("/api/search", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json(await storage.searchTasks(q));
  });

  // ── People (who owes the user) ──
  app.get("/api/people", async (_req, res) => {
    res.json(await listPeopleWithOpenTasks());
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
