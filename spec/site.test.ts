import { expect, inject, it } from "vitest";
import { MOTIFS } from "../public/shared.js";

// Read-only checks against the app under test (the built Docker image in
// CI): every page answers, and every motif the game can deal actually ships.
// Nothing here writes, so it's safe to point at any running copy.
const baseUrl = inject("baseUrl");

it("opens the shared scroll at /, not a landing page", async () => {
  const html = await (await fetch(new URL("/", baseUrl))).text();
  expect(html).toContain('id="scroll"');
  expect(html).toContain('lang="zh-Hans"');
  expect(html).toContain("/static/app.js");
});

it("serves the guidance, archive, credits and decision pages", async () => {
  for (const path of ["/how/", "/dreams/", "/credits/", "/decision/", "/readme/"]) {
    const res = await fetch(new URL(path, baseUrl));
    expect(res.status, path).toBe(200);
  }
  expect((await fetch(new URL("/dreams/999999/", baseUrl))).status).toBe(404);
});

it("ships every motif, the scaffolding and the client modules", async () => {
  const paths = [
    ...MOTIFS.map((m) => `/static/motifs/${m.id}.svg`),
    "/static/motifs/scaffold-ridge.svg",
    "/static/motifs/scaffold-water.svg",
    "/static/motifs/seal.svg",
    "/static/app.js",
    "/static/shared.js",
    "/static/archive.js",
    "/static/app.css",
    "/static/site.css",
  ];
  for (const path of paths) {
    const res = await fetch(new URL(path, baseUrl));
    expect(res.status, path).toBe(200);
  }
  const svg = await (await fetch(new URL("/static/motifs/boat.svg", baseUrl))).text();
  expect(svg).not.toMatch(/<script|<foreignObject|href="http/i);
});

it("refuses to serve files outside public/", async () => {
  const res = await fetch(new URL("/static/../src/db.ts", baseUrl));
  expect(res.status).toBe(404);
  const res2 = await fetch(new URL("/static/%2e%2e/src/db.ts", baseUrl));
  expect(res2.status).toBe(404);
});
