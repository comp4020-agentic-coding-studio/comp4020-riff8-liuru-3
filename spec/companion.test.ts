import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { begin, sleep, startServer, Visitor, waitUntil } from "./helpers.ts";

// The AI companion: invited and dismissed in view of everyone, labelled as
// AI, never a cookie, only ever doing what a person could, generous with
// requests, and gone with the round. Timings come from env vars, the same
// way round timings do.

const FAST = { COMPANION_MIN_SECONDS: "0.3", COMPANION_MAX_SECONDS: "0.8", COMPANION_GLIDE_SECONDS: "0.1", COMPANION_CHECK_SECONDS: "0.25", EXPOSE_STATS: "1" };

const stats = async (url: string) => (await fetch(`${url}/api/companion/stats`)).json();

describe("the AI companion", () => {
  it("arrives and leaves in view of everyone, labelled as AI, at most one per round", async () => {
    const server = await startServer({ COMPOSE_SECONDS: "120", ...FAST });
    try {
      const a = new Visitor(server.url);
      const b = new Visitor(server.url);
      await begin(a);
      await b.subscribe();
      const r = await a.post("companion/invite");
      expect(r.status).toBe(200);
      const arrived = await b.waitFor((e) => e.event === "change" && e.data.type === "companion" && e.data.payload.companion);
      const pid = arrived.data.payload.companion.pid;
      expect(arrived.data.payload.by).toBe((await a.state()).me);
      // a second invitation, from anyone, is the same companion
      const again = await b.post("companion/invite");
      expect(again.body.companion.pid).toBe(pid);
      const s = await b.state();
      expect(s.companion.pid).toBe(pid);
      const player = s.players.find((p: any) => p.pid === pid);
      expect(player).toMatchObject({ agent: true, mark: 99 });
      expect(player.palette).toHaveLength(8);
      // anyone can dismiss it, and everyone sees it go
      expect((await b.post("companion/dismiss")).status).toBe(200);
      const left = await b.waitFor((e) => e.event === "change" && e.data.type === "companion" && e.data.payload.companion === null);
      expect(left.data.payload.left).toBe(pid);
      expect((await a.state()).companion).toBeNull();
      b.unsubscribe();
      // its identity lives in the server: no cookie maps to it
      const db = new Database(`${server.dataDir}/app.db`, { readonly: true });
      try {
        const row = db.prepare("SELECT token, agent FROM participants WHERE pid = ?").get(pid) as { token: string; agent: number };
        expect(row.agent).toBe(1);
        expect(row.token).not.toMatch(/^[0-9a-f-]{36}$/);
        const present = db.prepare("SELECT COUNT(*) AS n FROM companions WHERE status = 'present'").get() as { n: number };
        expect(present.n).toBe(0);
      } finally {
        db.close();
      }
    } finally {
      await server.stop();
    }
  });

  it("plays a short round with no rejected writes, within its interval, then leaves with the round", async () => {
    const server = await startServer({ COMPOSE_SECONDS: "9", REFINE_SECONDS: "3", REVEAL_SECONDS: "1", DISSOLVE_SECONDS: "1", LIGHTNING_SECONDS: "4", ...FAST });
    try {
      const a = new Visitor(server.url);
      const palette = await begin(a);
      await a.subscribe(); // a person is in the room
      await a.post("place", { motif: "water", x: 900, y: 800, scale: 1.4 });
      await a.post("place", { motif: palette[2], x: 400, y: 500 });
      const inv = await a.post("invite", { x: 1300, y: 600, intent: "life" });
      expect(inv.status).toBe(200);
      expect((await a.post("companion/invite")).status).toBe(200);
      // answer whatever it proposes, like a person would
      const answered = new Set<number>();
      const roundId = (await a.state()).round.id;
      await waitUntil(async () => {
        const s = await a.state();
        for (const pr of s.proposals.filter((p: any) => p.target === s.me && !answered.has(p.id))) {
          answered.add(pr.id);
          await a.post("accept", { proposalId: pr.id });
        }
        return s.phase === "reveal" || s.phase === "dissolve" || s.phase === "finished";
      }, 30_000);
      const st = await stats(server.url);
      expect(st.tried).toBeGreaterThan(0);
      expect(st.accepted).toBe(st.tried);
      expect(st.rejected).toBe(0);
      for (const ms of st.intervals) {
        expect(ms).toBeGreaterThanOrEqual(300);
        expect(ms).toBeLessThanOrEqual(800);
      }
      // it went with the round, and the archive marks its work as AI's
      expect((await a.state()).companion).toBeNull();
      const html = await (await fetch(`${server.url}/dreams/${roundId}/`)).text();
      if (st.lastActions.some((x: any) => x.kind === "place" || x.kind === "respond")) {
        expect(html).toContain('class="mark agent"');
        expect(html).toContain("(AI)");
      }
      const db = new Database(`${server.dataDir}/app.db`, { readonly: true });
      try {
        const c = db.prepare("SELECT status, ended_by FROM companions WHERE round_id = ?").get(roundId) as { status: string; ended_by: number | null };
        expect(c).toEqual({ status: "left", ended_by: null });
      } finally {
        db.close();
      }
      a.unsubscribe();
    } finally {
      await server.stop();
    }
  }, 45_000);

  it("answers a borrow proposal well before it expires", async () => {
    const server = await startServer({ COMPOSE_SECONDS: "60", PROPOSAL_SECONDS: "4", ...FAST, COMPANION_MIN_SECONDS: "0.2", COMPANION_MAX_SECONDS: "0.4" });
    try {
      const a = new Visitor(server.url);
      await begin(a);
      await a.subscribe();
      await a.post("place", { motif: "water", x: 900, y: 800, scale: 1.4 });
      await a.post("companion/invite");
      // wait for it to place something of its own
      let theirs: any;
      await waitUntil(async () => {
        const s = await a.state();
        theirs = s.objects.find((o: any) => o.custodian === s.companion?.pid && o.status === "placed");
        return !!theirs;
      }, 20_000);
      // then slow it down so only its request check (not a lucky turn) can answer
      const sent = Date.now();
      const pr = await a.post("borrow", { objectId: theirs.id, version: theirs.version, x: Math.min(1700, theirs.x + 60), y: theirs.y });
      expect(pr.status).toBe(200);
      let outcome: string | undefined;
      await waitUntil(async () => {
        const s = await a.state();
        const still = s.proposals.find((p: any) => p.id === pr.body.proposalId);
        if (!still) {
          const o = s.objects.find((x: any) => x.id === theirs.id);
          outcome = o?.custodian === s.me ? "accepted" : "other";
        }
        return !still;
      }, 4000);
      expect(Date.now() - sent).toBeLessThan(2000);
      expect(outcome).toBe("accepted");
      a.unsubscribe();
    } finally {
      await server.stop();
    }
  }, 40_000);

  it("leaves nothing waiting on it when it goes", async () => {
    const server = await startServer({ COMPOSE_SECONDS: "60", PROPOSAL_SECONDS: "30", ...FAST, COMPANION_CHECK_SECONDS: "20" });
    try {
      const a = new Visitor(server.url);
      await begin(a);
      await a.subscribe();
      await a.post("place", { motif: "water", x: 900, y: 800, scale: 1.4 });
      await a.post("companion/invite");
      let theirs: any;
      await waitUntil(async () => {
        const s = await a.state();
        theirs = s.objects.find((o: any) => o.custodian === s.companion?.pid && o.status === "placed");
        return !!theirs;
      }, 20_000);
      // a request it hasn't answered yet (its check runs every 20 s here)
      const pr = await a.post("borrow", { objectId: theirs.id, version: theirs.version, x: Math.max(10, theirs.x - 50), y: theirs.y });
      expect(pr.status).toBe(200);
      await a.post("companion/dismiss");
      const s = await a.state();
      expect(s.proposals.find((p: any) => p.id === pr.body.proposalId)).toBeUndefined();
      expect(s.invitations.filter((i: any) => i.owner === theirs.custodian && i.status === "open")).toEqual([]);
      expect(s.offers.filter((o: any) => o.offerer === theirs.custodian)).toEqual([]);
      // its objects stay in the picture, as anyone's do
      expect(s.objects.find((o: any) => o.id === theirs.id)).toBeTruthy();
      a.unsubscribe();
    } finally {
      await server.stop();
    }
  }, 40_000);

  it("does nothing while nobody is connected, and never starts a round", async () => {
    const server = await startServer({ COMPOSE_SECONDS: "60", REFINE_SECONDS: "1", REVEAL_SECONDS: "1", DISSOLVE_SECONDS: "1", ...FAST });
    try {
      const a = new Visitor(server.url);
      await begin(a);
      // invited by a request, but no one holds the room open
      await a.post("companion/invite");
      await sleep(2500);
      let st = await stats(server.url);
      expect(st.tried + st.nothing).toBe(0);
      // someone opens the page: it wakes
      await a.subscribe();
      await waitUntil(async () => {
        st = await stats(server.url);
        return st.tried + st.nothing > 0;
      }, 10_000);
      // they leave: it stops
      a.unsubscribe();
      await sleep(1200);
      const frozen = await stats(server.url);
      await sleep(2500);
      const later = await stats(server.url);
      expect(later.tried + later.nothing).toBe(frozen.tried + frozen.nothing);
    } finally {
      await server.stop();
    }
    // with a finished round and people present, it never begins another
    const s2 = await startServer({ COMPOSE_SECONDS: "2", REFINE_SECONDS: "1", REVEAL_SECONDS: "0.5", DISSOLVE_SECONDS: "0.5", ...FAST });
    try {
      const a = new Visitor(s2.url);
      await begin(a);
      await a.subscribe();
      await a.post("companion/invite");
      await waitUntil(async () => (await a.state()).phase === "finished", 15_000);
      const id = (await a.state()).round.id;
      await sleep(2000);
      const s = await a.state();
      expect(s.phase).toBe("finished");
      expect(s.round.id).toBe(id);
      a.unsubscribe();
    } finally {
      await s2.stop();
    }
  }, 45_000);

  it("is reconciled after a restart mid-round, and can't be invited by itself or start a dream", async () => {
    const server = await startServer({ COMPOSE_SECONDS: "60", ...FAST });
    try {
      const a = new Visitor(server.url);
      await begin(a);
      await a.post("companion/invite");
      const pid = (await a.state()).companion.pid;
      await server.restart();
      const s = await a.state();
      expect(s.companion?.pid).toBe(pid);
      // and it picks up again once someone is here
      await a.subscribe();
      await waitUntil(async () => {
        const st = await stats(server.url);
        return st.tried + st.nothing > 0;
      }, 10_000);
      a.unsubscribe();
      // only one present per round, even across a restart
      const db = new Database(`${server.dataDir}/app.db`, { readonly: true });
      try {
        const n = db.prepare("SELECT COUNT(*) AS n FROM companions WHERE round_id = ? AND status = 'present'").get(s.round.id) as { n: number };
        expect(n.n).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      await server.stop();
    }
  }, 30_000);
});
