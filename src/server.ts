import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { marked } from "marked";
import * as chat from "./chat.ts";
import { companionPulse, companionStats, initCompanion } from "./companion.ts";
import * as game from "./game.ts";
import { attachPresence } from "./presence.ts";
import { renderArchive, renderArchiveList, renderApp, renderCredits, renderHow, renderPage } from "./templates.ts";

const PORT = Number(process.env.PORT ?? 8080);
const VISITOR_COOKIE = "visitor";
const FIVE_YEARS = 60 * 60 * 24 * 365 * 5;
const MAX_BODY = 4096;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    // a malformed % escape must not take the whole server down
    try {
      out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // ignore that cookie
    }
  }
  return out;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new game.GameError(413, "too-large", "请求太大 / Request too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function visitorCookie(id: string, secure: boolean): string {
  // Persistent identity, not a login: the server issues it, and it's the only
  // thing that says which palette and which objects are yours.
  return `${VISITOR_COOKIE}=${id}; Max-Age=${FIVE_YEARS}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

// ---------------------------------------------------------------- SSE

interface Client {
  res: ServerResponse;
  pid: string;
}
const clients = new Set<Client>();

function online(): Set<string> {
  return new Set([...clients].map((c) => c.pid));
}

function send(res: ServerResponse, event: string, data: unknown, id?: number): void {
  res.write(`${id !== undefined ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

game.onEvents((events) => {
  for (const c of clients) for (const e of events) send(c.res, "change", e, e.id);
  if (events.some((e) => e.type === "companion" || e.type === "round-started")) companionPulse();
});

let lastPresence = "";
function broadcastPresence(): void {
  const pids = [...online()].sort();
  const key = pids.join(",");
  if (key === lastPresence) return;
  lastPresence = key;
  for (const c of clients) send(c.res, "presence", { online: pids });
}

// ---------------------------------------------------------------- limits

// A small token bucket per participant: generous for real play, but enough
// to stop one script hammering the shared scroll.
const WRITES_PER_SECOND = Number(process.env.WRITES_PER_SECOND ?? 12);
// chat messages per 15 s from one address, and from the whole room
const CHAT_PER_IP = Number(process.env.CHAT_PER_IP ?? 10);
const CHAT_ROOM = Number(process.env.CHAT_ROOM ?? 40);
const buckets = new Map<string, { tokens: number; at: number }>();
function allow(key: string, rate: number, burst: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * rate);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [k, b] of buckets) if (b.at < cutoff) buckets.delete(k);
}, 60_000).unref();

// ---------------------------------------------------------------- routes

type Handler = (p: game.Participant, body: Record<string, unknown>) => unknown;
const actions: Record<string, Handler> = {
  "/api/start": game.startRound,
  "/api/reroll": game.reroll,
  "/api/place": game.place,
  "/api/update": game.update,
  "/api/withdraw": game.withdraw,
  "/api/reflect": game.reflect,
  "/api/invite": game.invite,
  "/api/respond": game.respond,
  "/api/acknowledge": game.acknowledge,
  "/api/borrow": game.borrow,
  "/api/accept": game.accept,
  "/api/decline": game.decline,
  "/api/cancel": game.cancelProposal,
  "/api/offer": game.offer,
  "/api/claim": game.claim,
  "/api/receive": game.placeClaimed,
  "/api/release": game.releaseOffer,
  "/api/dew": game.dew,
  "/api/companion/invite": game.inviteCompanion,
  "/api/companion/dismiss": game.dismissCompanion,
  "/api/chat": chat.say,
};

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function serveStatic(pathname: string, res: ServerResponse): boolean {
  const rel = normalize(pathname.slice("/static/".length));
  if (rel.startsWith("..") || rel.includes("\0")) return false;
  const file = join("public", rel);
  try {
    if (!statSync(file).isFile()) return false;
  } catch {
    return false;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": extname(file) === ".svg" ? "public, max-age=86400" : "no-cache",
  });
  res.end(readFileSync(file));
  return true;
}

function json(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(data));
}

function html(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(body);
}

