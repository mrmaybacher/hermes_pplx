import { storage } from "./storage";
import type { Task } from "@shared/schema";
import type { ThreadSegment } from "./emailSource";

export interface ParsedChecklistItem {
  text: string;
  textNorm: string;
  position: number;
}

const ITEM_MARKER = /^\s*(?:\d+\s*[.)\-:]\s+|[-*•]\s+)/;

export function normalizeChecklistText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function parseChecklistItems(bodyText: string): ParsedChecklistItem[] {
  const parsed = (bodyText || "")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!ITEM_MARKER.test(trimmed)) return null;
      const text = trimmed.replace(ITEM_MARKER, "").replace(/\s+/g, " ").trim();
      if (!text) return null;
      return { text, textNorm: normalizeChecklistText(text) };
    })
    .filter((item): item is { text: string; textNorm: string } => Boolean(item));

  if (parsed.length < 2) return [];
  return parsed.map((item, position) => ({ ...item, position }));
}

function topBodyForTask(task: Task, sourceEmail: { body?: string | null; bodyPreview?: string | null; threadJson?: string | null } | null | undefined): string {
  if (!sourceEmail) return task.description || "";
  if (sourceEmail.threadJson) {
    try {
      const parsed = JSON.parse(sourceEmail.threadJson) as ThreadSegment[];
      if (Array.isArray(parsed) && parsed[0]?.text?.trim()) return parsed[0].text;
    } catch {
      // Fall through to body/bodyPreview.
    }
  }
  return (sourceEmail.body || "").trim() || (sourceEmail.bodyPreview || "").trim() || task.description || "";
}

export async function syncChecklistForTask(taskId: number): Promise<{ itemCount: number }> {
  try {
    const task = await storage.getTask(taskId);
    if (!task) return { itemCount: 0 };
    if (task.status !== "open" && task.status !== "in_progress") return { itemCount: 0 };

    const sourceEmail = task.sourceEmailId ? await storage.getEmail(task.sourceEmailId) : null;
    const items = parseChecklistItems(topBodyForTask(task, sourceEmail));
    if (items.length < 2) return { itemCount: 0 };

    const synced = await storage.upsertTaskItems(taskId, items);
    return { itemCount: synced.length };
  } catch (error) {
    console.error(`[checklist] sync failed for task ${taskId}:`, error);
    return { itemCount: 0 };
  }
}

export async function syncOpenTaskChecklists(): Promise<{ ok: true; scanned: number; withChecklist: number }> {
  const tasks = (await storage.listTasks()).filter((task) => task.status === "open" || task.status === "in_progress");
  let withChecklist = 0;
  for (const task of tasks) {
    const result = await syncChecklistForTask(task.id);
    if (result.itemCount >= 2) withChecklist++;
  }
  return { ok: true, scanned: tasks.length, withChecklist };
}
