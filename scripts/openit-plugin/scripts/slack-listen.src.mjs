// Slack listener — local-only V1.
//
// Long-lived process supervised by the Tauri shell. Standalone mode:
//
//   OPENIT_REPO=/abs/path/to/project \
//   OPENIT_INTAKE_URL=http://127.0.0.1:54123 \
//   OPENIT_SLACK_BOT_TOKEN=xoxb-... \
//   OPENIT_SLACK_APP_TOKEN=xapp-... \
//   OPENIT_SLACK_WORKSPACE_ID=T0... \
//   OPENIT_SLACK_BOT_USER_ID=U0... \
//   [OPENIT_SLACK_ALLOWED_DOMAINS=acme.com,foo.com] \
//   node slack-listen.bundle.cjs
//
// Threading model:
//
//   One Slack thread == one OpenIT ticket. A user's top-level DM
//   starts a new ticket; the bot replies in-thread on that DM and
//   that thread is the ticket's durable identity. Any future reply
//   inside the thread continues the same ticket (reopening it if
//   it was closed). To start a new conversation the user simply
//   sends a new top-level DM — that is the "new chat" gesture.
//
//   Routing key: `${channel_id}:${thread_ts}` where
//   `thread_ts = event.thread_ts ?? event.ts`. The bot never posts
//   top-level, so a thread always exists from the first turn.
//
// Inbound:   message.im → ack immediately → enqueue → worker drains
//            → trust gates → POST /chat/start (fresh per-thread, or
//            with resume_ticket_id when we already have a ticket
//            for this thread) → POST /chat/turn → reply with
//            thread_ts.
//
// Egress:    every 2s, walk databases/conversations/<ticketId>/ for
//            every ticket in the delivery ledger, post any new
//            admin turns past the per-ticket high watermark — in
//            the ticket's thread.
//
// State:     persisted under .openit/slack-sessions.json and
//            .openit/slack-delivery.json (atomic write-temp+rename).
//            Loaded on startup so a listener restart resumes
//            cleanly without forking tickets or re-blasting replies.
//
// V1 scope:  DMs only. No channel mentions, no slash commands, no
//            Block Kit. Socket Mode does not buffer events, so any
//            DM missed while the listener is down is permanently
//            lost — same as the pre-threading behavior.

import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { promises as fs } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Env + constants
// ---------------------------------------------------------------------------

