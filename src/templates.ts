import { AGENT_MARK, markFor, paperMarkup, PROMPTS, SCENE, sceneDefs, sceneMarkup } from "../public/shared.js";
import type { ChatMessage } from "./chat.ts";
import { type ArchiveRow, sceneOf, type Scene } from "./game.ts";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const head = (title: string): string => `<meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(title)}</title>
    <link rel="icon" href="/static/motifs/seal.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/static/site.css" />`;

const siteNav = `<header class="page-bar">
      <a class="brand" href="/"><img src="/static/motifs/seal.svg" alt="" width="28" height="28" /><span>六如 · 共梦长卷</span></a>
      <nav aria-label="站内 Site">
        <a href="/">画卷 <span lang="en">Scroll</span></a>
        <a href="/how/">玩法 <span lang="en">How to play</span></a>
        <a href="/dreams/">梦痕 <span lang="en">Dream archive</span></a>
        <a href="/readme/">关于 <span lang="en">About</span></a>
      </nav>
    </header>`;

/** A reading page (README, decision record, credits, archive). */
export function renderPage(title: string, body: string, extra = ""): string {
  return `<!doctype html>
<html lang="zh-Hans">
  <head>
    ${head(title)}
  </head>
  <body class="page">
    ${siteNav}
    <main class="prose">
${body}
    </main>
    ${extra}
  </body>
</html>
`;
}

