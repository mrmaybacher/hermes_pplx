// Email source: real Microsoft Graph when credentials exist, mock feed otherwise.
// Both return the same RawEmail shape so the rest of the pipeline is identical.

export interface RawEmail {
  messageId: string;
  conversationId: string;
  fromName: string;
  fromEmail: string;
  toRecipients: string[];
  ccRecipients: string[];
  subject: string;
  bodyPreview: string;
  body: string;
  receivedAt: string; // ISO
  hasAttachments: boolean;
  attachmentName?: string;
}

const {
  GRAPH_TENANT_ID,
  GRAPH_CLIENT_ID,
  GRAPH_CLIENT_SECRET,
  GRAPH_MAILBOX = "hermes@angelsestate.bg",
} = process.env;

// ── Body cleaning ──────────────────────────────────────
// Convert an HTML (or already-plaintext) email body into readable plain text
// that preserves paragraph/line structure, then resolve forwarded content so
// the detail view is never blank.

const FORWARD_SEPARATORS = [
  /-{2,}\s*Forwarded message\s*-{2,}/i,
  /-{2,}\s*Original Message\s*-{2,}/i,
  /Begin forwarded message:/i,
];

// A line that is only forward-header boilerplate (From:/Sent:/To:/Subject:/Cc:/Date:).
const HEADER_LINE = /^\s*(From|Sent|To|Cc|Bcc|Subject|Date|Reply-To)\s*:/i;

