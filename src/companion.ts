import { readFileSync } from "node:fs";
import { box, INTENTS, LIMITS, MOTIF_BY_ID, reflectionWater, relations, waterSurface } from "../public/shared.js";
import { type Features, INTENT_MOTIFS, placementFeatures, PROMPT_MOTIFS, sample, score, type SceneObject, type Weights } from "./companion-model.ts";
import * as game from "./game.ts";
import { serverCursor, type Cursor } from "./presence.ts";

// The AI companion (画伴): an optional player that lives in the server
// process. Every few seconds it observes the whole room, lists the moves a
// person in its seat could make, keeps only those the server would accept
// (the real action, dry-run and rolled back), scores them with a small
// learned model, samples one, glides its cursor there, and then makes the
// move through the same src/game.ts function an HTTP request would use.

const secs = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v * 1000 : fallback * 1000;
};

export const COMPANION_TIMING = {
  min: secs("COMPANION_MIN_SECONDS", 5),
  max: secs("COMPANION_MAX_SECONDS", 30),
  glide: secs("COMPANION_GLIDE_SECONDS", 1.4),
  // requests aimed at it are checked far more often than it acts, so a
  // borrow proposal never expires waiting on it
  check: Math.min(secs("COMPANION_CHECK_SECONDS", 2), game.TIMING.proposal / 4),
};

// Stays well under the twelve-object quota and never outnumbers the people.
const OWN_CAP = 5;

const WEIGHTS: Weights = JSON.parse(readFileSync(new URL("./companion-weights.json", import.meta.url), "utf8"));

type Snapshot = ReturnType<typeof game.snapshot>;
type Obj = Snapshot["objects"][number];

interface Candidate {
  kind: string;
  label: string;
  score: number;
  at: { x: number; y: number };
  motif?: string;
  run: (p: game.Participant, actionId: string) => unknown;
}

export interface CompanionStats {
  tried: number;
  accepted: number;
  rejected: number;
  skipped: number;
  nothing: number;
  answered: number;
  intervals: number[];
  lastActions: { at: number; kind: string; label: string }[];
  model: string;
}

const stats: CompanionStats = {
  tried: 0,
  accepted: 0,
  rejected: 0,
  skipped: 0,
  nothing: 0,
  answered: 0,
  intervals: [],
  lastActions: [],
  model: "local",
};
export const companionStats = (): CompanionStats => stats;

let seq = 0;
const actionId = (kind: string) => `${kind}:ai-${Date.now().toString(36)}-${(++seq).toString(36)}`;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const log = (msg: string) => console.log(`companion ${msg}`);

// ---------------------------------------------------------------- observe

function observe(agent: game.Participant): Snapshot {
  return game.snapshot(agent, new Set());
}

const toModel = (o: Obj): SceneObject => ({ ...o, custodian: o.custodian });

function defaultDepth(motif: string): number {
  const m = MOTIF_BY_ID[motif];
  return m.group === "atmosphere" || motif === "peaks" ? 0 : m.role === "ground" && motif !== "water" && motif !== "bank" ? 0 : 1;
}

// ---------------------------------------------------------------- candidates

