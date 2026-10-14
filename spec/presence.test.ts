import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { begin, openSocket, sleep, startServer, type TestServer, Visitor, waitForItem } from "./helpers.ts";

// Live cursors over the WebSocket: who may open one, how fast a pointer
// reaches someone else, what gets dropped, and that none of it is stored.

describe("presence socket", () => {
  let server: TestServer;
  let a: Visitor;
  let b: Visitor;

  beforeAll(async () => {
    server = await startServer({ COMPOSE_SECONDS: "120" });
    a = new Visitor(server.url);
    b = new Visitor(server.url);
    await begin(a);
    await b.state();
  });
  afterAll(() => server.stop());

  it("refuses an upgrade without a visitor cookie, with an unknown one, or from a foreign origin", async () => {
    const nobody = new Visitor(server.url);
    await expect(openSocket(nobody)).rejects.toThrow(/refused 401/);
    await expect(openSocket(a, { cookie: "visitor=00000000-0000-4000-8000-000000000000" })).rejects.toThrow(/refused 401/);
    await expect(openSocket(a, { origin: "https://evil.example" })).rejects.toThrow(/refused 403/);
    await expect(openSocket(a, { origin: null })).rejects.toThrow(/refused 403/);
    const ok = await openSocket(a);
    ok.ws.close();
  });

  it("brings one person's pointer to another within 200 ms, in scene units, and never echoes it back", async () => {
    const sa = await openSocket(a);
    const sb = await openSocket(b);
    const aPid = (await a.state()).me;
    const sent = Date.now();
    sa.ws.send(JSON.stringify({ t: "c", x: 640.25, y: 333, act: "hold", motif: "boat" }));
    const got = await waitForItem(sb.messages, (m) => m.t === "cur" && m.c.some((c: any) => c.pid === aPid));
    expect(Date.now() - sent).toBeLessThan(200);
    expect(got.c.find((c: any) => c.pid === aPid)).toMatchObject({ x: 640.3, y: 333, act: "hold", motif: "boat" });
    await sleep(150);
    expect(sa.messages.some((m) => m.c?.some((c: any) => c.pid === aPid))).toBe(false);
    sa.ws.close();
    sb.ws.close();
  });

  it("drops malformed and oversized messages, and clamps what it keeps", async () => {
    const sa = await openSocket(a);
    const sb = await openSocket(b);
    const aPid = (await a.state()).me;
    for (const bad of ["not json", "{}", '{"t":"c","x":"left","y":2}', '{"t":"c","x":1}', "[1,2,3]", '{"t":"c","x":null,"y":5}']) {
      sa.ws.send(bad);
    }
    await sleep(200);
    expect(sb.messages.filter((m) => m.c?.some((c: any) => c.pid === aPid))).toEqual([]);
    sa.ws.send(JSON.stringify({ t: "c", x: 1e9, y: -50, act: "teleport", motif: "dragon", objectId: "x", ghost: { motif: "boat", x: 1e6, y: 4, scale: 99 } }));
    const got = await waitForItem(sb.messages, (m) => m.c?.some((c: any) => c.pid === aPid));
    const c = got.c.find((x: any) => x.pid === aPid);
    expect(c.x).toBeLessThanOrEqual(2400);
    expect(c.y).toBe(0);
    expect(c.act).toBe("");
    expect(c.motif).toBeUndefined();
    expect(c.objectId).toBeUndefined();
    expect(c.ghost.scale).toBe(1.8);
    // over the size cap: the server closes the socket rather than read it
    sa.ws.send(JSON.stringify({ t: "c", x: 1, y: 1, pad: "x".repeat(2000) }));
    expect(await sa.closed).toBe(1009);
    sb.ws.close();
  });

  it("removes a cursor for everyone when its owner disconnects", async () => {
    const sa = await openSocket(a);
    const sb = await openSocket(b);
    const aPid = (await a.state()).me;
    sa.ws.send(JSON.stringify({ t: "c", x: 10, y: 10 }));
    await waitForItem(sb.messages, (m) => m.c?.some((c: any) => c.pid === aPid));
    sa.ws.close();
    await waitForItem(sb.messages, (m) => m.gone?.includes(aPid));
    sb.ws.close();
  });

  it("keeps cursors out of SQLite and out of the event stream", async () => {
    await b.subscribe();
    const sa = await openSocket(a);
    const before = (await a.state()).cursor;
    for (let i = 0; i < 20; i++) {
      sa.ws.send(JSON.stringify({ t: "c", x: 100 + i * 7, y: 200, act: "drag", ghost: { motif: "boat", x: 100 + i * 7, y: 200 } }));
      await sleep(20);
    }
    await sleep(200);
    sa.ws.close();
    expect((await a.state()).cursor).toBe(before);
    expect(b.events.filter((e) => e.event === "change")).toEqual([]);
    b.unsubscribe();
    const db = new Database(`${server.dataDir}/app.db`, { readonly: true });
    try {
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
      expect(tables.some((t) => /cursor|presence/i.test(t))).toBe(false);
      const rows = db.prepare("SELECT payload FROM events").all() as { payload: string }[];
      expect(rows.some((r) => r.payload.includes('"ghost"') || r.payload.includes('"act"'))).toBe(false);
    } finally {
      db.close();
    }
  });
});