export function renderApp(): string {
  // The scene's viewBox is set per round by the client; it starts at the
  // current size so the first paint has the right proportions.
  return `<!doctype html>
<html lang="zh-Hans">
  <head>
    ${head("六如 · 共梦图 — A Shared Dream Picture")}
    <link rel="stylesheet" href="/static/app.css" />
    <link rel="modulepreload" href="/static/shared.js" />
    <link rel="modulepreload" href="/static/motion.js" />
  </head>
  <body class="app loading">
    <a class="skip" href="#scroll">跳到画面 <span lang="en">Skip to the picture</span></a>

    <main class="stage" id="stage">
      <svg id="scroll" class="scroll" tabindex="0" role="img" aria-roledescription="画面 picture" aria-label="共梦图：共享画面 The shared picture" preserveAspectRatio="none" viewBox="0 0 ${SCENE.width} ${SCENE.height}">
        <defs id="defs">${sceneDefs("s")}<clipPath id="s-scene-clip"><rect id="scene-clip-rect" width="${SCENE.width}" height="${SCENE.height}"/></clipPath></defs>
        <g id="world">
          <rect id="bleed" class="bleed" x="-2000" y="-2000" width="${SCENE.width + 4000}" height="${SCENE.height + 4000}"/>
          <rect id="bleed-grain" x="-2000" y="-2000" width="${SCENE.width + 4000}" height="${SCENE.height + 4000}" filter="url(#s-grain)"/>
          <g id="paper">${paperMarkup("s")}</g>
          <rect id="edge" class="edge" width="${SCENE.width}" height="${SCENE.height}"/>
          <g id="art" clip-path="url(#s-scene-clip)">
            <g id="glows"></g>
            <g id="layer-0"></g>
            <g id="layer-1"></g>
            <g id="layer-2"></g>
            <g id="moonrefl"></g>
          </g>
          <g id="dewfx"></g>
          <g id="wakes"></g>
          <g id="shadows"></g>
          <g id="reserved"></g>
          <g id="invites"></g>
          <g id="ghosts"></g>
          <g id="bubbles"></g>
          <g id="highlight"></g>
          <g id="selection"></g>
          <rect id="sky" width="${SCENE.width}" height="${SCENE.height}" fill="url(#s-sky)" pointer-events="none" opacity="0"/>
          <g id="cursors" aria-hidden="true"></g>
        </g>
      </svg>

      <header class="bar float">
        <h1 class="brand-h"><a class="brand" href="/">
          <img src="/static/motifs/seal.svg" alt="六如" width="30" height="30" />
          <span class="title"><span class="zh">共梦图</span><span class="en" lang="en">A Shared Dream</span></span>
        </a></h1>
        <div class="dream" aria-live="off">
          <p class="prompt"><span id="prompt-zh" class="zh">……</span> <span id="prompt-en" class="en" lang="en"></span></p>
          <p class="phase-line"><span id="phase">连接中 <span lang="en">Connecting</span></span> <span id="clock" class="clock"></span></p>
        </div>
        <nav class="links" aria-label="站内 Site">
          <ul id="marks" class="marks" aria-label="此刻在场 Here now"></ul>
          <span id="conn" class="conn" title="连接 Connection"><span class="dot"></span><span id="conn-text" class="visually-hidden">连接中</span></span>
          <button id="companion" type="button" class="companion-btn" hidden>邀请画伴 <span lang="en">Invite a companion</span></button>
          <details class="menu">
            <summary aria-label="更多 More">⋯ <span lang="en" class="more-label">More</span></summary>
            <div class="menu-body">
              <button id="share" type="button">分享 <span lang="en">Share</span></button>
              <button id="fullscreen" type="button" aria-pressed="false" hidden>全屏 <span lang="en">Full screen</span></button>
              <button id="motion" type="button" aria-pressed="true">动 <span lang="en">Motion</span></button>
              <button id="cursors-toggle" type="button" aria-pressed="true">指针 <span lang="en">Others' pointers</span></button>
              <a href="/how/">玩法 <span lang="en">How to play</span></a>
              <a href="/dreams/">梦痕 <span lang="en">Archive</span></a>
              <a href="/readme/">关于 <span lang="en">About</span></a>
            </div>
          </details>
        </nav>
      </header>

      <div class="rail float" role="toolbar" aria-label="工具 Tools">
        <button type="button" class="tool" data-tool="select" aria-pressed="true"><span class="zh">选</span><span class="en" lang="en">Place / select</span></button>
        <button type="button" class="tool" data-tool="invite" aria-pressed="false"><span class="zh">邀</span><span class="en" lang="en">Leave an opening</span></button>
        <button type="button" class="tool" data-tool="dew" aria-pressed="false"><span class="zh">露</span><span class="en" lang="en">Dew <span id="dew-left"></span></span></button>
      </div>

      <div id="overlay" class="overlay" hidden></div>
      <div id="modebar" class="modebar" hidden></div>
      <div id="guide" class="guide float" hidden>
        <h2>入梦三步 <span lang="en">Three steps into the dream</span></h2>
        <ol>
          <li><strong>读梦</strong> 读上方的一句梦。<span lang="en">Read the dream at the top.</span></li>
          <li><strong>布景</strong> 从下方素材匣选一件，点在画上。<span lang="en">Pick a motif from your tray below and tap the picture to place it.</span></li>
          <li><strong>成全</strong> 借别人的景、接一个泡、回应一处留白。<span lang="en">Complete someone else's scene: borrow a view, catch a bubble, answer an opening.</span></li>
        </ol>
        <button type="button" id="guide-close">好 <span lang="en">Got it</span></button>
      </div>

      <aside class="side float" id="side" aria-label="画中事 What's happening">
        <button type="button" class="side-handle" id="side-handle" aria-expanded="false" aria-controls="side">往来 <span lang="en">Requests</span> <span id="req-count" class="count"></span></button>
        <div class="side-body">
          <section class="requests" aria-labelledby="req-title">
            <h2 id="req-title">往来 <span lang="en">Requests and offers</span></h2>
            <div id="requests"><p class="quiet">还没有往来。<span lang="en">Nothing waiting yet.</span></p></div>
          </section>
          <section id="inspector" class="inspector" hidden aria-labelledby="insp-title"></section>
          <details class="objects">
            <summary>画中景物 <span lang="en">Objects in the scene</span> <span id="obj-count"></span></summary>
            <ul id="object-list"></ul>
          </details>
          <details class="similes">
            <summary>六如在哪里 <span lang="en">Where the six similes appear</span></summary>
            <dl>
              <dt>梦 <span lang="en">Dream</span></dt><dd>一梦七分钟：同一句梦，同一幅画，最后散回纸上。<span lang="en">One seven-minute dream: one prompt, one picture, which fades back into paper.</span></dd>
              <dt>幻 <span lang="en">Illusion</span></dt><dd>水边之物可“化影”，变成水中倒影。<span lang="en">An object by water can become its reflection.</span></dd>
              <dt>泡 <span lang="en">Bubble</span></dt><dd>把一件景物放进泡里，谁先接住，归谁照看。<span lang="en">Offer an object in a bubble; whoever catches it first cares for it.</span></dd>
              <dt>影 <span lang="en">Shadow</span></dt><dd>移走的景物在原处留下片刻淡影。<span lang="en">A moved object leaves a faint trace where it was.</span></dd>
              <dt>露 <span lang="en">Dew</span></dt><dd>每人两滴露，让附近的墨晕开一会儿。<span lang="en">Two drops of dew each soften nearby ink for a while.</span></dd>
              <dt>电 <span lang="en">Lightning</span></dt><dd>布景将尽时，远处一闪，一阵大风吹过画面，又归平静。<span lang="en">Late in Compose, a distant flash and a strong gust cross the picture, then settle.</span></dd>
            </dl>
          </details>
        </div>
      </aside>

      <section class="chat float collapsed" id="chat" aria-labelledby="chat-title">
        <button type="button" class="chat-toggle" id="chat-toggle" aria-expanded="false" aria-controls="chat-body"><span id="chat-title">谈 <span lang="en">Chat</span></span> <span id="chat-unread" class="count"></span></button>
        <div class="chat-body" id="chat-body">
          <p class="chat-note">公开，会被保存，可导出。<span lang="en">Public, kept and exportable. Plain text, up to 300 characters.</span></p>
          <button type="button" id="chat-older" class="chat-older" hidden>更早 <span lang="en">Earlier messages</span></button>
          <ol id="chat-log" class="chat-log" aria-live="polite" aria-relevant="additions"></ol>
          <form id="chat-form" class="chat-form" autocomplete="off">
            <p id="chat-about" class="chat-about" hidden></p>
            <label class="visually-hidden" for="chat-input">说一句 Say something</label>
            <input id="chat-input" name="text" maxlength="300" placeholder="说一句… Say something" />
            <button type="submit">送 <span lang="en">Send</span></button>
          </form>
          <details class="chat-export">
            <summary>导出 <span lang="en">Export</span></summary>
            <p>全部 <span lang="en">All dreams</span>: <a href="/api/chat/export?format=md" download>Markdown</a> · <a href="/api/chat/export?format=txt" download>Text</a> · <a href="/api/chat/export?format=json" download>JSON</a></p>
            <p id="chat-export-round"></p>
          </details>
        </div>
      </section>

      <footer class="tray float" id="tray">
        <div class="tray-head">
          <button type="button" id="tray-toggle" aria-expanded="true" aria-controls="tray-body">素材匣 <span lang="en">Your motifs</span></button>
          <span id="reroll-left" class="quiet"></span>
          <button type="button" id="swap-mode" aria-pressed="false">换一格 <span lang="en">Swap one</span></button>
          <button type="button" id="catalogue-open">全部景物 <span lang="en">All motifs</span></button>
        </div>
        <div id="tray-body" class="tray-body">
          <ul id="palette" class="palette" aria-label="你的素材 Your motifs"></ul>
        </div>
      </footer>
    </main>

    <dialog id="catalogue" aria-labelledby="cat-title">
      <h2 id="cat-title">全部景物 <span lang="en">All motifs</span></h2>
      <p class="quiet">亮的是你的；其余可以向持有的人借，或请他们回应你的留白。<span lang="en">Bright ones are yours; for the rest, ask whoever holds them, or leave them an opening.</span></p>
      <div id="catalogue-body"></div>
      <form method="dialog"><button>关 <span lang="en">Close</span></button></form>
    </dialog>

    <dialog id="intent-dialog" aria-labelledby="intent-title">
      <h2 id="intent-title">留下一处空白 <span lang="en">Leave an opening</span></h2>
      <p class="quiet">请别人在这里补一笔。<span lang="en">Invite someone else to complete this spot.</span></p>
      <div id="intent-options" class="intent-options"></div>
      <form method="dialog"><button>取消 <span lang="en">Cancel</span></button></form>
    </dialog>

    <dialog id="share-dialog" aria-labelledby="share-title">
      <h2 id="share-title">分享这场梦 <span lang="en">Share this dream</span></h2>
      <p>把链接发给同伴，打开就在同一幅画里。<span lang="en">Send this link; whoever opens it joins the same picture.</span></p>
      <label>链接 <span lang="en">Link</span> <input id="share-url" readonly /></label>
      <p id="share-status" class="quiet" role="status"></p>
      <form method="dialog"><button>关 <span lang="en">Close</span></button></form>
    </dialog>

    <div id="toast" class="toast" role="status" aria-live="polite"></div>
    <div id="live" class="visually-hidden" aria-live="polite"></div>
    <noscript><p class="noscript">这幅画需要 JavaScript。<span lang="en">The shared picture needs JavaScript. The <a href="/dreams/">archive</a> works without it.</span></p></noscript>
    <script type="module" src="/static/app.js"></script>
  </body>
</html>
`;
}

