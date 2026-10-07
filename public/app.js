// The live scroll. Server state arrives as a snapshot plus a stream of patch
// events over SSE; every durable change goes out as a POST and only shows up
// once the server's event comes back. Local state is limited to what this
// viewer is doing right now (camera, selection, a drag in progress).
import {
  box,
  bubbleDrift,
  DEPTHS,
  GROUPS,
  imageMarkup,
  INTENTS,
  LIMITS,
  MARKS,
  MOTIF_BY_ID,
  MOTIFS,
  moonReflectionTransform,
  objectBody,
  PHASES,
  reflectionWater,
  relations,
  SCENE,
  sceneMarkup,
  transformAttr,
  waterSurface,
} from "./shared.js";

const $ = (id) => document.getElementById(id);
const svg = $("scroll");
const NS = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------- state

const S = {
  connected: false,
  cursor: 0,
  offset: 0, // server clock minus local clock
  me: null,
  phase: "waiting",
  round: null,
  nextPrompt: null,
  lastArchive: null,
  players: new Map(),
  online: new Set(),
  objects: new Map(),
  proposals: new Map(),
  offers: new Map(),
  invitations: new Map(),
  dews: new Map(),
  shadows: new Map(),
  rels: [],
  timing: { proposal: 20000, lease: 8000, shadow: 10000, dew: 15000 },
  resyncing: false,
  buffered: [],
};

const UI = {
  tool: "select",
  mode: "idle", // idle | place | invite | dew | pan | borrow | respond | receive
  motif: null, // tray selection for place / respond
  selected: null, // object id
  ghost: null, // {x, y, ...transform} for borrow / respond / place previews
  respondTo: null, // invitation id
  receiving: null, // offer id
  drag: null,
  local: new Map(), // object id -> transform override while dragging/editing
  remote: new Map(), // pid -> preview
  cam: { x: 0, y: 0, w: SCENE.width, h: SCENE.height },
  motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
  seenRels: new Set(),
  storm: "",
  tour: null,
  pointer: null,
};

const now = () => Date.now() + S.offset;
const myPlayer = () => S.players.get(S.me);
const markOf = (pid) => {
  const p = S.players.get(pid);
  return p ? MARKS[p.mark % MARKS.length] : { glyph: "·", colour: "#62665f" };
};
const markHtml = (pid) => {
  const m = markOf(pid);
  return `<span class="mark" style="--mark:${m.colour}" title="${pid === S.me ? "你 you" : ""}">${m.glyph}</span>`;
};
const motifName = (id) => `${MOTIF_BY_ID[id].zh} <span lang="en">${MOTIF_BY_ID[id].en.toLowerCase()}</span>`;
const editable = () => S.connected && (S.phase === "compose" || S.phase === "refine");

// ---------------------------------------------------------------- feedback

let toastTimer;
function toast(html, announce = true) {
  const t = $("toast");
  t.innerHTML = html;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 4200);
  if (announce) say(t.textContent);
}

// The live region carries only meaningful changes: connection, requests,
// outcomes, phases. Never animation frames.
let lastSaid = "";
function say(text) {
  if (text === lastSaid) return;
  lastSaid = text;
  const live = $("live");
  live.textContent = "";
  setTimeout(() => (live.textContent = text), 50);
}

// ---------------------------------------------------------------- actions

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

async function post(path, body = {}) {
  if (!S.connected) {
    toast("连接中断，动作已暂停 <span lang=\"en\">Offline: actions are paused until you reconnect.</span>");
    return undefined;
  }
  const actionId = newId();
  // One retry with the same action id: if the first attempt did land, the
  // server returns the stored result instead of acting twice.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`/api/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId, ...body }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast(escapeText(data.message ?? "没成 / That didn't work."));
        return undefined;
      }
      return data;
    } catch {
      if (attempt === 1) toast("网络不稳，没送出 <span lang=\"en\">Network trouble: that didn't go through.</span>");
    }
  }
  return undefined;
}

