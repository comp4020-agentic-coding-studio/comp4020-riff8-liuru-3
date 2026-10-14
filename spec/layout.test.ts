import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sceneMarkup } from "../public/shared.js";
import { begin, startServer, Visitor } from "./helpers.ts";

// Every archive renders at the size its round was painted at. The dreams
// saved before the resize have no size stored; they must still draw on the
// 2400×900 scroll exactly as saved, while new rounds use the new size.

describe("scene size per round", () => {
  it("renders an old 2400×900 archive exactly as saved, and stores the new size for new rounds", async () => {
    const server = await startServer({ COMPOSE_SECONDS: "60" });
    try {
      await server.stop();
      // a dream written by the crit-9 app: one of the live app's public traces
      const old = (JSON.parse(readFileSync("scripts/data/archives.json", "utf8")) as { round: number; scene: any[] }[]).find((a) => a.scene.length > 8)!;
      const db = new Database(`${server.dataDir}/app.db`);
      try {
        // the crit-9 schema had no scene columns; an old row leaves them NULL
        db.prepare("INSERT INTO participants (token, pid, created_at) VALUES ('00000000-0000-4000-8000-000000000001', 'oldone', 1)").run();
        db.prepare(
          "INSERT INTO rounds (id, prompt_index, seed, started_at, compose_end, refine_end, reveal_end, dissolve_end, lightning_at, status, archived_at) VALUES (1, 0, 1, 1, 2, 3, 4, 5, 2, 'archived', 3)",
        ).run();
        db.prepare("INSERT INTO archives (round_id, prompt_index, scene, keyframes, created_at) VALUES (1, 0, ?, ?, 3)").run(
          JSON.stringify(old.scene),
          JSON.stringify([old.scene]),
        );
      } finally {
        db.close();
      }
      await server.restart();
      const html = await (await fetch(`${server.url}/dreams/1/`)).text();
      expect(html).toContain('viewBox="0 0 2400 900"');
      // the art is the same markup the old scroll drew, object for object
      const art = html.match(/<g class="scene-art">([\s\S]*?)<\/g><\/g>\s*<\/svg>/)![1];
      expect(art.trim()).toBe(sceneMarkup(old.scene, "d").trim());
      // the old scaffold sits where it always did
      expect(html).toContain('href="/static/motifs/scaffold-ridge.svg" x="0" y="250" width="2400"');
      const list = await (await fetch(`${server.url}/dreams/`)).text();
      expect(list).toContain('viewBox="0 0 2400 900"');

      // a new round is painted at the new size, and says so
      const a = new Visitor(server.url);
      await begin(a);
      const s = await a.state();
      expect(s.round.scene).toEqual({ width: 1800, height: 1000 });
      // positions are checked against the round's own size
      const palette = s.players.find((p: any) => p.pid === s.me).palette;
      expect((await a.post("place", { motif: palette[0], x: 1790, y: 990 })).status).toBe(200);
      expect((await a.post("place", { motif: palette[0], x: 2000, y: 500 })).status).toBe(400);
      expect((await a.post("place", { motif: palette[0], x: 500, y: 1001 })).status).toBe(400);
      // and the old archive is untouched by any of it
      expect(await (await fetch(`${server.url}/dreams/1/`)).text()).toBe(html);
    } finally {
      await server.stop();
    }
  });
});
