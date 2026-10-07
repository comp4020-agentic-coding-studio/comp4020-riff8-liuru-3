// Shared between the server (imported by src/game.ts) and the browser
// (imported by public/app.js): the motif catalogue, scene bounds, and the
// deterministic rules every client must agree on (relationships, bubble
// drift, reflection eligibility). Plain JS so the browser can load it without
// a build step.

export const SCENE = { width: 2400, height: 900 };

export const LIMITS = {
  sceneObjects: 48,
  perCustodian: 12,
  invitationsPerPlayer: 2,
  rerolls: 2,
  dew: 2,
  paletteSize: 8,
  scale: [0.5, 1.8],
  rotation: [-20, 20],
  ink: [0.4, 1],
  dewRadius: 150,
};

export const DEPTHS = ["far", "middle", "near"];

export const GROUPS = {
  landscape: { zh: "山水", en: "Landscape" },
  plants: { zh: "草木", en: "Plants" },
  built: { zh: "屋桥", en: "Built places" },
  journeys: { zh: "行旅", en: "Journeys and people" },
  living: { zh: "生灵", en: "Living things" },
  atmosphere: { zh: "气象", en: "Atmosphere" },
};

// w/h are the default size in scene units at scale 1. `role` decides palette
// dealing: every palette gets a ground, a focal subject and a detail.
// Anchors are fractions of the motif's box: `crown` (where birds perch),
// `keel` (where a boat meets water), `surface` (a water patch's top line).
export const MOTIFS = [
  { id: "ridge", zh: "山脊", en: "Mountain ridge", group: "landscape", w: 620, h: 300, role: "ground", tags: [] },
  { id: "peaks", zh: "远峰", en: "Distant peaks", group: "landscape", w: 720, h: 260, role: "ground", tags: [] },
  { id: "rock", zh: "石", en: "Rock", group: "landscape", w: 170, h: 120, role: "detail", tags: [] },
  { id: "bank", zh: "汀岸", en: "Island bank", group: "landscape", w: 440, h: 110, role: "ground", tags: ["bank"] },
  { id: "water", zh: "水面", en: "Water patch", group: "landscape", w: 560, h: 100, role: "ground", tags: ["water"], surface: 0.18 },
  { id: "reeds", zh: "芦苇", en: "Reeds", group: "landscape", w: 120, h: 160, role: "detail", tags: [] },
  { id: "pine", zh: "松", en: "Pine", group: "plants", w: 230, h: 330, role: "focal", tags: ["tree"], crown: [0.05, 0.0, 0.95, 0.6] },
  { id: "willow", zh: "柳", en: "Willow", group: "plants", w: 250, h: 310, role: "focal", tags: ["tree"], crown: [0.05, 0.0, 0.95, 0.55] },
  { id: "bamboo", zh: "竹", en: "Bamboo", group: "plants", w: 150, h: 310, role: "focal", tags: ["tree"], crown: [0.0, 0.0, 1.0, 0.6] },
  { id: "branch", zh: "枯枝", en: "Bare branch", group: "plants", w: 270, h: 210, role: "detail", tags: ["tree"], crown: [0.0, 0.0, 1.0, 0.7] },
  { id: "lotus", zh: "荷", en: "Lotus", group: "plants", w: 130, h: 100, role: "detail", tags: [] },
  { id: "grass", zh: "草", en: "Grasses", group: "plants", w: 150, h: 60, role: "detail", tags: [] },
  { id: "pavilion", zh: "亭", en: "Pavilion", group: "built", w: 230, h: 210, role: "focal", tags: ["shelter"] },
  { id: "bridge", zh: "桥", en: "Bridge", group: "built", w: 370, h: 110, role: "focal", tags: [] },
  { id: "window", zh: "月窗", en: "Round window", group: "built", w: 130, h: 150, role: "focal", tags: ["shelter"] },
  { id: "cottage", zh: "茅屋", en: "Cottage", group: "built", w: 250, h: 170, role: "focal", tags: ["shelter"] },
  { id: "steps", zh: "石阶", en: "Steps", group: "built", w: 170, h: 110, role: "detail", tags: [] },
  { id: "lantern", zh: "灯", en: "Lantern", group: "built", w: 44, h: 76, role: "detail", tags: ["lantern"] },
  { id: "boat", zh: "空舟", en: "Empty boat", group: "journeys", w: 190, h: 60, role: "focal", tags: ["boat"], keel: 0.8 },
  { id: "sailboat", zh: "帆", en: "Sailboat", group: "journeys", w: 180, h: 180, role: "focal", tags: ["boat"], keel: 0.9 },
  { id: "traveller", zh: "行人", en: "Traveller", group: "journeys", w: 64, h: 116, role: "focal", tags: [] },
  { id: "seated", zh: "坐者", en: "Seated figure", group: "journeys", w: 76, h: 84, role: "focal", tags: [] },
  { id: "umbrella", zh: "伞客", en: "Figure with umbrella", group: "journeys", w: 80, h: 126, role: "focal", tags: [] },
  { id: "crane", zh: "鹤", en: "Crane", group: "living", w: 116, h: 136, role: "focal", tags: ["bird"] },
  { id: "birds", zh: "飞鸟", en: "Small birds", group: "living", w: 96, h: 52, role: "detail", tags: ["bird"] },
  { id: "fish", zh: "鱼", en: "Fish", group: "living", w: 76, h: 34, role: "detail", tags: [] },
  { id: "deer", zh: "鹿", en: "Deer", group: "living", w: 126, h: 116, role: "focal", tags: [] },
  { id: "moon", zh: "月", en: "Moon", group: "atmosphere", w: 96, h: 96, role: "detail", tags: ["moon"], noReflect: true },
  { id: "sun", zh: "日", en: "Sun", group: "atmosphere", w: 110, h: 110, role: "detail", tags: [], noReflect: true },
  { id: "cloud", zh: "云", en: "Cloud", group: "atmosphere", w: 320, h: 100, role: "detail", tags: [], noReflect: true },
  { id: "mist", zh: "雾", en: "Mist", group: "atmosphere", w: 640, h: 110, role: "detail", tags: [], noReflect: true },
  { id: "rain", zh: "雨幕", en: "Rain veil", group: "atmosphere", w: 320, h: 280, role: "detail", tags: [], noReflect: true },
];

