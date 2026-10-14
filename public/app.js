// The live picture. Server state arrives as a snapshot plus a stream of patch
// events over SSE; every durable change goes out as a POST and only shows up
// once the server's event comes back. Pointers and drag previews travel over
// a WebSocket and are never stored. Local state is limited to what this viewer
// is doing right now (selection, a drag in progress). There is no camera:
// everyone sees the whole scene, fitted to the window.
import { animates, bobAt, flicker, motionAt, PARTS, rippleAt } from "./motion.js";
import {
  AGENT,
  ASSET_BASE,
  box,
  bubbleDrift,
  DEPTHS,
  GROUPS,
  imageMarkup,
  INTENTS,
  LIMITS,
  markFor,
  MOTIF_BY_ID,
  MOTIFS,
  moonReflectionTransform,
  paperMarkup,
  PHASES,
  PROMPTS,
  reflectionTransform,
  reflectionWater,
  relations,
  SCENE,
  transformAttr,
  waterSurface,
} from "./shared.js";

const $ = (id) => document.getElementById(id);
const svg = $("scroll");
const stage = $("stage");
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
  companion: null,
  scene: SCENE,
};

const UI = {
  tool: "select",
  mode: "idle", // idle | place | invite | dew | borrow | respond | receive
  motif: null, // tray selection for place / respond
  selected: null, // object id
  ghost: null, // {x, y, ...transform} for borrow / respond / place previews
  respondTo: null, // invitation id
  receiving: null, // offer id
  drag: null,
  local: new Map(), // object id -> transform override while dragging/editing
  cursors: new Map(), // pid -> {x, y, act, motif, objectId, touch, ghost, at, moved}
  showCursors: true,
  view: { x: 0, y: 0, w: SCENE.width, h: SCENE.height },
  motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
  seenRels: new Set(),
  storm: "",
  pointer: null,
  highlight: null, // {id, until} an object a chat message pointed at
};

const now = () => Date.now() + S.offset;
const myPlayer = () => S.players.get(S.me);
const isAgent = (pid) => !!(S.players.get(pid)?.agent || S.companion?.pid === pid);
const markOf = (pid) => {
  if (isAgent(pid)) return AGENT;
  const p = S.players.get(pid);
  return p ? markFor(p.mark) : { glyph: "·", colour: "#62665f" };
};
// The companion is labelled AI everywhere its mark appears.
const markHtml = (pid) => {
  const m = markOf(pid);
  if (isAgent(pid)) return `<span class="mark agent" style="--mark:${m.colour}" title="AI 画伴 companion">${m.glyph}<span class="ai-tag">AI</span></span>`;
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

// Drag and ghost previews ride along with this viewer's cursor on the
// presence socket (see "presence" below); there is no preview POST any more.
function sendPreview() {
  sendCursor(true);
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
  S.companion = snap.companion ?? null;
  setScene(snap.round?.scene ?? SCENE);
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
    // don't sit on a stale scene until the next gap: try again shortly
    setTimeout(resync, 1500);
  }
}

function onChange(e) {
  if (S.resyncing) {
    S.buffered.push(e);
    return;
  }
  if (e.id <= S.cursor) return; // already have it
  if (e.id !== S.cursor + 1 || e.type === "round-started" || e.type === "phase" || e.type === "companion") {
    // a gap (or a round boundary): take a fresh, consistent snapshot
    resync();
    return;
  }
  S.cursor = e.id;
  applyPatch(e.type, e.payload);
}

function applyPatch(type, p) {
  if (type === "chat") {
    onChat(p.message, p.prompt);
    return;
  }
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
        toast(`${markHtml(of.offerer)} 放出一个泡：${motifName(S.objects.get(of.objectId)?.motif ?? "moon")} <span lang="en">offered something in a bubble. Catch it from the list or the picture.</span>`);
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
  source.onerror = () => {
    setConnected(false);
  };
  openPresence();
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
  else loadChat();
  renderOverlay();
  renderTray();
}

// ---------------------------------------------------------------- the view

// No camera: the whole scene is always in view, as large as the window
// allows, centred. The SVG's viewBox is set to the window's own shape so the
// paper ground bleeds out to every edge instead of letterboxing; the scene's
// coordinates stay the same on every screen, so pointers and chat line up.
function fitView() {
  const r = svg.getBoundingClientRect();
  const w = Math.max(1, r.width);
  const h = Math.max(1, r.height);
  const sc = S.scene;
  // keep the floating header, rail, tray and side panels off the picture
  // where there's room for that; on small screens they overlay it
  const pad = insets(w, h);
  // a little paper showing around the picture's edge, where there's room
  const m = Math.min(16, w * 0.012);
  pad.t += m;
  pad.b += m;
  pad.l += m;
  pad.r += m;
  const availW = Math.max(w * 0.5, w - pad.l - pad.r);
  const availH = Math.max(h * 0.5, h - pad.t - pad.b);
  const k = Math.min(availW / sc.width, availH / sc.height);
  const vw = w / k;
  const vh = h / k;
  const cx = (pad.l + availW / 2) / k;
  const cy = (pad.t + availH / 2) / k;
  UI.view = { x: sc.width / 2 - cx, y: sc.height / 2 - cy, w: vw, h: vh, k };
  svg.setAttribute("viewBox", `${UI.view.x} ${UI.view.y} ${vw} ${vh}`);
}

function insets(w, h) {
  // panels that sit above the tray or below the bar follow their real size
  const bar0 = document.querySelector(".bar").getBoundingClientRect();
  const tray0 = document.querySelector(".tray");
  const trayTop = tray0 && getComputedStyle(tray0).display !== "none" ? tray0.getBoundingClientRect().top : h;
  stage.style.setProperty("--bar-b", `${Math.round(bar0.bottom)}px`);
  stage.style.setProperty("--tray-h", `${Math.round(h - trayTop)}px`);
  const box = (sel) => {
    const e = document.querySelector(sel);
    if (!e || e.hidden || getComputedStyle(e).display === "none") return null;
    return e.getBoundingClientRect();
  };
  const bar = box(".bar");
  const tray = box(".tray");
  const rail = box(".rail");
  // portrait phone: the picture sits in the band between the bar and the
  // tools; with the scene's width as the limit, there's height to spare
  if (w < 700) {
    const low = Math.min(tray ? tray.top : h, rail ? rail.top : h);
    return { t: bar ? bar.bottom + 4 : 0, b: h - low + 4, l: 0, r: 0 };
  }
  // short landscape (a phone on its side): bar above, tray below, rail on the
  // left, and the compact request and chat handles on the right
  if (h < 500) {
    const handles = [box(".side-handle"), box(".chat-toggle")].filter(Boolean);
    const r = handles.length ? w - Math.min(...handles.map((x) => x.left)) + 4 : 0;
    return { t: bar ? bar.bottom + 2 : 0, b: tray ? h - tray.top + 2 : 0, l: rail ? rail.right + 4 : 0, r };
  }
  // an open requests panel or chat makes room on a wide screen, rather than
  // covering the right-hand side of the picture
  const side = $("side").classList.contains("open") ? box(".side") : null;
  const chat = !$("chat").classList.contains("collapsed") ? box(".chat") : null;
  const right = w >= 1000 ? Math.max(side ? w - side.left : 0, chat ? w - chat.left : 0) : 0;
  return {
    t: bar ? bar.bottom + 4 : 0,
    b: tray ? h - tray.top + 4 : 0,
    l: rail ? rail.right + 6 : 0,
    r: right ? right + 6 : 0,
  };
}

