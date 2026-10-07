import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { marked } from "marked";
import * as game from "./game.ts";
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
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
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
});

let lastPresence = "";
function broadcastPresence(): void {
  const pids = [...online()].sort();
  const key = pids.join(",");
  if (key === lastPresence) return;
  lastPresence = key;
  for (const c of clients) send(c.res, "presence", { online: pids });
}

// Ephemeral previews (someone dragging, or composing a proposal) go to the
// other viewers without touching the database or the event cursor.
function broadcastPreview(from: string, data: unknown): void {
  for (const c of clients) if (c.pid !== from) send(c.res, "preview", data);
}

// ---------------------------------------------------------------- limits

// A small token bucket per participant: generous for real play, but enough
// to stop one script hammering the shared scroll.
const WRITES_PER_SECOND = Number(process.env.WRITES_PER_SECOND ?? 12);
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
      // Snapshot and subscription in the same synchronous turn: no event can
      // commit between them, so the client's cursor has no gap to fall into.
      const client = { res, pid: p.pid };
      clients.add(client);
      send(res, "snapshot", game.join(p, online()));
      broadcastPresence();
      const beat = setInterval(() => res.write(": beat\n\n"), 20_000);
      req.on("close", () => {
        clearInterval(beat);
        clients.delete(client);
        broadcastPresence();
      });
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/")) {
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, code: "origin", message: "只接受本站的请求 / Same-site requests only." });
        return;
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
      if (url.pathname === "/api/preview") {
        if (allow(`preview:${p.pid}`, 12, 12)) broadcastPreview(p.pid, { ...sanitisePreview(body), by: p.pid });
        res.writeHead(204, cookieHeader);
        res.end();
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
      const result = handler(p, body) as Record<string, unknown>;
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
      const md = readFileSync("docs/decisions/0002-shared-dream-custody.md", "utf8");
      html(res, 200, renderPage("Decision · 六如", await marked.parse(md)));
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
        html(res, 200, renderArchive(row));
        return;
      }
    }

    html(res, 404, renderPage("Not found · 六如", "<h1>找不到 / Not found</h1><p><a href=\"/\">回到画卷 / Back to the scroll</a></p>"));
  } catch (err) {
    if (err instanceof game.GameError) {
      json(res, err.status, { ok: false, code: err.code, message: err.message }, cookieHeader);
      return;
    }
    console.error(err);
    if (!res.headersSent) json(res, 500, { ok: false, code: "internal", message: "internal error" });
  }
});

function sanitisePreview(body: Record<string, unknown>) {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined);
  const motif = typeof body.motif === "string" && /^[a-z]{2,12}$/.test(body.motif) ? body.motif : undefined;
  return {
    kind: body.kind === "move" || body.kind === "borrow" || body.kind === "place" || body.kind === "end" ? body.kind : "end",
    objectId: num(body.objectId),
    motif,
    x: num(body.x),
    y: num(body.y),
    scale: num(body.scale),
    rotation: num(body.rotation),
    flip: body.flip === true,
  };
}

// Deadlines pass whether or not anyone is asking: a short tick expires
// proposals and moves the round on. On boot, the first tick reconciles
// anything that elapsed while the server was down, exactly once.
game.reconcile();
setInterval(() => game.reconcile(), 250).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on ${PORT}`);
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    for (const c of clients) c.res.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