export const MOTIF_BY_ID = Object.fromEntries(MOTIFS.map((m) => [m.id, m]));

export const PROMPTS = [
  { zh: "雨停了，人还没回来。", en: "The rain has stopped. Someone has not returned." },
  { zh: "有人住在月亮经过的地方。", en: "Someone lives where the moon passes." },
  { zh: "一艘没有目的地的船。", en: "A boat with no destination." },
  { zh: "山的另一边传来了灯火。", en: "Beyond the mountains, a light appears." },
  { zh: "热闹散去以后。", en: "After the gathering has gone." },
  { zh: "风把远方带到了窗前。", en: "The wind brought somewhere far away to the window." },
];

export const INTENTS = {
  life: { zh: "一点生气", en: "A sign of life" },
  visited: { zh: "有人来过", en: "Someone was here" },
  distance: { zh: "通向远处", en: "A way into the distance" },
  home: { zh: "一处归宿", en: "Somewhere to return" },
  open: { zh: "留白", en: "Leave this open" },
};

// Session marks: a small ink colour and a single character, handed out in
// join order within a round. Never a name, never a profile.
export const MARKS = [
  { glyph: "松", colour: "#4f6b58" },
  { glyph: "竹", colour: "#586e79" },
  { glyph: "梅", colour: "#a44d3c" },
  { glyph: "兰", colour: "#7a6a3e" },
  { glyph: "石", colour: "#5a5a66" },
  { glyph: "云", colour: "#5a6a79" },
  { glyph: "泉", colour: "#3f6f73" },
  { glyph: "鹤", colour: "#7b5a63" },
  { glyph: "舟", colour: "#55663f" },
  { glyph: "月", colour: "#6f6250" },
  { glyph: "风", colour: "#4d5f6e" },
  { glyph: "灯", colour: "#8a5a30" },
];

/** The object's box in scene units, ignoring rotation (modest, ±20°). */
export function box(o) {
  const m = MOTIF_BY_ID[o.motif];
  const w = m.w * o.scale;
  const h = m.h * o.scale;
  return { x0: o.x - w / 2, y0: o.y - h / 2, x1: o.x + w / 2, y1: o.y + h / 2, w, h };
}