function setScene(scene) {
  if (scene.width === S.scene.width && scene.height === S.scene.height && $("paper").dataset.w) return;
  S.scene = scene;
  $("paper").dataset.w = String(scene.width);
  $("paper").innerHTML = paperMarkup("s", scene);
  for (const id of ["scene-clip-rect", "sky", "edge"]) {
    $(id).setAttribute("width", scene.width);
    $(id).setAttribute("height", scene.height);
  }
  fitView();
}

function toScene(ev) {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
}

// Is the pointer over one of the floating panels rather than the picture?
const overPanel = (ev) => !!document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".float, .overlay > .card, .modebar");

const onPaper = (p) => p.x >= 0 && p.y >= 0 && p.x <= S.scene.width && p.y <= S.scene.height;

const clampScene = (p) => ({
  x: Math.min(S.scene.width - 1, Math.max(1, p.x)),
  y: Math.min(S.scene.height - 1, Math.max(1, p.y)),
});

function centreOf() {
  return { x: S.scene.width / 2, y: S.scene.height / 2 };
}

// "Show me": with the whole picture in view, pointing replaces panning.
function showAt(x, y, id) {
  UI.highlight = { x, y, id, until: performance.now() + 2600 };
  renderHighlight();
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
  const phaseWas = document.body.dataset.phase;
  for (const ph of Object.keys(PHASES)) document.body.classList.toggle(`phase-${ph}`, S.phase === ph);
  // panels appear and disappear with the phase; refit around them
  if (phaseWas !== S.phase) {
    document.body.dataset.phase = S.phase;
    requestAnimationFrame(fitView);
  }
  renderHeader();
  renderScene();
  renderOverlay();
  renderTray();
  renderInspector();
  renderRequests();
  renderObjectList();
  renderMarks();
  renderCompanion();
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
    compose: "入梦了：选一件景物放上画面 The dream has begun: place a motif.",
    refine: "留一点空白：不再添新景，只调整、借景、传泡 Make room for the scene: no new placements now, only refine, borrow and pass.",
    reveal: "画面定格，已存为梦痕 The picture is frozen and saved as a dream trace.",
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

const objectEls = new Map(); // id -> {g, sig, anim: {whole, parts[], glint, light}}
const cursorEls = new Map(); // pid -> {g, sig, x, y, label}
const CURSOR_IDLE = 6000; // a pointer at rest fades after this long
const LABEL_IDLE = 1800; // and its label sooner

// One motif image, or its separately animated parts stacked in paint order.
function motifInner(o) {
  const m = MOTIF_BY_ID[o.motif];
  const img = (href) => `<image href="${href}" x="${-m.w / 2}" y="${-m.h / 2}" width="${m.w}" height="${m.h}" preserveAspectRatio="none"/>`;
  const def = PARTS[o.motif];
  if (def) return def.parts.map((p, i) => `<g class="part" data-part="${i}">${img(`${ASSET_BASE}parts/${p.id}.svg`)}</g>`).join("");
  let out = img(`${ASSET_BASE}${o.motif}.svg`);
  if (o.motif === "water") out += `<g class="glint">${img(`${ASSET_BASE}parts/water-glint.svg`)}</g>`;
  if (o.motif === "rain") {
    // the veil falls through its own box: two copies, one a box-height above
    out = `<clipPath id="rc${o.id}"><rect x="${-m.w / 2}" y="${-m.h / 2}" width="${m.w}" height="${m.h}"/></clipPath><g clip-path="url(#rc${o.id})"><g class="fall">${img(`${ASSET_BASE}rain.svg`)}<g transform="translate(0 ${-m.h})">${img(`${ASSET_BASE}rain.svg`)}</g></g></g>`;
  }
  return out;
}

// Solid or reflected, the object's placed transform on the outside and a
// `.anim` group inside it that only the animation loop touches.
function objectMarkup(o, byId) {
  const water = o.reflectOn ? byId.get(o.reflectOn) : undefined;
  if (water) {
    return `<g class="reflected" opacity="${Math.round(o.ink * 42) / 100}" transform="${reflectionTransform(o, water)}" filter="url(#s-ripple)"><g class="anim">${motifInner(o)}</g></g>`;
  }
  const far = o.depth === 0 ? ` filter="url(#s-far)"` : "";
  return `<g class="solid" opacity="${o.ink}" transform="${transformAttr(o)}"${far}><g class="anim">${motifInner(o)}</g></g>`;
}

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
      entry = { g: el("g", { class: "obj", "data-id": o.id }), sig: "", anim: null };
      objectEls.set(o.id, entry);
    }
    const layer = layers[o.depth];
    if (entry.g.parentNode !== layer) layer.appendChild(entry.g);
    if (entry.sig !== sig) {
      entry.sig = sig;
      entry.rel = rel;
      entry.g.innerHTML = objectMarkup(o, byId);
      const anim = entry.g.querySelector(".anim");
      entry.anim = {
        whole: anim,
        parts: [...entry.g.querySelectorAll(".part")],
        glint: entry.g.querySelector(".glint"),
        fall: entry.g.querySelector(".fall"),
        last: "",
      };
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
    if (r.type === "lantern-shelter") glows.push(`<circle class="glow" data-for="${a.id}" cx="${a.x}" cy="${a.y}" r="${75 * a.scale}" fill="url(#s-glow)"/>`);
    if (r.type === "boat-water") {
      const bb = box(a);
      const ky = bb.y0 + bb.h * MOTIF_BY_ID[a.motif].keel + 4;
      const dir = a.flip ? 1 : -1;
      wakes.push(`<g class="wake" data-for="${a.id}"><path d="M${a.x + dir * bb.w * 0.45} ${ky} q${dir * 30} 6 ${dir * 70} 2"/><path d="M${a.x + dir * bb.w * 0.4} ${ky + 7} q${dir * 26} 4 ${dir * 52} 1"/></g>`);
    }
    if (r.type === "moon-water") {
      const wb = box(b);
      const s = waterSurface(b);
      moons.push(`<clipPath id="mc${a.id}"><rect x="${wb.x0}" y="${s}" width="${wb.w}" height="${wb.y1 - s}"/></clipPath><g clip-path="url(#mc${a.id})"><g class="moon-refl" data-for="${a.id}" data-surface="${s}"><g opacity="0.45" filter="url(#s-ripple)" transform="${moonReflectionTransform(a, b)}">${imageMarkup("moon")}</g></g></g>`);
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
  // a frozen picture is shown clean
  if (!editable()) UI.selected = null;
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
  // other people's in-progress drags and proposals, faint, carried by their cursors
  const t = performance.now();
  for (const [pid, c] of UI.cursors) {
    const g = c.ghost;
    if (!g || t - c.at > 2500 || !MOTIF_BY_ID[g.motif]) continue;
    out.push(`<g class="ghost-remote" transform="${transformAttr(g)}">${imageMarkup(g.motif)}</g>`);
    out.push(`<circle cx="${g.x}" cy="${g.y}" r="6" fill="${markOf(pid).colour}" opacity="0.7"/>`);
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
    html = `<div class="card"><h2>展纸中…</h2><p class="en" lang="en">Laying out the paper…</p></div>`;
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
      <p>${S.phase === "reveal" ? "展卷：画已定格，存为梦痕。" : "梦散：画面慢慢回到纸上。"}<span lang="en">${S.phase === "reveal" ? "The picture is frozen and saved." : "The picture is fading back into paper."}</span>
      ${S.round ? `<a href="/dreams/${S.round.id}/">梦痕 <span lang="en">Saved dream</span></a>` : ""}</p>
      ${joinedLate ? `<p class="quiet">你可以观看，下一梦再加入。<span lang="en">Watch now; you can join the next dream.</span></p>` : ""}
      ${S.phase === "reveal" && S.objects.size ? `<button type="button" id="tour" aria-pressed="${!!UI.tour}">慢读 <span lang="en">Slow reading</span></button>` : ""}
    </div>`;
  } else if (S.objects.size === 0 && S.phase === "compose" && !UI.motif) {
    ov.classList.add("corner");
    html = `<div class="card"><p>从下方素材匣选一件景物，点在画上。<span lang="en">Choose a motif from your tray below, then tap the picture to place it.</span></p></div>`;
  }
  if (ov.dataset.html !== html) {
    ov.dataset.html = html;
    ov.innerHTML = html;
    ov.hidden = !html;
    $("start")?.addEventListener("click", startRound);
    $("tour")?.addEventListener("click", startTour);
  }
  const btn = $("tour");
  if (btn) btn.setAttribute("aria-pressed", String(!!UI.tour));
  if (btn && UI.tour && !$("tour-caption")) btn.insertAdjacentHTML("afterend", `<p id="tour-caption" class="tour-caption" aria-hidden="true"></p>`);
  if (!UI.tour) $("tour-caption")?.remove();
}

async function startRound() {
  const r = await post("start");
  if (r) resync();
}

// 慢读 Slow reading: the picture is already all in view, so instead of
// panning, a soft pool of light reads it the way a handscroll is read, right
// to left, resting on each thing and naming who brought it. Local to this
// viewer; nothing is sent. With motion off it steps instead of gliding.
function startTour() {
  if (UI.tour) return stopTour();
  const stops = [...S.objects.values()]
    .filter((o) => o.status === "placed")
    .sort((a, b) => b.x - a.x)
    .slice(0, 16);
  if (!stops.length) return;
  const dwell = 1900;
  const t0 = performance.now();
  UI.tour = { stops, t0, dwell, at: -1 };
  renderOverlay();
}

function stopTour() {
  UI.tour = null;
  setHtml("highlight", "");
  renderOverlay();
}

function tickTour(t) {
  const tour = UI.tour;
  if (!tour) return;
  if (S.phase !== "reveal") return stopTour();
  const k = (t - tour.t0) / tour.dwell;
  const i = Math.floor(k);
  if (i >= tour.stops.length) return stopTour();
  const a = tour.stops[i];
  const b = tour.stops[Math.min(tour.stops.length - 1, i + 1)];
  // glide in the last third of each stop, unless motion is off
  const f = UI.motion ? Math.max(0, (k - i - 0.66) / 0.34) : 0;
  const e = 0.5 - Math.cos(Math.PI * f) / 2;
  const x = a.x + (b.x - a.x) * e;
  const y = a.y + (b.y - a.y) * e;
  const r = Math.max(150, Math.max(box(a).w, box(a).h) * 0.75);
  const sc = S.scene;
  setHtml(
    "highlight",
    `<mask id="tour-mask"><rect x="-2000" y="-2000" width="${sc.width + 4000}" height="${sc.height + 4000}" fill="#fff"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="url(#tour-hole)"/></mask>
     <radialGradient id="tour-hole"><stop offset="0.55" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>
     <rect class="tour-veil" x="-2000" y="-2000" width="${sc.width + 4000}" height="${sc.height + 4000}" mask="url(#tour-mask)"/>`,
  );
  if (i !== tour.at) {
    tour.at = i;
    const m = MOTIF_BY_ID[a.motif];
    const by = a.contributor === a.custodian ? markOf(a.contributor).glyph : `${markOf(a.contributor).glyph} → ${markOf(a.custodian).glyph}`;
    say(`${m.zh} ${m.en}: ${by}${isAgent(a.contributor) ? " (AI)" : ""}`);
    const cap = $("tour-caption");
    if (cap) cap.innerHTML = `${markHtml(a.contributor)} ${motifName(a.motif)}`;
  }
}

function renderMarks() {
  const ul = $("marks");
  const items = [...S.players.values()]
    .filter((p) => S.online.has(p.pid) || p.pid === S.me || p.pid === S.companion?.pid)
    .sort((a, b) => a.mark - b.mark)
    .map((p) => `<li class="${S.online.has(p.pid) || isAgent(p.pid) ? "online" : ""}${p.pid === S.me ? " me" : ""}">${markHtml(p.pid)}<span class="visually-hidden">${p.pid === S.me ? "你" : isAgent(p.pid) ? "AI 画伴 companion" : "同梦者"}</span></li>`)
    .join("");
  if (ul.innerHTML !== items) ul.innerHTML = items;
}

// The companion control: invite one when it isn't here, dismiss it when it is.
function renderCompanion() {
  const b = $("companion");
  const open = editable() && !!myPlayer();
  b.hidden = !open;
  const here = !!S.companion;
  const html = here
    ? `<span class="mark agent" style="--mark:${AGENT.colour}">${AGENT.glyph}<span class="ai-tag">AI</span></span> 请画伴离开 <span lang="en">Dismiss the AI companion</span>`
    : `邀请画伴 <span lang="en">Invite an AI companion</span>`;
  if (b.dataset.html !== html) {
    b.dataset.html = html;
    b.innerHTML = html;
  }
  b.classList.toggle("present", here);
}

$("companion").addEventListener("click", async () => {
  const here = !!S.companion;
  const r = await post(here ? "companion/dismiss" : "companion/invite");
  if (r && !here) toast(`${markHtml(r.companion?.pid ?? "")} 画伴来了：它是一个程序，不是人 <span lang="en">The AI companion has joined. It's a program, not a person, and it leaves when the dream ends.</span>`);
});

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
    say(`已选 ${MOTIF_BY_ID[id].zh} ${MOTIF_BY_ID[id].en}: tap the picture to place it, or press Enter to place it in the centre.`);
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
  const at = toScene(ev);
  const over = onPaper(at) && !overPanel(ev);
  UI.ghost = over ? { motif: d.motif, ...at, scale: 1, rotation: 0, flip: false } : null;
  UI.pointer = at;
  sendCursor();
  renderGhosts();
});
$("palette").addEventListener("pointerup", async (ev) => {
  const d = UI.trayDrag;
  UI.trayDrag = null;
  if (!d || !d.active) return;
  UI.trayDragged = true;
  setTimeout(() => (UI.trayDragged = false), 50);
  UI.ghost = null;
  renderGhosts();
  const at = toScene(ev);
  if (onPaper(at) && !overPanel(ev)) await placeAt(d.motif, clampScene(at));
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
  requestAnimationFrame(fitView);
});

