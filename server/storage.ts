import {
  emails, people, tasks, contracts, threadMessages, activity,
} from "@shared/schema";
import type {
  Email, InsertEmail, Person, InsertPerson, Task, InsertTask,
  Contract, InsertContract, ThreadMessage, InsertThreadMessage,
  Activity, InsertActivity,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";

// DB location is configurable so Docker can point it at a persistent volume
// (HERMES_DB_PATH=/app/data/data.db). Defaults to ./data.db for local/dev.
const DB_PATH = process.env.HERMES_DB_PATH || "data.db";
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

// Create tables if they don't exist (no migration tooling at runtime).
sqlite.exec(`
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT,
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  to_recipients TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  body_preview TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'other',
  processed INTEGER NOT NULL DEFAULT 0,
  ingested_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee_name TEXT,
  assignee_email TEXT,
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  source_email_id INTEGER,
  conversation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  counterparty TEXT,
  counterparty_email TEXT,
  status TEXT NOT NULL DEFAULT 'awaiting_signature',
  attachment_name TEXT,
  source_email_id INTEGER,
  conversation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  email_id INTEGER,
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  created_at TEXT NOT NULL
);
`);

export const db = drizzle(sqlite);

export interface IStorage {
  // emails
  getEmailByMessageId(messageId: string): Promise<Email | undefined>;
  createEmail(email: InsertEmail): Promise<Email>;
  listEmails(): Promise<Email[]>;
  getEmail(id: number): Promise<Email | undefined>;
  // people
  getPersonByEmail(email: string): Promise<Person | undefined>;
  upsertPerson(person: InsertPerson): Promise<Person>;
  listPeople(): Promise<Person[]>;
  // tasks
  createTask(task: InsertTask): Promise<Task>;
  listTasks(): Promise<Task[]>;
  getTask(id: number): Promise<Task | undefined>;
  updateTask(id: number, patch: Partial<Task>): Promise<Task | undefined>;
  findTaskByConversation(conversationId: string): Promise<Task | undefined>;
  // contracts
  createContract(c: InsertContract): Promise<Contract>;
  listContracts(): Promise<Contract[]>;
  findContractByConversation(conversationId: string): Promise<Contract | undefined>;
  // threads
  createThreadMessage(m: InsertThreadMessage): Promise<ThreadMessage>;
  listThreadMessages(conversationId: string): Promise<ThreadMessage[]>;
  // activity
  logActivity(a: InsertActivity): Promise<Activity>;
  listActivity(limit?: number): Promise<Activity[]>;
}

const now = () => new Date().toISOString();

export class DatabaseStorage implements IStorage {
  async getEmailByMessageId(messageId: string) {
    return db.select().from(emails).where(eq(emails.messageId, messageId)).get();
  }
  async createEmail(email: InsertEmail) {
    return db.insert(emails).values(email).returning().get();
  }
  async listEmails() {
    return db.select().from(emails).orderBy(desc(emails.receivedAt)).all();
  }
  async getEmail(id: number) {
    return db.select().from(emails).where(eq(emails.id, id)).get();
  }

  async getPersonByEmail(email: string) {
    return db.select().from(people).where(eq(people.email, email)).get();
  }
  async upsertPerson(person: InsertPerson) {
    const existing = await this.getPersonByEmail(person.email);
    if (existing) return existing;
    return db.insert(people).values(person).returning().get();
  }
  async listPeople() {
    return db.select().from(people).all();
  }

  async createTask(task: InsertTask) {
    return db.insert(tasks).values(task).returning().get();
  }
  async listTasks() {
    return db.select().from(tasks).orderBy(desc(tasks.createdAt)).all();
  }
  async getTask(id: number) {
    return db.select().from(tasks).where(eq(tasks.id, id)).get();
  }
  async updateTask(id: number, patch: Partial<Task>) {
    return db.update(tasks).set({ ...patch, updatedAt: now() }).where(eq(tasks.id, id)).returning().get();
  }
  async findTaskByConversation(conversationId: string) {
    if (!conversationId) return undefined;
    return db.select().from(tasks).where(eq(tasks.conversationId, conversationId)).get();
  }

  async createContract(c: InsertContract) {
    return db.insert(contracts).values(c).returning().get();
  }
  async listContracts() {
    return db.select().from(contracts).orderBy(desc(contracts.createdAt)).all();
  }
  async findContractByConversation(conversationId: string) {
    if (!conversationId) return undefined;
    return db.select().from(contracts).where(eq(contracts.conversationId, conversationId)).get();
  }

  async createThreadMessage(m: InsertThreadMessage) {
    return db.insert(threadMessages).values(m).returning().get();
  }
  async listThreadMessages(conversationId: string) {
    return db.select().from(threadMessages).where(eq(threadMessages.conversationId, conversationId)).orderBy(threadMessages.receivedAt).all();
  }

  async logActivity(a: InsertActivity) {
    return db.insert(activity).values(a).returning().get();
  }
  async listActivity(limit = 100) {
    return db.select().from(activity).orderBy(desc(activity.createdAt)).limit(limit).all();
  }
}

export const storage = new DatabaseStorage();
