import { randomBytes } from "node:crypto";
import { db } from "./db.ts";
import {
  cleanTransform,
  INTENTS,
  LIMITS,
  MOTIF_BY_ID,
  MOTIFS,
  PROMPTS,
  phaseAt,
  reflectionWater,
  relations,
  SCENE,
} from "../public/shared.js";

// Everything that changes the shared dream goes through this module. Each
// accepted mutation is one SQLite transaction that also appends to `events`
// (monotonic ids); the server broadcasts those events once the transaction
// commits. Time-driven changes (expiries, phase changes, the freeze) happen in
// `reconcile`, which runs before every request and on a short tick.

const secs = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v * 1000 : fallback * 1000;
};

// Configurable so local tests can play a whole round in seconds; production
// runs the defaults. There is deliberately no HTTP route that skips time.
export const TIMING = {
  compose: secs("COMPOSE_SECONDS", 300),
  refine: secs("REFINE_SECONDS", 60),
  reveal: secs("REVEAL_SECONDS", 30),
  dissolve: secs("DISSOLVE_SECONDS", 30),
  lightning: secs("LIGHTNING_SECONDS", 210),
  proposal: secs("PROPOSAL_SECONDS", 20),
  lease: secs("LEASE_SECONDS", 8),
  shadow: 10_000,
  dew: 15_000,
};

export class GameError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status: number, code: string, message: string): never => {
  throw new GameError(status, code, message);
};

export interface Participant {
  id: number;
  pid: string;
}

interface RoundRow {
  id: number;
  prompt_index: number;
  seed: number;
  started_at: number;
  compose_end: number;
  refine_end: number;
  reveal_end: number;
  dissolve_end: number;
  lightning_at: number;
  compose_closed: number;
  status: string;
  announced_phase: string;
}

interface ObjectRow {
  id: number;
  round_id: number;
  motif: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flip: number;
  ink: number;
  depth: number;
  z: number;
  contributor: number;
  custodian: number;
  version: number;
  reflect_on: number | null;
  status: string;
}

interface PlayerRow {
  round_id: number;
  participant_id: number;
  mark: number;
  palette: string;
  rerolls_used: number;
  dew_used: number;
}

interface ProposalRow {
  id: number;
  round_id: number;
  kind: "invite" | "borrow";
  invitation_id: number | null;
  object_id: number | null;
  object_version: number | null;
  proposer: number;
  target: number;
  motif: string;
  transform: string;
  status: string;
  created_at: number;
  expires_at: number;
}

interface OfferRow {
  id: number;
  round_id: number;
  object_id: number;
  object_version: number;
  offerer: number;
  claimant: number | null;
  status: string;
  created_at: number;
  expires_at: number;
  lease_expires_at: number | null;
}

interface InvitationRow {
  id: number;
  round_id: number;
  owner: number;
  x: number;
  y: number;
  intent: string;
  status: string;
  answered_by: number | null;
  created_at: number;
}

interface Shadow {
  id: number;
  motif: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flip: boolean;
  depth: number;
  createdAt: number;
  expiresAt: number;
}

export interface GameEvent {
  id: number;
  type: string;
  payload: unknown;
}

// ---------------------------------------------------------------- identity

const pidCache = new Map<number, string>();

export function participantFor(token: string): Participant {
  const row = db.prepare("SELECT id, pid FROM participants WHERE token = ?").get(token) as
    | Participant
    | undefined;
  if (row) return row;
  const pid = randomBytes(6).toString("hex");
  const info = db
    .prepare("INSERT INTO participants (token, pid, created_at) VALUES (?, ?, ?)")
    .run(token, pid, Date.now());
  return { id: Number(info.lastInsertRowid), pid };
}

function pidOf(id: number): string {
  let pid = pidCache.get(id);
  if (!pid) {
    pid = (db.prepare("SELECT pid FROM participants WHERE id = ?").get(id) as { pid: string }).pid;
    pidCache.set(id, pid);
  }
  return pid;
}

// ---------------------------------------------------------------- events

let pending: GameEvent[] = [];
let broadcaster: (events: GameEvent[]) => void = () => {};

export function onEvents(fn: (events: GameEvent[]) => void): void {
  broadcaster = fn;
}