const REPO = mustEnv("OPENIT_REPO");
const INTAKE_URL = mustEnv("OPENIT_INTAKE_URL").replace(/\/+$/, "");
const BOT_TOKEN = mustEnv("OPENIT_SLACK_BOT_TOKEN");
const APP_TOKEN = mustEnv("OPENIT_SLACK_APP_TOKEN");
const WORKSPACE_ID = mustEnv("OPENIT_SLACK_WORKSPACE_ID");
const BOT_USER_ID = mustEnv("OPENIT_SLACK_BOT_USER_ID");
const ALLOWED_DOMAINS = (process.env.OPENIT_SLACK_ALLOWED_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

const STATE_DIR = path.join(REPO, ".openit");
const SESSIONS_PATH = path.join(STATE_DIR, "slack-sessions.json");
const DELIVERY_PATH = path.join(STATE_DIR, "slack-delivery.json");

const EGRESS_INTERVAL_MS = 2_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const WORKER_CONCURRENCY = 4;
const SLACK_REPLY_PROMPT_EMAIL =
  "Hi! I'm the OpenIT triage bot. To file your ticket I just need your work email — what is it?";
const SLACK_REPLY_BAD_EMAIL =
  "Hmm, that doesn't look like an email address. Could you send just your work email (e.g. you@company.com)?";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function mustEnv(k) {
  const v = process.env[k];
  if (!v || !v.trim()) {
    console.error(`[slack-listen] missing required env var: ${k}`);
    process.exit(2);
  }
  return v.trim();
}

// ---------------------------------------------------------------------------
// On-disk state — thread-keyed sessions and per-ticket delivery ledger.
//
// sessions[`${channel_id}:${thread_ts}`] is one of two shapes:
//
//   { state: "pending_email", channel_id, thread_ts, original_message,
//     resume_ticket_id }
//     We DM'd the user asking for their work email and are waiting
//     for their reply. Their next message in the same thread becomes
//     the email; the `original_message` is replayed as the first
//     ticket turn. `resume_ticket_id` is non-null when the prompt
//     fired on an in-thread reply that already had a ticket bound
//     to it — preserved so the post-email handoff continues the
//     existing ticket instead of forking a new one.
//
//   { state: "active", session_id, ticket_id, channel_id, thread_ts,
//     slack_user_id, email }
//     A live session scoped to a single thread (one ticket). All
//     in-thread messages route here until the user starts a new
//     top-level DM (which creates a new thread → new session →
//     new ticket). `slack_user_id` is retained so that a 404-resume
//     can replay the originating user's identity to the intake
//     server instead of falling back to a placeholder.
//
// delivery[ticket_id] = { last_delivered_msg_id, channel_id, thread_ts }
//   Per-ticket egress watermark + Slack address. The thread anchor
//   is what makes admin replies land in the thread the user is
//   reading. last_delivered_msg_id is strictly monotonic (msg ids
//   embed unix-ms).
// ---------------------------------------------------------------------------

let sessions = {};
let delivery = {};
const writeMutex = { busy: false, queued: false };

function threadKey(channelId, threadTs) {
  return `${channelId}:${threadTs}`;
}

async function loadState() {
  await fs.mkdir(STATE_DIR, { recursive: true });
  try {
    sessions = JSON.parse(await fs.readFile(SESSIONS_PATH, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`[slack-listen] sessions load failed (resetting): ${err.message}`);
    }
    sessions = {};
  }
  try {
    delivery = JSON.parse(await fs.readFile(DELIVERY_PATH, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`[slack-listen] delivery load failed (resetting): ${err.message}`);
    }
    delivery = {};
  }
  // Discover any Slack tickets on disk that the ledger doesn't
  // know about (ledger lost/corrupt, or this is a fresh listener
  // boot against a project with pre-existing Slack tickets).
  await seedDeliveryFromDisk();

  // Defensive watermark init: for any ticket in the delivery ledger
  // without a `last_delivered_msg_id`, scan its conversation
  // directory and snap the watermark to the latest admin turn so we
  // don't re-blast historical replies.
  for (const [ticketId, entry] of Object.entries(delivery)) {
    if (entry.last_delivered_msg_id) continue;
    const id = await latestAdminMsgId(ticketId);
    if (id) {
      entry.last_delivered_msg_id = id;
    }
  }
  await persistAll();
}

// Walk databases/tickets/ for `askerChannel: "slack"` tickets that
// aren't already in the delivery ledger. For each, seed a delivery
// entry with the saved channel id and (if present) thread anchor.
// Called once at startup AFTER the ledger file has been loaded.
// Existing entries are left untouched.
async function seedDeliveryFromDisk() {
  const ticketsDir = path.join(REPO, "databases", "tickets");
  let names;
  try {
    names = await fs.readdir(ticketsDir);
  } catch (err) {
    if (err.code === "ENOENT") return; // no tickets dir yet
    console.error(`[slack-listen] tickets dir scan failed: ${err.message}`);
    return;
  }
  for (const name of names) {
    if (!name.endsWith(".json") || name === "_schema.json") continue;
    if (name.includes(".server.")) continue; // sync conflict shadow
    const ticketId = name.replace(/\.json$/, "");
    if (delivery[ticketId]) continue;
    try {
      const t = JSON.parse(await fs.readFile(path.join(ticketsDir, name), "utf8"));
      if (t.askerChannel !== "slack") continue;
      if (!t.slackChannelId) continue;
      delivery[ticketId] = {
        last_delivered_msg_id: null,
        channel_id: t.slackChannelId,
        thread_ts: t.slackThreadTs ?? null,
      };
    } catch {
      /* unreadable / not JSON — skip */
    }
  }
}

async function persistAll() {
  // Coalesce concurrent writes — if a write is in flight, mark a
  // second one queued; that write picks up the latest in-memory
  // state when it runs.
  if (writeMutex.busy) {
    writeMutex.queued = true;
    return;
  }
  writeMutex.busy = true;
  try {
    await atomicWriteJson(SESSIONS_PATH, sessions);
    await atomicWriteJson(DELIVERY_PATH, delivery);
  } finally {
    writeMutex.busy = false;
    if (writeMutex.queued) {
      writeMutex.queued = false;
      setImmediate(() => persistAll().catch(logErr));
    }
  }
}

async function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

async function latestAdminMsgId(ticketId) {
  const dir = path.join(REPO, "databases", "conversations", ticketId);
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  let best = null;
  for (const name of entries) {
    if (!name.startsWith("msg-") || !name.endsWith(".json")) continue;
    if (name.includes(".server.")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, name), "utf8");
      const msg = JSON.parse(raw);
      if (msg.role !== "admin") continue;
      if (!best || (msg.id ?? "") > best) best = msg.id ?? null;
    } catch {
      /* ignore unreadable */
    }
  }
  return best;
}