function escapeText(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

let previewAt = 0;
function sendPreview(data, force = false) {
  const t = performance.now();
  if (!force && t - previewAt < 140) return;
  previewAt = t;
  fetch("/api/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  }).catch(() => {});
}

// ---------------------------------------------------------------- sync

function applySnapshot(snap) {
  S.offset = snap.serverNow - Date.now();
  S.cursor = snap.cursor;
  S.me = snap.me;
  const roundChanged = S.round?.id !== snap.round?.id;
  S.round = snap.round;
  S.phase = snap.phase;
  S.nextPrompt = snap.nextPrompt;
  S.lastArchive = snap.lastArchive;
  S.timing = snap.timing;
  S.players = new Map(snap.players.map((p) => [p.pid, p]));
  S.online = new Set(snap.players.filter((p) => p.online).map((p) => p.pid));
  if (snap.online) S.online = new Set(snap.online);
  S.objects = new Map(snap.objects.map((o) => [o.id, o]));
  S.proposals = new Map(snap.proposals.map((p) => [p.id, p]));
  S.offers = new Map(snap.offers.map((o) => [o.id, o]));
  S.invitations = new Map(snap.invitations.map((i) => [i.id, i]));
  S.dews = new Map(snap.dews.map((d) => [d.id, d]));
  S.shadows = new Map(snap.shadows.map((s) => [s.id, s]));
  if (roundChanged) {
    resetMode();
    UI.selected = null;
    UI.seenRels = new Set();
    UI.local.clear();
  }
  // relationships already present on arrival aren't news
  for (const r of relations([...S.objects.values()])) UI.seenRels.add(relKey(r));
  if (UI.selected && !S.objects.has(UI.selected)) UI.selected = null;
  renderAll();
}

async function resync() {
  if (S.resyncing) return;
  S.resyncing = true;
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    const snap = await res.json();
    applySnapshot(snap);
    const pending = S.buffered.filter((e) => e.id > S.cursor).sort((a, b) => a.id - b.id);
    S.buffered = [];
    S.resyncing = false;
    for (const e of pending) onChange(e);
  } catch {
    S.resyncing = false;
  }
}

function onChange(e) {
  if (S.resyncing) {
    S.buffered.push(e);
    return;
  }
  if (e.id <= S.cursor) return; // already have it
  if (e.id !== S.cursor + 1 || e.type === "round-started" || e.type === "phase") {
    // a gap (or a round boundary): take a fresh, consistent snapshot
    resync();
    return;
  }
  S.cursor = e.id;
  applyPatch(e.type, e.payload);
}

function applyPatch(type, p) {
  if (S.round && p.round !== S.round.id) return;
  for (const pl of p.players ?? []) S.players.set(pl.pid, pl);
  for (const o of p.objects ?? []) {
    if (o.status === "withdrawn") {
      S.objects.delete(o.id);
      UI.local.delete(o.id);
      if (UI.selected === o.id) UI.selected = null;
    } else {
      S.objects.set(o.id, o);
      // the server's version is now the truth; drop any local override
      // unless we're mid-drag on it
      if (UI.drag?.id !== o.id) UI.local.delete(o.id);
    }
  }
  for (const pr of p.proposals ?? []) {
    const had = S.proposals.get(pr.id);
    if (pr.status === "pending") S.proposals.set(pr.id, pr);
    else {
      S.proposals.delete(pr.id);
      if (had || pr.proposer === S.me || pr.target === S.me) proposalOutcome(pr);
    }
  }
  for (const of of p.offers ?? []) {
    if (of.status === "floating" || of.status === "claimed") {
      const had = S.offers.get(of.id);
      S.offers.set(of.id, of);
      if (!had && of.offerer !== S.me) {
        toast(`${markHtml(of.offerer)} 放出一个泡：${motifName(S.objects.get(of.objectId)?.motif ?? "moon")} <span lang="en">offered something in a bubble. Catch it from the list or the scroll.</span>`);
      }
      if (of.status === "claimed" && of.claimant !== S.me && UI.receiving !== of.id && had?.status === "floating" && UI.wantOffer === of.id) {
        toast("已被接住 <span lang=\"en\">Someone has already received it.</span>");
      }
    } else {
      S.offers.delete(of.id);
      if (UI.receiving === of.id) {
        resetMode();
        if (of.status !== "completed") toast("泡散了，它回到原处 <span lang=\"en\">The bubble burst; the object went back where it was.</span>");
      }
      if (of.offerer === S.me && of.status === "completed") toast("你的泡被接住了 <span lang=\"en\">Your bubble was caught and placed.</span>");
      if (of.offerer === S.me && of.status === "expired") toast("没人接住，它回到原处 <span lang=\"en\">Nobody caught it; it's back where it was.</span>");
    }
  }
  for (const inv of p.invitations ?? []) {
    if (inv.status === "open" || inv.status === "acknowledged") S.invitations.set(inv.id, inv);
    else S.invitations.delete(inv.id);
    if (inv.status === "acknowledged" && inv.owner === S.me) toast(`${markHtml(inv.answeredBy)} 会意了你的留白 <span lang="en">understood the space you left open.</span>`);
    if (UI.respondTo === inv.id && inv.status !== "open") resetMode();
  }
  for (const d of p.dews ?? []) S.dews.set(d.id, d);
  for (const s of p.shadows ?? []) S.shadows.set(s.id, s);
  if (type === "proposed") {
    const pr = p.proposals?.[0];
    if (pr && pr.target === S.me) {
      const what = pr.kind === "borrow" ? `想借景：移动你的${motifName(pr.motif)} <span lang="en">suggests moving your object.</span>` : `想用${motifName(pr.motif)}回应你的留白 <span lang="en">wants to answer your opening.</span>`;
      toast(`${markHtml(pr.proposer)} ${what}`);
      openSide();
    }
  }
  if (type === "joined") {
    const pl = p.players?.[0];
    if (pl && pl.pid !== S.me) say(`有人入梦 Someone joined: ${markOf(pl.pid).glyph}`);
  }
  if (UI.selected && !S.objects.has(UI.selected)) UI.selected = null;
  renderAll();
}

function proposalOutcome(pr) {
  const mine = pr.proposer === S.me;
  if (pr.status === "accepted" && mine) toast(pr.kind === "borrow" ? "借景成了，它现在由你照看 <span lang=\"en\">Accepted: it moved, and it's now in your care.</span>" : "你的回应被收下了 <span lang=\"en\">Your answer was accepted into the scene.</span>");
  if (pr.status === "declined" && mine) toast("对方婉拒了，原物不动 <span lang=\"en\">Declined: nothing moved.</span>");
  if (pr.status === "expired" && mine) toast("提议过时了，原物不动 <span lang=\"en\">Your proposal expired: nothing moved.</span>");
  if (pr.status === "expired" && pr.target === S.me) say("一条提议过时了 A request expired.");
  if (pr.status === "stale") toast("此物刚刚变了，提议作废 <span lang=\"en\">The object changed in the meantime, so that proposal no longer applies.</span>");
  if (pr.status === "cancelled" && pr.target === S.me) say("对方撤回了提议 A request was withdrawn.");
}

let source;
function connect() {
  source = new EventSource("/api/events");
  source.addEventListener("snapshot", (ev) => {
    setConnected(true);
    applySnapshot(JSON.parse(ev.data));
  });
  source.addEventListener("change", (ev) => onChange(JSON.parse(ev.data)));
  source.addEventListener("presence", (ev) => {
    S.online = new Set(JSON.parse(ev.data).online);
    renderMarks();
    renderRequests();
  });
  source.addEventListener("preview", (ev) => {
    const p = JSON.parse(ev.data);
    if (p.kind === "end") UI.remote.delete(p.by);
    else UI.remote.set(p.by, { ...p, at: performance.now() });
    renderGhosts();
  });
  source.onerror = () => {
    setConnected(false);
  };
}

function setConnected(ok) {
  if (S.connected === ok) return;
  S.connected = ok;
  document.body.classList.toggle("offline", !ok);
  const c = $("conn");
  c.classList.toggle("ok", ok);
  c.classList.toggle("off", !ok);
  $("conn-text").textContent = ok ? "已连接 connected" : "连接中断 offline";
  c.title = ok ? "已连接 Connected" : "连接中断，正在重连 Offline, reconnecting";
  if (!ok) {
    // Never queue gestures for later: drop whatever was in progress.
    UI.drag = null;
    UI.local.clear();
    resetMode();
    toast("连接中断，正在重连；此时不能改动画面 <span lang=\"en\">Offline: reconnecting. You can't change the scene until it's back.</span>");
  } else if (document.body.classList.contains("was-offline")) {
    toast("已重新连上 <span lang=\"en\">Reconnected: you're seeing the current scene.</span>");
  }
  if (!ok) document.body.classList.add("was-offline");
  renderOverlay();
  renderTray();
}

// ---------------------------------------------------------------- camera

function wrapSize() {
  const r = $("scroll-wrap").getBoundingClientRect();
  return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
}

function minZoomUnits() {
  // widest view: the whole scroll width, or the whole height, whichever
  // needs more room
  const { w, h } = wrapSize();
  return Math.max(SCENE.width, SCENE.height * (w / h));
}

function setCamera(x, y, width) {
  const { w, h } = wrapSize();
  const aspect = h / w;
  width = Math.min(minZoomUnits(), Math.max(360, width));
  const height = width * aspect;
  // keep the paper in view: centre it if the view is larger than the scene
  x = width >= SCENE.width ? (SCENE.width - width) / 2 : Math.min(SCENE.width - width, Math.max(0, x));
  y = height >= SCENE.height ? (SCENE.height - height) / 2 : Math.min(SCENE.height - height, Math.max(0, y));
  UI.cam = { x, y, w: width, h: height };
  svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  const v = $("overview-view");
  v.setAttribute("x", Math.max(0, x));
  v.setAttribute("y", Math.max(0, y));
  v.setAttribute("width", Math.min(SCENE.width, width));
  v.setAttribute("height", Math.min(SCENE.height, height));
}

function fitHeight() {
  UI.fit = "height";
  const { w, h } = wrapSize();
  // on a wide screen the scroll's full height fills the view and you pan
  // sideways, like unrolling a handscroll; on a phone, show a good slice
  const width = Math.min(SCENE.width, SCENE.height * (w / h));
  setCamera(UI.cam.x + UI.cam.w / 2 - width / 2, 0, width);
}

function fitAll() {
  UI.fit = "all";
  setCamera(0, 0, minZoomUnits());
}

function zoom(factor, cx = UI.cam.x + UI.cam.w / 2, cy = UI.cam.y + UI.cam.h / 2) {
  UI.fit = null;
  const width = UI.cam.w * factor;
  const height = width * (UI.cam.h / UI.cam.w);
  setCamera(cx - (cx - UI.cam.x) * factor, cy - (cy - UI.cam.y) * (height / UI.cam.h), width);
}

function toScene(ev) {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
}

const clampScene = (p) => ({
  x: Math.min(SCENE.width - 1, Math.max(1, p.x)),
  y: Math.min(SCENE.height - 1, Math.max(1, p.y)),
});

function centreOf() {
  return clampScene({ x: UI.cam.x + UI.cam.w / 2, y: UI.cam.y + UI.cam.h / 2 });
}

function lookAt(x, y) {
  setCamera(x - UI.cam.w / 2, y - UI.cam.h / 2, UI.cam.w);
}

// ---------------------------------------------------------------- render

const relKey = (r) => `${r.type}:${r.a}:${r.b}`;

function displayed(o) {
  const l = UI.local.get(o.id);
  return l ? { ...o, ...l } : o;
}

function sceneObjects() {
  return [...S.objects.values()].map(displayed);
}

function renderAll() {
  document.body.classList.remove("loading");
  for (const ph of Object.keys(PHASES)) document.body.classList.toggle(`phase-${ph}`, S.phase === ph);
  renderHeader();
  renderScene();
  renderOverlay();
  renderTray();
  renderInspector();
  renderRequests();
  renderObjectList();
  renderMarks();
  renderOverview();
}

function renderHeader() {
  const prompt = S.round && S.phase !== "finished" ? S.round.prompt : S.nextPrompt;
  $("prompt-zh").textContent = prompt?.zh ?? "";
  $("prompt-en").textContent = prompt?.en ?? "";
  const ph = PHASES[S.phase];
  $("phase").innerHTML = `${ph.zh} <span lang="en">${ph.en}</span>`;
  const p = myPlayer();
  $("dew-left").textContent = p ? `${LIMITS.dew - p.dewUsed}` : "";
  tickClock();
}

function deadline() {
  if (!S.round) return undefined;
  return { compose: S.round.composeEnd, refine: S.round.refineEnd, reveal: S.round.revealEnd, dissolve: S.round.dissolveEnd }[S.phase];
}

let lastPhaseSeen = null;
function tickClock() {
  const d = deadline();
  const c = $("clock");
  if (!d) {
    c.textContent = "";
  } else {
    const s = Math.max(0, Math.ceil((d - now()) / 1000));
    c.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  // the client's own clock can see a phase boundary before the server's
  // event arrives; ask for the truth rather than guess
  if (S.round && d && now() > d + 400 && !S.resyncing) resync();
  if (lastPhaseSeen !== S.phase) {
    if (lastPhaseSeen !== null) announcePhase();
    lastPhaseSeen = S.phase;
  }
}

function announcePhase() {
  const msg = {
    compose: "入梦了：选一件景物放上画卷 The dream has begun: place a motif.",
    refine: "留一点空白：不再添新景，只调整、借景、传泡 Make room for the scene: no new placements now, only refine, borrow and pass.",
    reveal: "画卷定格，已存为梦痕 The scroll is frozen and saved as a dream trace.",
    dissolve: "梦散了，画面慢慢回到纸上 The dream dissolves back into paper.",
    finished: "梦醒 The dream has ended.",
  }[S.phase];
  if (msg) toast(escapeText(msg));
}

function el(tag, attrs = {}, html = "") {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

const objectEls = new Map(); // id -> {g, sig}

function renderScene() {
  const showArt = S.round && S.phase !== "finished" && S.phase !== "waiting";
  const objs = showArt ? sceneObjects() : [];
  const byId = new Map(objs.map((o) => [o.id, o]));
  S.rels = relations(objs);
  const relOf = new Map();
  for (const r of S.rels) {
    relOf.set(r.a, r.type);
    if (!relOf.has(r.b)) relOf.set(r.b, `${r.type}-partner`);
  }
  noticeRelations(byId);

  // objects, keyed: rebuild an element only when what it draws changed
  const layers = [0, 1, 2].map((d) => $(`layer-${d}`));
  const keep = new Set();
  const sorted = objs.filter((o) => o.status !== "leased" || UI.receiving).sort((a, b) => a.depth - b.depth || a.z - b.z);
  for (const o of sorted) {
    keep.add(o.id);
    const rel = relOf.get(o.id) ?? "";
    const water = o.reflectOn ? byId.get(o.reflectOn) : undefined;
    const sig = [o.motif, o.x, o.y, o.scale, o.rotation, o.flip, o.ink, o.depth, o.reflectOn, water?.x, water?.y, water?.scale, rel, o.status, UI.selected === o.id].join("|");
    let entry = objectEls.get(o.id);
    if (!entry) {
      entry = { g: el("g", { class: "obj", "data-id": o.id }), sig: "" };
      objectEls.set(o.id, entry);
    }
    const layer = layers[o.depth];
    if (entry.g.parentNode !== layer) layer.appendChild(entry.g);
    if (entry.sig !== sig) {
      entry.sig = sig;
      const wrap = rel === "boat-water" ? "bob" : rel === "bird-tree" ? "perched" : MOTIF_BY_ID[o.motif].tags.includes("bird") ? "bird-solo" : MOTIF_BY_ID[o.motif].tags.includes("lantern") ? "lantern-swing" : "";
      entry.g.innerHTML = `<g class="${wrap}">${objectBody(o, byId, "s")}</g>`;
      entry.g.style.opacity = o.status === "offered" ? "0.15" : o.status === "leased" ? "0.1" : "";
      entry.g.classList.toggle("selected-mine", UI.selected === o.id && o.custodian === S.me);
      entry.g.classList.toggle("selected-other", UI.selected === o.id && o.custodian !== S.me);
    }
  }
  // keep paint order consistent with depth, then z
  for (const o of sorted) objectEls.get(o.id).g.parentNode.appendChild(objectEls.get(o.id).g);
  for (const [id, entry] of objectEls) {
    if (!keep.has(id)) {
      entry.g.remove();
      objectEls.delete(id);
    }
  }

  // relationship effects
  const glows = [];
  const wakes = [];
  const moons = [];
  for (const r of S.rels) {
    const a = byId.get(r.a);
    const b = byId.get(r.b);
    if (r.type === "lantern-shelter") glows.push(`<circle class="glow" cx="${a.x}" cy="${a.y}" r="${75 * a.scale}" fill="url(#s-glow)"/>`);
    if (r.type === "boat-water") {
      const bb = box(a);
      const ky = bb.y0 + bb.h * MOTIF_BY_ID[a.motif].keel + 4;
      const dir = a.flip ? 1 : -1;
      wakes.push(`<g class="wake"><path d="M${a.x + dir * bb.w * 0.45} ${ky} q${dir * 30} 6 ${dir * 70} 2"/><path d="M${a.x + dir * bb.w * 0.4} ${ky + 7} q${dir * 26} 4 ${dir * 52} 1"/></g>`);
    }
    if (r.type === "moon-water") {
      const wb = box(b);
      const s = waterSurface(b);
      moons.push(`<clipPath id="mc${a.id}"><rect x="${wb.x0}" y="${s}" width="${wb.w}" height="${wb.y1 - s}"/></clipPath><g clip-path="url(#mc${a.id})"><g class="moon-refl"><g opacity="0.45" filter="url(#s-ripple)" transform="${moonReflectionTransform(a, b)}">${imageMarkup("moon")}</g></g></g>`);
    }
  }
  setHtml("glows", glows.join(""));
  setHtml("wakes", wakes.join(""));
  setHtml("moonrefl", moons.join(""));

  // reserved outlines for offered/leased objects (still in their place)
  setHtml(
    "reserved",
    objs
      .filter((o) => o.status === "offered" || o.status === "leased")
      .map((o) => {
        const b = box(o);
        return `<rect class="reserved-outline" x="${b.x0}" y="${b.y0}" width="${b.w}" height="${b.h}" rx="10"/>`;
      })
      .join(""),
  );

  renderInvites();
  renderSelection();
  renderGhosts();
  renderEffects();
  $("art").style.opacity = S.phase === "dissolve" ? String(Math.max(0, (S.round.dissolveEnd - now()) / (S.round.dissolveEnd - S.round.revealEnd))) : "";
}

const htmlCache = new Map();
function setHtml(id, html) {
  if (htmlCache.get(id) === html) return;
  htmlCache.set(id, html);
  $(id).innerHTML = html;
}

function noticeRelations(byId) {
  const msgs = {
    "lantern-shelter": "你们让这盏灯有了归处 <span lang=\"en\">Together, you gave the light a home.</span>",
    "boat-water": "你们让这只船有了水 <span lang=\"en\">Together, you gave the boat a river.</span>",
    "bird-tree": "你们让这只鸟有了栖枝 <span lang=\"en\">Together, you gave the bird a branch.</span>",
    "moon-water": "你们让月亮落进了水里 <span lang=\"en\">Together, you let the moon into the water.</span>",
  };
  const solo = {
    "lantern-shelter": "灯有了归处 <span lang=\"en\">The lantern found a home.</span>",
    "boat-water": "船浮在水上 <span lang=\"en\">The boat is afloat.</span>",
    "bird-tree": "鸟落在枝上 <span lang=\"en\">The bird has perched.</span>",
    "moon-water": "水里有了月 <span lang=\"en\">The moon is in the water.</span>",
  };
  for (const r of S.rels) {
    const k = relKey(r);
    if (UI.seenRels.has(k)) continue;
    UI.seenRels.add(k);
    const a = byId.get(r.a);
    const b = byId.get(r.b);
    const involved = [a.custodian, b.custodian, a.contributor, b.contributor];
    if (!involved.includes(S.me)) continue;
    const together = a.contributor !== b.contributor || a.custodian !== b.custodian;
    toast(together ? msgs[r.type] : solo[r.type]);
  }
  // let a relation be noticed again once it has ended
  const live = new Set(S.rels.map(relKey));
  for (const k of UI.seenRels) if (!live.has(k)) UI.seenRels.delete(k);
}

function renderInvites() {
  const out = [];
  for (const inv of S.invitations.values()) {
    const intent = INTENTS[inv.intent];
    const m = markOf(inv.owner);
    const ack = inv.status === "acknowledged";
    const pending = [...S.proposals.values()].find((p) => p.invitationId === inv.id);
    out.push(`<g class="invite-mark${ack ? " acknowledged" : ""}" data-invite="${inv.id}" transform="translate(${inv.x} ${inv.y})">
      <circle class="ring" r="44"/>
      <circle r="7" fill="${m.colour}" cy="-30" cx="30"/>
      <text text-anchor="middle" y="6">${ack ? "已会意" : intent.zh}</text>
      <text class="en" text-anchor="middle" y="66">${ack ? "understood" : intent.en}</text>
    </g>`);
    if (pending) {
      const t = { ...pending.transform };
      out.push(`<g class="ghost" transform="${transformAttr({ ...t, motif: pending.motif })}">${imageMarkup(pending.motif)}</g>`);
    }
  }
  setHtml("invites", out.join(""));
}

function renderSelection() {
  const o = UI.selected && S.objects.get(UI.selected);
  if (!o) {
    setHtml("selection", "");
    return;
  }
  const b = box(displayed(o));
  setHtml("selection", `<rect class="sel-box" x="${b.x0 - 6}" y="${b.y0 - 6}" width="${b.w + 12}" height="${b.h + 12}" rx="8"/>`);
}

function renderGhosts() {
  const out = [];
  // my own preview: borrow / respond / place at pointer
  if (UI.ghost && UI.ghost.motif) {
    out.push(`<g class="ghost" transform="${transformAttr(UI.ghost)}">${imageMarkup(UI.ghost.motif)}</g>`);
  }
  if (UI.mode === "dew" && UI.pointer) {
    out.push(`<circle class="dew-preview" cx="${UI.pointer.x}" cy="${UI.pointer.y}" r="${LIMITS.dewRadius}"/>`);
  }
  // pending borrow proposals are visible to everyone as a translucent ghost
  for (const pr of S.proposals.values()) {
    if (pr.kind !== "borrow") continue;
    out.push(`<g class="ghost" transform="${transformAttr({ ...pr.transform, motif: pr.motif })}">${imageMarkup(pr.motif)}</g>`);
    out.push(`<circle cx="${pr.transform.x}" cy="${pr.transform.y - 20}" r="7" fill="${markOf(pr.proposer).colour}"/>`);
  }
  // other people's in-progress drags, faint
  const t = performance.now();
  for (const [pid, p] of UI.remote) {
    if (t - p.at > 2500) {
      UI.remote.delete(pid);
      continue;
    }
    if (p.x === undefined) continue;
    const motif = p.motif ?? S.objects.get(p.objectId)?.motif;
    if (!motif || !MOTIF_BY_ID[motif]) continue;
    const base = S.objects.get(p.objectId) ?? { scale: 1, rotation: 0, flip: false };
    out.push(`<g class="ghost-remote" transform="${transformAttr({ x: p.x, y: p.y, scale: p.scale ?? base.scale, rotation: p.rotation ?? base.rotation, flip: p.flip ?? base.flip })}">${imageMarkup(motif)}</g>`);
    out.push(`<circle cx="${p.x}" cy="${p.y}" r="6" fill="${markOf(pid).colour}" opacity="0.7"/>`);
  }
  setHtml("ghosts", out.join(""));
}

// Bubbles drift on a path every client computes from the same offer id and
// server timestamp; shadows and dew fade on the shared clock too, so a late
// joiner sees them mid-fade rather than replayed from the start.
function renderEffects() {
  const t = now();
  const shadows = [];
  for (const [id, s] of S.shadows) {
    if (s.expiresAt <= t) {
      S.shadows.delete(id);
      continue;
    }
    const delay = -(t - s.createdAt);
    shadows.push(`<g class="shadow-ghost" style="--life:${S.timing.shadow}ms;animation-delay:${delay}ms"><g filter="url(#s-shadow)" transform="${transformAttr(s)}">${imageMarkup(s.motif)}</g></g>`);
  }
  setHtml("shadows", shadows.join(""));

  const dews = [];
  for (const [id, d] of S.dews) {
    if (d.createdAt + S.timing.dew <= t) {
      S.dews.delete(id);
      continue;
    }
    const delay = -(t - d.createdAt);
    dews.push(`<clipPath id="dc${id}"><circle cx="${d.x}" cy="${d.y}" r="${LIMITS.dewRadius}"/></clipPath>
      <g class="dew-wet" style="--life:${S.timing.dew}ms;animation-delay:${delay}ms" clip-path="url(#dc${id})"><use href="#art" filter="url(#s-wet)"/></g>
      <g class="dew-wet" style="--life:${S.timing.dew}ms;animation-delay:${delay}ms"><circle class="dew-drop" cx="${d.x}" cy="${d.y}" r="7"/></g>`);
  }
  setHtml("dewfx", dews.join(""));
  renderBubbles();
}

function renderBubbles() {
  const t = now();
  const out = [];
  for (const of of S.offers.values()) {
    const o = S.objects.get(of.objectId);
    if (!o) continue;
    if (of.status === "claimed") continue;
    const p = UI.motion ? bubbleDrift(of, t) : { x: of.origin.x, y: of.origin.y - 70 };
    const m = MOTIF_BY_ID[o.motif];
    const fit = 60 / Math.max(m.w, m.h);
    const left = Math.max(0, Math.ceil((of.expiresAt - t) / 1000));
    out.push(`<g class="bubble" data-offer="${of.id}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">
      <circle class="film" r="50"/>
      <g transform="scale(${fit.toFixed(3)})">${imageMarkup(o.motif)}</g>
      <path class="shine" d="M-30 -28 a40 40 0 0 1 22 -14" fill="none" stroke="#fff" stroke-width="4" stroke-opacity="0.7" stroke-linecap="round"/>
      <circle r="8" cx="38" cy="-38" fill="${markOf(of.offerer).colour}"/>
      <text y="70" text-anchor="middle" font-size="16" fill="#4e524c">${left}s</text>
    </g>`);
  }
  $("bubbles").innerHTML = out.join("");
}

function renderOverlay() {
  const ov = $("overlay");
  ov.classList.remove("corner");
  let html = "";
  const prompt = S.nextPrompt;
  if (!S.connected && S.me === null) {
    html = `<div class="card"><h2>展卷中…</h2><p class="en" lang="en">Unrolling the scroll…</p></div>`;
  } else if (S.phase === "waiting" || S.phase === "finished") {
    const again = S.phase === "finished";
    html = `<div class="card">
      ${again ? `<p>梦醒了。<span lang="en">The dream has ended.</span>${S.lastArchive ? ` <a href="/dreams/${S.lastArchive}/">看这场梦痕 <span lang="en">See the saved dream</span></a>` : ""}</p>` : ""}
      <h2>${prompt?.zh ?? ""}</h2>
      <p class="en" lang="en">${prompt?.en ?? ""}</p>
      <p class="quiet">七分钟，一起布一幅画；然后它会散去，只留梦痕。<span lang="en">Seven minutes to compose one picture together; then it passes, leaving a saved trace.</span></p>
      <button type="button" class="big" id="start" ${S.connected ? "" : "disabled"}>${again ? "再入一梦 <span lang=\"en\">Another dream</span>" : "入梦 <span lang=\"en\">Begin dream</span>"}</button>
    </div>`;
  } else if (S.phase === "reveal" || S.phase === "dissolve") {
    ov.classList.add("corner");
    const joinedLate = !myPlayer();
    html = `<div class="card">
      <p>${S.phase === "reveal" ? "展卷：画已定格，存为梦痕。" : "梦散：画面慢慢回到纸上。"}<span lang="en">${S.phase === "reveal" ? "The scroll is frozen and saved." : "The picture is fading back into paper."}</span>
      ${S.round ? `<a href="/dreams/${S.round.id}/">梦痕 <span lang="en">Saved dream</span></a>` : ""}</p>
      ${joinedLate ? `<p class="quiet">你可以观看，下一梦再加入。<span lang="en">Watch now; you can join the next dream.</span></p>` : ""}
      ${UI.motion && S.phase === "reveal" ? `<button type="button" id="tour">慢游全卷 <span lang="en">Slow panorama</span></button>` : ""}
    </div>`;
  } else if (S.objects.size === 0 && S.phase === "compose" && !UI.motif) {
    ov.classList.add("corner");
    html = `<div class="card"><p>从下方素材匣选一件景物，点在画上。<span lang="en">Choose a motif from your tray below, then tap the scroll to place it.</span></p></div>`;
  }
  if (ov.dataset.html !== html) {
    ov.dataset.html = html;
    ov.innerHTML = html;
    ov.hidden = !html;
    $("start")?.addEventListener("click", startRound);
    $("tour")?.addEventListener("click", startTour);
  }
}

async function startRound() {
  const r = await post("start");
  if (r) resync();
}

function startTour() {
  fitHeight();
  const from = 0;
  const to = SCENE.width - UI.cam.w;
  const t0 = performance.now();
  const dur = 18000;
  UI.tour = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    setCamera(from + (to - from) * (0.5 - Math.cos(Math.PI * k) / 2), 0, UI.cam.w);
    if (k >= 1) UI.tour = null;
  };
}

function renderMarks() {
  const ul = $("marks");
  const items = [...S.players.values()]
    .filter((p) => S.online.has(p.pid) || p.pid === S.me)
    .sort((a, b) => a.mark - b.mark)
    .map((p) => `<li class="${S.online.has(p.pid) ? "online" : ""}${p.pid === S.me ? " me" : ""}">${markHtml(p.pid)}<span class="visually-hidden">${p.pid === S.me ? "你" : "同梦者"}</span></li>`)
    .join("");
  if (ul.innerHTML !== items) ul.innerHTML = items;
}

function renderOverview() {
  const art = S.round && S.phase !== "finished" ? sceneMarkup(sceneObjects(), "ov") : "";
  if ($("overview-art").dataset.sig !== art) {
    $("overview-art").dataset.sig = art;
    $("overview-art").innerHTML = art;
  }
}

// ---------------------------------------------------------------- tray

function renderTray() {
  const p = myPlayer();
  const ul = $("palette");
  let html;
  if (!p || p.palette.length === 0) {
    const why =
      S.phase === "refine"
        ? "此刻不再添新景；可以借景、接泡、回应留白。<span lang=\"en\">Placement has closed: you can still borrow, catch bubbles and answer openings.</span>"
        : S.phase === "compose"
          ? "正在分发素材… <span lang=\"en\">Dealing your motifs…</span>"
          : "入梦后会分到八种景物。<span lang=\"en\">You'll be dealt eight motifs when a dream begins.</span>";
    html = `<li class="empty">${why}</li>`;
  } else {
    const canPlace = S.phase === "compose" && S.connected;
    const rerolls = LIMITS.rerolls - p.rerollsUsed;
    html = p.palette
      .map(
        (id, slot) => `<li>
        <button type="button" class="motif-btn" data-motif="${id}" aria-pressed="${UI.motif === id && (UI.mode === "place" || UI.mode === "respond")}" ${canPlace ? "" : "disabled"}>
          <img src="/static/motifs/${id}.svg" alt="" draggable="false"/>
          <span class="name">${MOTIF_BY_ID[id].zh}<span lang="en">${MOTIF_BY_ID[id].en}</span></span>
        </button>
        <button type="button" class="reroll" data-slot="${slot}" ${canPlace && rerolls > 0 ? "" : "disabled"} aria-label="换掉${MOTIF_BY_ID[id].zh} Reroll ${MOTIF_BY_ID[id].en}">换 <span lang="en">swap</span></button>
      </li>`,
      )
      .join("");
  }
  if (ul.dataset.html !== html) {
    ul.dataset.html = html;
    ul.innerHTML = html;
  }
  $("swap-mode").disabled = !(p && p.palette.length && S.phase === "compose" && p.rerollsUsed < LIMITS.rerolls);
  $("reroll-left").innerHTML = p && p.palette.length ? `可换 ${LIMITS.rerolls - p.rerollsUsed} 次 <span lang="en">${LIMITS.rerolls - p.rerollsUsed} swaps left</span>` : "";
}

$("palette").addEventListener("click", async (ev) => {
  const rr = ev.target.closest(".reroll");
  if (rr) {
    await post("reroll", { slot: Number(rr.dataset.slot) });
    return;
  }
  const btn = ev.target.closest(".motif-btn");
  if (!btn || UI.trayDragged) return;
  if (UI.swapMode) {
    const slot = myPlayer()?.palette.indexOf(btn.dataset.motif);
    setSwapMode(false);
    if (slot !== undefined && slot >= 0) await post("reroll", { slot });
    return;
  }
  chooseMotif(btn.dataset.motif);
});

function chooseMotif(id) {
  if (UI.mode === "respond") {
    UI.motif = id;
    const inv = S.invitations.get(UI.respondTo);
    UI.ghost = { motif: id, x: inv.x, y: inv.y, scale: 1, rotation: 0, flip: false };
    renderAll();
    renderModebar();
    return;
  }
  if (UI.motif === id && UI.mode === "place") {
    resetMode();
  } else {
    setTool("select");
    UI.mode = "place";
    UI.motif = id;
    UI.selected = null;
    say(`已选 ${MOTIF_BY_ID[id].zh} ${MOTIF_BY_ID[id].en}: tap the scroll to place it, or press Enter to place it in the centre.`);
  }
  renderAll();
  renderModebar();
}

// drag from the tray onto the scroll
$("palette").addEventListener("pointerdown", (ev) => {
  const btn = ev.target.closest(".motif-btn");
  if (!btn || btn.disabled || UI.mode === "respond") return;
  UI.trayDrag = { motif: btn.dataset.motif, x0: ev.clientX, y0: ev.clientY, active: false, id: ev.pointerId };
  UI.trayDragged = false;
  btn.setPointerCapture(ev.pointerId);
});
$("palette").addEventListener("pointermove", (ev) => {
  const d = UI.trayDrag;
  if (!d) return;
  if (!d.active && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) > 10) d.active = true;
  if (!d.active) return;
  const r = svg.getBoundingClientRect();
  const over = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  UI.ghost = over ? { motif: d.motif, ...toScene(ev), scale: 1, rotation: 0, flip: false } : null;
  renderGhosts();
});
$("palette").addEventListener("pointerup", async (ev) => {
  const d = UI.trayDrag;
  UI.trayDrag = null;
  if (!d || !d.active) return;
  UI.trayDragged = true;
  setTimeout(() => (UI.trayDragged = false), 50);
  const r = svg.getBoundingClientRect();
  UI.ghost = null;
  renderGhosts();
  if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
    await placeAt(d.motif, clampScene(toScene(ev)));
  }
});