function has(o, tag) {
  return MOTIF_BY_ID[o.motif]?.tags.includes(tag) ?? false;
}

function waterSurfaceY(w) {
  const b = box(w);
  return b.y0 + b.h * (MOTIF_BY_ID[w.motif].surface ?? 0);
}

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// Objects taking part in the picture right now: offered objects float in a
// bubble and reflected ones are images, not things, so neither relates.
function active(objects) {
  return objects
    .filter((o) => o.status === "placed" && !o.reflectOn)
    .sort((a, b) => a.id - b.id);
}

function nearest(subject, candidates) {
  let best;
  for (const c of candidates) {
    if (!best || dist2(subject, c) < dist2(subject, best)) best = c;
  }
  return best;
}

/**
 * The four motif relationships, as deterministic pairs every client derives
 * identically from the same scene: boat on water, bird in a tree, lantern by
 * a shelter, moon above water. Each subject pairs with at most one partner.
 */
export function relations(objects) {
  const live = active(objects);
  const out = [];
  const waters = live.filter((o) => has(o, "water"));
  for (const boat of live.filter((o) => has(o, "boat"))) {
    const b = box(boat);
    const keel = { x: boat.x, y: b.y0 + b.h * MOTIF_BY_ID[boat.motif].keel };
    const fits = waters.filter((w) => {
      const wb = box(w);
      return keel.x > wb.x0 && keel.x < wb.x1 && keel.y > waterSurfaceY(w) - 25 && keel.y < wb.y1 + 10;
    });
    const w = nearest(boat, fits);
    if (w) out.push({ type: "boat-water", a: boat.id, b: w.id });
  }
  const trees = live.filter((o) => has(o, "tree"));
  for (const bird of live.filter((o) => has(o, "bird"))) {
    const fits = trees.filter((t) => {
      const tb = box(t);
      const [cx0, cy0, cx1, cy1] = MOTIF_BY_ID[t.motif].crown;
      return (
        bird.x > tb.x0 + tb.w * cx0 - 30 &&
        bird.x < tb.x0 + tb.w * cx1 + 30 &&
        bird.y > tb.y0 + tb.h * cy0 - 30 &&
        bird.y < tb.y0 + tb.h * cy1 + 30
      );
    });
    const t = nearest(bird, fits);
    if (t) out.push({ type: "bird-tree", a: bird.id, b: t.id });
  }
  const shelters = live.filter((o) => has(o, "shelter"));
  for (const lamp of live.filter((o) => has(o, "lantern"))) {
    const fits = shelters.filter((s) => {
      const sb = box(s);
      return lamp.x > sb.x0 - 60 && lamp.x < sb.x1 + 60 && lamp.y > sb.y0 - 60 && lamp.y < sb.y1 + 60;
    });
    const s = nearest(lamp, fits);
    if (s) out.push({ type: "lantern-shelter", a: lamp.id, b: s.id });
  }
  for (const moon of live.filter((o) => has(o, "moon"))) {
    const fits = waters.filter((w) => {
      const wb = box(w);
      return moon.x > wb.x0 - 80 && moon.x < wb.x1 + 80 && moon.y < waterSurfaceY(w);
    });
    const w = nearest(moon, fits);
    if (w) out.push({ type: "moon-water", a: moon.id, b: w.id });
  }
  return out;
}

/**
 * The water an object could become a reflection on (幻): a placed water patch
 * whose span covers the object's centre and whose surface lies within reach
 * of the object's base. Undefined when there's none.
 */
export function reflectionWater(obj, objects) {
  const m = MOTIF_BY_ID[obj.motif];
  if (!m || m.noReflect || m.tags.includes("water")) return undefined;
  const ob = box(obj);
  const fits = objects.filter((w) => {
    if (w.id === obj.id || w.status !== "placed" || !has(w, "water") || w.reflectOn) return false;
    const wb = box(w);
    const gap = waterSurfaceY(w) - ob.y1;
    return obj.x > wb.x0 - 40 && obj.x < wb.x1 + 40 && gap > -60 && gap < 240;
  });
  return nearest(obj, fits.sort((a, b) => a.id - b.id));
}

export function waterSurface(w) {
  return waterSurfaceY(w);
}