function emit(roundId: number | null, type: string, payload: unknown, now: number): void {
  const info = db
    .prepare("INSERT INTO events (round_id, type, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(roundId, type, JSON.stringify(payload), now);
  pending.push({ id: Number(info.lastInsertRowid), type, payload });
}

function flush(): void {
  const out = pending;
  pending = [];
  if (out.length > 0) broadcaster(out);
}

export function cursor(): number {
  const row = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'events'").get() as
    | { seq: number }
    | undefined;
  return row?.seq ?? 0;
}

// A transaction whose events are broadcast only once it commits; a thrown
// GameError rolls everything back, events included.
function atomically<T>(fn: () => T): T {
  try {
    const result = db.transaction(fn)();
    flush();
    return result;
  } catch (err) {
    pending = [];
    throw err;
  }
}

// ---------------------------------------------------------------- shadows

let shadowSeq = 0;
let shadows: Shadow[] = [];

function castShadow(o: ObjectRow, now: number): Shadow {
  const s: Shadow = {
    id: ++shadowSeq,
    motif: o.motif,
    x: o.x,
    y: o.y,
    scale: o.scale,
    rotation: o.rotation,
    flip: !!o.flip,
    depth: o.depth,
    createdAt: now,
    expiresAt: now + TIMING.shadow,
  };
  shadows = [...shadows.filter((x) => x.expiresAt > now), s].slice(-24);
  return s;
}

// ---------------------------------------------------------------- rows

const currentRoundStmt = db.prepare("SELECT * FROM rounds ORDER BY id DESC LIMIT 1");
function currentRound(): RoundRow | undefined {
  return currentRoundStmt.get() as RoundRow | undefined;
}

function roundTimes(r: RoundRow) {
  return {
    composeEnd: r.compose_end,
    refineEnd: r.refine_end,
    revealEnd: r.reveal_end,
    dissolveEnd: r.dissolve_end,
  };
}

function phaseOf(r: RoundRow | undefined, now: number): string {
  return phaseAt(r ? roundTimes(r) : undefined, now);
}

function getObject(id: number): ObjectRow | undefined {
  return db.prepare("SELECT * FROM objects WHERE id = ?").get(id) as ObjectRow | undefined;
}

function liveObjects(roundId: number): ObjectRow[] {
  return db
    .prepare("SELECT * FROM objects WHERE round_id = ? AND status != 'withdrawn' ORDER BY id")
    .all(roundId) as ObjectRow[];
}

function getPlayer(roundId: number, participantId: number): PlayerRow | undefined {
  return db
    .prepare("SELECT * FROM round_players WHERE round_id = ? AND participant_id = ?")
    .get(roundId, participantId) as PlayerRow | undefined;
}

function publicObject(o: ObjectRow) {
  return {
    id: o.id,
    motif: o.motif,
    x: o.x,
    y: o.y,
    scale: o.scale,
    rotation: o.rotation,
    flip: !!o.flip,
    ink: o.ink,
    depth: o.depth,
    z: o.z,
    contributor: pidOf(o.contributor),
    custodian: pidOf(o.custodian),
    version: o.version,
    reflectOn: o.reflect_on,
    status: o.status,
  };
}

function publicPlayer(p: PlayerRow) {
  return {
    pid: pidOf(p.participant_id),
    mark: p.mark,
    palette: JSON.parse(p.palette) as string[],
    rerollsUsed: p.rerolls_used,
    dewUsed: p.dew_used,
  };
}

function publicProposal(p: ProposalRow) {
  return {
    id: p.id,
    kind: p.kind,
    invitationId: p.invitation_id,
    objectId: p.object_id,
    objectVersion: p.object_version,
    proposer: pidOf(p.proposer),
    target: pidOf(p.target),
    motif: p.motif,
    transform: JSON.parse(p.transform),
    status: p.status,
    createdAt: p.created_at,
    expiresAt: p.expires_at,
  };
}

function publicOffer(o: OfferRow) {
  const obj = getObject(o.object_id)!;
  return {
    id: o.id,
    objectId: o.object_id,
    offerer: pidOf(o.offerer),
    claimant: o.claimant === null ? null : pidOf(o.claimant),
    status: o.status,
    createdAt: o.created_at,
    expiresAt: o.expires_at,
    leaseExpiresAt: o.lease_expires_at,
    origin: { x: obj.x, y: obj.y },
  };
}

function publicInvitation(i: InvitationRow) {
  return {
    id: i.id,
    owner: pidOf(i.owner),
    x: i.x,
    y: i.y,
    intent: i.intent,
    status: i.status,
    answeredBy: i.answered_by === null ? null : pidOf(i.answered_by),
  };
}

// A patch event carries the full current rows of whatever changed, so a
// client applies it by upserting: idempotent, order-safe within a cursor.
function patch(
  roundId: number,
  now: number,
  type: string,
  ids: {
    objects?: number[];
    proposals?: number[];
    offers?: number[];
    invitations?: number[];
    players?: number[];
    dews?: number[];
    shadows?: Shadow[];
    by?: number;
  },
): void {
  const payload: Record<string, unknown> = {};
  if (ids.objects?.length) payload.objects = ids.objects.map((id) => publicObject(getObject(id)!));
  if (ids.proposals?.length)
    payload.proposals = ids.proposals.map((id) =>
      publicProposal(db.prepare("SELECT * FROM proposals WHERE id = ?").get(id) as ProposalRow),
    );
  if (ids.offers?.length)
    payload.offers = ids.offers.map((id) =>
      publicOffer(db.prepare("SELECT * FROM offers WHERE id = ?").get(id) as OfferRow),
    );
  if (ids.invitations?.length)
    payload.invitations = ids.invitations.map((id) =>
      publicInvitation(db.prepare("SELECT * FROM invitations WHERE id = ?").get(id) as InvitationRow),
    );
  if (ids.players?.length)
    payload.players = ids.players.map((pid) => publicPlayer(getPlayer(roundId, pid)!));
  if (ids.dews?.length)
    payload.dews = ids.dews.map((id) => publicDew(db.prepare("SELECT * FROM dews WHERE id = ?").get(id) as DewRow));
  if (ids.shadows?.length) payload.shadows = ids.shadows;
  if (ids.by !== undefined) payload.by = pidOf(ids.by);
  payload.round = roundId;
  emit(roundId, type, payload, now);
}

interface DewRow {
  id: number;
  participant_id: number;
  x: number;
  y: number;
  created_at: number;
}

function publicDew(d: DewRow) {
  return { id: d.id, by: pidOf(d.participant_id), x: d.x, y: d.y, createdAt: d.created_at };
}

// ---------------------------------------------------------------- dealing

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function heldCounts(roundId: number, except?: number): Map<string, number> {
  const counts = new Map<string, number>();
  const rows = db
    .prepare("SELECT participant_id, palette FROM round_players WHERE round_id = ?")
    .all(roundId) as { participant_id: number; palette: string }[];
  for (const r of rows) {
    if (r.participant_id === except) continue;
    for (const m of JSON.parse(r.palette) as string[]) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return counts;
}

// Least-held first, so palettes complement each other; the seeded jitter
// keeps two rounds from dealing identically.
function pick(candidates: string[], held: Map<string, number>, rand: () => number): string {
  const scored = candidates.map((id) => ({ id, s: (held.get(id) ?? 0) + rand() * 0.9 }));
  scored.sort((a, b) => a.s - b.s);
  return scored[0].id;
}

function deal(roundId: number, seed: number, joinIndex: number): string[] {
  const rand = rng(seed * 31 + joinIndex * 7919);
  const held = heldCounts(roundId);
  const palette: string[] = [];
  const take = (pool: string[]) => {
    const free = pool.filter((id) => !palette.includes(id));
    if (free.length) palette.push(pick(free, held, rand));
  };
  const ids = (f: (m: (typeof MOTIFS)[number]) => boolean) => MOTIFS.filter(f).map((m) => m.id);
  if (joinIndex === 0) {
    // The first dreamer may be alone: give them water and something that
    // answers it, so a solo scene can still discover a relationship.
    palette.push("water");
    take(["boat", "sailboat", "moon"]);
  } else {
    take(ids((m) => m.role === "ground"));
  }
  take(ids((m) => m.role === "focal" && m.group !== "landscape"));
  take(ids((m) => m.group === "atmosphere" || m.role === "detail"));
  // Fill, spreading across groups before doubling up on one.
  while (palette.length < LIMITS.paletteSize) {
    const groupsUsed = new Set(palette.map((id) => MOTIF_BY_ID[id].group));
    const fresh = ids((m) => !palette.includes(m.id) && !groupsUsed.has(m.group));
    take(fresh.length ? fresh : ids((m) => !palette.includes(m.id)));
  }
  return palette;
}

function ensurePlayer(r: RoundRow, p: Participant, now: number): PlayerRow | undefined {
  const phase = phaseOf(r, now);
  const existing = getPlayer(r.id, p.id);
  if (existing || (phase !== "compose" && phase !== "refine")) return existing;
  const count = (
    db.prepare("SELECT COUNT(*) AS n FROM round_players WHERE round_id = ?").get(r.id) as { n: number }
  ).n;
  // Late in the round placement is closed, so a newcomer gets no palette but
  // can still borrow, catch bubbles and answer openings.
  const palette = phase === "compose" ? deal(r.id, r.seed, count) : [];
  db.prepare(
    "INSERT INTO round_players (round_id, participant_id, mark, palette, joined_at) VALUES (?, ?, ?, ?, ?)",
  ).run(r.id, p.id, count % 12, JSON.stringify(palette), now);
  patch(r.id, now, "joined", { players: [p.id] });
  return getPlayer(r.id, p.id);
}

/** Join the current round (if it's open) and return a fresh snapshot. */
export function join(p: Participant, online: Set<string>) {
  const now = Date.now();
  atomically(() => {
    reconcileIn(now);
    const r = currentRound();
    if (r) ensurePlayer(r, p, now);
  });
  return snapshot(p, online);
}

// ---------------------------------------------------------------- snapshot

export function snapshot(p: Participant, online: Set<string>) {
  const now = Date.now();
  const r = currentRound();
  const phase = phaseOf(r, now);
  const showScene = r && phase !== "finished";
  const objects = showScene ? liveObjects(r.id).map(publicObject) : [];
  const lastArchive = db
    .prepare("SELECT round_id FROM archives ORDER BY round_id DESC LIMIT 1")
    .get() as { round_id: number } | undefined;
  return {
    serverNow: now,
    cursor: cursor(),
    me: p.pid,
    phase,
    round: r
      ? {
          id: r.id,
          prompt: PROMPTS[r.prompt_index],
          promptIndex: r.prompt_index,
          seed: r.seed,
          startedAt: r.started_at,
          ...roundTimes(r),
          lightningAt: r.lightning_at,
          archived: r.status === "archived",
        }
      : null,
    players: r
      ? (db.prepare("SELECT * FROM round_players WHERE round_id = ? ORDER BY mark").all(r.id) as PlayerRow[])
          .map(publicPlayer)
          .map((pl) => ({ ...pl, online: online.has(pl.pid) }))
      : [],
    objects,
    relations: relations(objects),
    invitations: showScene
      ? (
          db
            .prepare("SELECT * FROM invitations WHERE round_id = ? AND status IN ('open','acknowledged')")
            .all(r.id) as InvitationRow[]
        ).map(publicInvitation)
      : [],
    proposals: showScene
      ? (
          db.prepare("SELECT * FROM proposals WHERE round_id = ? AND status = 'pending'").all(r.id) as ProposalRow[]
        ).map(publicProposal)
      : [],
    offers: showScene
      ? (
          db
            .prepare("SELECT * FROM offers WHERE round_id = ? AND status IN ('floating','claimed')")
            .all(r.id) as OfferRow[]
        ).map(publicOffer)
      : [],
    dews: showScene
      ? (
          db
            .prepare("SELECT * FROM dews WHERE round_id = ? AND created_at > ?")
            .all(r.id, now - TIMING.dew) as DewRow[]
        ).map(publicDew)
      : [],
    shadows: shadows.filter((s) => s.expiresAt > now),
    lastArchive: lastArchive?.round_id ?? null,
    nextPrompt: PROMPTS[nextPromptIndex()],
    timing: { proposal: TIMING.proposal, lease: TIMING.lease, shadow: TIMING.shadow, dew: TIMING.dew },
  };
}

// ---------------------------------------------------------------- reconcile

function returnOffer(o: OfferRow, status: string, now: number): void {
  db.prepare("UPDATE offers SET status = ? WHERE id = ?").run(status, o.id);
  const obj = getObject(o.object_id)!;
  if (obj.status === "offered" || obj.status === "leased") {
    db.prepare("UPDATE objects SET status = 'placed', version = version + 1 WHERE id = ?").run(obj.id);
  }
  patch(o.round_id, now, "offer-returned", { offers: [o.id], objects: [obj.id] });
}

function archiveRound(r: RoundRow, now: number): void {
  const claimed = db
    .prepare("UPDATE rounds SET status = 'archived', archived_at = ? WHERE id = ? AND status = 'active'")
    .run(now, r.id);
  if (claimed.changes !== 1) return;
  const marks = new Map<number, number>(
    (
      db.prepare("SELECT participant_id, mark FROM round_players WHERE round_id = ?").all(r.id) as {
        participant_id: number;
        mark: number;
      }[]
    ).map((row) => [row.participant_id, row.mark]),
  );
  const compact = (o: ObjectRow) => ({
    id: o.id,
    motif: o.motif,
    x: o.x,
    y: o.y,
    scale: o.scale,
    rotation: o.rotation,
    flip: !!o.flip,
    ink: o.ink,
    depth: o.depth,
    z: o.z,
    reflectOn: o.reflect_on,
    status: "placed",
    contributor: marks.get(o.contributor) ?? 0,
    custodian: marks.get(o.custodian) ?? 0,
  });
  const scene = (
    db.prepare("SELECT * FROM objects WHERE round_id = ? AND status = 'placed' ORDER BY id").all(r.id) as ObjectRow[]
  ).map(compact);

  // Bounded keyframes for a stepped replay: replay the round's object
  // events and keep at most ten evenly spaced states plus the final one.
  const evs = db
    .prepare("SELECT payload FROM events WHERE round_id = ? ORDER BY id")
    .all(r.id) as { payload: string }[];
  const objectEvents = evs
    .map((e) => JSON.parse(e.payload) as { objects?: ReturnType<typeof publicObject>[] })
    .filter((e) => e.objects?.length);
  const state = new Map<number, ReturnType<typeof compact>>();
  const keyframes: ReturnType<typeof compact>[][] = [];
  const step = Math.max(1, Math.ceil(objectEvents.length / 10));
  objectEvents.forEach((e, i) => {
    for (const o of e.objects!) {
      if (o.status === "placed") {
        state.set(o.id, {
          ...o,
          status: "placed",
          contributor: 0,
          custodian: 0,
        });
      } else if (o.status === "withdrawn") state.delete(o.id);
    }
    if ((i + 1) % step === 0 && i + 1 < objectEvents.length) keyframes.push([...state.values()]);
  });
  keyframes.push(scene);

  db.prepare(
    "INSERT OR IGNORE INTO archives (round_id, prompt_index, scene, keyframes, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(r.id, r.prompt_index, JSON.stringify(scene), JSON.stringify(keyframes), now);
  // The archive now holds what the replay needs; the round's raw event log
  // is scaffolding and would otherwise grow without bound.
  db.prepare("DELETE FROM events WHERE round_id = ?").run(r.id);
  db.prepare("DELETE FROM actions WHERE created_at < ?").run(now - 86_400_000);
}

function reconcileIn(now: number): void {
  const r = currentRound();
  if (!r) return;
  const expiredProposals = db
    .prepare("SELECT * FROM proposals WHERE round_id = ? AND status = 'pending' AND expires_at <= ?")
    .all(r.id, now) as ProposalRow[];
  for (const p of expiredProposals) {
    db.prepare("UPDATE proposals SET status = 'expired' WHERE id = ?").run(p.id);
    patch(r.id, now, "proposal-expired", { proposals: [p.id] });
  }
  const floating = db
    .prepare("SELECT * FROM offers WHERE round_id = ? AND status = 'floating' AND expires_at <= ?")
    .all(r.id, now) as OfferRow[];
  for (const o of floating) returnOffer(o, "expired", now);
  const leased = db
    .prepare("SELECT * FROM offers WHERE round_id = ? AND status = 'claimed' AND lease_expires_at <= ?")
    .all(r.id, now) as OfferRow[];
  for (const o of leased) returnOffer(o, "returned", now);

  const phase = phaseOf(r, now);
  if (phase !== "compose" && !r.compose_closed) {
    db.prepare("UPDATE rounds SET compose_closed = 1 WHERE id = ?").run(r.id);
    // Placement is over: answers that would add a new object can't land.
    const cancelled = db
      .prepare("SELECT id FROM proposals WHERE round_id = ? AND kind = 'invite' AND status = 'pending'")
      .all(r.id) as { id: number }[];
    db.prepare("UPDATE proposals SET status = 'cancelled' WHERE round_id = ? AND kind = 'invite' AND status = 'pending'").run(r.id);
    const closed = db
      .prepare("SELECT id FROM invitations WHERE round_id = ? AND status = 'open' AND intent != 'open'")
      .all(r.id) as { id: number }[];
    db.prepare("UPDATE invitations SET status = 'closed' WHERE round_id = ? AND status = 'open' AND intent != 'open'").run(r.id);
    patch(r.id, now, "compose-closed", {
      proposals: cancelled.map((c) => c.id),
      invitations: closed.map((c) => c.id),
    });
  }
  if (r.status === "active" && now >= r.refine_end) {
    const open = db
      .prepare("SELECT id FROM proposals WHERE round_id = ? AND status = 'pending'")
      .all(r.id) as { id: number }[];
    db.prepare("UPDATE proposals SET status = 'cancelled' WHERE round_id = ? AND status = 'pending'").run(r.id);
    if (open.length) patch(r.id, now, "frozen-cancel", { proposals: open.map((o) => o.id) });
    const live = db
      .prepare("SELECT * FROM offers WHERE round_id = ? AND status IN ('floating','claimed')")
      .all(r.id) as OfferRow[];
    for (const o of live) returnOffer(o, "returned", now);
    archiveRound(r, now);
  }
  if (phase !== r.announced_phase && phase !== "compose") {
    db.prepare("UPDATE rounds SET announced_phase = ? WHERE id = ?").run(phase, r.id);
    emit(r.id, "phase", { round: r.id, phase }, now);
  }
}

export function reconcile(now = Date.now()): void {
  atomically(() => reconcileIn(now));
}

// ---------------------------------------------------------------- actions

const ACTION_ID = /^[a-z]+:[A-Za-z0-9_-]{8,64}$/;

/**
 * Run one mutation exactly once per (participant, actionId): a retried
 * request gets the stored response back instead of acting twice.
 */
export function act<T>(p: Participant, actionId: unknown, fn: (now: number, r: RoundRow) => T): T {
  if (typeof actionId !== "string" || !ACTION_ID.test(actionId)) {
    fail(400, "action-id", "每个动作需要一个编号 / Every action needs an action id.");
  }
  const now = Date.now();
  return atomically(() => {
    reconcileIn(now);
    const done = db
      .prepare("SELECT response FROM actions WHERE participant_id = ? AND action_id = ?")
      .get(p.id, actionId) as { response: string } | undefined;
    if (done) return JSON.parse(done.response) as T;
    const r = currentRound();
    const result = fn(now, r as RoundRow);
    db.prepare("INSERT INTO actions (participant_id, action_id, response, created_at) VALUES (?, ?, ?, ?)").run(
      p.id,
      actionId,
      JSON.stringify(result ?? null),
      now,
    );
    return result;
  });
}

function requirePhase(r: RoundRow | undefined, now: number, allowed: string[]): RoundRow {
  const phase = phaseOf(r, now);
  if (!r || !allowed.includes(phase)) {
    const why =
      phase === "refine" && allowed.includes("compose") && !allowed.includes("refine")
        ? "现在只调整，不添新景 / Placement has closed: only refine what's there."
        : phase === "reveal" || phase === "dissolve"
          ? "画卷已定 / The scroll is frozen."
          : "此刻不能这样做 / Not possible in this phase.";
    fail(409, "phase", why);
  }
  return r!;
}

function requirePlayer(r: RoundRow, p: Participant, now: number): PlayerRow {
  const player = ensurePlayer(r, p, now);
  if (!player) fail(409, "not-playing", "下一梦再加入 / Join the next dream.");
  return player!;
}

function objectInRound(r: RoundRow, id: unknown): ObjectRow {
  const o = typeof id === "number" ? getObject(id) : undefined;
  if (!o || o.round_id !== r.id || o.status === "withdrawn") fail(404, "object", "找不到此物 / No such object.");
  return o!;
}

function requireVersion(o: ObjectRow, version: unknown): void {
  if (version !== o.version) {
    fail(409, "stale", "此物刚被改动，请看新的样子 / That object just changed: look at its new state first.");
  }
}

// The scroll's limit counts objects on it; a handover moves one without
// adding to it, so handovers check only the receiver's hands.
function sceneCapacity(r: RoundRow): void {
  const scene = (
    db
      .prepare("SELECT COUNT(*) AS n FROM objects WHERE round_id = ? AND status != 'withdrawn'")
      .get(r.id) as { n: number }
  ).n;
  if (scene >= LIMITS.sceneObjects) {
    fail(409, "scene-full", "画卷已满，收回一件可腾出位置 / The scroll is full: withdrawing one frees a place.");
  }
}

// A caught bubble still being set down counts against the catcher's hands.
function handsCapacity(r: RoundRow, custodian: number): void {
  const mine = (
    db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM objects WHERE round_id = ? AND custodian = ? AND status != 'withdrawn') + (SELECT COUNT(*) FROM offers WHERE round_id = ? AND claimant = ? AND status = 'claimed') AS n",
      )
      .get(r.id, custodian, r.id, custodian) as { n: number }
  ).n;
  if (mine >= LIMITS.perCustodian) {
    fail(409, "hands-full", "你照看的已有十二件 / You're already caring for twelve objects.");
  }
}

function capacity(r: RoundRow, custodian: number): void {
  sceneCapacity(r);
  handsCapacity(r, custodian);
}

function inScene(x: unknown, y: unknown): { x: number; y: number } {
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x > SCENE.width ||
    y > SCENE.height
  ) {
    fail(400, "position", "位置不在画卷上 / That position is off the scroll.");
  }
  return { x: x as number, y: y as number };
}

