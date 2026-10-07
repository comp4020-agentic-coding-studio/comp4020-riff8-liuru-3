import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { begin, sleep, startServer, type TestServer, Visitor, waitUntil } from "./helpers.ts";

// The shared dream's promises, each against a real server process over HTTP
// and SSE: palettes, real-time placement, validation, consent-based
// borrowing, atomic bubble handoffs, idempotency, reconnects, restarts, and
// the round's freeze and archive.

describe("one long round", () => {
  let server: TestServer;
  let a: Visitor;
  let b: Visitor;
  let c: Visitor;

  beforeAll(async () => {
    server = await startServer({ COMPOSE_SECONDS: "120", PROPOSAL_SECONDS: "1.5", LEASE_SECONDS: "1.5" });
    a = new Visitor(server.url);
    b = new Visitor(server.url);
    c = new Visitor(server.url);
    await begin(a);
    await b.state();
    await c.state();
  });
  afterAll(() => server.stop());

  const mine = async (v: Visitor) => {
    const s = await v.state();
    return s.players.find((p: any) => p.pid === s.me);
  };

  it("deals each cookie its own palette, and keeps it across reloads", async () => {
    const pa = await mine(a);
    const pb = await mine(b);
    expect(pa.palette).toHaveLength(8);
    expect(pb.palette).toHaveLength(8);
    expect(pa.palette).not.toEqual(pb.palette);
    // the first dreamer may be alone, so they get water to play with
    expect(pa.palette).toContain("water");
    expect((await mine(a)).palette).toEqual(pa.palette);
    // a second tab with the same cookie is the same participant
    const tab = new Visitor(server.url);
    tab.cookie = a.cookie;
    expect((await tab.state()).me).toBe((await a.state()).me);
    expect((await mine(tab)).palette).toEqual(pa.palette);
    expect((await a.state()).players).toHaveLength(3);
  });

  it("shows a placement to another open session within a second, without reload", async () => {
    await b.subscribe();
    const sent = Date.now();
    const r = await a.post("place", { motif: "water", x: 1200, y: 650 });
    expect(r.status).toBe(200);
    const ev = await b.waitFor((e) => e.event === "change" && e.data.payload.objects?.some((o: any) => o.id === r.body.objectId));
    expect(ev.at - sent).toBeLessThan(1000);
    expect(ev.data.payload.objects[0]).toMatchObject({ motif: "water", x: 1200, y: 650, status: "placed" });
    b.unsubscribe();
  });

  it("rejects bad writes without touching the scene", async () => {
    const before = (await a.state()).objects;
    const pb = await mine(b);
    const notMine = ["boat", "pine", "moon", "pavilion", "crane", "rock"].find((m) => !pb.palette.includes(m))!;
    const bad = [
      await a.post("place", { motif: "water", x: 1e9, y: 10 }),
      await a.post("place", { motif: "water", x: 100, y: 100, scale: 9 }),
      await a.post("place", { motif: "water", x: 100, y: 100, rotation: "lots" }),
      await a.post("place", { motif: "dragon", x: 100, y: 100 }),
      await b.post("place", { motif: notMine, x: 100, y: 100 }),
      await a.post("place", { motif: "water", x: 100, y: 100, custodian: "someone" }, "bad id!"),
    ];
    for (const r of bad) expect(r.status).toBeGreaterThanOrEqual(400);
    // spoofed custody: b can't move or withdraw a's water
    const water = before.find((o: any) => o.motif === "water");
    expect((await b.post("update", { objectId: water.id, version: water.version, x: 10, y: 10 })).status).toBe(403);
    expect((await b.post("withdraw", { objectId: water.id, version: water.version })).status).toBe(403);
    // a client-supplied owner field is ignored, never trusted
    const spoof = await b.post("place", { motif: pb.palette[0], x: 300, y: 300, custodian: (await a.state()).me });
    const placed = (await b.state()).objects.find((o: any) => o.id === spoof.body.objectId);
    expect(placed.custodian).toBe((await b.state()).me);
    await b.post("withdraw", { objectId: placed.id, version: placed.version });
    // a cross-site page can't write
    const res = await fetch(`${server.url}/api/place`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: a.cookie, origin: "https://evil.example" },
      body: JSON.stringify({ actionId: "cross-site-1", motif: "water", x: 5, y: 5 }),
    });
    expect(res.status).toBe(403);
    const after = (await a.state()).objects;
    expect(after.map((o: any) => [o.id, o.x, o.y, o.custodian])).toEqual(before.map((o: any) => [o.id, o.x, o.y, o.custodian]));
  });

  it("treats a repeated action id as one action", async () => {
    const id = "spec-repeat-placement-1";
    const first = await a.post("place", { motif: "water", x: 400, y: 700 }, id);
    const again = await a.post("place", { motif: "water", x: 400, y: 700 }, id);
    expect(again.body.objectId).toBe(first.body.objectId);
    expect((await a.state()).objects.filter((o: any) => o.x === 400 && o.y === 700)).toHaveLength(1);
    const dewId = "spec-repeat-dew-1";
    await a.post("dew", { x: 400, y: 600 }, dewId);
    await a.post("dew", { x: 400, y: 600 }, dewId);
    expect((await mine(a)).dewUsed).toBe(1);
  });

  it("borrows only with consent, and never from a stale, declined or expired proposal", async () => {
    const s = await a.state();
    const water = s.objects.find((o: any) => o.motif === "water" && o.x === 1200);

    // declined: nothing moves
    const p1 = await b.post("borrow", { objectId: water.id, version: water.version, x: 1500, y: 650 });
    expect(p1.status).toBe(200);
    const cx = await c.post("accept", { proposalId: p1.body.proposalId });
    expect(cx.status, JSON.stringify(cx.body)).toBe(403);
    await a.post("decline", { proposalId: p1.body.proposalId });
    expect((await b.post("accept", { proposalId: p1.body.proposalId })).status).toBe(409);
    let now = (await a.state()).objects.find((o: any) => o.id === water.id);
    expect([now.x, now.custodian]).toEqual([1200, s.me]);

    // stale: the custodian changed the object after the proposal was made
    const p2 = await b.post("borrow", { objectId: water.id, version: now.version, x: 1500, y: 650 });
    await a.post("update", { objectId: water.id, version: now.version, x: 1210, y: 650, scale: 1, rotation: 0, flip: false, ink: 0.9, depth: 1 });
    const stale = await a.post("accept", { proposalId: p2.body.proposalId });
    expect(stale.status).toBe(409);
    now = (await a.state()).objects.find((o: any) => o.id === water.id);
    expect([now.x, now.custodian]).toEqual([1210, s.me]);

    // expired: twenty seconds in production, 1.5 here
    const p3 = await b.post("borrow", { objectId: water.id, version: now.version, x: 1500, y: 650 });
    await sleep(1800);
    expect((await a.post("accept", { proposalId: p3.body.proposalId })).status).toBe(409);
    now = (await a.state()).objects.find((o: any) => o.id === water.id);
    expect([now.x, now.custodian]).toEqual([1210, s.me]);

    // accepted: moves and changes custody in one step, contributor kept
    const p4 = await b.post("borrow", { objectId: water.id, version: now.version, x: 1500, y: 660 });
    const ok = await a.post("accept", { proposalId: p4.body.proposalId });
    expect(ok.status).toBe(200);
    now = (await a.state()).objects.find((o: any) => o.id === water.id);
    const bMe = (await b.state()).me;
    expect([now.x, now.y, now.custodian, now.contributor]).toEqual([1500, 660, bMe, s.me]);
    // a shadow (影) lingers where it was
    expect((await a.state()).shadows.some((sh: any) => sh.x === 1210)).toBe(true);
  });

  it("lets exactly one of two racing visitors catch a bubble", async () => {
    const water = (await a.state()).objects.find((o: any) => o.motif === "water" && o.x === 400);
    const off = await a.post("offer", { objectId: water.id, version: water.version });
    expect(off.status).toBe(200);
    const offerId = off.body.offerId;
    const [rb, rc] = await Promise.all([b.post("claim", { offerId }), c.post("claim", { offerId })]);
    expect([rb.status, rc.status].sort()).toEqual([200, 409]);
    const loser = rb.status === 409 ? rb : rc;
    expect(loser.body.message).toContain("已被接住");
    const winner = rb.status === 200 ? b : c;
    const placed = await winner.post("receive", { offerId, x: 900, y: 700 });
    expect(placed.status).toBe(200);
    const s = await a.state();
    const moved = s.objects.filter((o: any) => o.id === water.id);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ x: 900, y: 700, custodian: (await winner.state()).me, status: "placed" });
    expect(s.objects.filter((o: any) => o.motif === "water")).toHaveLength(2);
  });

  it("returns an unplaced bubble to its place and custodian when the lease runs out", async () => {
    const pb = await mine(b);
    const placed = await b.post("place", { motif: pb.palette[1], x: 2000, y: 400 });
    let o = (await b.state()).objects.find((x: any) => x.id === placed.body.objectId);
    const off = await b.post("offer", { objectId: o.id, version: o.version });
    expect((await c.post("claim", { offerId: off.body.offerId })).status).toBe(200);
    await sleep(1900);
    expect((await c.post("receive", { offerId: off.body.offerId, x: 100, y: 100 })).status).toBe(409);
    o = (await b.state()).objects.find((x: any) => x.id === placed.body.objectId);
    expect(o).toMatchObject({ x: 2000, y: 400, custodian: (await b.state()).me, status: "placed" });
  });

  it("completes an invitation through the inviter's consent", async () => {
    const inv = await a.post("invite", { x: 1700, y: 500, intent: "life" });
    expect(inv.status).toBe(200);
    const pc = await mine(c);
    // an answer belongs at the opening, not anywhere on the scroll
    expect((await c.post("respond", { invitationId: inv.body.invitationId, motif: pc.palette[0], x: 100, y: 100 })).status).toBe(400);
    const resp = await c.post("respond", { invitationId: inv.body.invitationId, motif: pc.palette[0] });
    expect(resp.status).toBe(200);
    // only one outstanding answer per opening
    expect((await b.post("respond", { invitationId: inv.body.invitationId, motif: (await mine(b)).palette[0] })).status).toBe(409);
    const ok = await a.post("accept", { proposalId: resp.body.proposalId });
    expect(ok.status).toBe(200);
    const s = await a.state();
    const obj = s.objects.find((o: any) => o.id === ok.body.objectId);
    expect(obj).toMatchObject({ motif: pc.palette[0], x: 1700, y: 500, custodian: (await c.state()).me });
    expect(s.invitations.find((i: any) => i.id === inv.body.invitationId)).toBeUndefined();

    // "leave this open" asks for acknowledgement, not an object
    const open = await a.post("invite", { x: 600, y: 300, intent: "open" });
    expect((await b.post("respond", { invitationId: open.body.invitationId, motif: (await mine(b)).palette[0] })).status).toBe(409);
    expect((await b.post("acknowledge", { invitationId: open.body.invitationId })).status).toBe(200);
  });

  it("derives relationships deterministically, and ends them when motifs part", async () => {
    const pa = await mine(a);
    const subject = ["boat", "sailboat", "moon"].find((m) => pa.palette.includes(m))!;
    const water = (await a.post("place", { motif: "water", x: 300, y: 500 })).body.objectId;
    const y = subject === "moon" ? 300 : subject === "boat" ? 500 : 440;
    const sub = (await a.post("place", { motif: subject, x: 300, y })).body.objectId;
    const type = subject === "moon" ? "moon-water" : "boat-water";
    let s = await a.state();
    expect(s.relations).toContainEqual({ type, a: sub, b: water });
    // every viewer computes the same pairs
    expect((await b.state()).relations).toEqual(s.relations);
    const o = s.objects.find((x: any) => x.id === sub);
    await a.post("update", { objectId: sub, version: o.version, x: 2300, y: 100, scale: 1, rotation: 0, flip: false, ink: 0.9, depth: 1 });
    s = await a.state();
    expect(s.relations.some((r: any) => r.a === sub)).toBe(false);
  });

  it("turns an object into a reflection only near water, and back when the water leaves", async () => {
    const pa = await mine(a);
    const solid = pa.palette.find((m: string) => !["water", "moon", "sun", "cloud", "mist", "rain"].includes(m))!;
    const far = (await a.post("place", { motif: solid, x: 2200, y: 150 })).body.objectId;
    let o = (await a.state()).objects.find((x: any) => x.id === far);
    expect((await a.post("reflect", { objectId: far, version: o.version, on: true })).status).toBe(409);
    const water = (await a.post("place", { motif: "water", x: 1900, y: 820 })).body.objectId;
    const near = (await a.post("place", { motif: solid, x: 1900, y: 700, scale: 0.6 })).body.objectId;
    o = (await a.state()).objects.find((x: any) => x.id === near);
    expect((await a.post("reflect", { objectId: near, version: o.version, on: true })).status).toBe(200);
    expect((await a.state()).objects.find((x: any) => x.id === near).reflectOn).toBe(water);
    const w = (await a.state()).objects.find((x: any) => x.id === water);
    await a.post("withdraw", { objectId: water, version: w.version });
    o = (await a.state()).objects.find((x: any) => x.id === near);
    expect(o.reflectOn).toBeNull();
    expect([o.x, o.y]).toEqual([1900, 700]);
  });

  it("recovers the canonical scene after a disconnect", async () => {
    const snap1 = await c.subscribe();
    c.unsubscribe();
    // the scene changes while c is away
    const pa = await mine(a);
    await a.post("place", { motif: pa.palette[2], x: 1000, y: 200 });
    const snap2 = await c.subscribe();
    expect(snap2.cursor).toBeGreaterThan(snap1.cursor);
    const truth = await a.state();
    const shape = (s: any) => s.objects.map((o: any) => [o.id, o.x, o.y, o.custodian, o.version]);
    expect(shape(snap2)).toEqual(shape(truth));
    // and the live stream carries on from that cursor, with no gap
    await a.post("place", { motif: pa.palette[2], x: 1100, y: 200 });
    const ev = await c.waitFor((e) => e.event === "change");
    expect(ev.id).toBe(snap2.cursor + 1);
    c.unsubscribe();
  });

  it("keeps a visitor's quotas to the published limits", async () => {
    const pa = await mine(a);
    await a.post("dew", { x: 100, y: 100 });
    expect((await a.post("dew", { x: 100, y: 100 })).status).toBe(409);
    expect((await a.post("reroll", { slot: 7 })).status).toBe(200);
    expect((await a.post("reroll", { slot: 7 })).status).toBe(200);
    expect((await a.post("reroll", { slot: 7 })).status).toBe(409);
    const after = await mine(a);
    expect(after.palette.slice(0, 7)).toEqual(pa.palette.slice(0, 7));
    expect(new Set(after.palette).size).toBe(8);
  });
});

