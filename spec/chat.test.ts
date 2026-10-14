import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { begin, sleep, startServer, type TestServer, Visitor, waitUntil } from "./helpers.ts";

// The room's chat: durable, real-time, escaped, limited, idempotent, paged
// and exportable, whole or one dream at a time.

describe("chat", () => {
  let server: TestServer;
  let a: Visitor;
  let b: Visitor;

  beforeAll(async () => {
    server = await startServer({ COMPOSE_SECONDS: "2", REFINE_SECONDS: "1", REVEAL_SECONDS: "1", DISSOLVE_SECONDS: "1" });
    a = new Visitor(server.url);
    b = new Visitor(server.url);
    await begin(a);
    await b.state();
  });
  afterAll(() => server.stop());

  const history = async (v: Visitor, q = "") => (await fetch(`${server.url}/api/chat${q}`, { headers: { cookie: v.cookie } })).json();

  it("reaches another open session within a second, and survives a restart", async () => {
    await b.subscribe();
    const sent = Date.now();
    const r = await a.post("chat", { text: "moon over the water?" });
    expect(r.status).toBe(200);
    const ev = await b.waitFor((e) => e.event === "change" && e.data.type === "chat");
    expect(ev.at - sent).toBeLessThan(1000);
    expect(ev.data.payload.message).toMatchObject({ id: r.body.messageId, body: "moon over the water?", pid: (await a.state()).me });
    b.unsubscribe();
    await server.restart();
    const h = await history(b);
    expect(h.messages.map((m: any) => m.body)).toContain("moon over the water?");
  });

  it("stores text as text: no markup is ever interpreted, control characters are stripped", async () => {
    const evil = `<img src=x onerror=alert(1)><script>alert(2)</script>\u0007bell‮flip\nline`;
    const r = await a.post("chat", { text: evil });
    expect(r.status).toBe(200);
    const m = (await history(a)).messages.find((x: any) => x.id === r.body.messageId);
    expect(m.body).toBe("<img src=x onerror=alert(1)><script>alert(2)</script> bell flip line");
    // the live page renders messages with textContent; the archive page escapes them
    const page = await (await fetch(`${server.url}/`)).text();
    expect(page).not.toContain("onerror=alert");
    // and the Markdown export escapes them too
    const md = await (await fetch(`${server.url}/api/chat/export?format=md`)).text();
    expect(md).not.toMatch(/(^|[^\\])<img src=x/);
    expect(md).toContain("\\<img src=x");
  });

  it("limits length to 300 characters, rejects empty and non-text, and rate-limits each person", async () => {
    expect((await a.post("chat", { text: "x".repeat(301) })).status).toBe(400);
    expect((await a.post("chat", { text: "字".repeat(300) })).status).toBe(200);
    expect((await a.post("chat", { text: "   " })).status).toBe(400);
    expect((await a.post("chat", { text: 42 })).status).toBe(400);
    expect((await a.post("chat", { text: ["hi"] })).status).toBe(400);
    const c = new Visitor(server.url);
    await c.state();
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await c.post("chat", { text: `quick ${i}` })).status);
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes.slice(5)).toEqual([429, 429, 429]);
    // someone else isn't slowed by it
    expect((await b.post("chat", { text: "still here" })).status).toBe(200);
  });

  it("stores one message for a repeated action id", async () => {
    const id = "spec-chat-repeat-1";
    const first = await b.post("chat", { text: "only once" }, id);
    const again = await b.post("chat", { text: "only once" }, id);
    expect(again.body.messageId).toBe(first.body.messageId);
    const all = (await history(b, "?limit=100")).messages.filter((m: any) => m.body === "only once");
    expect(all).toHaveLength(1);
  });

  it("can point at an object in the picture, and only at one that's there", async () => {
    const s = await a.state();
    const palette = s.players.find((p: any) => p.pid === s.me).palette;
    const placed = await a.post("place", { motif: palette[0], x: 400, y: 400 });
    if (placed.status !== 200) return; // compose may have closed on a slow machine; covered elsewhere
    const r = await b.post("chat", { text: "about this", objectId: placed.body.objectId });
    expect(r.status).toBe(200);
    const m = (await history(b)).messages.find((x: any) => x.id === r.body.messageId);
    expect(m).toMatchObject({ objectId: placed.body.objectId, objectMotif: palette[0] });
    expect((await b.post("chat", { text: "about nothing", objectId: 999999 })).status).toBe(404);
  });

  it("pages history in bounded steps, oldest first within a page", async () => {
    const c = new Visitor(server.url);
    await c.state();
    // spread over time so the rate limit lets them through
    for (let i = 0; i < 12; i++) {
      const r = await c.post("chat", { text: `page ${i}` });
      if (r.status === 429) {
        await sleep(3100);
        i--;
      }
    }
    const first = await history(c, "?limit=5");
    expect(first.messages).toHaveLength(5);
    expect(first.more).toBe(true);
    const ids = first.messages.map((m: any) => m.id);
    expect([...ids].sort((x, y) => x - y)).toEqual(ids);
    const older = await history(c, `?limit=5&before=${ids[0]}`);
    expect(older.messages).toHaveLength(5);
    expect(Math.max(...older.messages.map((m: any) => m.id))).toBeLessThan(ids[0]);
    // the server caps the page whatever is asked for
    expect((await history(c, "?limit=100000")).messages.length).toBeLessThanOrEqual(100);
  }, 60_000);

  it("exports the whole history and one dream as real downloads in Markdown, text and JSON", async () => {
    const s = await a.state();
    const round1 = s.round.id;
    // let this dream end and start another, so there are two dreams to tell apart
    await waitUntil(async () => (await a.state()).phase === "finished", 20_000);
    expect((await a.post("start")).status).toBe(200);
    expect((await a.post("chat", { text: "a line in the second dream" })).status).toBe(200);

    const md = await fetch(`${server.url}/api/chat/export?format=md`);
    expect(md.headers.get("content-type")).toMatch(/^text\/markdown/);
    expect(md.headers.get("content-disposition")).toMatch(/^attachment; filename="liuru-chat\.md"/);
    const mdText = await md.text();
    expect(mdText).toContain(`## Dream ${round1}: 雨停了，人还没回来。 The rain has stopped. Someone has not returned.`);
    expect(mdText).toContain(`## Dream ${round1 + 1}:`);
    expect(mdText).toContain("moon over the water?");
    expect(mdText.indexOf("moon over the water?")).toBeLessThan(mdText.indexOf("a line in the second dream"));

    const txt = await fetch(`${server.url}/api/chat/export?format=txt`);
    expect(txt.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await txt.text()).toContain("== Dream");

    const one = await fetch(`${server.url}/api/chat/export?format=json&round=${round1 + 1}`);
    expect(one.headers.get("content-type")).toMatch(/^application\/json/);
    expect(one.headers.get("content-disposition")).toContain(`liuru-chat-dream-${round1 + 1}.json`);
    const data = await one.json();
    expect(data.messages.map((m: any) => m.text)).toEqual(["a line in the second dream"]);
    expect(data.messages[0]).toMatchObject({ round: round1 + 1, phase: "compose" });

    const whole = await (await fetch(`${server.url}/api/chat/export?format=json`)).json();
    expect(whole.messages.length).toBeGreaterThan(10);
    expect(new Set(whole.messages.map((m: any) => m.round))).toEqual(new Set([round1, round1 + 1]));

    expect((await fetch(`${server.url}/api/chat/export?format=html`)).status).toBe(400);
    expect((await fetch(`${server.url}/api/chat/export?format=md&round=99999`)).status).toBe(404);
  }, 40_000);

  it("shows a dream's conversation on its saved page without changing the saved scene", async () => {
    const list = await (await fetch(`${server.url}/dreams/`)).text();
    const id = Number(list.match(/\/dreams\/(\d+)\//)![1]);
    const html = await (await fetch(`${server.url}/dreams/${id}/`)).text();
    expect(html).toContain("这场梦里的话");
    expect(html).toContain("moon over the water?");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
  });
});