export function renderHow(): string {
  return renderPage(
    "玩法 How to play · 六如",
    `<h1>玩法 <span lang="en">How to play</span></h1>
      <p>一场梦约七分钟。所有人在同一幅长卷上，读同一句梦。<span lang="en">A dream lasts about seven minutes. Everyone shares one long scroll and one line of poetry.</span></p>
      <h2>三步 <span lang="en">Three steps</span></h2>
      <ol>
        <li><strong>读梦 <span lang="en">Read the dream.</span></strong> 顶部那句话就是题目，没有标准答案。<span lang="en">The line at the top is the theme. There's no correct answer.</span></li>
        <li><strong>布景 <span lang="en">Arrange your motifs.</span></strong> 你有八种景物；选一件，点在画上，或直接拖上去。选中自己的景物可以调大小、角度、浓淡和远近。<span lang="en">You hold eight kinds of motif. Pick one and tap the scroll (or drag it on). Select your own object to change its size, angle, ink and depth.</span></li>
        <li><strong>成全 <span lang="en">Complete another person's scene.</span></strong> 别人的船也许正缺一条河。<span lang="en">Someone's boat may be waiting for a river.</span></li>
      </ol>
      <h2>往来 <span lang="en">Ways to work together</span></h2>
      <dl>
        <dt>借景 <span lang="en">Borrow a view</span></dt>
        <dd>选中别人的景物，点“借景”，把虚影放到你想要的位置再发出。对方同意后，它移过去，并改由你照看；原作者仍记在梦痕里。对方没回应或婉拒，原物不动。<span lang="en">Select someone else's object, choose "Suggest a move", place the ghost where you'd like it and send. If they accept, it moves and you become its custodian; the original contributor stays on the record. If they decline or don't answer in 20 seconds, nothing moves.</span></dd>
        <dt>泡 <span lang="en">Bubble</span></dt>
        <dd>把自己照看的一件放进泡里。泡在原处上方飘二十秒；谁先接住，就有八秒把它放到新位置。没人接，它回到原处。<span lang="en">Offer one of your objects in a bubble. It floats above its place for 20 seconds; the first person to catch it has eight seconds to set it down somewhere new. If nobody does, it returns home.</span></dd>
        <dt>留白邀作 <span lang="en">Leave an opening</span></dt>
        <dd>用“邀”在空处留下记号，写明你希望那里有什么：一点生气、有人来过、通向远处、一处归宿，或只是留白。别人用自己的景物回应，你来决定收不收。<span lang="en">Use the opening tool to mark an empty spot with an intention. Someone answers with one of their own motifs; you decide whether to accept it.</span></dd>
        <dt>景物相应 <span lang="en">Motifs respond</span></dt>
        <dd>船放在水上会轻轻起伏；鸟落在树冠里会栖息；灯靠近亭、窗或屋会亮起暖光；月在水面之上会落下倒影。<span lang="en">A boat on water bobs; a bird in a tree's crown perches; a lantern near a pavilion, window or cottage glows; a moon above water casts a reflection.</span></dd>
      </dl>
      <h2>一切都会过去 <span lang="en">Everything here passes</span></h2>
      <p>布景五分钟，留白一分钟，然后画卷定格、展开、慢慢散回纸上。定格那一刻会存成一份“梦痕”，在<a href="/dreams/">梦痕</a>里可以重看。<span lang="en">Five minutes to compose, one to refine; then the scroll freezes, is revealed, and fades back into paper. The frozen moment is saved as a dream trace you can revisit in the <a href="/dreams/">archive</a>.</span></p>
      <p><a href="/">回到画卷 <span lang="en">Back to the scroll</span></a> · <a href="/decision/">为什么这样设计 <span lang="en">Why it works this way</span></a> · <a href="/credits/">素材来源 <span lang="en">Asset credits</span></a></p>`,
  );
}