// After any object change: borrow requests made against an older version are
// stale, and reflections whose water moved away return to solid form.
function settle(r: RoundRow, now: number, changed: number[]): number[] {
  const stale = db
    .prepare(
      "SELECT p.id FROM proposals p JOIN objects o ON o.id = p.object_id WHERE p.round_id = ? AND p.kind = 'borrow' AND p.status = 'pending' AND p.object_version != o.version",
    )
    .all(r.id) as { id: number }[];
  for (const s of stale) db.prepare("UPDATE proposals SET status = 'stale' WHERE id = ?").run(s.id);
  const live = liveObjects(r.id);
  const scene = live.map(publicObject);
  const restored: number[] = [];
  for (const o of live.filter((x) => x.reflect_on !== null)) {
    const water = scene.find((w) => w.id === o.reflect_on);
    const still = water && water.status === "placed" && reflectionWater(publicObject(o), scene);
    if (!still || o.status !== "placed") {
      db.prepare("UPDATE objects SET reflect_on = NULL, version = version + 1 WHERE id = ?").run(o.id);
      restored.push(o.id);
    }
  }
  if (stale.length || restored.length) {
    patch(r.id, now, "settled", { proposals: stale.map((s) => s.id), objects: restored });
  }
  return [...changed, ...restored];
}

