// Fits the companion's placement weights (src/companion-weights.json).
//
//   node scripts/train-companion.ts
//
// Data: scripts/data/archives.json, the final scenes of the 16 public dream
// traces on the live app (fetched read-only from /dreams/<id>/ on 2026-10-14
// by scripts/fetch-archives.ts, and committed, so this fit and the spec don't
// need the network): 97 motifs that real people chose to put where they put
// them.
// For each placed object, the "choice" is where it actually sits, against 24
// random alternative spots for the same motif in the same scene (with that
// object removed). A conditional-logit model (softmax over the 25 options,
// linear in the features from src/companion-model.ts) is fitted by gradient
// ascent with a small L2 penalty, so the weights say which features make a
// spot look more like where a person would put that motif. Deterministic:
// the alternatives come from a seeded generator.
//
// The action priors (how often to place versus wait, borrow, offer...) can't
// be learned from finished pictures, so they're set by hand below and say so.
import { readFileSync, writeFileSync } from "node:fs";
import { FEATURES, type Features, placementFeatures, type SceneObject } from "../src/companion-model.ts";
import { LEGACY_SCENE, PROMPTS } from "../public/shared.js";

interface Archive {
  round: number;
  promptZh: string;
  scene: (SceneObject & { contributor: number; custodian: number })[];
}

const archives = JSON.parse(readFileSync("scripts/data/archives.json", "utf8")) as Archive[];

let seed = 20261014;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const vec = (f: Features) => FEATURES.map((k) => f[k]);
const groups: number[][][] = []; // each: [chosen, ...alternatives]
const scene = LEGACY_SCENE;
for (const a of archives) {
  const promptIndex = PROMPTS.findIndex((p) => p.zh === a.promptZh);
  const objs = a.scene.map((o) => ({ ...o, custodian: o.contributor }));
  if (objs.length < 2) continue; // a lone object says nothing about its neighbours
  for (const o of objs) {
    const others = objs.filter((x) => x.id !== o.id);
    const g = [vec(placementFeatures(o, others, scene, promptIndex, o.contributor))];
    for (let i = 0; i < 24; i++) {
      const alt = { ...o, x: rand() * scene.width, y: rand() * scene.height };
      g.push(vec(placementFeatures(alt, others, scene, promptIndex, o.contributor)));
    }
    groups.push(g);
  }
}

// Conditional logit: maximise sum log softmax(w·x)[chosen] - λ|w|².
const d = FEATURES.length;
const w = new Array(d).fill(0);
const lambda = 0.02;
const rate = 0.5;
let ll = 0;
for (let epoch = 0; epoch < 3000; epoch++) {
  const grad = new Array(d).fill(0);
  ll = 0;
  for (const g of groups) {
    const s = g.map((x) => x.reduce((acc, v, i) => acc + v * w[i], 0));
    const top = Math.max(...s);
    const e = s.map((v) => Math.exp(v - top));
    const z = e.reduce((a, b) => a + b, 0);
    ll += s[0] - top - Math.log(z);
    for (let i = 0; i < d; i++) {
      let expect = 0;
      for (let j = 0; j < g.length; j++) expect += (e[j] / z) * g[j][i];
      grad[i] += g[0][i] - expect;
    }
  }
  for (let i = 0; i < d; i++) w[i] += rate * (grad[i] / groups.length - 2 * lambda * w[i]);
}

// How often the real spot ranks first among its 25 options: chance is 4%.
let top1 = 0;
for (const g of groups) {
  const s = g.map((x) => x.reduce((acc, v, i) => acc + v * w[i], 0));
  if (s[0] >= Math.max(...s)) top1++;
}

// `prompt` and `fill` are constant across the 25 options in a group (same
// motif, same scene), so the fit can't see them: they decide WHICH motif, not
// where. Those two, and an extra overlap penalty (manners: the companion
// shouldn't pile onto anyone's work, even though people sometimes do), are
// hand-set and added on top of the learned weights.
const HAND: Partial<Record<(typeof FEATURES)[number], number>> = { prompt: 0.8, fill: 1.2, overlap: -1.5 };

const round = (v: number) => Math.round(v * 1000) / 1000;
const weights = {
  version: 1,
  learned: Object.fromEntries(FEATURES.map((k, i) => [k, round(w[i])])),
  hand: HAND,
  features: Object.fromEntries(FEATURES.map((k, i) => [k, round(w[i] + (HAND[k] ?? 0))])),
  // Hand-set, not learned: finished pictures don't record what people chose
  // NOT to do. "nothing" competes with every other move and usually wins.
  priors: {
    nothing: 1.6,
    place: -0.2,
    respond: 1.2,
    acknowledge: 1.5,
    invite: -2.6,
    adjust: -1.4,
    reflect: -1.8,
    offer: -3.2,
    withdraw: -3.5,
    reroll: -2.4,
    borrow: -0.8,
    claim: 1.4,
    dew: -2.2,
  },
  temperature: 0.6,
  source: `conditional logit over ${groups.length} placed motifs from ${archives.length} public dream traces, 24 random alternatives each; mean log-likelihood ${round(ll / groups.length)} (chance ${round(-Math.log(25))}); real spot ranked first ${top1}/${groups.length}`,
};
writeFileSync("src/companion-weights.json", `${JSON.stringify(weights, null, 2)}\n`);
console.log(weights.features, weights.source);