export function renderCredits(body: string): string {
  return renderPage("素材 Credits · 六如", body);
}

interface ArchivedObject {
  id: number;
  motif: string;
  contributor: number;
}

// Each archive draws at the size its round was painted at: 2400×900 for the
// dreams saved before the resize, 1800×1000 after.
function sceneSvg(objects: ArchivedObject[], prefix: string, label: string, scene: Scene): string {
  return `<svg class="scene" viewBox="0 0 ${scene.width} ${scene.height}" style="aspect-ratio: ${scene.width} / ${scene.height}" role="img" aria-label="${escapeHtml(label)}">
    <defs>${sceneDefs(prefix)}<clipPath id="${prefix}-clip"><rect width="${scene.width}" height="${scene.height}"/></clipPath></defs>
    <g clip-path="url(#${prefix}-clip)">${paperMarkup(prefix, scene)}
    <g class="scene-art">${sceneMarkup(objects, prefix)}</g></g>
  </svg>`;
}

function markChips(objects: ArchivedObject[]): string {
  const marks = [...new Set(objects.map((o) => o.contributor))].sort((a, b) => a - b);
  return marks
    .map((m) => {
      const mark = markFor(m);
      return m === AGENT_MARK
        ? `<span class="mark agent" style="--mark:${mark.colour}" title="AI 画伴 companion">${mark.glyph}<span class="visually-hidden"> (AI)</span></span>`
        : `<span class="mark" style="--mark:${mark.colour}">${mark.glyph}</span>`;
    })
    .join("");
}

