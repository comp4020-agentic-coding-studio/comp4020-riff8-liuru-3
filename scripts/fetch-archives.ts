// Refetches scripts/data/archives.json: the final scene of each public dream
// trace, straight from a running copy of the app.
//
//   node scripts/fetch-archives.ts [first] [last]
//
// Read-only GETs of /dreams/<id>/, whose page embeds its keyframes as JSON;
// the last keyframe is the picture as it froze. The file it writes is the
// training data for scripts/train-companion.ts and the old-archive fixture
// spec/layout.test.ts renders, so it is committed: CI has no network.
//
// Defaults to the live app and rounds 1-16, which is the dataset
// src/companion-weights.json was fitted on (fetched 2026-10-14). Later
// rounds are deliberately left out, so refetching reproduces those weights.
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.ARCHIVE_SOURCE ?? "https://comp4020-riff8-liuru-3.fly.dev";
const first = Number(process.argv[2] ?? 1);
const last = Number(process.argv[3] ?? 16);

interface Archive {
  round: number;
  promptZh: string;
  scene: unknown[];
}

const archives: Archive[] = [];
for (let round = first; round <= last; round++) {
  const res = await fetch(`${base}/dreams/${round}/`);
  if (res.status === 404) {
    console.log(`dream ${round}: not there`);
    continue;
  }
  if (!res.ok) throw new Error(`dream ${round}: HTTP ${res.status}`);
  const html = await res.text();
  const json = html.match(/<script type="application\/json" id="keyframes">([\s\S]*?)<\/script>/);
  const title = html.match(/<h1>([\s\S]*?)(?:<span|<\/h1>)/);
  if (!json || !title) throw new Error(`dream ${round}: no keyframes or title in the page`);
  const { keyframes } = JSON.parse(json[1].replace(/\\u003c/g, "<")) as { keyframes: unknown[][] };
  const scene = keyframes[keyframes.length - 1];
  archives.push({ round, promptZh: title[1].trim(), scene });
  console.log(`dream ${round}: ${scene.length} objects`);
}

mkdirSync("scripts/data", { recursive: true });
writeFileSync("scripts/data/archives.json", `${JSON.stringify(archives, null, 2)}\n`);
console.log(`wrote scripts/data/archives.json: ${archives.length} dreams, ${archives.reduce((n, a) => n + a.scene.length, 0)} objects`);