type Body = Record<string, unknown>;

// The first dream is always the rain; after that a fixed shuffled walk
// through the other five, so consecutive rounds don't repeat.
const PROMPT_ORDER = [3, 1, 5, 2, 4];
function nextPromptIndex(): number {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM rounds").get() as { n: number }).n;
  return count === 0 ? 0 : PROMPT_ORDER[(count - 1) % PROMPT_ORDER.length];
}

export function startRound(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    const phase = phaseOf(r, now);
    if (r && phase !== "finished") return { roundId: r.id };
    const seed = randomBytes(4).readUInt32BE(0);
    const promptIndex = nextPromptIndex();
    const composeEnd = now + TIMING.compose;
    const refineEnd = composeEnd + TIMING.refine;
    const revealEnd = refineEnd + TIMING.reveal;
    const dissolveEnd = revealEnd + TIMING.dissolve;
    const info = db
      .prepare(
        "INSERT INTO rounds (prompt_index, seed, started_at, compose_end, refine_end, reveal_end, dissolve_end, lightning_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(promptIndex, seed, now, composeEnd, refineEnd, revealEnd, dissolveEnd, now + Math.min(TIMING.lightning, TIMING.compose - 1000));
    const roundId = Number(info.lastInsertRowid);
    emit(roundId, "round-started", { round: roundId }, now);
    ensurePlayer(currentRound()!, p, now);
    return { roundId };
  });
}