// Writes must come from this site: a cross-site page can't forge one, since
// the browser sends its Origin, and a plain cross-site form can't send JSON.
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  if (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") return false;
  return (req.headers["content-type"] ?? "").startsWith("application/json");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies[VISITOR_COOKIE];
  const token = existing && /^[0-9a-f-]{36}$/.test(existing) ? existing : randomUUID();
  const secure = req.headers["x-forwarded-proto"] === "https";
  const cookieHeader: Record<string, string> =
    token === existing ? {} : { "set-cookie": visitorCookie(token, secure) };

  try {
    if (req.method === "GET" && url.pathname.startsWith("/static/")) {
      if (serveStatic(url.pathname, res)) return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      html(res, 200, renderApp(), cookieHeader);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/chat") {
      json(res, 200, chat.history(url.searchParams.get("before") ?? undefined, url.searchParams.get("limit") ?? undefined), cookieHeader);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/chat/export") {
      const format = url.searchParams.get("format") ?? "md";
      if (format !== "md" && format !== "txt" && format !== "json") {
        json(res, 400, { ok: false, code: "format", message: "md, txt or json" });
        return;
      }
      const roundParam = url.searchParams.get("round");
      const roundId = roundParam === null ? undefined : Number(roundParam);
      if (roundId !== undefined && !(Number.isInteger(roundId) && roundId > 0 && chat.exists(roundId))) {
        json(res, 404, { ok: false, code: "round", message: "no such dream" });
        return;
      }
      const name = `liuru-chat${roundId === undefined ? "" : `-dream-${roundId}`}.${format}`;
      res.writeHead(200, {
        "content-type": { md: "text/markdown", txt: "text/plain", json: "application/json" }[format] + "; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      // Streamed a page at a time, with backpressure, so a long history
      // never has to fit in memory.
      const chunks = chat.exportChunks(format, roundId);
      let gone = false;
      res.on("close", () => {
        gone = true;
        chunks.return(undefined);
      });
      const pump = () => {
        try {
          for (;;) {
            if (gone) return;
            const next = chunks.next();
            if (next.done) return res.end();
            if (!res.write(next.value)) return res.once("drain", pump);
          }
        } catch (err) {
          console.error(err);
          res.destroy();
        }
      };
      pump();
      return;
    }

    // Test and measurement only: off unless the server was started with it.
    if (req.method === "GET" && url.pathname === "/api/companion/stats" && process.env.EXPOSE_STATS === "1") {
      json(res, 200, { ...companionStats(), rss: process.memoryUsage().rss, ws: presence.count(), sse: clients.size });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const p = game.participantFor(token);
      json(res, 200, game.join(p, online()), cookieHeader);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const p = game.participantFor(token);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        ...cookieHeader,
      });
      // Snapshot first, then subscribe, in the same synchronous turn: events
      // join() itself commits are in the snapshot, and nothing can commit
      // between the two, so the client's cursor has no gap to fall into.
      const client = { res, pid: p.pid };
      const snap = game.join(p, new Set([...online(), p.pid]));
      clients.add(client);
      send(res, "snapshot", snap);
      broadcastPresence();
      companionPulse();
      const beat = setInterval(() => res.write(": beat\n\n"), 20_000);
      req.on("close", () => {
        clearInterval(beat);
        clients.delete(client);
        broadcastPresence();
        companionPulse();
      });
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/")) {
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, code: "origin", message: "只接受本站的请求 / Same-site requests only." });
        return;
      }
      // Chat is the one place free text reaches everyone and stays. A new
      // cookie per request mustn't mean a fresh allowance, so it needs a
      // visitor the server already knows, and is also limited per address and
      // for the room as a whole.
      if (url.pathname === "/api/chat") {
        const known = game.existingParticipant(token);
        if (!known) {
          json(res, 403, { ok: false, code: "visitor", message: "请先打开画面 / Open the picture first." }, cookieHeader);
          return;
        }
        const ip = String(req.headers["fly-client-ip"] ?? req.socket.remoteAddress ?? "");
        if (!allow(`chat-ip:${ip}`, CHAT_PER_IP / 15, CHAT_PER_IP) || !allow("chat-room", CHAT_ROOM / 15, CHAT_ROOM)) {
          json(res, 429, { ok: false, code: "chat-slow", message: "说得太快了，歇一会儿 / That's a lot of messages: wait a few seconds." }, cookieHeader);
          return;
        }
      }
      const p = game.participantFor(token);
      const raw = await readBody(req);
      let body: Record<string, unknown>;
      try {
        const parsed = JSON.parse(raw || "{}");
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
        body = parsed;
      } catch {
        json(res, 400, { ok: false, code: "json", message: "请求格式不对 / Malformed request." });
        return;
      }
      const handler = actions[url.pathname];
      if (!handler) {
        json(res, 404, { ok: false, code: "route", message: "not found" });
        return;
      }
      if (!allow(`write:${p.pid}`, WRITES_PER_SECOND, WRITES_PER_SECOND * 2)) {
        json(res, 429, { ok: false, code: "slow", message: "慢一点 / Slow down a little." });
        return;
      }
      // Action ids are scoped to their route, so a reused id on a different
      // action can't replay the wrong stored response.
      const scoped = typeof body.actionId === "string" ? `${url.pathname.slice(5).replace(/[^a-z]/g, "")}:${body.actionId}` : body.actionId;
      const result = handler(p, { ...body, actionId: scoped }) as Record<string, unknown>;
      // Who did what, for reading the deployed app from its logs. The pid is
      // the public participant id; the cookie itself is never logged.
      console.log(`action pid=${p.pid} ${url.pathname.slice(5)} ${result?.ok === false ? `refused:${result.code}` : "ok"}`);
      if (url.pathname.startsWith("/api/companion/")) companionPulse();
      json(res, result?.ok === false ? 409 : 200, { ok: true, ...result }, cookieHeader);
      return;
    }

    if (req.method === "GET" && url.pathname === "/readme/") {
      const md = readFileSync("README.md", "utf8");
      html(res, 200, renderPage("README · 六如", await marked.parse(md)));
      return;
    }
    if (req.method === "GET" && url.pathname === "/how/") {
      html(res, 200, renderHow());
      return;
    }
    if (req.method === "GET" && url.pathname === "/credits/") {
      const md = readFileSync("docs/assets.md", "utf8");
      html(res, 200, renderCredits(await marked.parse(md)));
      return;
    }
    if (req.method === "GET" && url.pathname === "/decision/") {
      // the newest record first, then the custody decision it builds on
      const md = ["0003-a-room-you-can-see-hear-and-paint-with.md", "0002-shared-dream-custody.md"]
        .map((f) => readFileSync(`docs/decisions/${f}`, "utf8"))
        .join("\n\n---\n\n");
      html(res, 200, renderPage("Decisions · 六如", await marked.parse(md)));
      return;
    }
    if (req.method === "GET" && url.pathname === "/dreams/") {
      const page = Math.max(0, Math.min(10_000, Number(url.searchParams.get("page")) || 0));
      html(res, 200, renderArchiveList(game.archives(page), page));
      return;
    }
    const dream = url.pathname.match(/^\/dreams\/(\d{1,9})\/?$/);
    if (req.method === "GET" && dream) {
      const row = game.archive(Number(dream[1]));
      if (row) {
        html(res, 200, renderArchive(row, chat.roundMessages(row.round_id)));
        return;
      }
    }

    html(res, 404, renderPage("Not found · 六如", "<h1>找不到 / Not found</h1><p><a href=\"/\">回到画卷 / Back to the scroll</a></p>"));
  } catch (err) {
    if (err instanceof game.GameError) {
      if (req.method === "POST") console.log(`action ${url.pathname.slice(5)} refused:${err.code}`);
      json(res, err.status, { ok: false, code: err.code, message: err.message }, cookieHeader);
      return;
    }
    console.error(err);
    if (!res.headersSent) json(res, 500, { ok: false, code: "internal", message: "internal error" });
  }
});