// Find the ticket id for a (channel, thread_ts) pair by scanning
// the delivery ledger. Returns null if no ticket is bound to this
// thread yet — caller treats that as "fresh top-level DM, mint a
// new ticket". Linear scan is fine: ledger size is bounded by open
// Slack tickets in the project, typically O(10–100).
function findTicketForThread(channelId, threadTs) {
  for (const [ticketId, entry] of Object.entries(delivery)) {
    if (entry.channel_id === channelId && entry.thread_ts === threadTs) {
      return ticketId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Intake server HTTP wrappers
// ---------------------------------------------------------------------------

async function intakePost(pathname, body) {
  const res = await fetch(`${INTAKE_URL}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The intake server gates every endpoint on Origin/Referer
      // being a localhost host. We're loopback, so this is honest.
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
  return res;
}

async function chatStart({ email, transport, resumeTicketId }) {
  const body = { email, transport };
  if (resumeTicketId) body.resume_ticket_id = resumeTicketId;
  const res = await intakePost("/chat/start", body);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`/chat/start ${res.status}: ${text}`);
  }
  return await res.json(); // { session_id, ticket_id }
}

async function chatTurn({ sessionId, message }) {
  const res = await intakePost("/chat/turn", {
    session_id: sessionId,
    message,
  });
  return res; // caller handles 404 specifically
}

// ---------------------------------------------------------------------------
// Slack clients
// ---------------------------------------------------------------------------

const web = new WebClient(BOT_TOKEN);
const sock = new SocketModeClient({ appToken: APP_TOKEN });

async function postSlack(channel, text, threadTs) {
  const args = { channel, text };
  if (threadTs) args.thread_ts = threadTs;
  await web.chat.postMessage(args);
}

// ---------------------------------------------------------------------------
// Trust gates
//
// Block bots, externals, and guests. Domain allowlist applies only
// to full members and never re-allows a guest or external.
// ---------------------------------------------------------------------------

function eventIsBot(event) {
  if (event.bot_id) return true;
  if (event.subtype === "bot_message") return true;
  if (event.user === BOT_USER_ID) return true;
  return false;
}

async function userPassesTrustGates(slackUserId) {
  let info;
  try {
    const res = await web.users.info({ user: slackUserId });
    info = res.user;
  } catch (err) {
    console.error(`[slack-listen] users.info failed for ${slackUserId}: ${err.message}`);
    return { ok: false, reason: "users.info failed" };
  }
  if (!info) return { ok: false, reason: "no user info" };
  if (info.is_bot) return { ok: false, reason: "is_bot" };
  if (info.is_stranger) return { ok: false, reason: "is_stranger" };
  if (info.is_restricted || info.is_ultra_restricted) {
    return { ok: false, reason: "is_guest" };
  }
  if (info.team_id && info.team_id !== WORKSPACE_ID) {
    return { ok: false, reason: "wrong_workspace" };
  }
  const email = info.profile?.email ?? null;
  if (ALLOWED_DOMAINS.length > 0) {
    if (!email) return { ok: false, reason: "no_email_for_domain_check" };
    const domain = email.split("@").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_DOMAINS.includes(domain)) {
      return { ok: false, reason: "domain_not_allowed" };
    }
  }
  return { ok: true, email };
}

// ---------------------------------------------------------------------------
// Inbound queue + worker pool
//
// Slack Socket Mode requires acks within ~3s or the event is
// retried (causing duplicate tickets and replies). The handler
// acks immediately and enqueues; workers drain the queue and do
// the slow `claude -p` round-trip out-of-band.
// ---------------------------------------------------------------------------

const queue = [];
let activeWorkers = 0;
let stopping = false;

function enqueue(job) {
  if (stopping) return;
  queue.push(job);
  pumpWorkers();
}

function pumpWorkers() {
  while (activeWorkers < WORKER_CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    activeWorkers += 1;
    Promise.resolve()
      .then(() => job())
      .catch(logErr)
      .finally(() => {
        activeWorkers -= 1;
        if (queue.length > 0) pumpWorkers();
      });
  }
}

async function handleMessageIm(event) {
  if (eventIsBot(event)) return;
  if (event.team && event.team !== WORKSPACE_ID) return;
  if (!event.user || !event.channel) return;
  if (!event.text || !event.text.trim()) return; // file_share-only etc.

  const slackUserId = event.user;
  const channelId = event.channel;
  const text = event.text.trim();
  // Thread anchor: an in-thread reply carries `thread_ts`; a fresh
  // top-level DM doesn't. Either way the bot's reply is threaded on
  // this value, so a top-level DM creates a new thread (= new ticket)
  // and a reply continues the existing one.
  const threadTs = event.thread_ts ?? event.ts;
  const key = threadKey(channelId, threadTs);
  const isThreadReply = event.thread_ts != null;

  // Trust gate (also resolves email).
  const gate = await userPassesTrustGates(slackUserId);
  if (!gate.ok) {
    console.error(
      `[slack-listen] dropped event from ${slackUserId} (${gate.reason})`,
    );
    return;
  }

  const session = sessions[key];

  // Pending-email state: this DM is the user's email reply on the
  // same thread we asked from.
  if (session?.state === "pending_email") {
    const match = text.match(EMAIL_RE);
    if (!match) {
      await postSlack(channelId, SLACK_REPLY_BAD_EMAIL, threadTs);
      return;
    }
    const email = match[0].toLowerCase();
    await startSessionAndDeliver({
      key,
      slackUserId,
      channelId,
      threadTs,
      email,
      firstMessage: session.original_message,
      resumeTicketId: session.resume_ticket_id ?? null,
    });
    return;
  }

  // Live session for this thread — route as a turn.
  if (session?.state === "active") {
    await deliverTurn({ key, message: text });
    return;
  }

  // No live session. If this is an in-thread reply we already have a
  // ticket for (listener restart, or a reply to an old/closed
  // ticket), resume it. Otherwise treat as a fresh top-level DM →
  // new ticket.
  const existingTicketId = isThreadReply
    ? findTicketForThread(channelId, threadTs)
    : null;

  if (!gate.email) {
    sessions[key] = {
      state: "pending_email",
      channel_id: channelId,
      thread_ts: threadTs,
      original_message: text,
      // Preserve the resume hint discovered before we knew the
      // email — otherwise an in-thread reply that lands in
      // pending_email forks a fresh ticket once the email arrives.
      resume_ticket_id: existingTicketId,
    };
    await persistAll();
    await postSlack(channelId, SLACK_REPLY_PROMPT_EMAIL, threadTs);
    return;
  }

  await startSessionAndDeliver({
    key,
    slackUserId,
    channelId,
    threadTs,
    email: gate.email,
    firstMessage: text,
    resumeTicketId: existingTicketId,
  });
}

async function startSessionAndDeliver({
  key,
  slackUserId,
  channelId,
  threadTs,
  email,
  firstMessage,
  resumeTicketId,
}) {
  let started;
  try {
    started = await chatStart({
      email,
      transport: {
        kind: "slack",
        workspace_id: WORKSPACE_ID,
        channel_id: channelId,
        user_id: slackUserId,
        thread_ts: threadTs,
      },
      resumeTicketId,
    });
  } catch (err) {
    // 400 from resume validation (e.g. asker email on the existing
    // ticket no longer matches) → retry once without resume, opening
    // a fresh ticket bound to the same thread.
    if (resumeTicketId && /\b400\b/.test(String(err.message))) {
      console.error(
        `[slack-listen] resume rejected (${err.message}); starting fresh ticket`,
      );
      started = await chatStart({
        email,
        transport: {
          kind: "slack",
          workspace_id: WORKSPACE_ID,
          channel_id: channelId,
          user_id: slackUserId,
          thread_ts: threadTs,
        },
      });
    } else {
      throw err;
    }
  }

  sessions[key] = {
    state: "active",
    session_id: started.session_id,
    ticket_id: started.ticket_id,
    channel_id: channelId,
    thread_ts: threadTs,
    slack_user_id: slackUserId,
    email,
  };
  if (!delivery[started.ticket_id]) {
    delivery[started.ticket_id] = {
      last_delivered_msg_id: null,
      channel_id: channelId,
      thread_ts: threadTs,
    };
  } else {
    delivery[started.ticket_id].channel_id = channelId;
    delivery[started.ticket_id].thread_ts = threadTs;
  }
  await persistAll();

  await deliverTurn({ key, message: firstMessage });
}

async function deliverTurn({ key, message }) {
  const sess = sessions[key];
  if (!sess || sess.state !== "active") {
    console.error(`[slack-listen] deliverTurn called without active session for ${key}`);
    return;
  }
  const reply = await runTurnWithRetry({ key, message });
  if (reply == null) return;
  await persistAll();
  await postSlack(sess.channel_id, reply, sess.thread_ts);
}

async function runTurnWithRetry({ key, message }) {
  const sess = sessions[key];
  let res = await chatTurn({ sessionId: sess.session_id, message });

  // Stale session_id (intake server restarted, or LRU-evicted).
  // Re-start with resume_ticket_id and retry once.
  if (res.status === 404) {
    console.error(
      `[slack-listen] session ${sess.session_id} unknown (404); resuming on ticket ${sess.ticket_id}`,
    );
    let restarted;
    try {
      restarted = await chatStart({
        email: sess.email,
        transport: {
          kind: "slack",
          workspace_id: WORKSPACE_ID,
          channel_id: sess.channel_id,
          user_id: sess.slack_user_id,
          thread_ts: sess.thread_ts,
        },
        resumeTicketId: sess.ticket_id,
      });
    } catch (err) {
      console.error(`[slack-listen] resume after 404 failed: ${err.message}`);
      return null;
    }
    sessions[key].session_id = restarted.session_id;
    await persistAll();
    res = await chatTurn({
      sessionId: restarted.session_id,
      message,
    });
    if (res.status === 404) {
      console.error(`[slack-listen] second 404 after resume — dropping turn`);
      return null;
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[slack-listen] /chat/turn ${res.status}: ${text}`);
    return null;
  }
  const json = await res.json();
  return json.reply ?? "";
}

// ---------------------------------------------------------------------------
// Egress polling — admin replies → Slack
// ---------------------------------------------------------------------------

async function egressTick() {
  for (const [ticketId, entry] of Object.entries(delivery)) {
    try {
      await drainTicket(ticketId, entry);
    } catch (err) {
      console.error(`[slack-listen] egress drain failed for ${ticketId}: ${err.message}`);
    }
  }
}

async function drainTicket(ticketId, entry) {
  const dir = path.join(REPO, "databases", "conversations", ticketId);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  // Filter + sort by id (monotonic since unix-ms is the prefix).
  const candidates = names
    .filter((n) => n.startsWith("msg-") && n.endsWith(".json") && !n.includes(".server."))
    .sort();
  let high = entry.last_delivered_msg_id ?? "";
  for (const name of candidates) {
    let msg;
    try {
      msg = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    if (msg.role !== "admin") continue;
    const id = msg.id ?? "";
    if (id <= high) continue;
    try {
      await postSlack(entry.channel_id, msg.body ?? "", entry.thread_ts);
      high = id;
      entry.last_delivered_msg_id = id;
      // Persist after each delivery — strictly monotonic, never
      // re-deliver on crash even if we crash between two messages.
      await persistAll();
    } catch (err) {
      console.error(
        `[slack-listen] postMessage failed for ticket ${ticketId} msg ${id}: ${err.message}`,
      );
      break; // try again next tick rather than skipping ahead
    }
  }
}

// ---------------------------------------------------------------------------
// Heartbeat — JSON line on stderr the Tauri supervisor parses
// ---------------------------------------------------------------------------

function heartbeat() {
  const payload = {
    ok: true,
    ts: new Date().toISOString(),
    sessions: Object.keys(sessions).length,
    open_tickets: Object.keys(delivery).length,
    queue_depth: queue.length,
    workers: activeWorkers,
  };
  console.error(JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Boot + lifecycle
// ---------------------------------------------------------------------------

function logErr(err) {
  console.error(`[slack-listen] worker error: ${err?.stack ?? err}`);
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.error(`[slack-listen] received ${signal}; draining…`);
  // Drain inbound queue — wait up to 5s for in-flight workers.
  const deadline = Date.now() + 5_000;
  while ((queue.length > 0 || activeWorkers > 0) && Date.now() < deadline) {
    await sleep(100);
  }
  try {
    await sock.disconnect();
  } catch (err) {
    console.error(`[slack-listen] disconnect failed: ${err.message}`);
  }
  await persistAll();
  process.exit(0);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await loadState();

  sock.on("message", async ({ event, ack }) => {
    // Ack first — always, fast — then enqueue.
    try {
      await ack();
    } catch (err) {
      console.error(`[slack-listen] ack failed: ${err.message}`);
    }
    // Some `message` envelope subtypes (channel_join, etc.) come
    // through too; we only handle plain DMs.
    if (!event || event.channel_type !== "im") return;
    if (event.subtype && event.subtype !== "file_share") return;
    enqueue(() => handleMessageIm(event));
  });

  sock.on("disconnect", () => {
    console.error(`[slack-listen] socket disconnected (will auto-retry)`);
  });
  sock.on("error", (err) => {
    console.error(`[slack-listen] socket error: ${err?.message ?? err}`);
  });

  await sock.start();
  // The SDK's start() resolves once the websocket is up. Log a
  // recognizable line so the Tauri supervisor can detect ready
  // state without polling Slack.
  console.error(`[slack-listen] socket-mode connected`);

  setInterval(() => egressTick().catch(logErr), EGRESS_INTERVAL_MS).unref();
  setInterval(heartbeat, HEARTBEAT_INTERVAL_MS).unref();

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(`[slack-listen] fatal: ${err?.stack ?? err}`);
  process.exit(1);
});
