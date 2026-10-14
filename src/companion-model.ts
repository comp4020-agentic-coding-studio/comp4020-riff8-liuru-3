import { box, INTENTS, MOTIF_BY_ID, relations } from "../public/shared.js";

// The companion's decision model: a linear scorer over a dozen features of
// "this motif, here, in this scene", plus one prior per kind of action.
// Pure functions only, shared by the live companion (src/companion.ts) and
// the trainer (scripts/train-companion.ts) so both compute features the same
// way. See README "The AI companion" for where the weights came from.

export interface SceneObject {
  id: number;
  motif: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flip: boolean;
  ink: number;
  depth: number;
  z?: number;
  status?: string;
  reflectOn?: number | null;
  custodian?: string | number;
}

export interface Scene {
  width: number;
  height: number;
}

// Where each kind of motif tends to sit, as a fraction of the scene's height:
// sky things high, ridges in the upper middle, water and boats low.
const BAND: Record<string, number> = {
  landscape: 0.55,
  plants: 0.6,
  built: 0.62,
  journeys: 0.7,
  living: 0.62,
  atmosphere: 0.2,
};
const BAND_BY_MOTIF: Record<string, number> = {
  peaks: 0.35,
  ridge: 0.42,
  water: 0.78,
  bank: 0.75,
  reeds: 0.72,
  lotus: 0.8,
  fish: 0.82,
  boat: 0.76,
  sailboat: 0.7,
  bridge: 0.7,
  birds: 0.28,
  rain: 0.35,
  mist: 0.45,
};

/** Motifs that belong to each round prompt (by PROMPTS index), hand-listed from the lines themselves. */
export const PROMPT_MOTIFS: string[][] = [
  ["rain", "umbrella", "traveller", "boat", "cottage", "mist", "willow", "steps", "bridge"],
  ["moon", "cottage", "window", "pavilion", "lantern", "water", "pine", "seated"],
  ["boat", "sailboat", "water", "mist", "reeds", "bank", "cloud", "birds"],
  ["peaks", "ridge", "lantern", "cottage", "pavilion", "sun", "traveller", "steps"],
  ["pavilion", "seated", "lantern", "steps", "branch", "moon", "bridge", "window"],
  ["window", "cloud", "willow", "birds", "bamboo", "peaks", "sailboat", "crane"],
];

/** Motifs that answer each invitation intent. */
export const INTENT_MOTIFS: Record<keyof typeof INTENTS, string[]> = {
  life: ["crane", "birds", "fish", "deer", "lotus", "grass", "reeds"],
  visited: ["traveller", "seated", "umbrella", "boat", "steps", "lantern"],
  distance: ["bridge", "steps", "sailboat", "boat", "peaks", "traveller", "birds"],
  home: ["cottage", "pavilion", "window", "lantern"],
  open: [],
};

export const FEATURES = [
  "rel", // relationships this object forms (boat on water, bird in tree, lantern by shelter, moon over water)
  "relOther", // ... of which with someone else's object
  "band", // how well its height suits the motif (1 = right in its band)
  "overlap", // fraction of its box covered by others' boxes
  "gap", // distance to the nearest other object, normalised
  "crowd", // other objects within a short radius, normalised
  "edge", // how far its box hangs off the paper
  "balance", // improvement in left/right balance of the picture
  "prompt", // the motif belongs to this round's line
  "fill", // adds to a sparse picture (+) or a full one (-)
] as const;
export type FeatureName = (typeof FEATURES)[number];
export type Features = Record<FeatureName, number>;

const area = (b: ReturnType<typeof box>) => Math.max(0, b.w) * Math.max(0, b.h);

function overlapArea(a: ReturnType<typeof box>, b: ReturnType<typeof box>): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Features of object `o` placed into `others` (which must not contain it). */
export function placementFeatures(
  o: SceneObject,
  others: SceneObject[],
  scene: Scene,
  promptIndex: number | null,
  me?: string | number,
): Features {
  const placed = others.filter((x) => (x.status ?? "placed") === "placed" && !x.reflectOn);
  const ob = box(o);
  const diag = Math.hypot(scene.width, scene.height);
  const before = relations(placed as never[]) as { a: number; b: number }[];
  const after = relations([...placed, { ...o, status: "placed" }] as never[]) as { a: number; b: number }[];
  const mine = after.filter((r) => r.a === o.id || r.b === o.id);
  const newOnes = mine.filter((r) => !before.some((q) => q.a === r.a && q.b === r.b));
  const partnerOf = (r: { a: number; b: number }) => placed.find((x) => x.id === (r.a === o.id ? r.b : r.a));
  const relOther = newOnes.filter((r) => {
    const p = partnerOf(r);
    return p && me !== undefined && p.custodian !== undefined && p.custodian !== me;
  }).length;
  const partners = new Set(newOnes.map((r) => partnerOf(r)?.id));

  let covered = 0;
  let nearest = Infinity;
  let crowd = 0;
  for (const x of placed) {
    const xb = box(x);
    const d = Math.hypot(x.x - o.x, x.y - o.y);
    nearest = Math.min(nearest, d);
    if (d < diag * 0.12) crowd++;
    // a relationship partner is meant to overlap (boat on water)
    if (!partners.has(x.id)) covered = Math.max(covered, overlapArea(ob, xb) / Math.max(1, area(ob)));
  }
  const band = BAND_BY_MOTIF[o.motif] ?? BAND[MOTIF_BY_ID[o.motif]?.group] ?? 0.6;
  const off =
    Math.max(0, -ob.x0) + Math.max(0, ob.x1 - scene.width) + Math.max(0, -ob.y0) + Math.max(0, ob.y1 - scene.height);
  const cx = (list: SceneObject[]) => (list.length ? list.reduce((s, x) => s + x.x, 0) / list.length / scene.width : 0.5);
  const coverage = placed.reduce((s, x) => s + area(box(x)), 0) / (scene.width * scene.height);
  return {
    rel: newOnes.length,
    relOther,
    band: 1 - Math.min(1, Math.abs(o.y / scene.height - band) / 0.5),
    overlap: Math.min(1, covered),
    gap: Number.isFinite(nearest) ? Math.min(1, (nearest / diag) * 4) : 1,
    crowd: Math.min(1, crowd / 5),
    edge: Math.min(1, off / Math.max(1, ob.w + ob.h)),
    balance: (Math.abs(cx(placed) - 0.5) - Math.abs(cx([...placed, o]) - 0.5)) * 4,
    prompt: promptIndex !== null && PROMPT_MOTIFS[promptIndex]?.includes(o.motif) ? 1 : 0,
    fill: 0.35 - coverage,
  };
}

export interface Weights {
  version: number;
  features: Record<FeatureName, number>;
  priors: Record<string, number>;
  temperature: number;
  source: string;
}

export function score(w: Weights, f: Partial<Features>): number {
  let s = 0;
  for (const k of FEATURES) s += (w.features[k] ?? 0) * (f[k] ?? 0);
  return s;
}

/** Softmax sampling with temperature; `rand` is injectable for tests. */
export function sample<T extends { score: number }>(items: T[], temperature: number, rand = Math.random): T | undefined {
  if (items.length === 0) return undefined;
  const t = Math.max(0.05, temperature);
  const top = Math.max(...items.map((i) => i.score));
  const ps = items.map((i) => Math.exp((i.score - top) / t));
  const sum = ps.reduce((a, b) => a + b, 0);
  let r = rand() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= ps[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
