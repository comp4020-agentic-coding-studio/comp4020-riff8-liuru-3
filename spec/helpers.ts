import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Game tests run against their OWN server: a fresh process on a free port,
// with a throwaway data directory and short round timings, so a whole dream
// plays out in seconds and parallel test files never share a scroll. The
// timings come from the same env vars production reads; there is no HTTP
// route that skips time.

export interface TestServer {
  url: string;
  dataDir: string;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

export async function startServer(
  env: Record<string, string> = {},
  dataDir = mkdtempSync(join(tmpdir(), "liuru-spec-")),
): Promise<TestServer> {
  const port = await freePort();
  const url = `http://localhost:${port}`;
  let child: ChildProcess;
  const launch = async () => {
    child = spawn(process.execPath, ["src/server.ts"], {
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, WRITES_PER_SECOND: "200", ...env },
      stdio: ["ignore", "ignore", "inherit"],
    });
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(url);
        return;
      } catch {
        await sleep(100);
      }
    }
    throw new Error(`test server didn't start on ${port}`);
  };
  const stop = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.kill("SIGKILL");
    });
  await launch();
  return {
    url,
    dataDir,
    stop,
    async restart() {
      await stop();
      await launch();
    },
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let seq = 0;
export const actionId = () => `spec-${process.pid}-${Date.now()}-${++seq}`;

export interface SseEvent {
  event: string;
  id?: number;
  data: any;
  at: number;
}

/** One visitor: a cookie jar, JSON helpers, and an optional SSE subscription. */
export class Visitor {
  cookie = "";
  events: SseEvent[] = [];
  private abort?: AbortController;
  constructor(public base: string) {}

  private remember(res: Response) {
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
  }

  async state(): Promise<any> {
    const res = await fetch(`${this.base}/api/state`, { headers: { cookie: this.cookie } });
    this.remember(res);
    return res.json();
  }

  async post(path: string, body: Record<string, unknown> = {}, id = actionId()): Promise<{ status: number; body: any }> {
    const res = await fetch(`${this.base}/api/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: this.cookie },
      body: JSON.stringify({ actionId: id, ...body }),
    });
    this.remember(res);
    return { status: res.status, body: await res.json() };
  }

  /** Subscribe to /api/events; resolves once the snapshot has arrived. */
  async subscribe(): Promise<any> {
    this.events = [];
    this.abort = new AbortController();
    const res = await fetch(`${this.base}/api/events`, { headers: { cookie: this.cookie }, signal: this.abort.signal });
    this.remember(res);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += decoder.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev: SseEvent = { event: "message", data: undefined, at: Date.now() };
            for (const line of block.split("\n")) {
              if (line.startsWith("event: ")) ev.event = line.slice(7);
              else if (line.startsWith("id: ")) ev.id = Number(line.slice(4));
              else if (line.startsWith("data: ")) ev.data = JSON.parse(line.slice(6));
            }
            if (ev.data !== undefined) this.events.push(ev);
          }
        }
      } catch {
        // aborted
      }
    })();
    const snap = await this.waitFor((e) => e.event === "snapshot");
    return snap.data;
  }

  unsubscribe() {
    this.abort?.abort();
  }

  async waitFor(pred: (e: SseEvent) => boolean, timeout = 3000): Promise<SseEvent> {
    const start = Date.now();
    let seen = 0;
    while (Date.now() - start < timeout) {
      for (; seen < this.events.length; seen++) if (pred(this.events[seen])) return this.events[seen];
      await sleep(10);
    }
    throw new Error("timed out waiting for an event");
  }
}

/** Start a round and return the visitor's dealt palette. */
export async function begin(v: Visitor): Promise<string[]> {
  await v.state();
  const r = await v.post("start");
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  const s = await v.state();
  return s.players.find((p: any) => p.pid === s.me).palette;
}

export async function waitUntil(fn: () => Promise<boolean>, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error("condition never became true");
}
