import type { Task, Contract, Activity } from "@shared/schema";

export type { Task, Contract, Activity };

export interface StatusResponse {
  watcher: { source: string; lastRunAt: string | null; intervalMinutes: number };
  counts: { openTasks: number; overdueTasks: number; awaitingSignature: number; people: number };
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
  subject: string;
  body: string;
  bodyPreview: string;
  receivedAt: string;
  classification: string;
}

export interface ThreadMsg {
  id: number;
  fromName: string;
  summary: string | null;
  receivedAt: string;
}

export interface TaskDetail {
  task: Task;
  sourceEmail: EmailRow | null;
  thread: ThreadMsg[];
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isOverdue(dueDate: string | null, status: string): boolean {
  return !!dueDate && status !== "done" && dueDate < todayStr();
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

export function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