async function placeAt(motif, p) {
  const m = MOTIF_BY_ID[motif];
  // atmospheric things default far, small staffage near
  const depth = m.group === "atmosphere" || motif === "peaks" ? 0 : m.role === "ground" && motif !== "water" && motif !== "bank" ? 0 : 1;
  const r = await post("place", { motif, x: p.x, y: p.y, scale: 1, rotation: 0, flip: false, ink: 0.9, depth });
  if (r) {
    UI.selected = r.objectId;
    resetMode();
    openSide();
    renderAll();
  }
}

// ---------------------------------------------------------------- catalogue

$("catalogue-open").addEventListener("click", () => {
  const mine = new Set(myPlayer()?.palette ?? []);
  const holders = new Map();
  for (const p of S.players.values()) {
    if (p.pid === S.me) continue;
    for (const id of p.palette) holders.set(id, [...(holders.get(id) ?? []), p.pid]);
  }
  $("catalogue-body").innerHTML = Object.entries(GROUPS)
    .map(([g, label]) => {
      const items = MOTIFS.filter((m) => m.group === g)
        .map((m) => {
          const who = holders.get(m.id) ?? [];
          const status = mine.has(m.id)
            ? "你有 <span lang=\"en\">yours</span>"
            : who.length
              ? `${who.map(markHtml).join("")} 有，可请他们回应留白 <span lang="en">ask them</span>`
              : "本梦无人持有 <span lang=\"en\">not in play this round</span>";
          return `<li class="${mine.has(m.id) ? "mine" : "unavailable"}"><img src="/static/motifs/${m.id}.svg" alt=""/><br>${m.zh} <span lang="en">${m.en}</span><span class="who">${status}</span></li>`;
        })
        .join("");
      return `<div class="cat-group"><h3>${label.zh} <span lang="en">${label.en}</span></h3><ul class="cat-list">${items}</ul></div>`;
    })
    .join("");
  $("catalogue").showModal();
});