// ---------------------------------------------------------------- tools & modes

const MODES = ["place", "invite", "dew", "borrow", "respond", "receive"];

function setTool(tool) {
  UI.tool = tool;
  for (const b of document.querySelectorAll(".tool[data-tool]")) b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
  if (tool === "invite" || tool === "dew") {
    UI.mode = tool;
    UI.motif = null;
    UI.ghost = null;
    UI.selected = null;
  } else if (UI.mode === "invite" || UI.mode === "dew") {
    UI.mode = "idle";
  }
  for (const m of MODES) document.body.classList.toggle(`mode-${m}`, UI.mode === m);
  renderModebar();
}

function resetMode() {
  const had = UI.ghost || UI.mode === "borrow";
  UI.mode = "idle";
  UI.motif = null;
  UI.ghost = null;
  UI.respondTo = null;
  UI.receiving = null;
  setTool("select");
  renderModebar();
  if (had) sendPreview();
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


function renderModebar() {
  const bar = $("modebar");
  let html = "";
  if (UI.mode === "place" && UI.motif) {
    html = `<span>点画面放下${motifName(UI.motif)} <span lang="en">Tap the picture to place it.</span></span>
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
    html = `<span>接住了！点画面放下它（还剩 <span class="lease">${left}</span> 秒） <span lang="en">Caught it: tap the picture to set it down.</span></span>
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
    setSideOpen(false);
    UI.receiving = offerId;
    UI.mode = "receive";
    UI.selected = null;
    const of = S.offers.get(offerId);
    const o = of && S.objects.get(of.objectId);
    if (o) UI.ghost = { motif: o.motif, x: of.origin.x, y: of.origin.y, scale: o.scale, rotation: o.rotation, flip: o.flip };
    for (const m of MODES) document.body.classList.toggle(`mode-${m}`, UI.mode === m);
    say("接住了，八秒内点画面放下 Caught it: tap the picture within eight seconds to set it down.");
    renderModebar();
    renderAll();
  }
}

function beginBorrow(o) {
  setSideOpen(false);
  UI.mode = "borrow";
  UI.ghost = { motif: o.motif, x: Math.min(SCENE.width, o.x + 80), y: o.y, scale: o.scale, rotation: o.rotation, flip: o.flip };
  for (const m of MODES) document.body.classList.toggle(`mode-${m}`, UI.mode === m);
  sendPreview();
  renderModebar();
  renderAll();
}

function beginRespond(inv) {
  setSideOpen(false);
  UI.mode = "respond";
  UI.respondTo = inv.id;
  UI.motif = null;
  UI.ghost = null;
  UI.selected = null;
  for (const m of MODES) document.body.classList.toggle(`mode-${m}`, UI.mode === m);
  showAt(inv.x, inv.y);
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
  const p = toScene(ev);
  UI.pointer = p;
  UI.touching = ev.pointerType !== "mouse";
  UI.pointerType = ev.pointerType;
  sendCursor(true);
  svg.setPointerCapture(ev.pointerId);
  const base = { x0: ev.clientX, y0: ev.clientY, p0: p, moved: false };
  if (!editable()) {
    UI.drag = { type: "look", ...base };
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
  UI.drag = { type: "look", deselect: true, ...base };
});

svg.addEventListener("pointermove", (ev) => {
  const p = toScene(ev);
  UI.pointer = p;
  UI.pointerType = ev.pointerType;
  // a touch point is only shown to others while the finger is down
  if (ev.pointerType === "mouse" || UI.drag) sendCursor();
  if (UI.mode === "dew") renderGhosts();
  if ((UI.mode === "place" || UI.mode === "receive") && UI.motif !== undefined && ev.pointerType === "mouse") {
    const motif = UI.mode === "place" ? UI.motif : UI.ghost?.motif;
    if (motif && onPaper(p)) {
      UI.ghost = { ...(UI.ghost ?? { scale: 1, rotation: 0, flip: false }), motif, ...clampScene(p) };
      renderGhosts();
    }
  }
  const d = UI.drag;
  if (!d) return;
  if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) > 6) d.moved = true;
  if (!d.moved) return;
  if (d.type === "move") {
    const o = S.objects.get(d.id);
    if (!o) return;
    const at = clampScene({ x: p.x + d.dx, y: p.y + d.dy });
    UI.local.set(d.id, at);
    UI.selected = d.id;
    sendPreview();
    renderScene();
  } else if (d.type === "ghost" && UI.ghost) {
    Object.assign(UI.ghost, clampScene({ x: p.x + d.dx, y: p.y + d.dy }));
    sendPreview();
    renderGhosts();
  }
});