const dateFmt = (ms: number): string =>
  new Date(ms).toLocaleString("zh-CN", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" });

export function renderArchiveList(data: { rows: ArchiveRow[]; more: boolean }, page: number): string {
  const cards = data.rows
    .map((row) => {
      const scene = JSON.parse(row.scene) as ArchivedObject[];
      const prompt = PROMPTS[row.prompt_index];
      return `<li class="dream-card">
        <a href="/dreams/${row.round_id}/">
          ${sceneSvg(scene, `a${row.round_id}`, `${prompt.zh} ${prompt.en}`, sceneOf(row))}
          <span class="dream-title">${escapeHtml(prompt.zh)}</span>
          <span class="dream-en" lang="en">${escapeHtml(prompt.en)}</span>
        </a>
        <p class="dream-meta"><span class="marks-inline"><span class="visually-hidden">合作者 Dreamers: </span>${markChips(scene)}</span> ${scene.length} 件 <span lang="en">objects</span> · ${dateFmt(row.created_at)}</p>
      </li>`;
    })
    .join("");
  const nav = `<nav class="pager" aria-label="翻页 Pages">
      ${page > 0 ? `<a href="/dreams/?page=${page - 1}">← 较新 <span lang="en">Newer</span></a>` : ""}
      ${data.more ? `<a href="/dreams/?page=${page + 1}">较早 <span lang="en">Older</span> →</a>` : ""}
    </nav>`;
  return renderPage(
    "梦痕 Dream archive · 六如",
    `<h1>梦痕 <span lang="en">Dream traces</span></h1>
      <p>每场梦定格时的样子。不排名，不点赞，只是留下。<span lang="en">Each dream as it froze. No rankings, no likes: just what was left.</span></p>
      ${data.rows.length ? `<ul class="dream-grid">${cards}</ul>` : `<p class="empty">还没有梦痕。<a href="/">去做第一场梦</a>。<span lang="en">No dreams saved yet. <a href="/">Begin the first one.</a></span></p>`}
      ${nav}`,
  );
}

const timeFmt = (ms: number): string =>
  new Date(ms).toLocaleTimeString("zh-CN", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit" });

/** A round's conversation beside its saved picture; text only, escaped. */
function chatTranscript(roundId: number, chat: { messages: ChatMessage[]; more: boolean }): string {
  if (chat.messages.length === 0) return "";
  const items = chat.messages
    .map((m) => {
      const mark = m.mark === null ? { glyph: "客", colour: "#7d7f76" } : markFor(m.mark);
      return `<li><span class="mark" style="--mark:${mark.colour}">${mark.glyph}</span> <time datetime="${new Date(m.at).toISOString()}">${timeFmt(m.at)}</time> <span class="text">${escapeHtml(m.body)}</span>${m.objectMotif ? ` <span class="about">(${escapeHtml(m.objectMotif)})</span>` : ""}</li>`;
    })
    .join("");
  return `<section class="dream-chat" aria-labelledby="dream-chat-title">
      <h2 id="dream-chat-title">这场梦里的话 <span lang="en">What was said during this dream</span></h2>
      <ol class="transcript">${items}</ol>
      ${chat.more ? `<p class="quiet">只显示前 ${chat.messages.length} 条。<span lang="en">Showing the first ${chat.messages.length}; the export has them all.</span></p>` : ""}
      <p class="quiet">导出 <span lang="en">Export</span>: <a href="/api/chat/export?format=md&amp;round=${roundId}" download>Markdown</a> · <a href="/api/chat/export?format=txt&amp;round=${roundId}" download>Text</a> · <a href="/api/chat/export?format=json&amp;round=${roundId}" download>JSON</a></p>
    </section>`;
}

export function renderArchive(row: ArchiveRow, chat: { messages: ChatMessage[]; more: boolean } = { messages: [], more: false }): string {
  const objects = JSON.parse(row.scene) as ArchivedObject[];
  const keyframes = JSON.parse(row.keyframes) as ArchivedObject[][];
  const prompt = PROMPTS[row.prompt_index];
  const scene = sceneOf(row);
  // a long 2400-wide handscroll can be read at full size, sideways
  const long = scene.width / scene.height > 2;
  // `<` escaped so the JSON can't close the script element early.
  const data = JSON.stringify({ keyframes }).replace(/</g, "\\u003c");
  return renderPage(
    `${prompt.zh} · 梦痕`,
    `<p class="crumb"><a href="/dreams/">← 梦痕 <span lang="en">All dream traces</span></a></p>
      <h1>${escapeHtml(prompt.zh)} <span class="en" lang="en">${escapeHtml(prompt.en)}</span></h1>
      <p class="dream-meta">第 ${row.round_id} 梦 <span lang="en">Dream ${row.round_id}</span> · ${dateFmt(row.created_at)} · <span class="marks-inline"><span class="visually-hidden">合作者 Dreamers: </span>${markChips(objects)}</span> ${objects.length} 件 <span lang="en">objects</span></p>
      <div class="archive-view fit${long ? " long" : ""}" id="archive-view">
        <div id="archive-scene">${sceneSvg(objects, "d", `${prompt.zh} ${prompt.en}`, scene)}</div>
      </div>
      <div class="replay" role="group" aria-label="回放 Replay">
        ${long ? `<button type="button" id="fit-toggle" aria-pressed="true">全卷 <span lang="en">Fit scroll</span></button>` : ""}
        <button type="button" id="kf-prev">← 前 <span lang="en">Earlier</span></button>
        <span id="kf-label" role="status">定格 <span lang="en">Final</span> ${keyframes.length}/${keyframes.length}</span>
        <button type="button" id="kf-next">后 → <span lang="en">Later</span></button>
      </div>
      <p class="quiet">按步回看这幅画是怎样一点点长成的。<span lang="en">Step through how the picture grew.</span></p>
      ${chatTranscript(row.round_id, chat)}
      <script type="application/json" id="keyframes">${data}</script>`,
    `<script type="module" src="/static/archive.js"></script>`,
  );
}
