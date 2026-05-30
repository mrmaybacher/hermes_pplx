// GPT extraction layer.
// Classifies an email and pulls out structured task/contract data.
// Uses the OpenAI Responses API via the website LLM proxy.
import OpenAI from "openai";
import type { RawEmail } from "./emailSource";

// Client configuration.
//
//  • In the Perplexity dev sandbox, leave OPENAI_API_KEY / OPENAI_BASE_URL
//    unset — the SDK is auto-wired to the platform LLM proxy and the model
//    alias "gpt_5_4" resolves there.
//
//  • When you SELF-HOST, set your own OpenAI key and use a real model name:
//        OPENAI_API_KEY=sk-...your key...
//        HERMES_MODEL=gpt-4o            (or gpt-4o-mini, gpt-4.1, etc.)
//    Optionally point at Azure OpenAI or any OpenAI-compatible gateway with
//        OPENAI_BASE_URL=https://your-endpoint/v1
//
// The SDK reads OPENAI_API_KEY and OPENAI_BASE_URL from the environment
// automatically; we pass baseURL explicitly only when provided so the dev
// proxy default is preserved.
const MODEL = process.env.HERMES_MODEL || "gpt_5_4";

// Lazily construct the OpenAI client. Constructing it eagerly throws when no
// API key is present (e.g. the published pplx.app sandbox, which has no LLM
// proxy), which would crash the whole server on boot. Building it on first use
// lets the app start cleanly and gracefully fall back to the keyword heuristic
// when GPT is unavailable.
let _client: OpenAI | null = null;
let _clientTried = false;
function getClient(): OpenAI | null {
  if (_clientTried) return _client;
  _clientTried = true;
  try {
    // Three supported wiring modes, checked in priority order:
    //
    // 1. Perplexity custom-credential pass-through proxy. When the app is run
    //    in the Perplexity sandbox with api_credentials=["custom-cred:api.openai.com"],
    //    the proxy injects CUSTOM_CRED_API_OPENAI_COM_URL (a pass-through
    //    endpoint) and CUSTOM_CRED_API_OPENAI_COM_TOKEN (a short-lived proxy
    //    token). We point the SDK at that URL and send the proxy token as the
    //    key; the proxy swaps in the user's real OpenAI key server-side.
    //
    // 2. Self-host: OPENAI_API_KEY (+ optional OPENAI_BASE_URL) set directly.
    //
    // 3. Dev LLM proxy: nothing set, SDK auto-wired to the platform proxy.
    const ccUrl = process.env.CUSTOM_CRED_API_OPENAI_COM_URL;
    const ccToken = process.env.CUSTOM_CRED_API_OPENAI_COM_TOKEN;
    if (ccUrl && ccToken) {
      // The pass-through proxy forwards to the real OpenAI API; the SDK appends
      // "/responses", so the baseURL must end in "/v1" to hit "/v1/responses".
      const base = ccUrl.replace(/\/$/, "") + "/v1";
      _client = new OpenAI({ baseURL: base, apiKey: ccToken });
    } else {
      _client = new OpenAI(
        process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}
      );
    }
  } catch (err) {
    console.warn("[extract] OpenAI client unavailable — using keyword fallback:", (err as Error).message);
    _client = null;
  }
  return _client;
}

export interface Extraction {
  classification: "task" | "contract" | "reply" | "other";
  task?: {
    title: string;
    description: string;
    assigneeName: string | null;
    assigneeEmail: string | null;
    dueDate: string | null; // ISO date YYYY-MM-DD
    priority: "high" | "medium" | "low";
  };
  contract?: {
    title: string;
    counterparty: string | null;
    counterpartyEmail: string | null;
  };
  replySummary?: string; // short summary if this is a reply
}

const SYSTEM = `You are Hermes, an email-to-task engine for a real-estate and product entrepreneur.
You read one inbound email and decide what action it represents. Reply ONLY with strict JSON matching the schema.

Classification rules:
- "task": the email asks the owner (or someone) to DO something — produce a report, schedule, follow up, prepare numbers, arrange a viewing, etc.
- "contract": the email concerns a document needing review/signature (lease, NDA, agreement), usually with an attachment.
- "reply": the email is a response within an existing thread (subject starts with RE:/FW: or clearly continues a conversation), confirming or updating prior work.
- "other": newsletters, receipts, noise.

Extraction rules:
- assigneeName/assigneeEmail: who must do the task. If the email names a person ("ask Petar", "can Elena prepare"), use them. If it's clearly directed at the owner with no other name, leave assignee null.
- dueDate: resolve relative dates ("by Friday", "next week") to an absolute YYYY-MM-DD using the provided "Today" date. If none stated, null.
- priority: "high" if the email signals urgency/closing/deadline-critical, else "medium", "low" for FYI.
- For contracts, counterparty = the other party/company, counterpartyEmail = sender email.
- For replies, replySummary = one concise sentence on what changed/was confirmed.`;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    classification: { type: "string", enum: ["task", "contract", "reply", "other"] },
    task: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        assigneeName: { type: ["string", "null"] },
        assigneeEmail: { type: ["string", "null"] },
        dueDate: { type: ["string", "null"] },
        priority: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["title", "description", "assigneeName", "assigneeEmail", "dueDate", "priority"],
    },
    contract: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        counterparty: { type: ["string", "null"] },
        counterpartyEmail: { type: ["string", "null"] },
      },
      required: ["title", "counterparty", "counterpartyEmail"],
    },
    replySummary: { type: ["string", "null"] },
  },
  required: ["classification", "task", "contract", "replySummary"],
};