/**
 * Where an offered bubble floats at time `t`: a slow, bounded figure-eight
 * above its origin, seeded by the offer id so every client draws the same
 * path from the same server timestamps.
 */
export function bubbleDrift(offer, t) {
  const s = (t - offer.createdAt) / 1000;
  const phase = (offer.id * 2.399) % (Math.PI * 2);
  return {
    x: offer.origin.x + Math.sin(s * 0.6 + phase) * 50,
    y: offer.origin.y - 60 - Math.min(s, 6) * 8 + Math.sin(s * 1.2 + phase) * 14,
  };
}

/** Clamp and validate a client-supplied transform. Returns undefined if invalid. */
export function cleanTransform(t, motifId) {
  const m = MOTIF_BY_ID[motifId];
  if (!m || typeof t !== "object" || t === null) return undefined;
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const { x, y } = t;
  const scale = t.scale ?? 1;
  const rotation = t.rotation ?? 0;
  const ink = t.ink ?? 0.9;
  const depth = t.depth ?? 1;
  const flip = t.flip ?? false;
  if (![x, y, scale, rotation, ink, depth].every(num) || typeof flip !== "boolean") return undefined;
  if (x < 0 || x > SCENE.width || y < 0 || y > SCENE.height) return undefined;
  if (scale < LIMITS.scale[0] || scale > LIMITS.scale[1]) return undefined;
  if (rotation < LIMITS.rotation[0] || rotation > LIMITS.rotation[1]) return undefined;
  if (ink < LIMITS.ink[0] || ink > LIMITS.ink[1]) return undefined;
  if (!Number.isInteger(depth) || depth < 0 || depth > 2) return undefined;
  return { x, y, scale, rotation, ink, depth, flip };
}

export function phaseAt(round, now) {
  if (!round) return "waiting";
  if (now < round.composeEnd) return "compose";
  if (now < round.refineEnd) return "refine";
  if (now < round.revealEnd) return "reveal";
  if (now < round.dissolveEnd) return "dissolve";
  return "finished";
}

export const PHASES = {
  waiting: { zh: "待梦", en: "Waiting" },
  compose: { zh: "布景", en: "Compose" },
  refine: { zh: "留白", en: "Refine" },
  reveal: { zh: "展卷", en: "Reveal" },
  dissolve: { zh: "梦散", en: "Dissolve" },
  finished: { zh: "梦醒", en: "Finished" },
};

// ---------------------------------------------------------------- rendering
// String builders for SVG scene markup. The live client and the
// server-rendered archive both draw through these, so a saved dream looks
// like the scene it froze from. Every interpolated value is a catalogue id or
// a number, never free text.

export const ASSET_BASE = "/static/motifs/";
const n = (v) => Math.round(v * 100) / 100;

export function transformAttr(o) {
  const sx = o.scale * (o.flip ? -1 : 1);
  return `translate(${n(o.x)} ${n(o.y)}) rotate(${n(o.rotation)}) scale(${n(sx)} ${n(o.scale)})`;
}

export function imageMarkup(motifId) {
  const m = MOTIF_BY_ID[motifId];
  return `<image href="${ASSET_BASE}${m.id}.svg" x="${-m.w / 2}" y="${-m.h / 2}" width="${m.w}" height="${m.h}" preserveAspectRatio="none"/>`;
}

/** Transform drawing `o` as a reflection hanging below water `w`'s surface. */
export function reflectionTransform(o, w) {
  const m = MOTIF_BY_ID[o.motif];
  const s = waterSurfaceY(w);
  const h = m.h * o.scale;
  const sx = o.scale * (o.flip ? -1 : 1);
  return `translate(${n(o.x)} ${n(s + h / 2 + 4)}) rotate(${n(-o.rotation)}) scale(${n(sx)} ${n(-o.scale)})`;
}

export function moonReflectionTransform(moon, w) {
  const s = waterSurfaceY(w);
  const y = s + Math.min(40, (s - moon.y) * 0.12) + 14;
  return `translate(${n(moon.x)} ${n(y)}) scale(${n(moon.scale * 0.8)} ${n(-moon.scale * 0.45)})`;
}