svg.addEventListener("pointerup", async (ev) => {
  const d = UI.drag;
  UI.drag = null;
  if (UI.touching) {
    UI.touching = false;
    sendLeave();
  }
  if (!d) return;
  const raw = toScene(ev);
  const p = clampScene(raw);
  if (d.type === "move") {
    const o = S.objects.get(d.id);
    UI.selected = d.id;
    if (!d.moved) openSide();
    if (d.moved && o) {
      const at = UI.local.get(d.id);
      sendPreview();
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
  if (d.type === "look" && d.deselect) {
    UI.selected = null;
    renderAll();
    return;
  }
  if (d.type === "tap") {
    // the paper bleeds past the scene's edge; a tap out there isn't on the picture
    if (!onPaper(raw) && UI.mode !== "borrow" && UI.mode !== "respond") {
      toast("点在画纸之内 <span lang=\"en\">Tap inside the picture's edge.</span>", false);
      return;
    }
    if (UI.mode === "place" && UI.motif) await placeAt(UI.motif, p);
    else if (UI.mode === "invite") openIntent(p);
    else if (UI.mode === "dew") await dewAt(p);
    else if (UI.mode === "receive") await receiveAt(p);
    else if ((UI.mode === "borrow" || UI.mode === "respond") && UI.ghost) {
      Object.assign(UI.ghost, p);
      sendPreview();
      renderGhosts();
    }
  }
});

svg.addEventListener("pointercancel", () => {
  UI.drag = null;
  if (UI.touching) {
    UI.touching = false;
    sendLeave();
  }
});

svg.addEventListener("pointerleave", (ev) => {
  UI.pointer = null;
  if (ev.pointerType === "mouse") sendLeave();
  if (UI.mode === "place" && UI.ghost) {
    UI.ghost = null;
    renderGhosts();
  }
});

// The page itself never scrolls or zooms with the wheel or a pinch: the whole
// picture is already in view.
svg.addEventListener("wheel", (ev) => ev.preventDefault(), { passive: false });

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
  renderChatAbout();
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
        <button type="button" data-act="offer" ${S.online.size > 1 || S.companion ? "" : "disabled"}>放入泡中 <span lang="en">Offer in a bubble</span></button>
        <button type="button" data-act="withdraw">收回 <span lang="en">Withdraw</span></button>
      </div>
      ${reflectReason && !o.reflectOn ? `<p class="reason">${reflectReason}</p>` : ""}
      ${S.online.size > 1 || S.companion ? "" : `<p class="reason">有别人在场时才能传泡。<span lang="en">Bubbles need someone else here to catch them.</span></p>`}
      <p class="reason">方向键微移，+/− 调大小，[ ] 调远近，Esc 取消。<span lang="en">Arrow keys nudge, +/− resize, [ ] change depth, Esc deselects.</span></p>`;
  } else if (!mine && can) {
    controls = pendingBorrow
      ? `<p class="reason">已有人提议借景，等待回应。<span lang="en">A move has already been suggested; waiting for an answer.</span></p>`
      : `<div class="row"><button type="button" data-act="borrow">借景 <span lang="en">Suggest a move</span></button></div>
         <p class="reason">放一个虚影，对方同意后才会移动，并改由你照看。<span lang="en">Place a ghost; it only moves if they agree, and then it's in your care.</span></p>`;
  } else if (o.status === "offered") {
    controls = `<p class="reason">它正在泡里，等人接住。<span lang="en">It's floating in a bubble, waiting to be caught.</span></p>`;
  } else if (!editable()) {
    controls = `<p class="reason">画面已定，只能看。<span lang="en">The picture is frozen: look only.</span></p>`;
  }
  sec.innerHTML = `
    <button type="button" class="close" data-act="deselect" aria-label="关闭 Close">×</button>
    <h2 id="insp-title">${m.zh} <span lang="en">${m.en}</span></h2>
    <button type="button" class="chat-about-btn" data-act="chat-about">谈谈这件 <span lang="en">Say something about this</span></button>
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
  if (b.dataset.act === "chat-about") {
    setChatOpen(true);
    renderChatAbout();
    $("chat-input").focus();
    return;
  }
  if (b.dataset.act === "deselect") {
    UI.selected = null;
    setSideOpen(false);
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
  const people = [...S.online].filter((pid) => !isAgent(pid)).length;
  const alone = S.round && editable() && people <= 1 && !S.companion;
  if (alone) {
    items.push(`<p class="quiet">现在只有你。可以分享链接，或请一位 AI 画伴来。<button type="button" data-share>邀人同梦 <span lang="en">Share the link</span></button><br><span lang="en">You're the only one here. Share the link, or invite the AI companion from the top bar.</span></p>`);
  }
  const waiting = [...S.proposals.values()].filter((p) => p.target === S.me).length + [...S.offers.values()].filter((o) => o.status === "floating" && o.offerer !== S.me).length;
  $("req-count").textContent = waiting ? String(waiting) : "";
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
    showAt(x, y);
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
    ul.innerHTML = html || `<li class="quiet">画上还是空的。<span lang="en">The picture is still empty.</span></li>`;
  }
}