export function reroll(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose"]);
    const player = requirePlayer(r, p, now);
    const slot = body.slot;
    const palette = JSON.parse(player.palette) as string[];
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= palette.length) {
      fail(400, "slot", "没有这一格 / No such palette slot.");
    }
    if (player.rerolls_used >= LIMITS.rerolls) fail(409, "rerolls", "本梦换过两次了 / Both rerolls are used.");
    const held = heldCounts(r.id, p.id);
    const rand = rng(r.seed + p.id * 13 + player.rerolls_used * 101);
    palette[slot as number] = pick(
      MOTIFS.map((m) => m.id).filter((id) => !palette.includes(id)),
      held,
      rand,
    );
    db.prepare(
      "UPDATE round_players SET palette = ?, rerolls_used = rerolls_used + 1 WHERE round_id = ? AND participant_id = ?",
    ).run(JSON.stringify(palette), r.id, p.id);
    patch(r.id, now, "rerolled", { players: [p.id] });
    return { palette };
  });
}

export function place(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose"]);
    const player = requirePlayer(r, p, now);
    const motif = body.motif;
    if (typeof motif !== "string" || !Object.hasOwn(MOTIF_BY_ID, motif)) fail(400, "motif", "没有这种景物 / Unknown motif.");
    if (!(JSON.parse(player.palette) as string[]).includes(motif as string)) {
      fail(403, "not-yours", "这不在你的素材匣里，可向别人借 / Not in your tray: ask someone who has it.");
    }
    const t = cleanTransform(body, motif);
    if (!t) fail(400, "transform", "位置或大小超出范围 / Position or size out of range.");
    capacity(r, p.id);
    const z = (db.prepare("SELECT COALESCE(MAX(z), 0) + 1 AS z FROM objects WHERE round_id = ?").get(r.id) as { z: number }).z;
    const info = db
      .prepare(
        "INSERT INTO objects (round_id, motif, x, y, scale, rotation, flip, ink, depth, z, contributor, custodian, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(r.id, motif, t!.x, t!.y, t!.scale, t!.rotation, t!.flip ? 1 : 0, t!.ink, t!.depth, z, p.id, p.id, now);
    const id = Number(info.lastInsertRowid);
    patch(r.id, now, "placed", { objects: [id], by: p.id });
    return { objectId: id };
  });
}

