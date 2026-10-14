import { db } from "./db.ts";
import { act, currentRound, emit, GameError, type Participant, phaseOf } from "./game.ts";
import { MARKS, PROMPTS } from "../public/shared.js";

// The room's one conversation. Same pattern as src/game.ts: a message is one
// transaction keyed by an idempotency id, appending a monotonic event that the
// SSE stream carries to everyone. Messages span rounds and record the round
// they were sent in. Every query here is bounded.

export const CHAT = {
  maxLength: 300,
  // per person: at most `burst` messages in any `window` ms
  burst: 5,
  window: 15_000,
  page: 50,
  maxPage: 100,
};

interface MessageRow {
  id: number;
  participant_id: number;
  round_id: number | null;
  phase: string;
  mark: number | null;
  body: string;
  object_id: number | null;
  object_motif: string | null;
  created_at: number;
  pid: string;
  agent: number;
  prompt_index: number | null;
}

const fail = (status: number, code: string, message: string): never => {
  throw new GameError(status, code, message);
};

/**
 * Plain text only: control characters (including newlines and bidi
 * overrides) become spaces, runs of space collapse, and the length is counted
 * in characters, not UTF-16 units.
 */
export function cleanText(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const length = [...text].length;
  if (length === 0 || length > CHAT.maxLength) return undefined;
  return text;
}

const SELECT = `SELECT m.*, p.pid, p.agent, r.prompt_index FROM chat_messages m
  JOIN participants p ON p.id = m.participant_id
  LEFT JOIN rounds r ON r.id = m.round_id`;

function publicMessage(m: MessageRow) {
  return {
    id: m.id,
    pid: m.pid,
    mark: m.mark,
    round: m.round_id,
    phase: m.phase,
    body: m.body,
    objectId: m.object_id,
    objectMotif: m.object_motif,
    at: m.created_at,
  };
}
export type ChatMessage = ReturnType<typeof publicMessage>;

/** Most recent messages before `before` (exclusive), oldest first. */
export function history(before?: unknown, limit: unknown = CHAT.page) {
  const n = Math.min(CHAT.maxPage, Math.max(1, Math.floor(Number(limit)) || CHAT.page));
  const cursor = Number(before);
  const rows = (
    Number.isInteger(cursor) && cursor > 0
      ? db.prepare(`${SELECT} WHERE m.id < ? ORDER BY m.id DESC LIMIT ?`).all(cursor, n + 1)
      : db.prepare(`${SELECT} ORDER BY m.id DESC LIMIT ?`).all(n + 1)
  ) as MessageRow[];
  const more = rows.length > n;
  const page = rows.slice(0, n).reverse();
  return { messages: page.map(publicMessage), more, prompts: promptsFor(page) };
}

/** Each round's prompt, so a client can head the history dream by dream. */
function promptsFor(rows: MessageRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of rows) if (m.round_id !== null && m.prompt_index !== null) out[m.round_id] = m.prompt_index;
  return out;
}

/** One round's conversation, oldest first, capped. */
export function roundMessages(roundId: number, limit = 200) {
  const rows = db
    .prepare(`${SELECT} WHERE m.round_id = ? ORDER BY m.id LIMIT ?`)
    .all(roundId, limit + 1) as MessageRow[];
  return { messages: rows.slice(0, limit).map(publicMessage), more: rows.length > limit };
}

// A person keeps the ink mark from the round they're in, or else from the last
// round they played; someone who has never played shows as a guest (null).
function markNow(p: Participant, roundId: number | null): number | null {
  const row = (
    roundId === null
      ? undefined
      : db.prepare("SELECT mark FROM round_players WHERE round_id = ? AND participant_id = ?").get(roundId, p.id)
  ) as { mark: number } | undefined;
  if (row) return row.mark;
  const last = db
    .prepare("SELECT mark FROM round_players WHERE participant_id = ? ORDER BY round_id DESC LIMIT 1")
    .get(p.id) as { mark: number } | undefined;
  return last?.mark ?? null;
}