/** Positions worth trying for a motif: its relationship anchors, then open space in its band. */
function positionsFor(motif: string, s: Snapshot): { x: number; y: number }[] {
  const scene = s.round!.scene;
  const m = MOTIF_BY_ID[motif];
  const placed = s.objects.filter((o) => o.status === "placed" && !o.reflectOn);
  const out: { x: number; y: number }[] = [];
  const has = (o: Obj, tag: string) => MOTIF_BY_ID[o.motif].tags.includes(tag);
  for (const w of placed.filter((o) => has(o, "water"))) {
    const b = box(w);
    const surface = waterSurface(w);
    if (m.tags.includes("boat")) {
      // keel on the surface: centre y = surface - (keel - 0.5) * h
      const y = surface - ((m.keel ?? 0.8) - 0.5) * m.h + 6;
      for (const f of [0.3, 0.5, 0.7]) out.push({ x: b.x0 + b.w * f, y });
    }
    if (motif === "moon") out.push({ x: w.x + rand(-80, 80), y: Math.max(60, surface - rand(220, 420)) });
    if (motif === "fish" || motif === "lotus") out.push({ x: b.x0 + b.w * rand(0.2, 0.8), y: surface + b.h * 0.35 });
    if (motif === "reeds" || motif === "grass") out.push({ x: b.x0 - 20, y: surface - 40 }, { x: b.x1 + 20, y: surface - 40 });
  }
  if (m.tags.includes("bird")) {
    for (const t of placed.filter((o) => has(o, "tree"))) {
      const b = box(t);
      const [cx0, cy0, cx1, cy1] = MOTIF_BY_ID[t.motif].crown ?? [0, 0, 1, 0.6];
      out.push({ x: b.x0 + b.w * ((cx0 + cx1) / 2), y: b.y0 + b.h * ((cy0 + cy1) / 2) });
    }
  }
  if (m.tags.includes("lantern")) {
    for (const sh of placed.filter((o) => has(o, "shelter"))) {
      const b = box(sh);
      out.push({ x: b.x1 + 25, y: b.y0 + b.h * 0.45 }, { x: b.x0 - 25, y: b.y0 + b.h * 0.45 });
    }
  }
  // open space: a spread of columns at heights suiting the motif
  for (let i = 0; i < 7; i++) {
    const x = scene.width * ((i + 0.5 + rand(-0.35, 0.35)) / 7);
    const y = scene.height * rand(0.15, 0.88);
    out.push({ x, y });
  }
  return out.map((p) => ({ x: clamp(p.x, m.w * 0.3, scene.width - m.w * 0.3), y: clamp(p.y, m.h * 0.3, scene.height - m.h * 0.3) }));
}

function feats(o: SceneObject, s: Snapshot): Features {
  const others = s.objects.filter((x) => x.id !== o.id).map(toModel);
  return placementFeatures(o, others, s.round!.scene, s.round!.promptIndex, s.me);
}

const prior = (k: string) => WEIGHTS.priors[k] ?? 0;