function custodianObject(r: RoundRow, p: Participant, body: Body): ObjectRow {
  const o = objectInRound(r, body.objectId);
  if (o.custodian !== p.id) fail(403, "custody", "此物由别人照看，可提议借景 / Someone else cares for this: suggest a move instead.");
  if (o.status !== "placed") fail(409, "busy", "此物正在泡中 / That object is in a bubble right now.");
  requireVersion(o, body.version);
  return o;
}

export function update(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose", "refine"]);
    const o = custodianObject(r, p, body);
    const t = cleanTransform(body, o.motif);
    if (!t) fail(400, "transform", "位置或大小超出范围 / Position or size out of range.");
    db.prepare(
      "UPDATE objects SET x = ?, y = ?, scale = ?, rotation = ?, flip = ?, ink = ?, depth = ?, version = version + 1 WHERE id = ?",
    ).run(t!.x, t!.y, t!.scale, t!.rotation, t!.flip ? 1 : 0, t!.ink, t!.depth, o.id);
    const moved = Math.hypot(t!.x - o.x, t!.y - o.y) > 30;
    const shadow = moved ? [castShadow(o, now)] : [];
    patch(r.id, now, "updated", { objects: settle(r, now, [o.id]), shadows: shadow, by: p.id });
    return { version: getObject(o.id)!.version };
  });
}

export function withdraw(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose", "refine"]);
    const o = custodianObject(r, p, body);
    db.prepare("UPDATE objects SET status = 'withdrawn', reflect_on = NULL, version = version + 1 WHERE id = ?").run(o.id);
    const cancelled = db
      .prepare("SELECT id FROM proposals WHERE object_id = ? AND status = 'pending'")
      .all(o.id) as { id: number }[];
    db.prepare("UPDATE proposals SET status = 'cancelled' WHERE object_id = ? AND status = 'pending'").run(o.id);
    patch(r.id, now, "withdrawn", {
      objects: settle(r, now, [o.id]),
      proposals: cancelled.map((c) => c.id),
      shadows: [castShadow(o, now)],
      by: p.id,
    });
    return { ok: true };
  });
}

export function reflect(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose", "refine"]);
    const o = custodianObject(r, p, body);
    let waterId: number | null = null;
    if (body.on === true) {
      if (MOTIF_BY_ID[o.motif].noReflect || MOTIF_BY_ID[o.motif].tags.includes("water")) {
        fail(409, "no-reflect", "此物不能化影 / This motif can't become a reflection.");
      }
      const water = reflectionWater(publicObject(o), liveObjects(r.id).map(publicObject));
      if (!water) fail(409, "no-water", "附近没有水面，移近水边再试 / No water nearby: move it to the water's edge.");
      waterId = water!.id;
    }
    db.prepare("UPDATE objects SET reflect_on = ?, version = version + 1 WHERE id = ?").run(waterId, o.id);
    patch(r.id, now, "reflected", { objects: settle(r, now, [o.id]), by: p.id });
    return { reflectOn: waterId };
  });
}

export function invite(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose"]);
    requirePlayer(r, p, now);
    const { x, y } = inScene(body.x, body.y);
    const intent = body.intent;
    if (typeof intent !== "string" || !Object.hasOwn(INTENTS, intent)) fail(400, "intent", "未知的意图 / Unknown intention.");
    const open = (
      db
        .prepare("SELECT COUNT(*) AS n FROM invitations WHERE round_id = ? AND owner = ?")
        .get(r.id, p.id) as { n: number }
    ).n;
    if (open >= LIMITS.invitationsPerPlayer) fail(409, "invitations", "每梦最多留两处空白 / Two openings per dream at most.");
    const info = db
      .prepare("INSERT INTO invitations (round_id, owner, x, y, intent, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(r.id, p.id, x, y, intent, now);
    const id = Number(info.lastInsertRowid);
    patch(r.id, now, "invited", { invitations: [id], by: p.id });
    return { invitationId: id };
  });
}

function getInvitation(r: RoundRow, id: unknown): InvitationRow {
  const i =
    typeof id === "number"
      ? (db.prepare("SELECT * FROM invitations WHERE id = ?").get(id) as InvitationRow | undefined)
      : undefined;
  if (!i || i.round_id !== r.id) fail(404, "invitation", "找不到这处留白 / No such opening.");
  if (i!.status !== "open") fail(409, "closed", "这处留白已有回应 / That opening has already been answered.");
  return i!;
}