$("object-list").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-obj]");
  if (!b) return;
  UI.selected = Number(b.dataset.obj);
  const o = S.objects.get(UI.selected);
  if (o) showAt(o.x, o.y, o.id);
  renderAll();
  $("inspector").querySelector("button, input")?.focus();
});

function openSide() {
  setSideOpen(true);
}

function setSideOpen(open) {
  $("side").classList.toggle("open", open);
  $("side-handle").setAttribute("aria-expanded", String(open));
  fitView();
}
$("side-handle").addEventListener("click", () => setSideOpen(!$("side").classList.contains("open")));

// on phones the side column is a sheet: tapping its heading opens/closes it


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
  // with nothing selected, arrow keys step through the objects in the
  // picture (left to right), so a keyboard can reach every one
  if (document.activeElement === svg && arrows[ev.key] && S.objects.size) {
    ev.preventDefault();
    const list = [...S.objects.values()].filter((x) => x.status === "placed").sort((a, b) => a.x - b.x || a.y - b.y);
    if (!list.length) return;
    const i = list.findIndex((x) => x.id === UI.selected);
    const next = list[(i + (arrows[ev.key][0] + arrows[ev.key][1] >= 0 ? 1 : -1) + list.length) % list.length];
    UI.selected = next.id;
    showAt(next.x, next.y, next.id);
    renderAll();
    say(`${MOTIF_BY_ID[next.motif].zh} ${MOTIF_BY_ID[next.motif].en}${next.custodian === S.me ? " 你的 yours" : ""}`);
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
  animate(now());
});
const savedMotion = localStorage.getItem("liuru-motion");
setMotion(savedMotion ? savedMotion === "on" : UI.motion);
// the OS setting changing mid-session wins over a stale saved choice
matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
  setMotion(!e.matches);
  animate(now());
});

function setShowCursors(on) {
  UI.showCursors = on;
  $("cursors-toggle").setAttribute("aria-pressed", String(on));
  localStorage.setItem("liuru-cursors", on ? "on" : "off");
  renderCursors();
}
$("cursors-toggle").addEventListener("click", () => setShowCursors(!UI.showCursors));
setShowCursors(localStorage.getItem("liuru-cursors") !== "off");

// Full screen, where the browser has it (not iPhone Safari).
if (document.fullscreenEnabled && stage.requestFullscreen) {
  $("fullscreen").hidden = false;
  $("fullscreen").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener("fullscreenchange", () => {
    $("fullscreen").setAttribute("aria-pressed", String(!!document.fullscreenElement));
    fitView();
  });
}

// Close the overflow menu after picking something from it.
document.querySelector(".menu").addEventListener("click", (ev) => {
  if (ev.target.closest("button, a")) document.querySelector(".menu").open = false;
});

if (!localStorage.getItem("liuru-guide")) $("guide").hidden = false;

// A portrait phone shows the whole picture, but small: suggest turning it.
const portrait = matchMedia("(orientation: portrait) and (max-width: 700px)");
function renderTurnHint() {
  $("turn-hint").hidden = !portrait.matches || localStorage.getItem("liuru-turn") === "seen";
}
portrait.addEventListener("change", () => {
  renderTurnHint();
  fitView();
});
$("turn-hint").addEventListener("click", () => {
  localStorage.setItem("liuru-turn", "seen");
  renderTurnHint();
});
renderTurnHint();
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