describe("a whole short dream", () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer({ COMPOSE_SECONDS: "2", REFINE_SECONDS: "1.5", REVEAL_SECONDS: "1", DISSOLVE_SECONDS: "1", LIGHTNING_SECONDS: "1" });
  });
  afterAll(() => server.stop());

  it("starts exactly one round from simultaneous requests", async () => {
    const vs = Array.from({ length: 6 }, () => new Visitor(server.url));
    await Promise.all(vs.map((v) => v.state()));
    const rs = await Promise.all(vs.map((v) => v.post("start")));
    expect(new Set(rs.map((r) => r.body.roundId)).size).toBe(1);
  });

  it("closes placement in refine, freezes, archives once, and lets a new dream begin", async () => {
    const a = new Visitor(server.url);
    const b = new Visitor(server.url);
    const s0 = await a.state();
    await b.state();
    const roundId = s0.round.id;
    const pa = s0.players.find((p: any) => p.pid === s0.me).palette;
    const placed = await a.post("place", { motif: pa[0], x: 500, y: 500 });
    expect(placed.status).toBe(200);
    await waitUntil(async () => (await a.state()).phase === "refine");
    const refused = await a.post("place", { motif: pa[0], x: 600, y: 500 });
    expect(refused.status).toBe(409);
    // moving is still fine in refine
    const o = (await a.state()).objects[0];
    expect((await a.post("update", { objectId: o.id, version: o.version, x: 520, y: 500, scale: 1, rotation: 0, flip: false, ink: 0.9, depth: 1 })).status).toBe(200);
    // hammer the freeze boundary from two visitors at once
    const late: Promise<{ status: number }>[] = [];
    await waitUntil(async () => {
      const s = await a.state();
      const cur = s.objects[0];
      late.push(a.post("update", { objectId: cur.id, version: cur.version, x: 530, y: 500, scale: 1, rotation: 0, flip: false, ink: 0.9, depth: 1 }));
      late.push(b.post("start"));
      return s.phase === "reveal";
    });
    await Promise.all(late);
    expect((await a.post("update", { objectId: o.id, version: o.version + 1, x: 999, y: 500 })).status).toBe(409);
    const html = await (await fetch(`${server.url}/dreams/`)).text();
    expect(html.match(new RegExp(`/dreams/${roundId}/`, "g"))).toHaveLength(1);
    const detail = await fetch(`${server.url}/dreams/${roundId}/`);
    expect(detail.status).toBe(200);
    expect(await detail.text()).toContain("motifs/" + pa[0]);
    await waitUntil(async () => (await a.state()).phase === "finished");
    const next = await b.post("start");
    expect(next.body.roundId).toBe(roundId + 1);
    expect((await b.post("start")).body.roundId).toBe(roundId + 1);
  });
});