// Turn HTML into newline-preserving plain text. Safe on plain text input
// (no tags → returned essentially unchanged aside from entity decoding).
export function htmlToText(input: string): string {
  if (!input) return "";
  let s = input;
  // Drop script/style blocks entirely.
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Block-level boundaries → newlines BEFORE stripping tags.
  s = s.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  s = s.replace(/<\/\s*(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n");
  s = s.replace(/<\s*(p|div|li|tr|h[1-6]|blockquote)[^>]*>/gi, "\n");
  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, "");
  // Decode the common HTML entities.
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
  // Collapse runs of spaces/tabs but keep newlines; trim trailing space per line.
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").replace(/\s+$/g, ""))
    .join("\n");
  // Collapse 3+ blank lines down to a max of two.
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

// True when the text contains no real content — empty, or only forward-header
// boilerplate lines (From:/Sent:/To:/Subject: ...).
function isOnlyBoilerplate(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return true;
  return lines.every((l) => HEADER_LINE.test(l) || FORWARD_SEPARATORS.some((re) => re.test(l)));
}

// Given cleaned plain text, if the meaningful body is empty or only forward
// boilerplate, drill past the forward-header block and return the real body
// beneath it. Returns the best available body (never throws).
export function resolveBody(text: string): string {
  const cleaned = (text || "").trim();
  if (!cleaned) return "";
  if (!isOnlyBoilerplate(cleaned)) {
    // There IS real content at the top level. If a forward separator exists,
    // keep the whole thing — the wrapper note plus the forwarded body are both
    // useful and the UI separates them. Otherwise return as-is.
    return cleaned;
  }

  // Top level is empty/boilerplate. Find a forward separator and take what
  // follows; if there is no explicit separator, skip the leading block of
  // header lines and return the remainder.
  for (const re of FORWARD_SEPARATORS) {
    const m = cleaned.match(re);
    if (m && m.index !== undefined) {
      const after = cleaned.slice(m.index + m[0].length).trim();
      if (after) return after;
    }
  }

  const lines = cleaned.split("\n");
  let i = 0;
  while (i < lines.length && (!lines[i].trim() || HEADER_LINE.test(lines[i]) || FORWARD_SEPARATORS.some((re) => re.test(lines[i])))) {
    i++;
  }
  const remainder = lines.slice(i).join("\n").trim();
  return remainder || cleaned;
}

export const usingRealGraph = Boolean(
  GRAPH_TENANT_ID && GRAPH_CLIENT_ID && GRAPH_CLIENT_SECRET
);

// ── Microsoft Graph (real inbox) ───────────────────────
async function getGraphToken(): Promise<string> {
  const url = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: GRAPH_CLIENT_ID!,
    client_secret: GRAPH_CLIENT_SECRET!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Graph token error ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  return json.access_token;
}

async function fetchFromGraph(sinceIso: string): Promise<RawEmail[]> {
  const token = await getGraphToken();
  // Only messages received since the lookback window, newest first.
  const filter = encodeURIComponent(`receivedDateTime ge ${sinceIso}`);
  const select = "id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments";
  const url =
    `https://graph.microsoft.com/v1.0/users/${GRAPH_MAILBOX}/mailFolders/inbox/messages` +
    `?$filter=${filter}&$select=${select}&$orderby=receivedDateTime desc&$top=25`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph messages error ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  return (json.value || []).map((m: any): RawEmail => {
    const rawBody = m.body?.content || "";
    const cleaned = htmlToText(rawBody);
    // Resolve forwarded content so the detail view never shows a blank pane.
    const resolved = resolveBody(cleaned) || cleaned || (m.bodyPreview || "").trim();
    return {
      messageId: m.id,
      conversationId: m.conversationId || m.id,
      fromName: m.from?.emailAddress?.name || "Unknown",
      fromEmail: m.from?.emailAddress?.address || "unknown@unknown",
      toRecipients: (m.toRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean),
      ccRecipients: (m.ccRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean),
      subject: m.subject || "(no subject)",
      bodyPreview: m.bodyPreview || "",
      body: resolved,
      receivedAt: m.receivedDateTime,
      hasAttachments: Boolean(m.hasAttachments),
    };
  });
}

// ── Mock feed (demo / no credentials) ──────────────────
// A realistic stream of emails arriving to hermes@angelsestate.bg.
// Drip-fed: each watcher tick reveals a few more so the dashboard "comes alive".
function todayAt(hour: number, min = 0): string {
  const d = new Date();
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}

const HERMES = "hermes@angelsestate.bg";
const OWNER = "g.meriacre@angelsestate.bg"; // the user

const MOCK_FEED: RawEmail[] = [
  // CASE: Maria writes to the owner and CC's Hermes → becomes a task.
  {
    messageId: "mock-001",
    conversationId: "conv-roof",
    fromName: "Maria Dimitrova",
    fromEmail: "maria.dimitrova@buildco.bg",
    toRecipients: [OWNER],
    ccRecipients: [HERMES],
    subject: "Roof inspection report needed for Lozenets apartment",
    bodyPreview: "Hi, can you have the roof inspection report ready by Friday June 5?",
    body: "Hi Grigore, the buyer for the Lozenets apartment is asking for the roof inspection report. Can you make sure Petar from the engineering team gets this to us by Friday, June 5? It's a high priority — closing depends on it. Thanks, Maria.",
    receivedAt: todayAt(8, 12),
    hasAttachments: false,
  },
  // CASE: The owner forwards the lease to Hermes → becomes a contract.
  {
    messageId: "mock-002",
    conversationId: "conv-lease",
    fromName: "Grigore Meriacre",
    fromEmail: OWNER,
    toRecipients: [HERMES],
    ccRecipients: [],
    subject: "FW: Lease agreement — Vitosha office space (signature required)",
    bodyPreview: "Forwarding the Vitosha lease — needs signing by June 10.",
    body: "Tracking this. Forwarded from legal: attached is the lease agreement for the Vitosha Boulevard office space. The landlord needs my signature by June 10 to hold the unit. Review the rent escalation clause in section 4.",
    receivedAt: todayAt(8, 40),
    hasAttachments: true,
    attachmentName: "Vitosha_Lease_Agreement_v3.pdf",
  },
  // CASE: Investor writes to owner, CC's Hermes → task.
  {
    messageId: "mock-003",
    conversationId: "conv-yield",
    fromName: "Investor Relations",
    fromEmail: "ivan@capitalpartners.bg",
    toRecipients: [OWNER],
    ccRecipients: [HERMES],
    subject: "Q2 yield report for the Sofia portfolio",
    bodyPreview: "Could you send over the Q2 rental yield numbers when you get a chance?",
    body: "Hi Grigore, the LPs would like the Q2 rental yield report for the Sofia portfolio. No rush, but ideally before end of next week. Can your analyst Elena prepare it? Best, Ivan.",
    receivedAt: todayAt(9, 5),
    hasAttachments: false,
  },
  // CASE: Reply-all on the roof thread — Hermes stays in CC → linked reply.
  {
    messageId: "mock-004",
    conversationId: "conv-roof",
    fromName: "Petar Georgiev",
    fromEmail: "petar.georgiev@angelsestate.bg",
    toRecipients: [OWNER, "maria.dimitrova@buildco.bg"],
    ccRecipients: [HERMES],
    subject: "RE: Roof inspection report needed for Lozenets apartment",
    bodyPreview: "On it — scheduling the inspection for Wednesday, report by Thursday.",
    body: "Confirmed, I've booked the roof inspection for Wednesday morning. I'll have the full report written up by Thursday EOD, ahead of the Friday deadline. Petar.",
    receivedAt: todayAt(9, 48),
    hasAttachments: false,
  },
  // CASE: Owner forwards a buyer viewing request to Hermes → task.
  {
    messageId: "mock-005",
    conversationId: "conv-viewing",
    fromName: "Grigore Meriacre",
    fromEmail: OWNER,
    toRecipients: [HERMES],
    ccRecipients: [],
    subject: "FW: Viewing request — Mladost 2BR listing",
    bodyPreview: "Forwarding — buyer wants a viewing Saturday.",
    body: "Please track this. From Sofia Petrova: 'My husband and I are interested in the 2-bedroom in Mladost. Could someone arrange a viewing for Saturday? We're flexible on time.'",
    receivedAt: todayAt(10, 20),
    hasAttachments: false,
  },
  // CASE: Reply-all on the lease thread — Hermes in CC → linked reply.
  {
    messageId: "mock-006",
    conversationId: "conv-lease",
    fromName: "Angel Estate Legal",
    fromEmail: "legal@angelsestate.bg",
    toRecipients: [OWNER],
    ccRecipients: [HERMES],
    subject: "RE: Lease agreement — Vitosha office space (signature required)",
    bodyPreview: "Quick reminder the landlord needs the signed copy by June 10.",
    body: "Just following up — the landlord confirmed they'll hold the Vitosha unit only until June 10. Please prioritise the signature. Thanks.",
    receivedAt: todayAt(11, 2),
    hasAttachments: false,
  },
  // CASE: Supplier writes to owner, CC's Hermes → contract.
  {
    messageId: "mock-007",
    conversationId: "conv-supplier",
    fromName: "Collagen Supply Co",
    fromEmail: "sales@collagensupply.com",
    toRecipients: [OWNER],
    ccRecipients: [HERMES],
    subject: "Marine collagen sample dispatch + NDA",
    bodyPreview: "Samples shipped. Please sign the attached mutual NDA before formula details.",
    body: "Hi Grigore, your marine collagen samples for the Forma line have shipped (tracking attached). Before we share the full formulation spec, we need the mutual NDA signed and returned by June 8. Best regards.",
    receivedAt: todayAt(11, 35),
    hasAttachments: true,
    attachmentName: "Mutual_NDA_CollagenSupply.pdf",
  },
  // IGNORED CASE: a newsletter that landed in the inbox — Hermes is NOT a
  // recipient. Stored as "other", never becomes a task.
  {
    messageId: "mock-008",
    conversationId: "conv-news",
    fromName: "PropTech Weekly",
    fromEmail: "news@proptechweekly.com",
    toRecipients: ["subscribers@proptechweekly.com"],
    ccRecipients: [],
    subject: "This week in real estate tech: 7 trends to watch",
    bodyPreview: "Your weekly digest of proptech news and funding rounds.",
    body: "The latest funding rounds, product launches, and market moves in real estate technology. Read more on our site.",
    receivedAt: todayAt(7, 30),
    hasAttachments: false,
  },
  // IGNORED CASE: someone emailed Hermes-adjacent address but Hermes itself is
  // not in To/CC (e.g. autoresponder to a different alias). Stored as "other".
  {
    messageId: "mock-009",
    conversationId: "conv-noreply",
    fromName: "Bank Notifications",
    fromEmail: "noreply@bank.bg",
    toRecipients: ["accounts@angelsestate.bg"],
    ccRecipients: [],
    subject: "Your statement is ready",
    bodyPreview: "Automated notice — no action required.",
    body: "This is an automated message. Your monthly account statement is now available in online banking.",
    receivedAt: todayAt(6, 50),
    hasAttachments: false,
  },
];

let mockCursor = 0;
function fetchFromMock(): RawEmail[] {
  // Reveal up to 3 new emails per tick to simulate a live inbox.
  const batch = MOCK_FEED.slice(mockCursor, mockCursor + 3);
  mockCursor = Math.min(mockCursor + 3, MOCK_FEED.length);
  return batch;
}

// On first run we want the dashboard populated immediately:
export function primeMockFull(): RawEmail[] {
  mockCursor = MOCK_FEED.length;
  return MOCK_FEED.slice();
}

// ── Public API ─────────────────────────────────────────
export async function fetchNewEmails(sinceIso: string): Promise<RawEmail[]> {
  if (usingRealGraph) {
    return fetchFromGraph(sinceIso);
  }
  return fetchFromMock();
}