function candidates(s: Snapshot): Candidate[] {
  const out: Candidate[] = [];
  const me = s.players.find((p) => p.pid === s.me);
  if (!me || !s.round) return out;
  const mine = s.objects.filter((o) => o.custodian === s.me && o.status !== "withdrawn");
  const theirs = s.objects.filter((o) => o.custodian !== s.me && o.status === "placed");
  const people = s.objects.filter((o) => o.contributor !== s.me).length;
  const cap = Math.max(2, Math.min(OWN_CAP, people + 2));
  const compose = s.phase === "compose";
  const scene = s.round.scene;

  // nothing: leaving room is often the best move, and more so the busier it is
  out.push({
    kind: "nothing",
    label: "留白 leave room",
    score: prior("nothing") + 0.9 * (mine.length / OWN_CAP) + 0.6 * (s.objects.length / LIMITS.sceneObjects),
    at: { x: scene.width / 2, y: scene.height / 2 },
    run: () => undefined,
  });

  // place one of its motifs
  if (compose && mine.length < cap) {
    const used = new Set(mine.map((o) => o.motif));
    for (const motif of me.palette) {
      for (const at of positionsFor(motif, s)) {
        const t = { x: Math.round(at.x), y: Math.round(at.y), scale: Math.round(rand(0.8, 1.1) * 100) / 100, rotation: 0, flip: Math.random() < 0.5, ink: 0.85, depth: defaultDepth(motif) };
        const f = feats({ id: -1, motif, ...t }, s);
        out.push({
          kind: "place",
          label: `放 ${MOTIF_BY_ID[motif].zh} place ${motif}`,
          score: prior("place") + score(WEIGHTS, f) - (used.has(motif) ? 0.6 : 0),
          at: t,
          motif,
          run: (p, id) => game.place(p, { actionId: id, motif, ...t }),
        });
      }
    }
  }

  // answer someone else's opening
  for (const inv of s.invitations) {
    if (inv.owner === s.me || inv.status !== "open") continue;
    if (inv.intent === "open") {
      out.push({ kind: "acknowledge", label: "会意 acknowledge", score: prior("acknowledge"), at: inv, run: (p, id) => game.acknowledge(p, { actionId: id, invitationId: inv.id }) });
      continue;
    }
    if (!compose) continue;
    const fits = INTENT_MOTIFS[inv.intent as keyof typeof INTENTS] ?? [];
    for (const motif of me.palette) {
      const t = { x: inv.x, y: inv.y, scale: 1, rotation: 0, flip: false, depth: 1 };
      const f = feats({ id: -1, motif, ink: 0.9, ...t }, s);
      out.push({
        kind: "respond",
        label: `回应 answer with ${motif}`,
        score: prior("respond") + score(WEIGHTS, f) + (fits.includes(motif) ? 1 : 0),
        at: inv,
        motif,
        run: (p, id) => game.respond(p, { actionId: id, invitationId: inv.id, motif, ...t }),
      });
    }
  }

  // leave an opening of its own, rarely, in a quiet part of the picture
  if (compose) {
    const at = { x: Math.round(rand(0.15, 0.85) * scene.width), y: Math.round(rand(0.3, 0.8) * scene.height) };
    const intent = pick(["life", "visited", "distance", "home", "open"]);
    const f = feats({ id: -1, motif: "rock", x: at.x, y: at.y, scale: 1, rotation: 0, flip: false, ink: 1, depth: 1 }, s);
    out.push({ kind: "invite", label: `留白邀作 ${intent}`, score: prior("invite") + 0.8 * f.gap - 0.8 * f.crowd, at, run: (p, id) => game.invite(p, { actionId: id, ...at, intent }) });
  }

  // tend its own objects: nudge toward a better spot, reflect, offer or withdraw
  for (const o of mine.filter((x) => x.status === "placed")) {
    const here = score(WEIGHTS, feats(toModel(o), s));
    for (let i = 0; i < 3; i++) {
      const t = { x: Math.round(clamp(o.x + rand(-90, 90), 1, scene.width - 1)), y: Math.round(clamp(o.y + rand(-50, 50), 1, scene.height - 1)), scale: o.scale, rotation: o.rotation, flip: o.flip, ink: o.ink, depth: o.depth };
      const there = score(WEIGHTS, feats({ ...toModel(o), ...t }, s));
      out.push({ kind: "adjust", label: `调 adjust ${o.motif}`, score: prior("adjust") + (there - here) * 2, at: t, motif: o.motif, run: (p, id) => game.update(p, { actionId: id, objectId: o.id, version: o.version, ...t }) });
    }
    if (!o.reflectOn && reflectionWater(o, s.objects)) {
      out.push({ kind: "reflect", label: `化影 reflect ${o.motif}`, score: prior("reflect"), at: o, run: (p, id) => game.reflect(p, { actionId: id, objectId: o.id, version: o.version, on: true }) });
    }
    out.push({ kind: "offer", label: `泡 offer ${o.motif}`, score: prior("offer"), at: o, run: (p, id) => game.offer(p, { actionId: id, objectId: o.id, version: o.version }) });
    out.push({ kind: "withdraw", label: `收回 withdraw ${o.motif}`, score: prior("withdraw") - here, at: o, run: (p, id) => game.withdraw(p, { actionId: id, objectId: o.id, version: o.version }) });
  }

  // swap a tray slot that doesn't belong to this dream
  if (compose && me.rerollsUsed < LIMITS.rerolls) {
    const fit = PROMPT_MOTIFS[s.round.promptIndex] ?? [];
    me.palette.forEach((motif, slot) => {
      if (fit.includes(motif) || mine.some((o) => o.motif === motif)) return;
      out.push({ kind: "reroll", label: `换 swap ${motif}`, score: prior("reroll"), at: { x: scene.width / 2, y: scene.height - 40 }, run: (p, id) => game.reroll(p, { actionId: id, slot }) });
    });
  }

  // suggest a move that would give someone's object a partner (consent asked)
  for (const o of theirs) {
    if (s.proposals.some((pr) => pr.objectId === o.id)) continue;
    const here = feats(toModel(o), s);
    if (here.rel > 0) continue;
    for (const at of positionsFor(o.motif, s).slice(0, 3)) {
      const t = { x: Math.round(at.x), y: Math.round(at.y) };
      const f = feats({ ...toModel(o), ...t }, s);
      if (f.rel === 0) continue;
      out.push({ kind: "borrow", label: `借景 suggest moving ${o.motif}`, score: prior("borrow") + score(WEIGHTS, f) - score(WEIGHTS, here), at: t, motif: o.motif, run: (p, id) => game.borrow(p, { actionId: id, objectId: o.id, version: o.version, ...t }) });
    }
  }

  // catch someone's bubble (then set it down, see act())
  for (const of of s.offers) {
    if (of.status !== "floating" || of.offerer === s.me) continue;
    out.push({ kind: "claim", label: "接泡 catch a bubble", score: prior("claim"), at: { x: of.origin.x, y: of.origin.y - 70 }, run: (p, id) => game.claim(p, { actionId: id, offerId: of.id }) });
  }

  // a drop of dew on something someone else made
  if (me.dewUsed < LIMITS.dew && theirs.length) {
    const o = pick(theirs);
    out.push({ kind: "dew", label: "露 dew", score: prior("dew"), at: o, run: (p, id) => game.dew(p, { actionId: id, x: Math.round(o.x), y: Math.round(o.y) }) });
  }
  return out;
}

