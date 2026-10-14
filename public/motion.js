// The living picture: small, slow, continuous motion for the motifs that
// would move in a real landscape. Everything here is a pure function of the
// shared clock (server time, ms), the round's lightning moment and the
// object's own stored data, never per-client randomness, so two screens side
// by side show the fish in the same place. Motion never changes durable
// position: hit testing, relationships and archives all use the placed
// object; these transforms only draw it.
import { MOTIF_BY_ID } from "./shared.js";

/** Motifs drawn from separately animated parts (public/motifs/parts/, made by scripts/split-motifs.py). */
export const PARTS = {
  fish: { parts: [{ id: "fish-tail", pivot: [54.5, 17.5] }, { id: "fish-body" }] },
  crane: {
    parts: [
      { id: "crane-body" },
      { id: "crane-neck", pivot: [37, 58] },
      { id: "crane-leg-near", pivot: [62, 76] },
      { id: "crane-leg-far", pivot: [66.5, 76] },
    ],
  },
  deer: {
    parts: [
      { id: "deer-body" },
      { id: "deer-leg-front-near", pivot: [51.5, 73] },
      { id: "deer-leg-front-far", pivot: [60, 75] },
      { id: "deer-leg-hind-far", pivot: [94, 75] },
      { id: "deer-leg-hind-near", pivot: [101, 73] },
      { id: "deer-head", pivot: [37, 33] },
    ],
  },
  birds: {
    parts: [
      { id: "birds-a", pivot: [22, 18.8] },
      { id: "birds-b", pivot: [54.3, 32.2] },
      { id: "birds-c", pivot: [80.3, 13.3] },
    ],
  },
  lantern: { parts: [{ id: "lantern-light", pivot: [22, 40] }, { id: "lantern-frame" }] },
  willow: { parts: [{ id: "willow-trunk-wash" }, { id: "willow-fronds", pivot: [122, 60] }, { id: "willow-trunk" }] },
};

// How each motif breathes. Anything not listed (mountains, rocks, buildings,
// people, sun, moon) stays still.
const KIND = {
  pine: "tree",
  bamboo: "tree",
  branch: "tree",
  reeds: "tree",
  grass: "tree",
  willow: "willow",
  cloud: "drift",
  mist: "drift",
  rain: "rain",
  water: "water",
  lotus: "float",
  fish: "fish",
  crane: "crane",
  birds: "birds",
  deer: "deer",
  lantern: "lantern",
};
// How far a tree-like thing leans in a unit of wind (degrees of skew).
const SWAY = { pine: 1.1, bamboo: 2.6, branch: 1.4, reeds: 4.2, grass: 5, willow: 2.4 };

export const animates = (motif) => KIND[motif] !== undefined;
export const isRain = (motif) => motif === "rain";

const TAU = Math.PI * 2;
const r2 = (v) => Math.round(v * 100) / 100;
// A stable phase per object, so neighbouring trees don't sway in lockstep.
const phase = (id, k = 1) => ((id * 2.399 * k) % TAU + TAU) % TAU;
const ease = (v) => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, v))) / 2;

/**
 * The one shared wind at scene x and time t: a slow breath leaning one way,
 * plus a gust that crosses the picture left to right every 23 seconds. The
 * lightning (电) is the same wind, much stronger and faster, for a few
 * seconds from the round's lightning moment.
 */
export function windAt(x, t, ctx) {
  const s = t / 1000;
  const w = ctx.width;
  let v = 0.4 + 0.22 * Math.sin(s * 0.55 - x / 520) + 0.1 * Math.sin(s * 1.7 - x / 160);
  const cycle = s % 23;
  if (cycle < 7) {
    const gx = (cycle / 7) * (w + 900) - 450;
    v += 0.9 * Math.exp(-(((x - gx) / 260) ** 2));
  }
  if (ctx.lightningAt) {
    const dt = (t - ctx.lightningAt) / 1000;
    if (dt > 0 && dt < 5) {
      const gx = (dt / 2.4) * (w + 1200) - 600;
      const fade = dt < 3 ? 1 : 1 - (dt - 3) / 2;
      v += 2.6 * fade * Math.exp(-(((x - gx) / 420) ** 2));
    }
  }
  return v;
}

const about = (px, py, tf) => `translate(${r2(px)} ${r2(py)}) ${tf} translate(${r2(-px)} ${r2(-py)})`;