export function say(p: Participant, body: Record<string, unknown>) {
  if (p.agent) fail(403, "agent", "画伴不聊天 / The companion doesn't chat.");
  return act(p, body.actionId, (now, r) => {
    const text = cleanText(body.text);
    if (text === undefined) {
      fail(400, "text", `一句话，最多 ${CHAT.maxLength} 字 / One line of plain text, up to ${CHAT.maxLength} characters.`);
    }
    const recent = (
      db
        .prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE participant_id = ? AND created_at > ?")
        .get(p.id, now - CHAT.window) as { n: number }
    ).n;
    if (recent >= CHAT.burst) fail(429, "chat-slow", "说得太快了，歇一会儿 / That's a lot of messages: wait a few seconds.");
    const phase = phaseOf(r, now);
    // Between dreams the message still records the last round, with phase
    // "finished", so the export can tell "during" from "after".
    const roundId = r?.id ?? null;
    // An optional pointer at one object in the current picture.
    let objectId: number | null = null;
    let motif: string | null = null;
    if (body.objectId !== undefined && body.objectId !== null) {
      const o = (
        typeof body.objectId === "number" && r
          ? db.prepare("SELECT id, motif, round_id, status FROM objects WHERE id = ?").get(body.objectId)
          : undefined
      ) as { id: number; motif: string; round_id: number; status: string } | undefined;
      if (!o || o.round_id !== r?.id || o.status === "withdrawn") fail(404, "object", "画上没有这件 / That object isn't in the picture.");
      objectId = o!.id;
      motif = o!.motif;
    }
    const info = db
      .prepare(
        "INSERT INTO chat_messages (participant_id, round_id, phase, mark, body, object_id, object_motif, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(p.id, roundId, phase, markNow(p, roundId), text, objectId, motif, now);
    const row = db.prepare(`${SELECT} WHERE m.id = ?`).get(Number(info.lastInsertRowid)) as MessageRow;
    const message = publicMessage(row);
    // Not tied to a round's event log: the chat outlives the dream.
    emit(null, "chat", { message, prompt: row.prompt_index }, now);
    return { messageId: message.id };
  });
}

// ---------------------------------------------------------------- export

const promptLine = (i: number | null): string =>
  i === null || !PROMPTS[i] ? "" : `${PROMPTS[i].zh} ${PROMPTS[i].en}`;

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

// Guests who haven't played a round yet show as 客 (guest).
const who = (m: MessageRow): string => (m.mark === null ? "客" : (MARKS[m.mark % MARKS.length]?.glyph ?? "客"));

/**
 * The history (or one round's) as a sequence of string chunks, read a page
 * at a time so a long history never sits in memory at once.
 */
export function* exportChunks(format: "md" | "txt" | "json", roundId?: number): Generator<string> {
  const exported = iso(Date.now());
  const scope = roundId === undefined ? "" : " AND m.round_id = ?";
  const page = db.prepare(`${SELECT} WHERE m.id > ?${scope} ORDER BY m.id LIMIT 500`);
  const title = roundId === undefined ? "六如 · 共梦长卷 chat" : `六如 · 共梦长卷 chat, dream ${roundId}`;
  if (format === "json") yield `{"title":${JSON.stringify(title)},"exportedAt":"${exported}","messages":[`;
  else if (format === "md") yield `# ${title}\n\nExported ${exported}. Public messages from the one shared room, grouped by dream.\n`;
  else yield `${title}\nExported ${exported}\n`;
  let after = 0;
  let first = true;
  let lastRound: number | null | undefined;
  for (;;) {
    const rows = (roundId === undefined ? page.all(after) : page.all(after, roundId)) as MessageRow[];
    if (rows.length === 0) break;
    let out = "";
    for (const m of rows) {
      if (format === "json") {
        out += `${first ? "" : ","}${JSON.stringify({
          id: m.id,
          at: iso(m.created_at),
          round: m.round_id,
          prompt: m.prompt_index === null ? null : PROMPTS[m.prompt_index],
          phase: m.phase,
          mark: who(m),
          text: m.body,
          about: m.object_id === null ? null : { objectId: m.object_id, motif: m.object_motif },
        })}`;
      } else {
        if (m.round_id !== lastRound) {
          const head = m.round_id === null ? "Before the first dream" : `Dream ${m.round_id}: ${promptLine(m.prompt_index)}`;
          out += format === "md" ? `\n## ${head}\n\n` : `\n== ${head} ==\n`;
          lastRound = m.round_id;
        }
        const about = m.object_motif ? ` (about the ${m.object_motif} #${m.object_id})` : "";
        out +=
          format === "md"
            ? `- ${iso(m.created_at)} **${who(m)}**: ${m.body.replace(/([\\`*_[\]<>#])/g, "\\$1")}${about}\n`
            : `[${iso(m.created_at)}] ${who(m)}: ${m.body}${about}\n`;
      }
      first = false;
    }
    after = rows[rows.length - 1].id;
    yield out;
  }
  if (format === "json") yield "]}\n";
  else if (first) yield format === "md" ? "\n_No messages yet._\n" : "\n(no messages yet)\n";
}

export function exists(roundId: number): boolean {
  return !!db.prepare("SELECT 1 FROM rounds WHERE id = ?").get(roundId);
}
