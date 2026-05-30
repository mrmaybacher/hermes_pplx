import type { Person, Task } from "@shared/schema";
import { getGraphToken, graphMailbox } from "./emailSource";

export interface SendGraphMailInput {
  to: string;
  subject: string;
  html: string;
}

export class GraphMailError extends Error {
  status: number;
  responseText: string;

  constructor(status: number, responseText: string) {
    super(`Graph sendMail error ${status}: ${responseText}`);
    this.name = "GraphMailError";
    this.status = status;
    this.responseText = responseText;
  }
}

function requireGraphMailbox(): string {
  const mailbox = (graphMailbox || "").trim();
  if (!mailbox) {
    throw new Error("GRAPH_MAILBOX is required to send mail via Microsoft Graph");
  }
  return mailbox;
}

export async function sendGraphMail({ to, subject, html }: SendGraphMailInput): Promise<{ ok: true }> {
  const recipient = (to || "").trim();
  if (!recipient) throw new Error("Recipient email address is required");

  const token = await getGraphToken();
  const mailbox = requireGraphMailbox();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body: {
          contentType: "HTML",
          content: html,
        },
        toRecipients: [
          {
            emailAddress: {
              address: recipient,
            },
          },
        ],
      },
      saveToSentItems: true,
    }),
  });

  if (res.status === 202) return { ok: true };
  if (!res.ok) throw new GraphMailError(res.status, await res.text());
  return { ok: true };
}

export interface PersonDigestInput extends Person {
  tasks: Task[];
}

export interface PersonDigestResult {
  subject: string;
  html: string;
  taskCount: number;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateText(value: string, max = 700): string {
  const flat = value.replace(/\r\n/g, "\n").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function firstName(name: string): string {
  return (name || "there").trim().split(/\s+/)[0] || "there";
}

function renderDescription(description: string): string {
  const text = truncateText(description || "");
  if (!text) return "";
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  const body = lines.map((line) => escapeHtml(line)).join("<br>");
  return `<div style="margin-top:8px;color:#334155;font-size:14px;line-height:1.5;">${body}</div>`;
}

export function buildPersonDigestHtml(person: PersonDigestInput): PersonDigestResult {
  const openTasks = person.tasks.filter((task) => task.status === "open" || task.status === "in_progress");
  const today = formatDate(new Date().toISOString().slice(0, 10));
  const subject = `Your ${openTasks.length} open task${openTasks.length === 1 ? "" : "s"} — ${today}`;
  const items = openTasks.map((task) => {
    const due = task.dueDate
      ? `<div style="margin-top:4px;color:#475569;font-size:13px;"><strong>Due:</strong> ${escapeHtml(formatDate(task.dueDate))}</div>`
      : "";
    return `
      <li style="margin:0 0 18px 0;padding-left:4px;">
        <div style="font-size:15px;line-height:1.45;color:#0f172a;"><strong>${escapeHtml(task.title)}</strong></div>
        ${due}
        ${renderDescription(task.description)}
      </li>`;
  }).join("");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="max-width:680px;margin:0 auto;padding:28px 18px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;">
        <p style="margin:0 0 14px 0;font-size:16px;line-height:1.5;">Hi ${escapeHtml(firstName(person.name))},</p>
        <p style="margin:0 0 22px 0;font-size:15px;line-height:1.5;color:#334155;">Here are your open tasks tracked by Hermes:</p>
        <ol style="margin:0 0 24px 22px;padding:0;">
          ${items}
        </ol>
        <div style="border-top:1px solid #e2e8f0;padding-top:14px;margin-top:8px;color:#64748b;font-size:12px;line-height:1.5;">
          Sent automatically by Hermes — reply to this email to update Grigore.
        </div>
      </div>
    </div>
  </body>
</html>`;

  return { subject, html, taskCount: openTasks.length };
}