// A part's pivot in the motif's local coordinates (the image sits centred on 0,0).
function pivot(motif, i) {
  const m = MOTIF_BY_ID[motif];
  const p = PARTS[motif].parts[i].pivot;
  return [p[0] - m.w / 2, p[1] - m.h / 2];
}

/**
 * The transforms that animate object `o` at time `t`: `whole` for its inner
 * group, `parts` for individual parts (by index), `opacity` for the group,
 * `glint` for water's light. `rel` is the object's relationship, if any.
 */
export function motionAt(o, t, ctx, rel) {
  const kind = KIND[o.motif];
  if (!kind) return undefined;
  const m = MOTIF_BY_ID[o.motif];
  const s = t / 1000;
  const ph = phase(o.id);
  // a flipped object's local x runs the other way; wind must not
  const dir = o.flip ? -1 : 1;
  const wind = windAt(o.x, t, ctx);
  const out = { whole: "", parts: {}, opacity: undefined, fall: undefined };
  switch (kind) {
    case "tree": {
      const lean = (SWAY[o.motif] ?? 2) * (wind + 0.15 * Math.sin(s * 1.3 + ph)) * dir;
      out.whole = about(0, m.h / 2, `skewX(${r2(-lean)})`);
      break;
    }
    case "willow": {
      const lean = SWAY.willow * (wind + 0.2 * Math.sin(s * 1.1 + ph)) * dir;
      const [px, py] = pivot("willow", 1);
      out.parts[1] = about(px, py, `skewX(${r2(-lean)})`);
      break;
    }
    case "drift": {
      const reach = o.motif === "mist" ? 46 : 30;
      const dx = (reach * Math.sin(s * 0.045 + ph) + wind * 9) * dir;
      out.whole = `translate(${r2(dx)} 0)`;
      if (o.motif === "mist") out.opacity = r2(0.82 + 0.18 * Math.sin(s * 0.11 + ph));
      break;
    }
    case "rain": {
      // the veil falls through its own box (clipped), slanting with the wind
      out.fall = r2((s * m.h * 0.55 + ph * 40) % m.h);
      out.whole = about(0, -m.h / 2, `skewX(${r2(-wind * 5 * dir)})`);
      break;
    }
    case "water": {
      // light runs along the surface, carried by the wind
      const dx = (12 * Math.sin(s * 0.28 + ph) + wind * 8) * dir;
      out.parts.glint = `translate(${r2(dx)} 0)`;
      out.glintOpacity = r2(0.45 + 0.4 * (0.5 + 0.5 * Math.sin(s * 0.6 + ph - o.x / 300)));
      break;
    }
    case "float": {
      out.whole = about(0, m.h / 2, `rotate(${r2(1.6 * Math.sin(s * 0.7 + ph) + wind * 0.6 * dir)}) translate(0 ${r2(1.5 * Math.sin(s * 0.9 + ph))})`);
      break;
    }
    case "fish": {
      // swims a slow loop a little way either side of where it was placed,
      // turning at each end (the narrowing reads as turning, not flipping)
      const a = s * 0.32 + ph;
      const x = 34 * Math.sin(a);
      const v = Math.cos(a);
      const face = -Math.sign(v || 1) * Math.max(0.14, Math.min(1, Math.abs(v) * 2.4));
      const y = 3 * Math.sin(s * 0.8 + ph);
      out.whole = `translate(${r2(x)} ${r2(y)}) scale(${r2(face)} 1)`;
      const [px, py] = pivot("fish", 0);
      out.parts[0] = about(px, py, `rotate(${r2((9 + 6 * Math.abs(v)) * Math.sin(s * 5.2 + ph))})`);
      break;
    }
    case "crane": {
      const [nx, ny] = pivot("crane", 1);
      if (rel === "bird-tree") {
        // perched: still, but for the neck
        out.parts[1] = about(nx, ny, `rotate(${r2(3 * Math.sin(s * 0.9 + ph))})`);
        break;
      }
      // paces a few steps and back; the legs swing only while it walks
      const a = s * 0.16 + ph;
      const x = 18 * Math.sin(a);
      const v = Math.cos(a);
      const walking = Math.min(1, Math.abs(v) * 1.6);
      const face = -Math.sign(v || 1) * Math.max(0.22, Math.min(1, Math.abs(v) * 2));
      const step = s * 2.4 + ph;
      out.whole = `translate(${r2(x)} ${r2(-Math.abs(Math.sin(step)) * 1.2 * walking)}) scale(${r2(face)} 1)`;
      const [ax, ay] = pivot("crane", 2);
      const [bx, by] = pivot("crane", 3);
      out.parts[2] = about(ax, ay, `rotate(${r2(7 * Math.sin(step) * walking)})`);
      out.parts[3] = about(bx, by, `rotate(${r2(-15 * Math.sin(step) * walking)})`);
      // the head bobs with each step, and now and then dips to the water
      const dip = ease(Math.max(0, Math.sin(s * 0.37 + ph * 2) - 0.85) / 0.15) * -9;
      out.parts[1] = about(nx, ny, `rotate(${r2(3 * Math.sin(step * 2) * walking + dip)})`);
      break;
    }
    case "birds": {
      const perched = rel === "bird-tree";
      const gusty = Math.max(0, wind - 1.2);
      for (let i = 0; i < 3; i++) {
        const [px, py] = pivot("birds", i);
        const p = ph + i * 2.1;
        const rate = perched ? 0.6 : 7 + i;
        // a perched bird folds its wings, ruffling now and then and in the gust
        const amp = perched ? 0.12 * Math.max(0, Math.sin(s * 0.8 + p) - 0.6) * 2.5 + gusty * 0.3 : 0.45 + gusty * 0.2;
        const flap = 1 - amp * (0.5 + 0.5 * Math.sin(s * rate * (1 + gusty) + p));
        const dx = perched ? 0 : 7 * Math.sin(s * 0.5 + p) * dir;
        const dy = perched ? 0 : 4 * Math.sin(s * 0.8 + p);
        out.parts[i] = `translate(${r2(dx)} ${r2(dy)}) ${about(px, py, `scale(1 ${r2(flap)})`)}`;
      }
      break;
    }
    case "deer": {
      // grazes, then lifts its head and looks, every eleven seconds or so
      const cycle = (s + ph * 3) % 11;
      const up = cycle < 4 ? ease(cycle / 1.2) * (cycle > 2.8 ? 1 - ease((cycle - 2.8) / 1.2) : 1) : 0;
      const [hx, hy] = pivot("deer", 5);
      out.parts[5] = about(hx, hy, `rotate(${r2(-4 + 9 * up + 0.8 * Math.sin(s * 0.7 + ph))})`);
      // and shifts its weight between the diagonal pairs
      const shift = 2.2 * Math.sin(s * 0.33 + ph);
      for (const [i, sign] of [
        [1, 1],
        [2, -1],
        [3, 1],
        [4, -1],
      ]) {
        const [lx, ly] = pivot("deer", i);
        out.parts[i] = about(lx, ly, `rotate(${r2(shift * sign)})`);
      }
      break;
    }
    case "lantern": {
      // swings in the wind from where it hangs, and the flame flickers
      const hang = [22 - m.w / 2, 1 - m.h / 2];
      const swing = (wind * 3.2 + 1.4 * Math.sin(s * 1.1 + ph)) * dir;
      out.whole = about(hang[0], hang[1], `rotate(${r2(swing)})`);
      out.parts[0] = undefined;
      out.flicker = flicker(o, t);
      break;
    }
  }
  return out;
}

