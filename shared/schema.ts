import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Emails ─────────────────────────────────────────────
// Raw emails Hermes has ingested. The watcher dedupes on messageId so
// the same email is never processed twice.
export const emails = sqliteTable("emails", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: text("message_id").notNull().unique(), // provider message id (dedup key)
  conversationId: text("conversation_id"),          // Graph conversation/thread id
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  toRecipients: text("to_recipients").notNull().default("[]"), // JSON array of emails
  ccRecipients: text("cc_recipients").notNull().default("[]"), // JSON array of emails
  subject: text("subject").notNull().default(""),
  bodyPreview: text("body_preview").notNull().default(""),
  body: text("body").notNull().default(""),
  receivedAt: text("received_at").notNull(),         // ISO timestamp
  classification: text("classification").notNull().default("other"), // task | contract | reply | other
  processed: integer("processed", { mode: "boolean" }).notNull().default(false),
  ingestedAt: text("ingested_at").notNull(),
});

// ── People ─────────────────────────────────────────────
// Anyone who owes the user something. Derived from task assignees.
export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

// ── Tasks ──────────────────────────────────────────────
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  assigneeName: text("assignee_name"),
  assigneeEmail: text("assignee_email"),
  dueDate: text("due_date"),                          // ISO date or null
  priority: text("priority").notNull().default("medium"), // high | medium | low
  status: text("status").notNull().default("open"),       // open | in_progress | done | deleted | cancelled
  sourceEmailId: integer("source_email_id"),          // FK -> emails.id
  conversationId: text("conversation_id"),            // links replies to this task
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── Contracts ──────────────────────────────────────────
export const contracts = sqliteTable("contracts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  counterparty: text("counterparty"),
  counterpartyEmail: text("counterparty_email"),
  status: text("status").notNull().default("awaiting_signature"), // awaiting_signature | signed | expired
  attachmentName: text("attachment_name"),
  sourceEmailId: integer("source_email_id"),
  conversationId: text("conversation_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── Threads ────────────────────────────────────────────
// Reply messages linked to a task or contract via conversationId.
export const threadMessages = sqliteTable("thread_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: text("conversation_id").notNull(),
  emailId: integer("email_id"),
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  snippet: text("snippet").notNull().default(""),
  receivedAt: text("received_at").notNull(),
});

// ── Activity log ───────────────────────────────────────
export const activity = sqliteTable("activity", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),    // email_ingested | task_created | contract_created | reply_linked | task_updated | watcher_run
  message: text("message").notNull(),
  entityType: text("entity_type"), // task | contract | email | system
  entityId: integer("entity_id"),
  createdAt: text("created_at").notNull(),
});

// ── Insert schemas / types ─────────────────────────────
export const insertEmailSchema = createInsertSchema(emails).omit({ id: true });
export const insertPersonSchema = createInsertSchema(people).omit({ id: true });
export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true });
export const insertContractSchema = createInsertSchema(contracts).omit({ id: true });
export const insertThreadMessageSchema = createInsertSchema(threadMessages).omit({ id: true });
export const insertActivitySchema = createInsertSchema(activity).omit({ id: true });

export type Email = typeof emails.$inferSelect;
export type InsertEmail = z.infer<typeof insertEmailSchema>;
export type Person = typeof people.$inferSelect;
export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Contract = typeof contracts.$inferSelect;
export type InsertContract = z.infer<typeof insertContractSchema>;
export type ThreadMessage = typeof threadMessages.$inferSelect;
export type InsertThreadMessage = z.infer<typeof insertThreadMessageSchema>;
export type Activity = typeof activity.$inferSelect;
export type InsertActivity = z.infer<typeof insertActivitySchema>;

// Patch schema for task updates from the dashboard
export const updateTaskSchema = z.object({
  status: z.enum(["open", "in_progress", "done", "deleted", "cancelled"]).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
});
export type UpdateTask = z.infer<typeof updateTaskSchema>;