// ---------------------------------------------------------------- acting

function cursorFor(c: Candidate, s: Snapshot): Cursor {
  const act: Cursor["act"] =
    c.kind === "place" || c.kind === "respond" ? "hold" : c.kind === "borrow" ? "borrow" : c.kind === "dew" ? "dew" : c.kind === "invite" ? "invite" : c.kind === "adjust" ? "drag" : "";
  const cur: Cursor = { pid: s.me, x: Math.round(c.at.x), y: Math.round(c.at.y), act };
  if (c.motif) cur.motif = c.motif;
  return cur;
}

/** Run a move only if, at this instant, the server would accept it. Sync: nothing interleaves. */
function commit(agent: game.Participant, c: Candidate): unknown {
  const id = actionId(c.kind);
  if (!game.wouldAccept(() => c.run(agent, id)).ok) {
    stats.skipped++;
    return undefined;
  }
  stats.tried++;
  try {
    const result = c.run(agent, id) as { ok?: boolean } | undefined;
    if (result && result.ok === false) {
      stats.rejected++;
      log(`rejected ${c.kind}`);
      return undefined;
    }
    stats.accepted++;
    stats.lastActions = [...stats.lastActions, { at: Date.now(), kind: c.kind, label: c.label }].slice(-20);
    log(`pid=${agent.pid} ${c.kind}: ${c.label}`);
    return result ?? {};
  } catch (err) {
    stats.rejected++;
    log(`rejected ${c.kind}: ${(err as Error).message}`);
    return undefined;
  }
}

// ---------------------------------------------------------------- the optional online model

const LLM = {
  url: process.env.COMPANION_LLM_URL,
  key: process.env.COMPANION_LLM_KEY,
  model: process.env.COMPANION_LLM_MODEL,
  timeout: secs("COMPANION_LLM_TIMEOUT_SECONDS", 3),
};

/**
 * Ask an OpenAI-compatible endpoint to pick one candidate by index. Off
 * unless COMPANION_LLM_URL and COMPANION_LLM_MODEL are set; any error,
 * timeout or out-of-range answer falls back to the local model's sample.
 */