// On phones the per-slot swap buttons give way to one toggle: press it,
// then tap the motif to swap.
function setSwapMode(on) {
  UI.swapMode = on;
  $("swap-mode").setAttribute("aria-pressed", String(on));
  document.body.classList.toggle("swapping", on);
  if (on) say("点一件景物把它换掉 Tap a motif to swap it for another.");
}
$("swap-mode").addEventListener("click", () => setSwapMode(!UI.swapMode));

$("tray-toggle").addEventListener("click", () => {
  const collapsed = $("tray").classList.toggle("collapsed");
  $("tray-toggle").setAttribute("aria-expanded", String(!collapsed));
  requestAnimationFrame(fitHeight);
});

// ---------------------------------------------------------------- tools & modes

function setTool(tool) {
  UI.tool = tool;
  for (const b of document.querySelectorAll(".tool[data-tool]")) b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
  if (tool === "invite" || tool === "dew" || tool === "pan") {
    UI.mode = tool;
    UI.motif = null;
    UI.ghost = null;
    UI.selected = null;
  } else if (UI.mode === "invite" || UI.mode === "dew" || UI.mode === "pan") {
    UI.mode = "idle";
  }
  for (const m of ["place", "invite", "dew", "pan", "borrow", "respond", "receive"]) document.body.classList.toggle(`mode-${m}`, UI.mode === m);
  renderModebar();
}