describe("a restart", () => {
  it("keeps scene, palette and archive, and reconciles what expired while down", async () => {
    const server = await startServer({ COMPOSE_SECONDS: "4", REFINE_SECONDS: "1", REVEAL_SECONDS: "1", DISSOLVE_SECONDS: "1", PROPOSAL_SECONDS: "1" });
    try {
      const a = new Visitor(server.url);
      const b = new Visitor(server.url);
      const palette = await begin(a);
      await b.state();
      const id = (await a.post("place", { motif: palette[0], x: 700, y: 400 })).body.objectId;
      const o = (await a.state()).objects.find((x: any) => x.id === id);
      const off = await a.post("offer", { objectId: id, version: o.version });
      expect(off.status).toBe(200);
      const before = await a.state();

      await server.restart();
      const mid = await a.state();
      expect(mid.round.id).toBe(before.round.id);
      expect(mid.players.find((p: any) => p.pid === mid.me).palette).toEqual(palette);
      expect(mid.objects.find((x: any) => x.id === id)).toMatchObject({ x: 700, y: 400 });

      // the offer expires and the round's deadline passes while the server is down
      await server.stop();
      await sleep(6500);
      await server.restart();
      const after = await a.state();
      expect(["reveal", "dissolve", "finished"]).toContain(after.phase);
      expect(after.offers).toEqual([]);
      const html = await (await fetch(`${server.url}/dreams/`)).text();
      expect(html.match(new RegExp(`/dreams/${before.round.id}/`, "g"))).toHaveLength(1);
      const detail = await (await fetch(`${server.url}/dreams/${before.round.id}/`)).text();
      expect(detail).toContain(`motifs/${palette[0]}.svg`);
      // a second restart doesn't archive it again
      await server.restart();
      const again = await (await fetch(`${server.url}/dreams/`)).text();
      expect(again.match(new RegExp(`/dreams/${before.round.id}/`, "g"))).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });
});

describe("limits during handovers", () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startServer({ COMPOSE_SECONDS: "120" });
  });
  afterAll(() => server.stop());

  const placeMany = async (v: Visitor, n: number, y: number) => {
    const s = await v.state();
    const palette = s.players.find((p: any) => p.pid === s.me).palette;
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      const r = await v.post("place", { motif: palette[i % 8], x: 60 + i * 150, y });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      ids.push(r.body.objectId);
    }
    return ids;
  };
  const offerOf = async (v: Visitor, id: number) => {
    const o = (await v.state()).objects.find((x: any) => x.id === id);
    return (await v.post("offer", { objectId: id, version: o.version })).body.offerId;
  };

  it("counts a caught bubble against the catcher's twelve, and lets handovers through a full scroll", async () => {
    const vs = Array.from({ length: 5 }, () => new Visitor(server.url));
    await begin(vs[0]);
    for (const v of vs.slice(1)) await v.state();
    await placeMany(vs[0], 12, 100);
    await placeMany(vs[1], 11, 250);
    await placeMany(vs[2], 12, 400);
    const d = await placeMany(vs[3], 12, 550);
    // 47 on the scroll; vs[1] holds 11. Two bubbles from vs[3]:
    const o1 = await offerOf(vs[3], d[0]);
    const o2 = await offerOf(vs[3], d[1]);
    expect((await vs[1].post("claim", { offerId: o1 })).status).toBe(200);
    const second = await vs[1].post("claim", { offerId: o2 });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("hands-full");
    await vs[1].post("receive", { offerId: o1, x: 1000, y: 700 });
    // fill the scroll to 48, then a handover still works
    const s4 = await vs[4].state();
    const p4 = s4.players.find((p: any) => p.pid === s4.me).palette;
    expect((await vs[4].post("place", { motif: p4[0], x: 1200, y: 800 })).status).toBe(200);
    expect((await vs[4].state()).objects.filter((o: any) => o.status !== "withdrawn")).toHaveLength(48);
    expect((await vs[4].post("claim", { offerId: o2 })).status).toBe(200);
    expect((await vs[4].post("receive", { offerId: o2, x: 1300, y: 800 })).status).toBe(200);
  });

  it("only accepts real intents, and two openings per person per dream", async () => {
    const v = new Visitor(server.url);
    await v.state();
    for (const intent of ["toString", "__proto__", "constructor"]) {
      expect((await v.post("invite", { x: 100, y: 100, intent })).status).toBe(400);
    }
    expect((await v.post("place", { motif: "constructor", x: 100, y: 100 })).status).toBe(400);
    expect((await v.post("invite", { x: 100, y: 100, intent: "open" })).status).toBe(200);
    const second = await v.post("invite", { x: 300, y: 100, intent: "open" });
    const w = new Visitor(server.url);
    await w.state();
    await w.post("acknowledge", { invitationId: second.body.invitationId });
    expect((await v.post("invite", { x: 500, y: 100, intent: "life" })).status).toBe(409);
  });
});
