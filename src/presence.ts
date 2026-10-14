import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { LEGACY_SCENE, MOTIF_BY_ID, SCENE } from "../public/shared.js";

// Ephemeral presence over one WebSocket per tab: where everyone's pointer is
// and what they're holding or dragging. None of it is durable: nothing here
// touches SQLite or the SSE event stream, and a cursor vanishes with its
// socket. The server batches the latest cursor per person and fans it out
// every BATCH_MS.

const MAX_MESSAGE = 512; // bytes; a cursor is ~150
const BATCH_MS = 50;
const PING_MS = 15_000;
const RATE = 30; // messages per second per socket, after a small burst

export type Activity = "hold" | "drag" | "borrow" | "dew" | "invite" | "receive" | "respond" | "";
const ACTIVITIES = new Set<Activity>(["hold", "drag", "borrow", "dew", "invite", "receive", "respond", ""]);

export interface Cursor {
  pid: string;
  x: number;
  y: number;
  act: Activity;
  motif?: string;
  objectId?: number;
  touch?: boolean;
  agent?: boolean;
  // the drag/ghost preview this cursor is carrying, if any
  ghost?: { motif: string; x: number; y: number; scale: number; rotation: number; flip: boolean; objectId?: number };
}

interface Peer {
  ws: WebSocket;
  pid: string;
  alive: boolean;
  tokens: number;
  at: number;
}

const peers = new Set<Peer>();
const latest = new Map<string, Cursor>(); // pid -> cursor waiting to go out
const gone = new Set<string>();

const MAX_X = Math.max(SCENE.width, LEGACY_SCENE.width);
const MAX_Y = Math.max(SCENE.height, LEGACY_SCENE.height);

const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v)) * 10) / 10 : undefined;

/** Validate and clamp one client message into a cursor, or undefined to drop it. */
export function cleanCursor(raw: unknown, pid: string): Cursor | "leave" | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const m = raw as Record<string, unknown>;
  if (m.t === "leave") return "leave";
  if (m.t !== "c") return undefined;
  const x = num(m.x, 0, MAX_X);
  const y = num(m.y, 0, MAX_Y);
  if (x === undefined || y === undefined) return undefined;
  const act = typeof m.act === "string" && ACTIVITIES.has(m.act as Activity) ? (m.act as Activity) : "";
  const motif = typeof m.motif === "string" && Object.hasOwn(MOTIF_BY_ID, m.motif) ? m.motif : undefined;
  const objectId = typeof m.objectId === "number" && Number.isInteger(m.objectId) && m.objectId > 0 ? m.objectId : undefined;
  const c: Cursor = { pid, x, y, act };
  if (motif) c.motif = motif;
  if (objectId) c.objectId = objectId;
  if (m.touch === true) c.touch = true;
  const g = m.ghost as Record<string, unknown> | undefined;
  if (g && typeof g === "object" && typeof g.motif === "string" && Object.hasOwn(MOTIF_BY_ID, g.motif)) {
    const gx = num(g.x, 0, MAX_X);
    const gy = num(g.y, 0, MAX_Y);
    if (gx !== undefined && gy !== undefined) {
      c.ghost = {
        motif: g.motif,
        x: gx,
        y: gy,
        scale: num(g.scale, 0.5, 1.8) ?? 1,
        rotation: num(g.rotation, -20, 20) ?? 0,
        flip: g.flip === true,
      };
      const gid = g.objectId;
      if (typeof gid === "number" && Number.isInteger(gid) && gid > 0) c.ghost.objectId = gid;
    }
  }
  return c;
}

function broadcast(): void {
  if (latest.size === 0 && gone.size === 0) return;
  const cursors = [...latest.values()];
  const left = [...gone];
  latest.clear();
  gone.clear();
  for (const peer of peers) {
    if (peer.ws.readyState !== WebSocket.OPEN) continue;
    // never echo someone's own cursor back to them
    const theirs = cursors.filter((c) => c.pid !== peer.pid);
    if (theirs.length === 0 && left.length === 0) continue;
    peer.ws.send(JSON.stringify({ t: "cur", c: theirs, gone: left }));
  }
}

function connected(pid: string): boolean {
  for (const p of peers) if (p.pid === pid) return true;
  return false;
}

/** Push a cursor that isn't from a socket: the server-side companion's. */
export function serverCursor(c: Cursor | "leave", pid: string): void {
  if (c === "leave") {
    latest.delete(pid);
    gone.add(pid);
  } else {
    latest.set(pid, { ...c, pid, agent: true });
  }
}

export interface PresenceOptions {
  /** The participant for a visitor cookie, without creating one. */
  identify(req: IncomingMessage): { pid: string } | undefined;
  sameOrigin(req: IncomingMessage): boolean;
}

export function attachPresence(server: Server, opts: PresenceOptions): { close(): void; count(): number } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE, perMessageDeflate: false });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://x");
    const refuse = (status: number, why: string) => {
      socket.write(`HTTP/1.1 ${status} ${why}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (url.pathname !== "/api/presence") return refuse(404, "Not Found");
    // A browser always sends Origin on a WebSocket handshake; a cross-site
    // page's Origin won't match, so it can't open a socket in your name.
    if (!req.headers.origin || !opts.sameOrigin(req)) return refuse(403, "Forbidden");
    const who = opts.identify(req);
    if (!who) return refuse(401, "Unauthorized");
    wss.handleUpgrade(req, socket, head, (ws) => {
      const peer: Peer = { ws, pid: who.pid, alive: true, tokens: RATE, at: Date.now() };
      peers.add(peer);
      ws.on("pong", () => (peer.alive = true));
      ws.on("message", (data, isBinary) => {
        if (isBinary) return;
        const now = Date.now();
        peer.tokens = Math.min(RATE, peer.tokens + ((now - peer.at) / 1000) * RATE);
        peer.at = now;
        if (peer.tokens < 1) return; // over the rate: dropped, not queued
        peer.tokens -= 1;
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString());
        } catch {
          return;
        }
        const c = cleanCursor(parsed, peer.pid);
        if (c === "leave") {
          latest.delete(peer.pid);
          gone.add(peer.pid);
        } else if (c) {
          gone.delete(peer.pid);
          latest.set(peer.pid, c);
        }
      });
      ws.on("close", () => {
        peers.delete(peer);
        // another tab with the same cookie keeps the cursor alive
        if (!connected(peer.pid)) {
          latest.delete(peer.pid);
          gone.add(peer.pid);
        }
      });
      ws.on("error", () => ws.terminate());
    });
  });

  const batch = setInterval(broadcast, BATCH_MS);
  batch.unref();
  // Drop sockets that stop answering pings (a laptop lid closed mid-session).
  const ping = setInterval(() => {
    for (const peer of peers) {
      if (!peer.alive) {
        peer.ws.terminate();
        continue;
      }
      peer.alive = false;
      peer.ws.ping();
    }
  }, PING_MS);
  ping.unref();

  return {
    close() {
      clearInterval(batch);
      clearInterval(ping);
      for (const p of peers) p.ws.terminate();
      wss.close();
    },
    count: () => peers.size,
  };
}