/** A lantern's flame, also used for its glow on a nearby shelter. */
export function flicker(o, t) {
  const s = t / 1000;
  const ph = phase(o.id, 3);
  return r2(0.78 + 0.12 * Math.sin(s * 3.1 + ph) + 0.07 * Math.sin(s * 7.3 + ph * 2) + 0.03 * Math.sin(s * 13 + ph));
}

/** A boat on water bobs, more in the wind; its wake breathes with it. */
export function bobAt(o, t, ctx) {
  const s = t / 1000;
  const ph = phase(o.id);
  const wind = windAt(o.x, t, ctx);
  const k = 1 + Math.max(0, wind - 0.6) * 0.8;
  return {
    whole: `translate(0 ${r2(4 * k * Math.sin(s * 1.85 + ph))}) rotate(${r2(0.8 * k * Math.sin(s * 1.85 + ph + 0.9))})`,
    wake: r2(0.35 + 0.25 * Math.sin(s * 1.85 + ph)),
  };
}

/** The moon's reflection shivers on the water. */
export function rippleAt(moon, t, ctx, surfaceY) {
  const s = t / 1000;
  const wind = windAt(moon.x, t, ctx);
  const k = 1 + 0.05 * Math.sin(s * 1.25 + phase(moon.id)) + wind * 0.02;
  return about(moon.x + wind * 3, surfaceY, `scale(${r2(k)} 1)`);
}