// ---------------------------------------------------------------- presence

// One WebSocket carries this viewer's pointer (in scene units, so it lines up
// on any screen) and whatever it's holding or dragging, ~16 times a second at
// most. The server batches everyone's and sends them back; nothing is stored.
let sock;
let sockRetry = 500;
let lastSent = 0;
let sendTimer;
let lastPayload = "";

function openPresence() {
  if (sock && sock.readyState <= 1) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  sock = new WebSocket(`${proto}://${location.host}/api/presence`);
  sock.addEventListener("open", () => {
    sockRetry = 500;
    lastPayload = "";
  });
  sock.addEventListener("message", (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.t !== "cur") return;
    const t = performance.now();
    for (const c of m.c ?? []) {
      const was = UI.cursors.get(c.pid);
      const moved = !was || Math.hypot(was.x - c.x, was.y - c.y) > 2 || was.act !== c.act || was.objectId !== c.objectId;
      UI.cursors.set(c.pid, { ...c, at: t, moved: moved ? t : (was?.moved ?? t) });
    }
    for (const pid of m.gone ?? []) UI.cursors.delete(pid);
    renderCursors();
    renderGhosts();
  });
  sock.addEventListener("close", () => {
    UI.cursors.clear();
    renderCursors();
    // back off and retry, the same as the event stream does
    setTimeout(openPresence, sockRetry);
    sockRetry = Math.min(10_000, sockRetry * 2);
  });
}

// What this viewer is doing, for the label on its cursor elsewhere.
function activity() {
  if (UI.drag?.type === "move") return { act: "drag", objectId: UI.drag.id, motif: S.objects.get(UI.drag.id)?.motif };
  if (UI.mode === "borrow") return { act: "borrow", objectId: UI.selected, motif: UI.ghost?.motif };
  if (UI.mode === "place" && UI.motif) return { act: "hold", motif: UI.motif };
  if (UI.mode === "respond" && UI.motif) return { act: "respond", motif: UI.motif };
  if (UI.mode === "receive") return { act: "receive", motif: UI.ghost?.motif };
  if (UI.mode === "dew") return { act: "dew" };
  if (UI.mode === "invite") return { act: "invite" };
  return { act: "" };
}

function ghostPayload() {
  if (UI.drag?.type === "move") {
    const o = S.objects.get(UI.drag.id);
    const at = UI.local.get(UI.drag.id);
    if (o && at) return { motif: o.motif, x: at.x, y: at.y, scale: o.scale, rotation: o.rotation, flip: o.flip, objectId: o.id };
  }
  if ((UI.mode === "borrow" || UI.mode === "respond") && UI.ghost?.motif) {
    const g = UI.ghost;
    return { motif: g.motif, x: g.x, y: g.y, scale: g.scale, rotation: g.rotation, flip: g.flip, objectId: UI.mode === "borrow" ? UI.selected : undefined };
  }
  return undefined;
}

function sendCursor(force = false) {
  if (!sock || sock.readyState !== 1) return;
  const p = UI.pointer ?? (UI.ghost ? { x: UI.ghost.x, y: UI.ghost.y } : null);
  if (!p) return;
  const t = performance.now();
  // ~16 Hz: anything sooner waits for a trailing send, so the last position always goes out
  if (!force && t - lastSent < 60) {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => sendCursor(true), 60 - (t - lastSent));
    return;
  }
  const hover = UI.pointer ? hitObject(UI.pointer) : undefined;
  const a = activity();
  const msg = {
    t: "c",
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
    act: a.act,
    motif: a.motif,
    objectId: a.objectId ?? hover?.id,
    touch: UI.pointerType !== "mouse" || undefined,
    ghost: ghostPayload(),
  };
  const payload = JSON.stringify(msg);
  if (payload === lastPayload) return;
  lastPayload = payload;
  lastSent = t;
  sock.send(payload);
}

function sendLeave() {
  clearTimeout(sendTimer);
  lastPayload = "";
  if (sock?.readyState === 1) sock.send('{"t":"leave"}');
}

// "梅 · 松 Pine (竹's)", "竹 · holding 舟 Boat", "云 · empty paper".
function cursorLabel(pid, c) {
  const who = markOf(pid).glyph + (isAgent(pid) ? " AI" : "");
  const name = (id) => `${MOTIF_BY_ID[id].zh} ${MOTIF_BY_ID[id].en}`;
  const whose = (o) => (o.custodian === pid ? "" : o.custodian === S.me ? " (yours)" : ` (${markOf(o.custodian).glyph}'s)`);
  const o = c.objectId ? S.objects.get(c.objectId) : undefined;
  switch (c.act) {
    case "hold":
      return `${who} · holding ${c.motif ? name(c.motif) : ""}`;
    case "respond":
      return `${who} · answering with ${c.motif ? name(c.motif) : ""}`;
    case "drag":
      return `${who} · moving ${o ? name(o.motif) : c.motif ? name(c.motif) : ""}`;
    case "borrow":
      return `${who} · suggesting a move${o ? `: ${name(o.motif)}${whose(o)}` : ""}`;
    case "receive":
      return `${who} · setting down ${c.motif ? name(c.motif) : "a bubble"}`;
    case "dew":
      return `${who} · aiming dew`;
    case "invite":
      return `${who} · leaving an opening`;
  }
  if (o) return `${who} · ${name(o.motif)}${whose(o)}`;
  const sc = S.scene;
  if (c.x < 0 || c.y < 0 || c.x > sc.width || c.y > sc.height) return `${who} · beyond the edge`;
  return `${who} · empty paper`;
}


// Keyed elements, one per person; each frame eases the drawn position toward
// the last reported one, so 16 Hz updates still glide. Rebuilt only when the
// label or shape changes.

