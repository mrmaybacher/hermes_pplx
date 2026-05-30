import type { Task, Activity } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

export type { Task, Activity };

// Result of the admin re-process action.
export interface ReprocessResult {
  scanned: number;
  updated: number;
  skipped: number;
}

export const api = {
  // POST /api/admin/reprocess — re-fetch + re-extract stored emails in place.
  async reprocess(): Promise<ReprocessResult> {
    const res = await apiRequest("POST", "/api/admin/reprocess");
    return res.json();
  },
};

export type TaskStatus = "open" | "in_progress" | "done" | "deleted" | "cancelled";

export interface StatusResponse {
  watcher: { source: string; lastRunAt: string | null; intervalMinutes: number; activeWindow?: string };
  counts: {
    openTasks: number;
    overdueTasks: number;
    doneTasks: number;
    archivedTasks: number;
    people: number;
  };
}

export interface PersonRow {
  id: number;
  name: string;
  email: string;
  openCount: number;
  overdueCount: number;
  tasks: Task[];
}

export interface EmailRow {
  id: number;
  fromName: string;
  fromEmail: string;
  toRecipients: string; // JSON array string
  ccRecipients: string; // JSON array string
  subject: string;
  body: string;
  bodyPreview: string;
  receivedAt: string;
  classification: string;
  threadJson?: string | null; // JSON array of ThreadSegment, or null
}

export interface ThreadMsg {
  id: number;
  fromName: string;
  summary: string | null;
  receivedAt: string;
}

// A single message parsed out of a forwarded chain (server splitThread).
export interface ThreadSegment {
  from: string | null;
  sent: string | null;
  to: string | null;
  subject: string | null;
  text: string;
}

export interface TaskDetail {
  task: Task;
  sourceEmail: EmailRow | null;
  thread: ThreadMsg[];
  threadSegments?: ThreadSegment[];
}

// A task matched by the cross-status search, with a matched excerpt.
export interface SearchResult extends Task {
  snippet: string;
  sourceSubject: string | null;
}

// Placeholder the UI uses to detect "no extractable body".
export const EMPTY_BODY = "";

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// "active" task = open or in_progress (not done/deleted/cancelled).
export function isActive(status: string): boolean {
  return status === "open" || status === "in_progress";
}

export function isOverdue(dueDate: string | null, status: string): boolean {
  return !!dueDate && isActive(status) && dueDate < todayStr();
}

export function dueLabel(dueDate: string | null): string {
  if (!dueDate) return "No deadline";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  const fmt = due.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  if (days < 0) return `${fmt} · ${Math.abs(days)}d overdue`;
  if (days === 0) return `${fmt} · today`;
  if (days === 1) return `${fmt} · tomorrow`;
  return `${fmt} · in ${days}d`;
}

// Readable created-date: "Today, 10:42" / "Yesterday" / "12 Mar 2026".
export function createdLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function fullDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function assigneeLabel(name: string | null): string {
  return name && name.trim() ? name : "You";
}

export function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export function parseRecipients(json: string | undefined | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
