import { storage } from "./storage";
import type { Email, Task } from "@shared/schema";
import { htmlToText, resolveBody, splitThread } from "./emailSource";
import type { ThreadSegment } from "./emailSource";

export interface ParsedChecklistItem {
  text: string;
  textNorm: string;
  position: number;
}

const INLINE_ITEM_MARKER = /^\s*(?:\d+\s*[.)\-:]\s+|[-*•]\s+)/;
const NUMBERED_OWN_LINE_MARKER = /^\s*(\d+)\s*([.)\-:]?)\s*$/;
const BULLET_OWN_LINE_MARKER = /^\s*[-*•]\s*$/;

export function normalizeChecklistText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function isOwnLineMarker(line: string): boolean {
  if (BULLET_OWN_LINE_MARKER.test(line)) return true;

  const match = line.match(NUMBERED_OWN_LINE_MARKER);
  if (!match) return false;

  const [, digits, punctuation] = match;
  if (punctuation) return true;

  const value = Number.parseInt(digits, 10);
  return Number.isInteger(value) && value > 0 && value < 100;
}

function isAnyMarkerLine(line: string): boolean {
  return INLINE_ITEM_MARKER.test(line) || isOwnLineMarker(line);
}

function normalizeParsedItemText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function parseChecklistItems(bodyText: string): ParsedChecklistItem[] {
  const parsed: { text: string; textNorm: string }[] = [];
  const lines = (bodyText || "").split("\n");

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (!trimmed) continue;

    if (INLINE_ITEM_MARKER.test(trimmed)) {
      const text = normalizeParsedItemText(trimmed.replace(INLINE_ITEM_MARKER, ""));
      if (text) parsed.push({ text, textNorm: normalizeChecklistText(text) });
      continue;
    }

    if (!isOwnLineMarker(trimmed)) continue;

    const textLines: string[] = [];
    let lookahead = index + 1;

    while (lookahead < lines.length && !lines[lookahead].trim()) lookahead++;

    while (lookahead < lines.length) {
      const candidate = lines[lookahead].trim();
      if (!candidate || isAnyMarkerLine(candidate)) break;
      textLines.push(candidate);
      lookahead++;
    }

    const text = normalizeParsedItemText(textLines.join(" "));
    if (text) parsed.push({ text, textNorm: normalizeChecklistText(text) });
    index = Math.max(index, lookahead - 1);
  }

  return parsed.map((item, position) => ({ ...item, position }));
}

function parseThreadJson(threadJson: string | null | undefined): ThreadSegment[] {
  if (!threadJson) return [];
  try {
    const parsed = JSON.parse(threadJson) as ThreadSegment[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((segment) => typeof segment?.text === "string" && segment.text.trim());
  } catch {
    return [];
  }
}

function dateKey(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanBodyText(body: string | null | undefined, fallback: string | null | undefined = ""): string {
  const cleaned = htmlToText((body || "").trim());
  return (resolveBody(cleaned) || cleaned || (fallback || "").trim()).trim();
}

interface ChecklistBody {
  text: string;
  chronology: number;
  fallbackOrder: number;
}

function bodiesForEmail(email: Email, fallbackOrder: number): ChecklistBody[] {
  const baseChronology = dateKey(email.receivedAt) ?? fallbackOrder;
  const storedSegments = parseThreadJson(email.threadJson);
  const bodyText = cleanBodyText(email.body, email.bodyPreview);
  const segments = storedSegments.length ? storedSegments : splitThread(bodyText);

  if (segments.length > 0) {
    return segments
      .map((segment, index) => ({
        text: segment.text.trim(),
        chronology: dateKey(segment.sent) ?? (index === 0 ? baseChronology : baseChronology + index + 1),
        fallbackOrder: fallbackOrder * 1000 + index,
      }))
      .filter((body) => body.text);
  }

  const text = bodyText || (email.bodyPreview || "").trim();
  return text ? [{ text, chronology: baseChronology, fallbackOrder: fallbackOrder * 1000 }] : [];
}

async function gatherChecklistBodies(task: Task, sourceEmail: Email | null | undefined): Promise<ChecklistBody[]> {
  const conversationId = sourceEmail?.conversationId || task.conversationId;
  const threadEmails = conversationId
    ? (await storage.listEmails()).filter((email) => email.conversationId === conversationId)
    : sourceEmail ? [sourceEmail] : [];

  const emails = (threadEmails.length ? threadEmails : sourceEmail ? [sourceEmail] : [])
    .sort((a, b) => {
      const aTime = dateKey(a.receivedAt) ?? 0;
      const bTime = dateKey(b.receivedAt) ?? 0;
      if (aTime !== bTime) return aTime - bTime;
      return a.id - b.id;
    });

  const bodies = emails.flatMap((email, index) => bodiesForEmail(email, index));
  if (bodies.length > 0) return bodies.sort((a, b) => a.chronology - b.chronology || a.fallbackOrder - b.fallbackOrder);

  const description = (task.description || "").trim();
  return description ? [{ text: description, chronology: 0, fallbackOrder: 0 }] : [];
}

function mergeChecklistItems(bodies: ChecklistBody[]): ParsedChecklistItem[] {
  const merged: ParsedChecklistItem[] = [];
  const seen = new Set<string>();

  for (const body of bodies) {
    for (const item of parseChecklistItems(body.text)) {
      if (seen.has(item.textNorm)) continue;
      seen.add(item.textNorm);
      merged.push({ ...item, position: merged.length });
    }
  }

  return merged;
}

export async function syncChecklistForTask(taskId: number): Promise<{ itemCount: number }> {
  try {
    const task = await storage.getTask(taskId);
    if (!task) return { itemCount: 0 };
    if (task.status !== "open" && task.status !== "in_progress") return { itemCount: 0 };

    const sourceEmail = task.sourceEmailId ? await storage.getEmail(task.sourceEmailId) : null;
    const items = mergeChecklistItems(await gatherChecklistBodies(task, sourceEmail));
    if (items.length < 2) return { itemCount: 0 };

    await storage.upsertTaskItems(taskId, items);
    return { itemCount: items.length };
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