// Deadlines pass whether or not anyone is asking: a short tick expires
// proposals and moves the round on. On boot, the first tick reconciles
// anything that elapsed while the server was down, exactly once.
game.reconcile();
setInterval(() => game.reconcile(), 250).unref();

const presence = attachPresence(server, {
  // The socket belongs to an existing visitor: the page load that opened it
  // already issued the cookie, so a bare upgrade with none is refused.
  identify: (req) => {
    const token = parseCookies(req.headers.cookie)[VISITOR_COOKIE];
    return token && /^[0-9a-f-]{36}$/.test(token) ? game.existingParticipant(token) : undefined;
  },
  sameOrigin,
});

// The companion acts only while at least one person has the room open.
initCompanion(() => clients.size);

// Read-only numbers for the memory measurement in README.
if (process.env.EXPOSE_STATS === "1") {
  setInterval(() => {
    const m = process.memoryUsage();
    const s = companionStats();
    console.log(
      `stats rss=${Math.round(m.rss / 1048576)}MB heap=${Math.round(m.heapUsed / 1048576)}MB sse=${clients.size} ws=${presence.count()} companion=${s.accepted}/${s.tried} rejected=${s.rejected}`,
    );
  }, 5000).unref();
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on ${PORT}`);
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    presence.close();
    for (const c of clients) c.res.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