function resetMode() {
  if (UI.ghost || UI.mode === "borrow") sendPreview({ kind: "end" }, true);
  UI.mode = "idle";
  UI.motif = null;
  UI.ghost = null;
  UI.respondTo = null;
  UI.receiving = null;
  setTool("select");
  renderModebar();
}

document.querySelector(".rail").addEventListener("click", (ev) => {
  const b = ev.target.closest(".tool[data-tool]");
  if (!b) return;
  const tool = b.dataset.tool;
  if (tool === "invite" && S.phase !== "compose") {
    toast("留白只能在布景时留下 <span lang=\"en\">Openings can only be left during Compose.</span>");
    return;
  }
  if (tool === "dew") {
    const p = myPlayer();
    if (!p || p.dewUsed >= LIMITS.dew) {
      toast("本梦的两滴露已用 <span lang=\"en\">Both drops of dew are used.</span>");
      return;
    }
  }
  setTool(UI.tool === tool ? "select" : tool);
  renderAll();
});

$("zoom-in").addEventListener("click", () => zoom(0.8));
$("zoom-out").addEventListener("click", () => zoom(1.25));
$("fit").addEventListener("click", () => (UI.cam.w >= minZoomUnits() - 1 ? fitHeight() : fitAll()));

function renderModebar() {
  const bar = $("modebar");
  let html = "";
  if (UI.mode === "place" && UI.motif) {
    html = `<span>点画面放下${motifName(UI.motif)} <span lang="en">Tap the scroll to place it.</span></span>
      <button type="button" data-act="place-centre">放在中央 <span lang="en">Place in centre</span></button>
      <button type="button" data-act="cancel">取消 <span lang="en">Cancel</span></button>`;
  } else if (UI.mode === "invite") {
    html = `<span>点一处空白，留下邀请 <span lang="en">Tap an empty spot to leave an opening.</span></span>
      <button type="button" data-act="invite-centre">留在中央 <span lang="en">Use centre</span></button>
      <button type="button" data-act="cancel">取消 <span lang="en">Cancel</span></button>`;
  } else if (UI.mode === "dew") {
    html = `<span>露：虚线圈内的墨会晕开片刻 <span lang="en">Dew softens the ink inside the circle for a while.</span></span>
      <button type="button" data-act="dew-centre">滴在中央 <span lang="en">Drop in centre</span></button>
      <button type="button" data-act="cancel">取消 <span lang="en">Cancel</span></button>`;
  } else if (UI.mode === "pan") {
    html = `<span>拖动画面平移 <span lang="en">Drag to pan the scroll.</span></span><button type="button" data-act="cancel">完成 <span lang="en">Done</span></button>`;
  } else if (UI.mode === "borrow") {
    html = `<span>把虚影拖到你想要的位置（或用方向键） <span lang="en">Drag the ghost (or use arrow keys) to where you'd like it.</span></span>
      <button type="button" data-act="send-borrow">发出提议 <span lang="en">Send suggestion</span></button>
      <button type="button" data-act="cancel">取消 <span lang="en">Cancel</span></button>`;
  } else if (UI.mode === "respond") {
    const inv = S.invitations.get(UI.respondTo);
    html = `<span>回应“${INTENTS[inv?.intent]?.zh ?? ""}”：${UI.motif ? `拖动虚影调整位置 <span lang="en">drag the ghost to adjust</span>` : `从素材匣选一件 <span lang="en">pick a motif from your tray</span>`}</span>
      ${UI.motif ? `<button type="button" data-act="send-respond">发出 <span lang="en">Send</span></button>` : ""}
      <button type="button" data-act="cancel">取消 <span lang="en">Cancel</span></button>`;
  } else if (UI.mode === "receive") {
    const of = S.offers.get(UI.receiving);
    const left = of?.leaseExpiresAt ? Math.max(0, Math.ceil((of.leaseExpiresAt - now()) / 1000)) : 0;
    html = `<span>接住了！点画面放下它（还剩 <span class="lease">${left}</span> 秒） <span lang="en">Caught it: tap the scroll to set it down.</span></span>
      <button type="button" data-act="receive-centre">放在中央 <span lang="en">Place in centre</span></button>
      <button type="button" data-act="release">放手 <span lang="en">Let go</span></button>`;
  }
  if (bar.dataset.html !== html) {
    bar.dataset.html = html;
    bar.innerHTML = html;
  }
  bar.hidden = !html;
}

$("modebar").addEventListener("click", async (ev) => {
  const act = ev.target.closest("button")?.dataset.act;
  if (!act) return;
  const c = centreOf();
  if (act === "cancel") resetMode();
  if (act === "place-centre" && UI.motif) await placeAt(UI.motif, c);
  if (act === "invite-centre") openIntent(c);
  if (act === "dew-centre") await dewAt(c);
  if (act === "send-borrow") await sendBorrow();
  if (act === "send-respond") await sendRespond();
  if (act === "receive-centre") await receiveAt(c);
  if (act === "release") {
    await post("release", { offerId: UI.receiving });
    resetMode();
  }
  renderAll();
});

let intentAt = null;
function openIntent(p) {
  intentAt = p;
  $("intent-options").innerHTML = Object.entries(INTENTS)
    .map(([k, v]) => `<button type="button" data-intent="${k}">${v.zh} <span lang="en">${v.en}</span></button>`)
    .join("");
  $("intent-dialog").showModal();
}
$("intent-options").addEventListener("click", async (ev) => {
  const k = ev.target.closest("button")?.dataset.intent;
  if (!k || !intentAt) return;
  $("intent-dialog").close();
  const r = await post("invite", { x: intentAt.x, y: intentAt.y, intent: k });
  if (r) {
    toast("留白已留下，等别人来回应 <span lang=\"en\">Opening left: others can now answer it.</span>");
    resetMode();
    renderAll();
  }
});

async function dewAt(p) {
  const r = await post("dew", p);
  if (r) {
    resetMode();
    renderAll();
  }
}

async function sendBorrow() {
  const o = S.objects.get(UI.selected);
  if (!o || !UI.ghost) return;
  const g = UI.ghost;
  const r = await post("borrow", { objectId: o.id, version: o.version, x: g.x, y: g.y, scale: g.scale, rotation: g.rotation, flip: g.flip, ink: o.ink, depth: o.depth });
  if (r) {
    toast("提议已发出，等对方决定 <span lang=\"en\">Suggestion sent: waiting for their answer.</span>");
    resetMode();
  }
}

async function sendRespond() {
  if (!UI.ghost || !UI.motif) return;
  const g = UI.ghost;
  const r = await post("respond", { invitationId: UI.respondTo, motif: UI.motif, x: g.x, y: g.y, scale: g.scale, rotation: 0, flip: g.flip, depth: 1 });
  if (r) {
    toast("回应已发出 <span lang=\"en\">Answer sent: waiting for them to accept.</span>");
    resetMode();
  }
}

async function receiveAt(p) {
  const r = await post("receive", { offerId: UI.receiving, x: p.x, y: p.y });
  if (r) {
    UI.selected = r.objectId;
    UI.receiving = null;
    resetMode();
    toast("你接住并放下了它，现在由你照看 <span lang=\"en\">You caught it and set it down: it's in your care now.</span>");
  }
}

async function catchBubble(offerId) {
  UI.wantOffer = offerId;
  const r = await post("claim", { offerId });
  if (r) {
    // on a phone, get the sheet out of the way so the scroll can be tapped
    document.querySelector(".side").classList.remove("open");
    UI.receiving = offerId;
    UI.mode = "receive";
    UI.selected = null;
    const of = S.offers.get(offerId);
    const o = of && S.objects.get(of.objectId);
    if (o) UI.ghost = { motif: o.motif, x: of.origin.x, y: of.origin.y, scale: o.scale, rotation: o.rotation, flip: o.flip };
    for (const m of ["place", "invite", "dew", "pan", "borrow", "respond", "receive"]) document.body.classList.toggle(`mode-${m}`, UI.mode === m);
    say("接住了，八秒内点画面放下 Caught it: tap the scroll within eight seconds to set it down.");
    renderModebar();
    renderAll();
  }
}

