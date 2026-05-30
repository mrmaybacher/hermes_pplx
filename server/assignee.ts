// Assignee inference, shared by the ingestion watcher and the reprocess path.
// Moved out of watcher.ts so reprocess can reuse the exact same logic without a
// circular import. Behavior is identical to the original watcher helpers.
import type { RawEmail } from "./emailSource";

export const HERMES_ADDRESS = (process.env.GRAPH_MAILBOX || "hermes@angelsestate.bg").toLowerCase();
export const OWNER_ADDRESS = "g.meriacre@angelsestate.bg"; // the business owner ("You")

// Turn an email local-part into a display name, e.g.
// "petar.georgiev@angelsestate.bg" → "Petar Georgiev".
export function displayNameFromEmail(addr: string): string {
  const local = addr.split("@")[0] || addr;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || addr;
}

// Infer the assignee from the recipients when GPT left it blank. Hermes and the
// owner are excluded from being picked when other recipients exist; preference
// is the first non-Hermes/non-owner To, then CC, else the owner ("You").
export function inferAssignee(raw: RawEmail): { name: string | null; email: string | null } {
  const excluded = new Set([HERMES_ADDRESS, OWNER_ADDRESS]);
  const pick = (list: string[]) =>
    list.map((e) => e.trim()).filter((e) => e && !excluded.has(e.toLowerCase()))[0];
  const chosen = pick(raw.toRecipients) || pick(raw.ccRecipients);
  if (chosen) return { name: displayNameFromEmail(chosen), email: chosen.toLowerCase() };
  return { name: null, email: null }; // falls back to owner ("You") in the UI
}