function renderCursors() {
  const layer = $("cursors");
  const t = performance.now();
  const hide = !UI.showCursors || S.phase === "reveal" || S.phase === "dissolve";
  const k = UI.view.k || 1;
  const size = 1 / k; // screen-sized whatever the scene's drawn size
  const seen = new Set();
  if (!hide) {
    for (const [pid, c] of UI.cursors) {
      if (pid === S.me) continue;
      const idle = t - c.moved;
      if (idle > CURSOR_IDLE + 1500) continue;
      seen.add(pid);
      const fade = idle < CURSOR_IDLE ? 1 : Math.max(0, 1 - (idle - CURSOR_IDLE) / 1500);
      const labelOn = idle < LABEL_IDLE || !!c.act;
      const m = markOf(pid);
      const agent = isAgent(pid);
      const label = cursorLabel(pid, c);
      const width = Math.max(30, label.length * 7.4 + 14);
      // keep the label on screen: near the right edge it hangs to the left
      const flipLabel = (c.x - UI.view.x) * k + (width + 30) > (UI.view.w * k) - 8;
      const sig = [label, c.touch, agent, m.colour, flipLabel].join("|");
      let e = cursorEls.get(pid);
      if (!e) {
        e = { g: el("g", { class: "cursor", "data-pid": pid }), sig: "", x: c.x, y: c.y };
        cursorEls.set(pid, e);
        layer.appendChild(e.g);
      }
      if (e.sig !== sig) {
        e.sig = sig;
        const shape = c.touch
          ? `<circle r="13" fill="${m.colour}" fill-opacity="0.18" stroke="${m.colour}" stroke-width="2"/>`
          : `<path d="M0 0 L0 17 L4.6 12.8 L8 20 L11 18.6 L7.8 11.6 L14 11.4 Z" fill="${m.colour}" stroke="#fbf6ec" stroke-width="1.4" stroke-linejoin="round"${agent ? ' stroke-dasharray="3 2"' : ""}/>`;
        const lx = flipLabel ? -(width + 6) : c.touch ? 16 : 15;
        e.g.innerHTML = `${shape}<g class="cursor-label" transform="translate(${lx} ${c.touch ? -10 : 20})">
          <rect class="cursor-tag${agent ? " agent" : ""}" x="0" y="-13" rx="4" height="20" width="${width}" fill="${m.colour}"/>
          <text x="7" y="2"></text></g>`;
        e.g.querySelector("text").textContent = label;
        e.label = e.g.querySelector(".cursor-label");
      }
      // glide: most of the way each frame, snapping when it's close
      const ease = UI.motion ? 0.35 : 1;
      e.x += (c.x - e.x) * ease;
      e.y += (c.y - e.y) * ease;
      if (Math.abs(c.x - e.x) < 0.5) e.x = c.x;
      if (Math.abs(c.y - e.y) < 0.5) e.y = c.y;
      e.g.setAttribute("transform", `translate(${e.x.toFixed(1)} ${e.y.toFixed(1)}) scale(${size.toFixed(4)})`);
      e.g.setAttribute("opacity", fade.toFixed(2));
      e.label.setAttribute("opacity", labelOn ? "1" : "0");
    }
  }
  for (const [pid, e] of cursorEls) {
    if (seen.has(pid)) continue;
    e.g.remove();
    cursorEls.delete(pid);
  }
}

// ---------------------------------------------------------------- chat

const CHAT = { max: 300, about: null, oldest: null, more: false, unread: 0, prompts: {}, ids: new Set() };

function chatTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Plain text only: every message is set with textContent, never as HTML.
function chatItem(m) {
  const li = document.createElement("li");
  li.className = "chat-msg" + (m.pid === S.me ? " mine" : "");
  li.dataset.id = m.id;
  li.dataset.round = m.round ?? "";
  const mark = m.mark === null ? { glyph: "客", colour: "#7d7f76" } : markFor(m.mark);
  const chip = document.createElement("span");
  chip.className = "mark";
  chip.style.setProperty("--mark", mark.colour);
  chip.textContent = mark.glyph;
  chip.title = m.pid === S.me ? "你 you" : "";
  const time = document.createElement("time");
  time.dateTime = new Date(m.at).toISOString();
  time.textContent = chatTime(m.at);
  const text = document.createElement("span");
  text.className = "text";
  text.textContent = m.body;
  li.append(chip, " ", time, " ", text);
  if (m.objectId) {
    const a = document.createElement("button");
    a.type = "button";
    a.className = "about-link";
    a.dataset.object = m.objectId;
    const motif = MOTIF_BY_ID[m.objectMotif];
    a.textContent = motif ? `↗ ${motif.zh} ${motif.en.toLowerCase()}` : "↗";
    a.title = "在画中指出 Show it in the picture";
    li.append(" ", a);
  }
  return li;
}

function roundHeading(round, promptIndex) {
  const li = document.createElement("li");
  li.className = "chat-round";
  li.dataset.roundHead = round ?? "";
  const pr = promptIndex !== undefined && promptIndex !== null ? PROMPTS[promptIndex] : null;
  li.textContent = round === null ? "入梦之前 Before the first dream" : `第 ${round} 梦 Dream ${round}${pr ? ` · ${pr.zh}` : ""}`;
  return li;
}

function insertMessages(msgs, prompts, atTop) {
  const log = $("chat-log");
  const frag = document.createDocumentFragment();
  let lastRound = atTop ? undefined : log.lastElementChild?.dataset.round;
  for (const m of msgs) {
    if (CHAT.ids.has(m.id)) continue;
    CHAT.ids.add(m.id);
    const r = String(m.round ?? "");
    if (r !== lastRound) {
      frag.append(roundHeading(m.round, prompts?.[m.round]));
      lastRound = r;
    }
    frag.append(chatItem(m));
  }
  if (atTop) {
    // drop a now-duplicated heading where the older page meets the newer one
    const first = log.firstElementChild;
    if (first?.classList.contains("chat-round") && frag.lastChild && frag.lastChild.dataset.round === first.nextElementSibling?.dataset.round) first.remove();
    log.prepend(frag);
  } else {
    log.append(frag);
  }
}

async function loadChat(before) {
  try {
    const res = await fetch(`/api/chat${before ? `?before=${before}` : ""}`, { cache: "no-store" });
    const page = await res.json();
    if (!before) {
      $("chat-log").innerHTML = "";
      CHAT.ids.clear();
    }
    const log = $("chat-log");
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const height = log.scrollHeight;
    insertMessages(page.messages, page.prompts, !!before);
    CHAT.oldest = page.messages[0]?.id ?? CHAT.oldest;
    CHAT.more = page.more;
    $("chat-older").hidden = !page.more;
    if (before) log.scrollTop = log.scrollHeight - height;
    else if (stick || !before) log.scrollTop = log.scrollHeight;
    renderChatExport();
  } catch {
    // the next reconnect reloads it
  }
}

function onChat(m, promptIndex) {
  if (!m || CHAT.ids.has(m.id)) return;
  const log = $("chat-log");
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  insertMessages([m], { [m.round]: promptIndex }, false);
  if (stick) log.scrollTop = log.scrollHeight;
  if ($("chat").classList.contains("collapsed") && m.pid !== S.me) {
    CHAT.unread++;
    $("chat-unread").textContent = String(CHAT.unread);
    toast(`${markHtml(m.pid)} ${escapeText(m.body.length > 60 ? `${m.body.slice(0, 60)}…` : m.body)}`, false);
  }
}

$("chat-older").addEventListener("click", () => loadChat(CHAT.oldest));

$("chat-log").addEventListener("click", (ev) => {
  const b = ev.target.closest(".about-link");
  if (!b) return;
  const o = S.objects.get(Number(b.dataset.object));
  if (o) showAt(o.x, o.y, o.id);
  else toast("那件已不在画中 <span lang=\"en\">That object isn't in the picture any more.</span>");
});