function beginBorrow(o) {
  document.querySelector(".side").classList.remove("open");
  UI.mode = "borrow";
  UI.ghost = { motif: o.motif, x: Math.min(SCENE.width, o.x + 80), y: o.y, scale: o.scale, rotation: o.rotation, flip: o.flip };
  for (const m of ["place", "invite", "dew", "pan", "borrow", "respond", "receive"]) document.body.classList.toggle(`mode-${m}`, UI.mode === m);
  sendPreview({ kind: "borrow", objectId: o.id, motif: o.motif, x: UI.ghost.x, y: UI.ghost.y }, true);
  renderModebar();
  renderAll();
}

function beginRespond(inv) {
  document.querySelector(".side").classList.remove("open");
  UI.mode = "respond";
  UI.respondTo = inv.id;
  UI.motif = null;
  UI.ghost = null;
  UI.selected = null;
  for (const m of ["place", "invite", "dew", "pan", "borrow", "respond", "receive"]) document.body.classList.toggle(`mode-${m}`, UI.mode === m);
  lookAt(inv.x, inv.y);
  say("从素材匣选一件景物来回应 Pick a motif from your tray to answer.");
  renderModebar();
  renderAll();
}

// ---------------------------------------------------------------- hit testing

function hitObject(p) {
  // smallest box first, so a boat on a big water patch is still clickable
  let best;
  for (const o0 of S.objects.values()) {
    if (o0.status !== "placed") continue;
    const o = displayed(o0);
    const b = box(o);
    if (p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1) continue;
    const area = b.w * b.h - o.depth * 1000 - o.z;
    if (!best || area < best.area) best = { o: o0, area };
  }
  return best?.o;
}

function hitInvite(p) {
  for (const inv of S.invitations.values()) if (Math.hypot(inv.x - p.x, inv.y - p.y) < 48) return inv;
  return undefined;
}

function hitBubble(p) {
  const t = now();
  for (const of of S.offers.values()) {
    if (of.status !== "floating") continue;
    const b = UI.motion ? bubbleDrift(of, t) : { x: of.origin.x, y: of.origin.y - 70 };
    // a generous target: you shouldn't have to chase it
    if (Math.hypot(b.x - p.x, b.y - p.y) < 75) return of;
  }
  return undefined;
}

// ---------------------------------------------------------------- pointer

svg.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  UI.tour = null;
  const p = toScene(ev);
  svg.setPointerCapture(ev.pointerId);
  const base = { x0: ev.clientX, y0: ev.clientY, p0: p, moved: false, cam0: { ...UI.cam } };
  if (!editable() || UI.mode === "pan") {
    UI.drag = { type: "pan", ...base };
    return;
  }
  if (UI.mode === "borrow" || UI.mode === "respond") {
    if (UI.ghost) {
      const gb = box(UI.ghost);
      if (p.x > gb.x0 && p.x < gb.x1 && p.y > gb.y0 && p.y < gb.y1) {
        UI.drag = { type: "ghost", dx: UI.ghost.x - p.x, dy: UI.ghost.y - p.y, ...base };
        return;
      }
    }
    UI.drag = { type: "tap", ...base };
    return;
  }
  if (UI.mode !== "idle") {
    UI.drag = { type: "tap", ...base };
    return;
  }
  const bubble = hitBubble(p);
  if (bubble) {
    UI.drag = { type: "bubble", offer: bubble.id, ...base };
    return;
  }
  const inv = hitInvite(p);
  if (inv) {
    UI.drag = { type: "invite", invite: inv.id, ...base };
    return;
  }
  const o = hitObject(p);
  if (o && o.custodian === S.me) {
    UI.drag = { type: "move", id: o.id, dx: o.x - p.x, dy: o.y - p.y, ...base };
    return;
  }
  if (o) {
    UI.drag = { type: "select", id: o.id, ...base };
    return;
  }
  UI.drag = { type: "pan", deselect: true, ...base };
});

svg.addEventListener("pointermove", (ev) => {
  const p = toScene(ev);
  UI.pointer = p;
  if (UI.mode === "dew") renderGhosts();
  if ((UI.mode === "place" || UI.mode === "receive") && UI.motif !== undefined && ev.pointerType === "mouse") {
    const motif = UI.mode === "place" ? UI.motif : UI.ghost?.motif;
    if (motif) {
      UI.ghost = { ...(UI.ghost ?? { scale: 1, rotation: 0, flip: false }), motif, ...clampScene(p) };
      renderGhosts();
    }
  }
  const d = UI.drag;
  if (!d) return;
  if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) > 6) d.moved = true;
  if (!d.moved) return;
  if (d.type === "pan" || d.type === "select" || d.type === "bubble" || d.type === "invite") {
    d.type = "pan";
    const k = d.cam0.w / svg.getBoundingClientRect().width;
    setCamera(d.cam0.x - (ev.clientX - d.x0) * k, d.cam0.y - (ev.clientY - d.y0) * k, d.cam0.w);
  } else if (d.type === "move") {
    const o = S.objects.get(d.id);
    if (!o) return;
    const at = clampScene({ x: p.x + d.dx, y: p.y + d.dy });
    UI.local.set(d.id, at);
    UI.selected = d.id;
    sendPreview({ kind: "move", objectId: d.id, x: at.x, y: at.y });
    renderScene();
  } else if (d.type === "ghost" && UI.ghost) {
    Object.assign(UI.ghost, clampScene({ x: p.x + d.dx, y: p.y + d.dy }));
    if (UI.mode === "borrow") sendPreview({ kind: "borrow", objectId: UI.selected, motif: UI.ghost.motif, x: UI.ghost.x, y: UI.ghost.y, scale: UI.ghost.scale });
    renderGhosts();
  }
});

svg.addEventListener("pointerup", async (ev) => {
  const d = UI.drag;
  UI.drag = null;
  if (!d) return;
  const p = clampScene(toScene(ev));
  if (d.type === "move") {
    const o = S.objects.get(d.id);
    UI.selected = d.id;
    if (!d.moved) openSide();
    if (d.moved && o) {
      sendPreview({ kind: "end" }, true);
      const at = UI.local.get(d.id);
      await commitTransform(o, at);
    }
    renderAll();
    return;
  }
  if (d.moved) return;
  if (d.type === "select") {
    UI.selected = d.id;
    openSide();
    renderAll();
    return;
  }
  if (d.type === "bubble") {
    await catchBubble(d.offer);
    return;
  }
  if (d.type === "invite") {
    const inv = S.invitations.get(d.invite);
    if (inv) onInvite(inv);
    return;
  }
  if (d.type === "pan" && d.deselect) {
    UI.selected = null;
    renderAll();
    return;
  }
  if (d.type === "tap") {
    if (UI.mode === "place" && UI.motif) await placeAt(UI.motif, p);
    else if (UI.mode === "invite") openIntent(p);
    else if (UI.mode === "dew") await dewAt(p);
    else if (UI.mode === "receive") await receiveAt(p);
    else if ((UI.mode === "borrow" || UI.mode === "respond") && UI.ghost) {
      Object.assign(UI.ghost, p);
      renderGhosts();
    }
  }
});

svg.addEventListener("pointerleave", () => {
  UI.pointer = null;
  if (UI.mode === "place" && UI.ghost) {
    UI.ghost = null;
    renderGhosts();
  }
});

svg.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    UI.tour = null;
    if (ev.ctrlKey || ev.metaKey) {
      const p = toScene(ev);
      zoom(ev.deltaY > 0 ? 1.1 : 0.9, p.x, p.y);
    } else {
      // a handscroll unrolls sideways: vertical wheel pans horizontally
      const k = UI.cam.w / svg.getBoundingClientRect().width;
      setCamera(UI.cam.x + (ev.deltaX + ev.deltaY) * k, UI.cam.y, UI.cam.w);
    }
  },
  { passive: false },
);

function onInvite(inv) {
  if (inv.owner === S.me) {
    toast(`这是你留的“${INTENTS[inv.intent].zh}” <span lang="en">Your own opening: ${INTENTS[inv.intent].en}.</span>`);
    return;
  }
  if (inv.status !== "open") return;
  if (inv.intent === "open") {
    post("acknowledge", { invitationId: inv.id }).then((r) => r && toast("你会意了这处留白 <span lang=\"en\">You acknowledged the space left open.</span>"));
    return;
  }
  if (S.phase !== "compose") {
    toast("此刻不再添新景 <span lang=\"en\">Placement has closed for this dream.</span>");
    return;
  }
  beginRespond(inv);
}

$("overview").addEventListener("pointerdown", (ev) => {
  const r = $("overview").getBoundingClientRect();
  const jump = (e) => lookAt(((e.clientX - r.left) / r.width) * SCENE.width, ((e.clientY - r.top) / r.height) * SCENE.height);
  jump(ev);
  const move = (e) => jump(e);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
});

// ---------------------------------------------------------------- inspector

async function commitTransform(o, changes) {
  const t = { x: o.x, y: o.y, scale: o.scale, rotation: o.rotation, flip: o.flip, ink: o.ink, depth: o.depth, ...UI.local.get(o.id), ...changes };
  UI.local.set(o.id, t);
  const r = await post("update", { objectId: o.id, version: o.version, ...t });
  if (!r) {
    // refused (stale, phase, custody): fall back to the server's state
    UI.local.delete(o.id);
    renderAll();
  }
}

let nudgeTimer;
function stageChange(o, changes) {
  UI.local.set(o.id, { ...(UI.local.get(o.id) ?? {}), ...changes });
  renderScene();
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => {
    const cur = S.objects.get(o.id);
    if (cur) commitTransform(cur, {});
  }, 450);
}

const HINTS = {
  boat: "放到水面上，它会轻轻起伏。<span lang=\"en\">Set it on a water patch and it will bob.</span>",
  sailboat: "放到水面上，它会轻轻起伏。<span lang=\"en\">Set it on a water patch and it will bob.</span>",
  lantern: "靠近亭、月窗或茅屋，灯会亮起。<span lang=\"en\">Near a pavilion, window or cottage, it glows.</span>",
  crane: "放进树冠里，它会栖息。<span lang=\"en\">Put it in a tree's crown and it will perch.</span>",
  birds: "放进树冠里，它们会栖息。<span lang=\"en\">Put them in a tree's crown and they will perch.</span>",
  moon: "放在水面上方，水里会有月影。<span lang=\"en\">Above a water patch, it casts a reflection.</span>",
  water: "船、月、水边之物都会回应它。<span lang=\"en\">Boats, the moon and things at the water's edge respond to it.</span>",
};