// Pre-computed GPT-4o extractions for the built-in demo feed (server/emailSource
// MOCK_FEED). Captured during development so that environments without live GPT
// (the published demo sandbox) still render full-quality results. Due dates are
// expressed as offsets from "today" so the demo never looks stale.
function dueInDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
const DEMO_EXTRACTIONS: Record<string, () => Extraction> = {
  // mock-001 — Maria CC's Hermes asking for the roof inspection report.
  "mock-001": () => ({
    classification: "task",
    task: {
      title: "Provide roof inspection report for Lozenets apartment",
      description:
        "Ensure Petar from the engineering team sends the roof inspection report for the Lozenets apartment to Maria Dimitrova.",
      assigneeName: "Petar",
      assigneeEmail: "petar@team",
      dueDate: dueInDays(6),
      priority: "high",
    },
  }),
  // mock-002 — Owner forwards the Vitosha lease for signature → contract.
  "mock-002": () => ({
    classification: "contract",
    contract: {
      title: "Lease agreement — Vitosha office space",
      counterparty: null,
      counterpartyEmail: "g.meriacre@angelsestate.bg",
    },
  }),
  // mock-003 — Investor CC's Hermes requesting the Q2 yield report → task.
  "mock-003": () => ({
    classification: "task",
    task: {
      title: "Prepare Q2 Rental Yield Report for Sofia Portfolio",
      description:
        "The LPs request a Q2 rental yield report for the Sofia portfolio. Prepare and send by the due date.",
      assigneeName: "Elena",
      assigneeEmail: "elena@team",
      dueDate: dueInDays(6),
      priority: "medium",
    },
  }),
  // mock-004 — Petar replies on the roof thread (Hermes in CC) → reply.
  "mock-004": () => ({
    classification: "reply",
    replySummary:
      "Petar booked the roof inspection for Wednesday and will deliver the report Thursday, ahead of the Friday deadline.",
  }),
  // mock-005 — Owner forwards a buyer viewing request → task.
  "mock-005": () => ({
    classification: "task",
    task: {
      title: "Arrange a viewing for Mladost 2BR listing",
      description:
        "Arrange a viewing for the 2-bedroom apartment in Mladost for Sofia Petrova. They are flexible on time for Saturday.",
      assigneeName: null,
      assigneeEmail: null,
      dueDate: dueInDays(7),
      priority: "medium",
    },
  }),
  // mock-006 — Legal replies on the lease thread (Hermes in CC) → reply.
  "mock-006": () => ({
    classification: "reply",
    replySummary:
      "Legal confirms the landlord will hold the Vitosha unit only until June 10; the signature should be prioritised.",
  }),
  // mock-007 — Supplier CC's Hermes with a mutual NDA to sign → contract.
  "mock-007": () => ({
    classification: "contract",
    contract: {
      title: "Mutual NDA with Collagen Supply Co",
      counterparty: "Collagen Supply Co",
      counterpartyEmail: "sales@collagensupply.com",
    },
  }),
  // mock-008 / mock-009 — Hermes is NOT a recipient; the recipient gate stores
  // them as "other" before extraction is ever reached, so no entry is needed.
};

export async function extractFromEmail(email: RawEmail): Promise<Extraction> {
  const userContent = [
    `Today: ${todayISO()}`,
    `From: ${email.fromName} <${email.fromEmail}>`,
    `To: ${email.toRecipients.join(", ")}`,
    `Subject: ${email.subject}`,
    `Has attachment: ${email.hasAttachments ? `yes (${email.attachmentName || "file"})` : "no"}`,
    `Body: ${email.body}`,
  ].join("\n");

  const client = getClient();
  if (!client) {
    // No live GPT (e.g. published/demo sandbox where the proxy is unavailable).
    // For the built-in demo feed we ship the exact GPT-4o extractions captured
    // during development, so the demo still showcases full-quality output. Real
    // (non-mock) emails fall back to the keyword heuristic.
    const demo = DEMO_EXTRACTIONS[email.messageId];
    if (demo) return demo();
    return heuristicFallback(email);
  }

  try {
    const response = await client.responses.create({
      model: MODEL,
      instructions: SYSTEM,
      input: userContent,
      text: {
        format: {
          type: "json_schema",
          name: "email_extraction",
          schema: SCHEMA as any,
          strict: true,
        },
      },
    } as any);

    const text =
      (response as any).output_text ??
      (response as any).output?.[0]?.content?.[0]?.text;
    const parsed = JSON.parse(text) as Extraction;
    return parsed;
  } catch (err) {
    console.error("[extract] GPT extraction failed, falling back to heuristic:", err);
    return heuristicFallback(email);
  }
}

// If GPT is unavailable, a simple keyword heuristic keeps the pipeline alive.
function heuristicFallback(email: RawEmail): Extraction {
  const s = (email.subject + " " + email.body).toLowerCase();
  const isReply = /^(re:|fw:)/i.test(email.subject);
  if (isReply) {
    return { classification: "reply", replySummary: email.bodyPreview.slice(0, 120) };
  }
  if (email.hasAttachments && /(lease|nda|agreement|contract|sign)/.test(s)) {
    return {
      classification: "contract",
      contract: {
        title: email.subject.replace(/\(signature required\)/i, "").trim(),
        counterparty: email.fromName,
        counterpartyEmail: email.fromEmail,
      },
    };
  }
  return {
    classification: "task",
    task: {
      title: email.subject,
      description: email.bodyPreview,
      assigneeName: null,
      assigneeEmail: null,
      dueDate: null,
      priority: /urgent|asap|priority|closing|deadline/.test(s) ? "high" : "medium",
    },
  };
}