async function online(s: Snapshot, list: Candidate[]): Promise<Candidate | undefined> {
  if (!LLM.url || !LLM.model) return undefined;
  const top = [...list].sort((a, b) => b.score - a.score).slice(0, 12);
  const lines = top.map((c, i) => `${i}: ${c.label} at (${Math.round(c.at.x)}, ${Math.round(c.at.y)})`).join("\n");
  const prompt = `You are a quiet, generous co-painter on a shared Chinese ink-wash picture (${s.round!.scene.width}x${s.round!.scene.height}). The dream's line: "${s.round!.prompt.en}". There are ${s.objects.length} objects. Choose ONE move by index; leaving room is often best. Reply with the number only.\n${lines}`;
  try {
    const res = await fetch(LLM.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(LLM.key ? { authorization: `Bearer ${LLM.key}` } : {}) },
      body: JSON.stringify({ model: LLM.model, messages: [{ role: "user", content: prompt }], max_tokens: 4, temperature: 0.7 }),
      signal: AbortSignal.timeout(LLM.timeout),
    });
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const i = Number.parseInt(data.choices?.[0]?.message?.content?.trim() ?? "", 10);
    if (Number.isInteger(i) && i >= 0 && i < top.length) {
      stats.model = "online";
      return top[i];
    }
  } catch {
    // fall through to the local model
  }
  stats.model = "local";
  return undefined;
}

// ---------------------------------------------------------------- the loop

let humans: () => number = () => 0;
let actTimer: NodeJS.Timeout | undefined;
let checkTimer: NodeJS.Timeout | undefined;
let busy = false;
let lastAct = 0;
let cursorShown = false;
let cursorAt: { x: number; y: number } | undefined;

function hideCursor(pid: string) {
  if (!cursorShown) return;
  cursorShown = false;
  cursorAt = undefined;
  serverCursor("leave", pid);
}

/** Move the companion's cursor to `to` along an eased arc over `ms`, so people see it coming. */
async function glide(to: Cursor, ms: number): Promise<void> {
  const from = cursorAt ?? { x: to.x + rand(-160, 160), y: to.y + rand(80, 200) };
  const steps = Math.max(1, Math.round(ms / 80));
  // a slight sideways bow, like a hand rather than a ruler
  const bow = rand(-0.18, 0.18) * Math.hypot(to.x - from.x, to.y - from.y);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const e = 0.5 - Math.cos(Math.PI * k) / 2;
    const arc = Math.sin(Math.PI * k) * bow;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const x = from.x + dx * e + (-dy / len) * arc;
    const y = from.y + dy * e + (dx / len) * arc;
    serverCursor({ ...to, x: Math.round(x), y: Math.round(y) }, to.pid);
    cursorShown = true;
    await sleep(ms / steps);
  }
  cursorAt = { x: to.x, y: to.y };
}

function scheduleAct() {
  clearTimeout(actTimer);
  const delay = rand(COMPANION_TIMING.min, COMPANION_TIMING.max);
  stats.intervals = [...stats.intervals, Math.round(delay)].slice(-50);
  actTimer = setTimeout(() => void turn(), delay);
  actTimer.unref();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms).unref());

// Whatever goes wrong inside the companion stays inside it: it logs, skips the
// turn, and the room carries on. It must never take the server down.
async function turn() {
  try {
    await turnInner();
  } catch (err) {
    log(`turn failed: ${(err as Error).stack ?? err}`);
  }
}

async function turnInner() {
  const here = game.companionNow();
  if (!here || humans() === 0) return stop();
  if (busy) return scheduleAct();
  busy = true;
  try {
    const agent = here.participant;
    const s = observe(agent);
    if (s.phase !== "compose" && s.phase !== "refine") return;
    const list = candidates(s);
    const choice = (await online(s, list)) ?? sample(list, WEIGHTS.temperature);
    if (!choice || choice.kind === "nothing") {
      stats.nothing++;
      return;
    }
    // glide there first, so people can see what it's about to do
    await glide(cursorFor(choice, s), COMPANION_TIMING.glide);
    await sleep(250);
    if (!game.companionNow() || humans() === 0) return;
    const result = commit(agent, choice) as { leaseExpiresAt?: number } | undefined;
    lastAct = Date.now();
    if (choice.kind === "claim" && result) await setDown(agent);
  } finally {
    busy = false;
    if (game.companionNow() && humans() > 0) scheduleAct();
  }
}