function setChatOpen(open) {
  $("chat").classList.toggle("collapsed", !open);
  $("chat-toggle").setAttribute("aria-expanded", String(open));
  if (open) {
    CHAT.unread = 0;
    $("chat-unread").textContent = "";
    const log = $("chat-log");
    log.scrollTop = log.scrollHeight;
  }
  localStorage.setItem("liuru-chat", open ? "open" : "closed");
  fitView();
}
$("chat-toggle").addEventListener("click", () => setChatOpen($("chat").classList.contains("collapsed")));
setChatOpen(localStorage.getItem("liuru-chat") === "open" && innerWidth > 900);

// "About this": the selected object rides along with the next message.
function renderChatAbout() {
  const o = UI.selected && S.objects.get(UI.selected);
  CHAT.about = o ? o.id : null;
  const p = $("chat-about");
  p.hidden = !o;
  if (o) p.textContent = `关于 about: ${MOTIF_BY_ID[o.motif].zh} ${MOTIF_BY_ID[o.motif].en.toLowerCase()} (×)`;
}
$("chat-about").addEventListener("click", () => {
  UI.selected = null;
  renderAll();
});

$("chat-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;
  if ([...text].length > CHAT.max) {
    toast(`最多 ${CHAT.max} 字 <span lang="en">Up to ${CHAT.max} characters.</span>`);
    return;
  }
  const body = { text };
  if (CHAT.about) body.objectId = CHAT.about;
  input.disabled = true;
  const r = await post("chat", body);
  input.disabled = false;
  if (r) {
    input.value = "";
    if (CHAT.about) {
      UI.selected = null;
      renderAll();
    }
  }
  input.focus();
});

function renderChatExport() {
  const p = $("chat-export-round");
  const id = S.round?.id;
  const html = id
    ? `这一梦 <span lang="en">This dream</span>: <a href="/api/chat/export?format=md&amp;round=${id}" download>Markdown</a> · <a href="/api/chat/export?format=txt&amp;round=${id}" download>Text</a> · <a href="/api/chat/export?format=json&amp;round=${id}" download>JSON</a>`
    : "";
  if (p.dataset.html !== html) {
    p.dataset.html = html;
    p.innerHTML = html;
  }
}

// ---------------------------------------------------------------- the living picture

// Called every frame while motion is on (and once when it's switched off, to
// settle everything to rest). Only transforms and opacity change; nothing is
// rebuilt, and the placed position underneath never moves.
let restApplied = false;
function animate(t) {
  const still = !UI.motion;
  if (still && restApplied) return;
  restApplied = still;
  const ctx = { width: S.scene.width, lightningAt: S.round?.lightningAt };
  for (const [id, e] of objectEls) {
    if (!e.anim) continue;
    const o = S.objects.get(id);
    if (!o || UI.drag?.id === id) continue;
    const a = e.anim;
    if (still) {
      if (a.last) {
        a.whole.removeAttribute("transform");
        a.whole.removeAttribute("opacity");
        for (const p of a.parts) p.removeAttribute("transform");
        a.fall?.removeAttribute("transform");
        a.glint?.removeAttribute("transform");
        a.last = "";
      }
      continue;
    }
    if (e.rel === "boat-water") {
      const b = bobAt(o, t, ctx);
      a.whole.setAttribute("transform", b.whole);
      a.last = "bob";
      continue;
    }
    if (!animates(o.motif)) continue;
    const m = motionAt(o, t, ctx, e.rel);
    if (!m) continue;
    a.last = "m";
    if (m.whole) a.whole.setAttribute("transform", m.whole);
    else a.whole.removeAttribute("transform");
    if (m.opacity !== undefined) a.whole.setAttribute("opacity", m.opacity);
    for (let i = 0; i < a.parts.length; i++) {
      const tf = m.parts[i];
      if (tf) a.parts[i].setAttribute("transform", tf);
    }
    if (m.flicker !== undefined && a.parts[0]) a.parts[0].setAttribute("opacity", m.flicker);
    if (a.glint && m.parts.glint) {
      a.glint.setAttribute("transform", m.parts.glint);
      a.glint.setAttribute("opacity", m.glintOpacity);
    }
    if (a.fall && m.fall !== undefined) a.fall.setAttribute("transform", `translate(0 ${m.fall})`);
  }
  // relationship effects breathe with the same clock
  for (const g of $("glows").children) {
    const o = S.objects.get(Number(g.dataset.for));
    if (o) g.setAttribute("opacity", still ? "" : String(Math.min(1, flicker(o, t) + 0.1)));
  }
  for (const w of $("wakes").children) {
    const o = S.objects.get(Number(w.dataset.for));
    if (o) w.setAttribute("opacity", still ? "" : String(bobAt(o, t, ctx).wake + 0.2));
  }
  for (const r of $("moonrefl").querySelectorAll(".moon-refl")) {
    const o = S.objects.get(Number(r.dataset.for));
    if (!o) continue;
    if (still) r.removeAttribute("transform");
    else r.setAttribute("transform", rippleAt(o, t, ctx, Number(r.dataset.surface)));
  }
}

// The chat's object pointer, and "Show" in the requests list: a ring that
// breathes for a couple of seconds where the thing is.
function renderHighlight() {
  if (UI.tour) return;
  const h = UI.highlight;
  if (!h || performance.now() > h.until) {
    UI.highlight = null;
    setHtml("highlight", "");
    return;
  }
  const o = h.id ? S.objects.get(h.id) : undefined;
  const b = o ? box(o) : { x0: h.x - 60, y0: h.y - 60, w: 120, h: 120 };
  const r = Math.max(60, Math.hypot(b.w, b.h) / 2 + 20);
  setHtml("highlight", `<circle class="highlight-ring" cx="${(b.x0 + b.w / 2).toFixed(1)}" cy="${(b.y0 + b.h / 2).toFixed(1)}" r="${r.toFixed(1)}"/>`);
}

// ---------------------------------------------------------------- loop

let lastSecond = 0;
let lastCursorFrame = 0;
function frame(t) {
  const st = now();
  animate(st);
  tickTour(t);
  if (S.offers.size) renderBubbles();
  if (UI.cursors.size || cursorEls.size) renderCursors();
  if (t - lastCursorFrame > 100) {
    lastCursorFrame = t;
    if (UI.highlight) renderHighlight();
  }
  if (t - lastSecond > 500) {
    lastSecond = t;
    tickClock();
    tickStorm();
    renderEffects();
    renderRequests();
    if (UI.mode === "receive") renderModebar();
    if (S.phase === "dissolve") $("art").style.opacity = String(Math.max(0, (S.round.dissolveEnd - now()) / (S.round.dissolveEnd - S.round.revealEnd)));
    if (UI.cursors.size) renderGhosts();
  }
  // rAF already stops while the tab is hidden; nothing else keeps it running
  requestAnimationFrame(frame);
}

// Keep the whole picture fitted as the window or the panels change.
new ResizeObserver(() => fitView()).observe(svg);
for (const id of ["tray", "side", "chat"]) new ResizeObserver(() => fitView()).observe($(id));
fitView();
connect();
requestAnimationFrame(frame);