function renderInspector() {
  const sec = $("inspector");
  const o0 = UI.selected && S.objects.get(UI.selected);
  if (!o0) {
    sec.hidden = true;
    sec.dataset.sig = "";
    return;
  }
  const o = displayed(o0);
  const m = MOTIF_BY_ID[o.motif];
  const mine = o.custodian === S.me;
  const sig = JSON.stringify([o, mine, S.phase, S.connected, S.objects.size, [...S.proposals.keys()]]);
  if (sec.dataset.sig === sig && !sec.hidden) return;
  // don't rebuild under someone dragging a slider
  if (sec.contains(document.activeElement) && document.activeElement.type === "range") return;
  sec.dataset.sig = sig;
  sec.hidden = false;
  const can = editable() && o.status === "placed";
  const water = reflectionWater(o0, [...S.objects.values()]);
  const reflectReason = m.noReflect || m.tags.includes("water") ? "此物不能化影 This motif can't become a reflection." : !water && !o.reflectOn ? "附近没有水面：移近水边再试 No water nearby: move it to the water's edge." : "";
  const pendingBorrow = [...S.proposals.values()].find((p) => p.kind === "borrow" && p.objectId === o.id);
  const custody = mine ? "由你照看 <span lang=\"en\">In your care</span>" : `由 ${markHtml(o.custodian)} 照看 <span lang="en">In someone else's care</span>`;
  const contributed = o.contributor === o.custodian ? "" : ` · 原作 ${markHtml(o.contributor)} <span lang="en">first placed by</span>`;
  let controls = "";
  if (mine && can) {
    controls = `
      <label><span>大小 <span lang="en">Size</span></span><input type="range" data-k="scale" min="${LIMITS.scale[0]}" max="${LIMITS.scale[1]}" step="0.05" value="${o.scale}"></label>
      <label><span>角度 <span lang="en">Angle</span></span><input type="range" data-k="rotation" min="${LIMITS.rotation[0]}" max="${LIMITS.rotation[1]}" step="1" value="${o.rotation}"></label>
      <label><span>浓淡 <span lang="en">Ink</span></span><input type="range" data-k="ink" min="${LIMITS.ink[0]}" max="${LIMITS.ink[1]}" step="0.05" value="${o.ink}"></label>
      <label><span>远近 <span lang="en">Depth</span></span><select data-k="depth">${DEPTHS.map((d, i) => `<option value="${i}" ${o.depth === i ? "selected" : ""}>${["远", "中", "近"][i]} ${d}</option>`).join("")}</select></label>
      <div class="row">
        <button type="button" data-act="flip">翻转 <span lang="en">Flip</span></button>
        <div class="nudge" role="group" aria-label="微移 Nudge">
          <button type="button" data-nudge="-1,0" aria-label="左移 Nudge left">←</button>
          <button type="button" data-nudge="0,-1" aria-label="上移 Nudge up">↑</button>
          <button type="button" data-nudge="0,1" aria-label="下移 Nudge down">↓</button>
          <button type="button" data-nudge="1,0" aria-label="右移 Nudge right">→</button>
        </div>
      </div>
      <div class="row">
        <button type="button" data-act="reflect" aria-pressed="${!!o.reflectOn}" ${reflectReason && !o.reflectOn ? "disabled" : ""}>化影 <span lang="en">${o.reflectOn ? "Become solid again" : "Become a reflection"}</span></button>
        <button type="button" data-act="offer" ${S.online.size > 1 ? "" : "disabled"}>放入泡中 <span lang="en">Offer in a bubble</span></button>
        <button type="button" data-act="withdraw">收回 <span lang="en">Withdraw</span></button>
      </div>
      ${reflectReason && !o.reflectOn ? `<p class="reason">${reflectReason}</p>` : ""}
      ${S.online.size > 1 ? "" : `<p class="reason">有别人在场时才能传泡。<span lang="en">Bubbles need someone else here to catch them.</span></p>`}
      <p class="reason">方向键微移，+/− 调大小，[ ] 调远近，Esc 取消。<span lang="en">Arrow keys nudge, +/− resize, [ ] change depth, Esc deselects.</span></p>`;
  } else if (!mine && can) {
    controls = pendingBorrow
      ? `<p class="reason">已有人提议借景，等待回应。<span lang="en">A move has already been suggested; waiting for an answer.</span></p>`
      : `<div class="row"><button type="button" data-act="borrow">借景 <span lang="en">Suggest a move</span></button></div>
         <p class="reason">放一个虚影，对方同意后才会移动，并改由你照看。<span lang="en">Place a ghost; it only moves if they agree, and then it's in your care.</span></p>`;
  } else if (o.status === "offered") {
    controls = `<p class="reason">它正在泡里，等人接住。<span lang="en">It's floating in a bubble, waiting to be caught.</span></p>`;
  } else if (!editable()) {
    controls = `<p class="reason">画卷已定，只能看。<span lang="en">The scroll is frozen: look only.</span></p>`;
  }
  sec.innerHTML = `
    <button type="button" class="close" data-act="deselect" aria-label="关闭 Close">×</button>
    <h2 id="insp-title">${m.zh} <span lang="en">${m.en}</span></h2>
    <p class="quiet">${custody}${contributed}${o.reflectOn ? " · 已化影 <span lang=\"en\">reflected</span>" : ""}</p>
    ${HINTS[o.motif] ? `<p class="hint">${HINTS[o.motif]}</p>` : ""}
    ${controls}`;
}

$("inspector").addEventListener("input", (ev) => {
  const k = ev.target.dataset.k;
  const o = S.objects.get(UI.selected);
  if (!k || !o) return;
  const v = Number(ev.target.value);
  stageChange(o, { [k]: k === "depth" ? Math.round(v) : v });
});

$("inspector").addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  const o = S.objects.get(UI.selected);
  if (b.dataset.act === "deselect") {
    UI.selected = null;
    document.querySelector(".side").classList.remove("open");
    renderAll();
    return;
  }
  if (!o) return;
  if (b.dataset.nudge) {
    const [dx, dy] = b.dataset.nudge.split(",").map(Number);
    const cur = displayed(o);
    stageChange(o, clampScene({ x: cur.x + dx * 20, y: cur.y + dy * 20 }));
    return;
  }
  const act = b.dataset.act;
  if (act === "flip") stageChange(o, { flip: !displayed(o).flip });
  if (act === "withdraw") {
    if (await post("withdraw", { objectId: o.id, version: o.version })) {
      UI.selected = null;
      toast("收回了，腾出一个位置 <span lang=\"en\">Withdrawn: that frees a place.</span>");
    }
  }
  if (act === "reflect") await post("reflect", { objectId: o.id, version: o.version, on: !o.reflectOn });
  if (act === "offer") {
    if (await post("offer", { objectId: o.id, version: o.version })) {
      UI.selected = null;
      toast("它在泡里飘着，等人接住 <span lang=\"en\">It's floating in a bubble: whoever catches it first gets it.</span>");
    }
  }
  if (act === "borrow") beginBorrow(o);
  renderAll();
});

// ---------------------------------------------------------------- requests

function renderRequests() {
  const t = now();
  const items = [];
  const timer = (exp) => `<span class="timer">${Math.max(0, Math.ceil((exp - t) / 1000))}s</span>`;
  for (const pr of S.proposals.values()) {
    if (pr.target === S.me) {
      const what = pr.kind === "borrow" ? `想借景，移动你的${motifName(pr.motif)}，之后由 Ta 照看。<span lang="en">suggests moving your object; it would pass into their care.</span>` : `想用${motifName(pr.motif)}回应你的留白。<span lang="en">wants to answer your opening.</span>`;
      items.push(`<div class="req"><p>${markHtml(pr.proposer)} ${what} ${timer(pr.expiresAt)}</p>
        <div class="buttons"><button type="button" class="accept" data-accept="${pr.id}">接受 <span lang="en">Accept</span></button>
        <button type="button" data-decline="${pr.id}">婉拒 <span lang="en">Decline</span></button>
        <button type="button" data-look="${pr.transform.x},${pr.transform.y}">看看 <span lang="en">Show</span></button></div></div>`);
    } else if (pr.proposer === S.me) {
      items.push(`<div class="req"><p>你的${pr.kind === "borrow" ? "借景" : "回应"}在等对方决定 ${markHtml(pr.target)} ${timer(pr.expiresAt)} <span lang="en">Waiting for their answer.</span></p>
        <div class="buttons"><button type="button" data-cancel="${pr.id}">撤回 <span lang="en">Withdraw</span></button></div></div>`);
    }
  }
  for (const of of S.offers.values()) {
    const o = S.objects.get(of.objectId);
    if (!o) continue;
    if (of.status === "floating" && of.offerer !== S.me) {
      items.push(`<div class="req"><p>${markHtml(of.offerer)} 放出一个泡：${motifName(o.motif)} ${timer(of.expiresAt)}</p>
        <div class="buttons"><button type="button" class="accept" data-catch="${of.id}" ${editable() ? "" : "disabled"}>接住 <span lang="en">Catch it</span></button>
        <button type="button" data-look="${of.origin.x},${of.origin.y}">看看 <span lang="en">Show</span></button></div></div>`);
    } else if (of.status === "floating") {
      items.push(`<div class="req"><p>你的${motifName(o.motif)}在泡里飘 ${timer(of.expiresAt)} <span lang="en">Floating, waiting for a catch.</span></p>
        <div class="buttons"><button type="button" data-release="${of.id}">收回 <span lang="en">Take it back</span></button></div></div>`);
    } else if (of.status === "claimed" && of.claimant !== S.me) {
      items.push(`<div class="req"><p>${markHtml(of.claimant)} 接住了${motifName(o.motif)}，正在放下。<span lang="en">Caught; being set down.</span></p></div>`);
    }
  }
  for (const inv of S.invitations.values()) {
    if (inv.status !== "open") continue;
    const intent = INTENTS[inv.intent];
    if (inv.owner === S.me) {
      items.push(`<div class="req"><p>你留的“${intent.zh}” <span lang="en">Your opening: ${intent.en}</span></p><div class="buttons"><button type="button" data-look="${inv.x},${inv.y}">看看 <span lang="en">Show</span></button></div></div>`);
    } else {
      const busy = [...S.proposals.values()].some((p) => p.invitationId === inv.id);
      const action =
        inv.intent === "open"
          ? `<button type="button" data-ack="${inv.id}">会意 <span lang="en">Acknowledge</span></button>`
          : `<button type="button" data-respond="${inv.id}" ${busy || S.phase !== "compose" ? "disabled" : ""}>回应 <span lang="en">Answer</span></button>`;
      items.push(`<div class="req"><p>${markHtml(inv.owner)} 留下“${intent.zh}” <span lang="en">left an opening: ${intent.en}</span></p>
        <div class="buttons">${action}<button type="button" data-look="${inv.x},${inv.y}">看看 <span lang="en">Show</span></button></div></div>`);
    }
  }
  const alone = S.round && editable() && S.online.size <= 1;
  if (alone) {
    items.push(`<p class="quiet">现在只有你。有人加入后，借景、传泡与回应留白才有对象。<button type="button" data-share>邀人同梦 <span lang="en">Share the link</span></button><br><span lang="en">You're the only one here. Borrowing, bubbles and openings come alive when someone else joins.</span></p>`);
  }
  const html = items.length ? items.join("") : `<p class="quiet">还没有往来。<span lang="en">Nothing waiting yet.</span></p>`;
  const box = $("requests");
  if (box.dataset.html !== html && !box.contains(document.activeElement)) {
    box.dataset.html = html;
    box.innerHTML = html;
  } else if (box.dataset.html !== html) {
    // keep focus stable: update just the timers in place
    const timers = [...box.querySelectorAll(".timer")];
    const fresh = [...new DOMParser().parseFromString(html, "text/html").querySelectorAll(".timer")];
    if (timers.length === fresh.length) timers.forEach((el, i) => (el.textContent = fresh[i].textContent));
    else {
      box.dataset.html = html;
      box.innerHTML = html;
    }
  }
}