export function respond(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose"]);
    const player = requirePlayer(r, p, now);
    const i = getInvitation(r, body.invitationId);
    if (i.owner === p.id) fail(409, "own", "这是你自己留的空白 / That's your own opening.");
    if (i.intent === "open") fail(409, "ack-only", "留白只需会意 / A space left open only needs acknowledging.");
    const busy = db
      .prepare("SELECT id FROM proposals WHERE invitation_id = ? AND status = 'pending'")
      .get(i.id);
    if (busy) fail(409, "busy", "已有人在回应 / Someone is already answering it.");
    const motif = body.motif;
    if (typeof motif !== "string" || !Object.hasOwn(MOTIF_BY_ID, motif)) fail(400, "motif", "没有这种景物 / Unknown motif.");
    if (!(JSON.parse(player.palette) as string[]).includes(motif as string)) {
      fail(403, "not-yours", "只能用自己素材匣里的 / Answer with a motif from your own tray.");
    }
    const t = cleanTransform({ x: i.x, y: i.y, ...(body as object) }, motif);
    if (!t) fail(400, "transform", "位置或大小超出范围 / Position or size out of range.");
    if (Math.hypot(t!.x - i.x, t!.y - i.y) > 160) {
      fail(400, "too-far", "回应要放在留白附近 / An answer belongs near the opening it answers.");
    }
    const info = db
      .prepare(
        "INSERT INTO proposals (round_id, kind, invitation_id, proposer, target, motif, transform, created_at, expires_at) VALUES (?, 'invite', ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(r.id, i.id, p.id, i.owner, motif, JSON.stringify(t), now, now + TIMING.proposal);
    const id = Number(info.lastInsertRowid);
    patch(r.id, now, "proposed", { proposals: [id], by: p.id });
    return { proposalId: id };
  });
}

export function acknowledge(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose", "refine"]);
    requirePlayer(r, p, now);
    const i = getInvitation(r, body.invitationId);
    if (i.owner === p.id) fail(409, "own", "这是你自己留的空白 / That's your own opening.");
    if (i.intent !== "open") fail(409, "needs-motif", "这处留白在等一件景物 / This opening is waiting for a motif.");
    db.prepare("UPDATE invitations SET status = 'acknowledged', answered_by = ? WHERE id = ?").run(p.id, i.id);
    patch(r.id, now, "acknowledged", { invitations: [i.id], by: p.id });
    return { ok: true };
  });
}

export function borrow(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose", "refine"]);
    requirePlayer(r, p, now);
    const o = objectInRound(r, body.objectId);
    if (o.custodian === p.id) fail(409, "own", "这本就由你照看 / You already care for this.");
    if (o.status !== "placed") fail(409, "busy", "此物正在泡中 / That object is in a bubble right now.");
    requireVersion(o, body.version);
    const busy = db.prepare("SELECT id FROM proposals WHERE object_id = ? AND status = 'pending'").get(o.id);
    if (busy) fail(409, "busy", "已有人提议借景 / Someone has already suggested a move.");
    const t = cleanTransform(
      { scale: o.scale, rotation: o.rotation, flip: !!o.flip, ink: o.ink, depth: o.depth, ...(body as object) },
      o.motif,
    );
    if (!t) fail(400, "transform", "位置或大小超出范围 / Position or size out of range.");
    const info = db
      .prepare(
        "INSERT INTO proposals (round_id, kind, object_id, object_version, proposer, target, motif, transform, created_at, expires_at) VALUES (?, 'borrow', ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(r.id, o.id, o.version, p.id, o.custodian, o.motif, JSON.stringify(t), now, now + TIMING.proposal);
    const id = Number(info.lastInsertRowid);
    patch(r.id, now, "proposed", { proposals: [id], by: p.id });
    return { proposalId: id };
  });
}

function getProposal(r: RoundRow, id: unknown): ProposalRow {
  const pr =
    typeof id === "number"
      ? (db.prepare("SELECT * FROM proposals WHERE id = ?").get(id) as ProposalRow | undefined)
      : undefined;
  if (!pr || pr.round_id !== r.id) fail(404, "proposal", "找不到这条提议 / No such proposal.");
  if (pr!.status !== "pending") {
    const why: Record<string, string> = {
      expired: "提议已过时 / That proposal has expired.",
      stale: "此物已变，提议作废 / The object changed, so the proposal no longer applies.",
      declined: "提议已被婉拒 / That proposal was declined.",
      cancelled: "提议已撤回 / That proposal was withdrawn.",
      accepted: "提议已被接受 / That proposal was already accepted.",
    };
    fail(409, pr!.status, why[pr!.status] ?? "提议已结束 / That proposal has ended.");
  }
  return pr!;
}

export function accept(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose", "refine"]);
    const pr = getProposal(r, body.proposalId);
    if (pr.target !== p.id) fail(403, "not-yours", "这条提议不是给你的 / That proposal isn't addressed to you.");
    const t = JSON.parse(pr.transform);
    if (pr.kind === "invite") {
      requirePhase(r, now, ["compose"]);
      const i = getInvitation(r, pr.invitation_id);
      capacity(r, pr.proposer);
      const z = (db.prepare("SELECT COALESCE(MAX(z), 0) + 1 AS z FROM objects WHERE round_id = ?").get(r.id) as { z: number }).z;
      const info = db
        .prepare(
          "INSERT INTO objects (round_id, motif, x, y, scale, rotation, flip, ink, depth, z, contributor, custodian, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(r.id, pr.motif, t.x, t.y, t.scale, t.rotation, t.flip ? 1 : 0, t.ink, t.depth, z, pr.proposer, pr.proposer, now);
      db.prepare("UPDATE invitations SET status = 'answered', answered_by = ? WHERE id = ?").run(pr.proposer, i.id);
      db.prepare("UPDATE proposals SET status = 'accepted' WHERE id = ?").run(pr.id);
      const id = Number(info.lastInsertRowid);
      patch(r.id, now, "invite-accepted", { objects: [id], proposals: [pr.id], invitations: [i.id], by: p.id });
      return { objectId: id };
    }
    const o = getObject(pr.object_id!)!;
    if (o.version !== pr.object_version || o.status !== "placed" || o.custodian !== p.id) {
      db.prepare("UPDATE proposals SET status = 'stale' WHERE id = ?").run(pr.id);
      patch(r.id, now, "settled", { proposals: [pr.id] });
      // The stale mark has to survive the error response, so this one
      // returns a refusal instead of throwing (which would roll it back).
      return { ok: false, code: "stale", message: "此物已变，提议作废 / The object changed, so the proposal no longer applies." };
    }
    handsCapacity(r, pr.proposer);
    db.prepare(
      "UPDATE objects SET x = ?, y = ?, scale = ?, rotation = ?, flip = ?, ink = ?, depth = ?, custodian = ?, version = version + 1 WHERE id = ?",
    ).run(t.x, t.y, t.scale, t.rotation, t.flip ? 1 : 0, t.ink, t.depth, pr.proposer, o.id);
    db.prepare("UPDATE proposals SET status = 'accepted' WHERE id = ?").run(pr.id);
    const moved = Math.hypot(t.x - o.x, t.y - o.y) > 30;
    patch(r.id, now, "borrow-accepted", {
      objects: settle(r, now, [o.id]),
      proposals: [pr.id],
      shadows: moved ? [castShadow(o, now)] : [],
      by: p.id,
    });
    return { ok: true, objectId: o.id };
  });
}