export function sceneDefs(prefix = "s") {
  return `
  <filter id="${prefix}-grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="t"/>
    <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.40  0 0 0 0 0.32  0 0 0 0.09 0"/>
  </filter>
  <filter id="${prefix}-far" x="-5%" y="-5%" width="110%" height="110%">
    <feGaussianBlur stdDeviation="1.2"/>
    <feComponentTransfer><feFuncA type="linear" slope="0.62"/></feComponentTransfer>
  </filter>
  <filter id="${prefix}-ripple" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency="0.02 0.25" numOctaves="1" seed="2"/>
    <feDisplacementMap in="SourceGraphic" scale="9"/>
  </filter>
  <filter id="${prefix}-wet" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur stdDeviation="5" result="b"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="9" result="t"/>
    <feDisplacementMap in="b" in2="t" scale="14"/>
  </filter>
  <filter id="${prefix}-shadow" x="-5%" y="-5%" width="110%" height="110%">
    <feColorMatrix type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.46  0 0 0 0 0.42  0 0 0 0.5 0"/>
    <feGaussianBlur stdDeviation="2"/>
  </filter>
  <radialGradient id="${prefix}-glow">
    <stop offset="0" stop-color="#e3b469" stop-opacity="0.55"/>
    <stop offset="0.5" stop-color="#e3b469" stop-opacity="0.18"/>
    <stop offset="1" stop-color="#e3b469" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="${prefix}-sky" cx="0.5" cy="0" r="0.9">
    <stop offset="0" stop-color="#fffdf6" stop-opacity="0.85"/>
    <stop offset="0.6" stop-color="#fbf4e6" stop-opacity="0.3"/>
    <stop offset="1" stop-color="#fbf4e6" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="${prefix}-fade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0.9"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>`;
}

export function paperMarkup(prefix = "s") {
  return `<rect class="paper" width="${SCENE.width}" height="${SCENE.height}" fill="#F3EBDD"/>
  <rect width="${SCENE.width}" height="${SCENE.height}" filter="url(#${prefix}-grain)"/>
  <image class="scaffold" href="${ASSET_BASE}scaffold-ridge.svg" x="0" y="250" width="2400" height="360" opacity="0.55"/>
  <image class="scaffold" href="${ASSET_BASE}scaffold-water.svg" x="0" y="600" width="2400" height="200" opacity="0.7"/>`;
}

/**
 * One object's drawable markup (without its outer transform group): solid,
 * or reflected onto its water.
 */
export function objectBody(o, byId, prefix = "s") {
  const water = o.reflectOn ? byId.get(o.reflectOn) : undefined;
  if (water) {
    return `<g class="reflected" opacity="${n(o.ink * 0.42)}" transform="${reflectionTransform(o, water)}" filter="url(#${prefix}-ripple)">${imageMarkup(o.motif)}</g>`;
  }
  const far = o.depth === 0 ? ` filter="url(#${prefix}-far)"` : "";
  return `<g class="solid" opacity="${n(o.ink)}" transform="${transformAttr(o)}"${far}>${imageMarkup(o.motif)}</g>`;
}

/** Static markup for a whole scene: layered by depth, then z. */
export function sceneMarkup(objects, prefix = "s") {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const rel = relations(objects);
  const glowFor = new Set(rel.filter((r) => r.type === "lantern-shelter").map((r) => r.a));
  const sorted = [...objects].sort((a, b) => a.depth - b.depth || a.z - b.z);
  let out = "";
  for (const o of sorted) {
    if (glowFor.has(o.id)) {
      out += `<circle cx="${n(o.x)}" cy="${n(o.y)}" r="${n(70 * o.scale)}" fill="url(#${prefix}-glow)"/>`;
    }
    out += objectBody(o, byId, prefix);
  }
  for (const r of rel.filter((x) => x.type === "moon-water")) {
    const moon = byId.get(r.a);
    const w = byId.get(r.b);
    const wb = box(w);
    out += `<clipPath id="${prefix}-mc${moon.id}"><rect x="${n(wb.x0)}" y="${n(waterSurfaceY(w))}" width="${n(wb.w)}" height="${n(wb.y1 - waterSurfaceY(w))}"/></clipPath>`;
    out += `<g clip-path="url(#${prefix}-mc${moon.id})"><g opacity="0.45" filter="url(#${prefix}-ripple)" transform="${moonReflectionTransform(moon, w)}">${imageMarkup("moon")}</g></g>`;
  }
  return out;
}