$("requests").addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  if (d.accept) await post("accept", { proposalId: Number(d.accept) });
  if (d.decline) await post("decline", { proposalId: Number(d.decline) });
  if (d.cancel) await post("cancel", { proposalId: Number(d.cancel) });
  if (d.catch) await catchBubble(Number(d.catch));
  if (d.release) await post("release", { offerId: Number(d.release) });
  if (d.ack) await post("acknowledge", { invitationId: Number(d.ack) });
  if (d.respond) {
    const inv = S.invitations.get(Number(d.respond));
    if (inv) beginRespond(inv);
  }
  if (d.look) {
    const [x, y] = d.look.split(",").map(Number);
    lookAt(x, y);
  }
  if (d.share !== undefined) openShare();
});

function renderObjectList() {
  const objs = [...S.objects.values()].filter((o) => o.status === "placed").sort((a, b) => a.id - b.id);
  $("obj-count").textContent = `(${objs.length}/${LIMITS.sceneObjects})`;
  const html = objs
    .map((o) => `<li><button type="button" data-obj="${o.id}" aria-current="${UI.selected === o.id}">${markHtml(o.custodian)} ${MOTIF_BY_ID[o.motif].zh} <span lang="en">${MOTIF_BY_ID[o.motif].en}</span></button></li>`)
    .join("");
  const ul = $("object-list");
  if (ul.dataset.html !== html) {
    ul.dataset.html = html;
    ul.innerHTML = html || `<li class="quiet">画上还是空的。<span lang="en">The scroll is still empty.</span></li>`;
  }
}

$("object-list").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-obj]");
  if (!b) return;
  UI.selected = Number(b.dataset.obj);
  const o = S.objects.get(UI.selected);
  if (o) lookAt(o.x, o.y);
  renderAll();
  $("inspector").querySelector("button, input")?.focus();
});

function openSide() {
  document.querySelector(".side").classList.add("open");
}

// on phones the side column is a sheet: tapping its heading opens/closes it
$("req-title").addEventListener("click", () => document.querySelector(".side").classList.toggle("open"));

// ---------------------------------------------------------------- keyboard

document.addEventListener("keydown", (ev) => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || document.querySelector("dialog[open]")) return;
  if (ev.key === "Escape") {
    if (UI.mode !== "idle") resetMode();
    else UI.selected = null;
    renderAll();
    return;
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const step = ev.shiftKey ? 60 : 15;
  if ((UI.mode === "borrow" || UI.mode === "respond") && UI.ghost) {
    if (arrows[ev.key]) {
      ev.preventDefault();
      Object.assign(UI.ghost, clampScene({ x: UI.ghost.x + arrows[ev.key][0] * step, y: UI.ghost.y + arrows[ev.key][1] * step }));
      renderGhosts();
    }
    if (ev.key === "Enter") UI.mode === "borrow" ? sendBorrow() : sendRespond();
    return;
  }
  if (UI.mode === "place" && ev.key === "Enter" && UI.motif && document.activeElement === svg) {
    placeAt(UI.motif, centreOf());
    return;
  }
  const o = UI.selected && S.objects.get(UI.selected);
  if (o && o.custodian === S.me && editable() && o.status === "placed") {
    const cur = displayed(o);
    if (arrows[ev.key]) {
      ev.preventDefault();
      stageChange(o, clampScene({ x: cur.x + arrows[ev.key][0] * step, y: cur.y + arrows[ev.key][1] * step }));
    } else if (ev.key === "+" || ev.key === "=") {
      stageChange(o, { scale: Math.min(LIMITS.scale[1], cur.scale + 0.05) });
    } else if (ev.key === "-") {
      stageChange(o, { scale: Math.max(LIMITS.scale[0], cur.scale - 0.05) });
    } else if (ev.key === "[") {
      stageChange(o, { depth: Math.max(0, cur.depth - 1) });
    } else if (ev.key === "]") {
      stageChange(o, { depth: Math.min(2, cur.depth + 1) });
    }
    return;
  }
  if (document.activeElement === svg && arrows[ev.key]) {
    ev.preventDefault();
    setCamera(UI.cam.x + arrows[ev.key][0] * UI.cam.w * 0.1, UI.cam.y + arrows[ev.key][1] * UI.cam.h * 0.1, UI.cam.w);
  }
});

// ---------------------------------------------------------------- header controls

function openShare() {
  const url = location.origin + "/";
  $("share-url").value = url;
  $("share-status").textContent = "";
  $("share-dialog").showModal();
  $("share-url").select();
  navigator.clipboard?.writeText(url).then(
    () => ($("share-status").textContent = "已复制 Copied to clipboard."),
    () => ($("share-status").textContent = "请手动复制上面的链接 Copy the link above by hand."),
  );
}
$("share").addEventListener("click", openShare);

function setMotion(on) {
  UI.motion = on;
  document.body.classList.toggle("motion", on);
  $("motion").setAttribute("aria-pressed", String(on));
  $("motion").title = on ? "动效开 Motion on" : "动效关 Motion off";
  localStorage.setItem("liuru-motion", on ? "on" : "off");
}
$("motion").addEventListener("click", () => {
  setMotion(!UI.motion);
  renderAll();
});
const savedMotion = localStorage.getItem("liuru-motion");
setMotion(savedMotion ? savedMotion === "on" : UI.motion);

if (!localStorage.getItem("liuru-guide")) $("guide").hidden = false;
$("guide-close").addEventListener("click", () => {
  $("guide").hidden = true;
  localStorage.setItem("liuru-guide", "seen");
});

// ---------------------------------------------------------------- lightning

// The lightning (电) is derived from the round's shared timestamp: a quiet
// cue, a gentle flash and a gust, then the same picture. A late joiner past
// the window sees nothing replayed.
function tickStorm() {
  let state = "";
  if (S.round && S.phase === "compose") {
    const dt = now() - S.round.lightningAt;
    if (dt > -5000 && dt < 0) state = "cue";
    else if (dt >= 0 && dt < 1400) state = "flash";
    else if (dt >= 1400 && dt < 5000) state = "gust";
  }
  if (state === UI.storm) return;
  const was = UI.storm;
  UI.storm = state;
  const b = document.body.classList;
  b.toggle("storm-cue", state === "cue" || state === "flash" || state === "gust");
  b.toggle("storm-flash", state === "flash" || state === "gust");
  b.toggle("storm-gust", state === "gust" || state === "flash");
  b.toggle("storm-still", !UI.motion && state !== "");
  if (state === "cue" && was === "") say("远处起风了 A wind is rising in the distance.");
  if (state === "flash") say("电：远处一闪，风过画面 Lightning: a distant flash, and a gust passes through.");
  if (state === "" && was) say("风停了，画面如旧 The wind settles; the picture is as it was.");
}

// ---------------------------------------------------------------- loop

let lastSecond = 0;
function frame(t) {
  if (UI.tour) UI.tour(t);
  if (S.offers.size) renderBubbles();
  if (t - lastSecond > 500) {
    lastSecond = t;
    tickClock();
    tickStorm();
    renderEffects();
    renderRequests();
    if (UI.mode === "receive") renderModebar();
    if (S.phase === "dissolve") $("art").style.opacity = String(Math.max(0, (S.round.dissolveEnd - now()) / (S.round.dissolveEnd - S.round.revealEnd)));
    if (UI.remote.size) renderGhosts();
  }
  requestAnimationFrame(frame);
}

// keep a fitted view fitted when the layout changes (tray collapsing,
// rotating a phone); otherwise keep the same centre and zoom
new ResizeObserver(() => {
  if (UI.fit === "all") fitAll();
  else if (UI.fit === "height") fitHeight();
  else setCamera(UI.cam.x, UI.cam.y, UI.cam.w);
}).observe($("scroll-wrap"));
UI.cam.x = 0;
fitHeight();
connect();
requestAnimationFrame(frame);