function closeProposal(p: Participant, body: Body, status: "declined" | "cancelled") {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose", "refine"]);
    const pr = getProposal(r, body.proposalId);
    const who = status === "declined" ? pr.target : pr.proposer;
    if (who !== p.id) fail(403, "not-yours", "这不由你决定 / That isn't yours to decide.");
    db.prepare("UPDATE proposals SET status = ? WHERE id = ?").run(status, pr.id);
    patch(r.id, now, `proposal-${status}`, { proposals: [pr.id], by: p.id });
    return { ok: true };
  });
}

export const decline = (p: Participant, body: Body) => closeProposal(p, body, "declined");
export const cancelProposal = (p: Participant, body: Body) => closeProposal(p, body, "cancelled");

export function offer(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose", "refine"]);
    const o = custodianObject(r, p, body);
    db.prepare("UPDATE objects SET status = 'offered', reflect_on = NULL, version = version + 1 WHERE id = ?").run(o.id);
    const info = db
      .prepare(
        "INSERT INTO offers (round_id, object_id, object_version, offerer, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(r.id, o.id, o.version + 1, p.id, now, Math.min(now + TIMING.proposal, r.refine_end));
    const id = Number(info.lastInsertRowid);
    patch(r.id, now, "offered", { offers: [id], objects: settle(r, now, [o.id]), by: p.id });
    return { offerId: id };
  });
}

function getOffer(r: RoundRow, id: unknown): OfferRow {
  const o =
    typeof id === "number"
      ? (db.prepare("SELECT * FROM offers WHERE id = ?").get(id) as OfferRow | undefined)
      : undefined;
  if (!o || o.round_id !== r.id) fail(404, "offer", "找不到这个泡 / No such bubble.");
  return o!;
}

export function claim(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose", "refine"]);
    requirePlayer(r, p, now);
    const o = getOffer(r, body.offerId);
    if (o.offerer === p.id) fail(409, "own", "这是你自己放出的泡 / That's your own bubble.");
    if (o.status === "claimed" || o.status === "completed") {
      fail(409, "taken", "已被接住 / Someone has already received it.");
    }
    if (o.status !== "floating") fail(409, "gone", "泡已散了 / That bubble has burst.");
    handsCapacity(r, p.id);
    const lease = Math.min(now + TIMING.lease, r.refine_end);
    // The status guard is the race: of two simultaneous claims, only one
    // update finds the offer still floating.
    const won = db
      .prepare(
        "UPDATE offers SET status = 'claimed', claimant = ?, lease_expires_at = ? WHERE id = ? AND status = 'floating'",
      )
      .run(p.id, lease, o.id);
    if (won.changes !== 1) fail(409, "taken", "已被接住 / Someone has already received it.");
    db.prepare("UPDATE objects SET status = 'leased', version = version + 1 WHERE id = ?").run(o.object_id);
    patch(r.id, now, "claimed", { offers: [o.id], objects: [o.object_id], by: p.id });
    return { leaseExpiresAt: lease };
  });
}

export function placeClaimed(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose", "refine"]);
    const of = getOffer(r, body.offerId);
    if (of.status !== "claimed" || of.claimant !== p.id) fail(409, "lease", "接住的时限已过 / The placement window has passed.");
    const obj = getObject(of.object_id)!;
    const { x, y } = inScene(body.x, body.y);
    db.prepare(
      "UPDATE objects SET x = ?, y = ?, custodian = ?, status = 'placed', version = version + 1 WHERE id = ?",
    ).run(x, y, p.id, obj.id);
    db.prepare("UPDATE offers SET status = 'completed' WHERE id = ?").run(of.id);
    patch(r.id, now, "received", {
      offers: [of.id],
      objects: settle(r, now, [obj.id]),
      shadows: [castShadow(obj, now)],
      by: p.id,
    });
    return { objectId: obj.id };
  });
}

export function releaseOffer(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose", "refine"]);
    const of = getOffer(r, body.offerId);
    const mine =
      (of.status === "claimed" && of.claimant === p.id) || (of.status === "floating" && of.offerer === p.id);
    if (!mine) fail(409, "not-yours", "这个泡不由你收回 / That bubble isn't yours to release.");
    returnOffer(of, of.status === "floating" ? "cancelled" : "returned", now);
    return { ok: true };
  });
}

export function dew(p: Participant, body: Body) {
  return act(p, body.actionId, (now, r) => {
    r = requirePhase(r, now, ["compose", "refine"]);
    const player = requirePlayer(r, p, now);
    if (player.dew_used >= LIMITS.dew) fail(409, "dew", "本梦的两滴露已用 / Both drops of dew are used.");
    const { x, y } = inScene(body.x, body.y);
    const info = db
      .prepare("INSERT INTO dews (round_id, participant_id, x, y, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(r.id, p.id, x, y, now);
    db.prepare("UPDATE round_players SET dew_used = dew_used + 1 WHERE round_id = ? AND participant_id = ?").run(
      r.id,
      p.id,
    );
    const id = Number(info.lastInsertRowid);
    patch(r.id, now, "dew", { dews: [id], players: [p.id], by: p.id });
    return { dewId: id };
  });
}

// ---------------------------------------------------------------- archive

export interface ArchiveRow {
  round_id: number;
  prompt_index: number;
  scene: string;
  keyframes: string;
  created_at: number;
}

export function archives(page: number, perPage = 12): { rows: ArchiveRow[]; more: boolean } {
  const rows = db
    .prepare("SELECT * FROM archives ORDER BY round_id DESC LIMIT ? OFFSET ?")
    .all(perPage + 1, page * perPage) as ArchiveRow[];
  return { rows: rows.slice(0, perPage), more: rows.length > perPage };
}

export function archive(id: number): ArchiveRow | undefined {
  return db.prepare("SELECT * FROM archives WHERE round_id = ?").get(id) as ArchiveRow | undefined;
}