// After catching a bubble: set it down somewhere the model likes, well inside the lease.
async function setDown(agent: game.Participant) {
  const s = observe(agent);
  const held = s.offers.find((o) => o.status === "claimed" && o.claimant === s.me);
  const obj = held && s.objects.find((o) => o.id === held.objectId);
  if (!held || !obj) return;
  const spots = positionsFor(obj.motif, s).map((at) => {
    const t = { x: Math.round(at.x), y: Math.round(at.y) };
    return { t, score: score(WEIGHTS, feats({ ...toModel(obj), ...t }, s)) };
  });
  const best = sample(spots, WEIGHTS.temperature)!;
  await glide({ pid: s.me, ...best.t, act: "receive", motif: obj.motif }, Math.min(COMPANION_TIMING.glide, game.TIMING.lease / 4));
  // the room may have emptied during the glide; an unplaced bubble just goes home
  if (!game.companionNow() || humans() === 0) return;
  commit(agent, { kind: "receive", label: `放下 set down ${obj.motif}`, score: 0, at: best.t, run: (p, id) => game.placeClaimed(p, { actionId: id, offerId: held.id, ...best.t }) });
}

/** Requests aimed at the companion: answer each well before it expires. */
function check() {
  try {
    checkInner();
  } catch (err) {
    log(`check failed: ${(err as Error).stack ?? err}`);
  }
}

function checkInner() {
  const here = game.companionNow();
  if (!here || humans() === 0) return stop();
  const agent = here.participant;
  const s = observe(agent);
  for (const pr of s.proposals.filter((p) => p.target === s.me && p.status === "pending")) {
    let accept = true;
    if (pr.kind === "borrow") {
      // generous: only a move that throws its object off the paper is declined
      const o = s.objects.find((x) => x.id === pr.objectId);
      if (o) accept = feats({ ...toModel(o), ...pr.transform }, s).edge < 0.5;
    }
    const kind = accept ? "accept" : "decline";
    const run = (p: game.Participant, id: string) => (accept ? game.accept(p, { actionId: id, proposalId: pr.id }) : game.decline(p, { actionId: id, proposalId: pr.id }));
    serverCursor({ pid: s.me, x: Math.round(pr.transform.x), y: Math.round(pr.transform.y), act: "" }, agent.pid);
    cursorShown = true;
    cursorAt = { x: pr.transform.x, y: pr.transform.y };
    // A borrow made against an older version of its object is stale. Accepting
    // it refuses *and records* the stale mark, which a dry run would roll back,
    // so it's answered for real; the proposer hears at once instead of waiting
    // out the expiry.
    const o = pr.kind === "borrow" ? s.objects.find((x) => x.id === pr.objectId) : undefined;
    if (accept && o && o.version !== pr.objectVersion) {
      game.accept(agent, { actionId: actionId("accept"), proposalId: pr.id });
      stats.answered++;
      continue;
    }
    if (commit(agent, { kind, label: `${accept ? "接受" : "婉拒"} ${kind} a ${pr.kind}`, score: 0, at: pr.transform, run })) stats.answered++;
  }
  if (Date.now() - lastAct > 12_000) hideCursor(agent.pid);
}

function start() {
  if (!checkTimer) {
    checkTimer = setInterval(check, COMPANION_TIMING.check);
    checkTimer.unref();
  }
  if (!actTimer && !busy) scheduleAct();
}

function stop() {
  clearTimeout(actTimer);
  clearInterval(checkTimer);
  actTimer = undefined;
  checkTimer = undefined;
  if (cursorShown) hideCursor(game.agentParticipant().pid);
}

/**
 * Wake or pause the companion. The server calls this whenever people connect
 * or leave and after the companion is invited or dismissed. With nobody
 * connected it holds no timers, makes no writes and never starts a round.
 */
export function companionPulse(): void {
  if (game.companionNow() && humans() > 0) start();
  else stop();
}

export function initCompanion(countHumans: () => number): void {
  humans = countHumans;
  companionPulse();
}

// for tests of the model's plumbing
export const internals = { candidates, positionsFor, relations };
