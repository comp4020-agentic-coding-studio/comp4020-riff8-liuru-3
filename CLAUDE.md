# This repo is a pod riff: pods write the prompt, the agent does the work

**Crit agent: `prompt.md` is your brief.** Run it to
completion, keep `main` deployable, and delete `prompt.md` in your
last commit. Leave this block of `CLAUDE.md` as it is.

## How you work

1. **Don't ask questions.** Nobody is there to answer. When in doubt, use
   your own best judgement, act on it, and say which call you made in the
   commit message.
2. **Spawn subagents freely**, as many as you want, for anything: research,
   building, review, browser checks.
3. **Don't worry about time or cost.** Think as deeply as you can, or as
   deeply as you want.
4. **Change the harness, the prompts, even the goal.** If changing this file
   (below the opening block), `prompt.md`, the specs or what the app is for
   would make you or the project better, do it. Recursive self-improvement
   is encouraged. Record a change of goal or rule as an ADR in
   `docs/decisions/` and update this file, so the next run starts from the
   better version.
5. **Never stop.** When everything looks done, keep running and thinking:
   finishing `prompt.md`'s brief is a milestone, not the end. There are
   endless possibilities; go explore them and do whatever you want.

Rewriting the rules is allowed; doing what can't be undone is not. Whatever
you change, never wipe `/data` or rewrite a written archive, and keep `main`
deployable with `spec/invariants.test.ts` green.

## What this app is

A cooperative, real-time ink-wash picture (六如 · 共梦图). One public room;
each seven-minute round has a poetic prompt, every participant gets a
different dealt palette of prepared motifs, and the picture freezes into an
immutable dream trace, then dissolves. Everyone sees the whole picture at
once, the motifs breathe, everyone's pointer is visible, there is one room
chat, and anyone can invite an AI companion. No accounts: the server-issued
`visitor` cookie is the only identity of a person.

## Rules that follow from the design

- Others' work changes only with consent: custody, borrow proposals, bubble
  handoffs and invitations. Don't add "edit anything", delete-others, clear
  all or whole-scene drag. Cursors, chat and the companion never bypass it.
- The six similes are behaviours (see README), not tags or buttons. Keep all
  six; don't add a seventh mechanic just to fill a slot.
- One plain-text room chat (ADR 0003). No likes, rankings, streaks, scores,
  AI judging or autoplay audio. The companion doesn't chat.
- Never pass a program off as a person. The AI companion joins only when
  invited, leaves with the round, acts only while a person is connected,
  never starts a round, and wears the 机 AI mark everywhere it appears.
- Every viewer sees the whole scene: no per-viewer camera, pan, zoom or
  crop. Each round stores its scene size; archives draw at their own size.
- Motion is derived from the server clock and object data only, never
  per-client randomness, and never changes durable position. Reduced motion
  and the Motion toggle give a still picture.
- Archives are immutable once written. Never wipe `/data`, and keep the old
  `traces` table as it is.
- The server decides: every durable change (chat included) is a POST
  through `src/game.ts` or `src/chat.ts` (one transaction, idempotency id,
  monotonic event). The companion uses the same functions and is filtered by
  `game.wouldAccept`. Cursors and previews are presence: WebSocket only,
  never stored.
- No admin, skip-timer or force-finish routes. Tests shorten rounds and the
  companion's pace through env vars only.
- Motifs and their parts are local SVG files (`MOTIFS` in `public/shared.js`,
  `PARTS` in `public/motion.js`) credited in `docs/assets.md`; no hotlinks
  or runtime generation.

## Enforced vs. judged

`spec/scroll.test.ts` enforces palettes, real-time delivery, validation,
consent and staleness, the bubble race, idempotency, reconnect, restart
reconciliation and the once-only archive. `chat.test.ts`, `presence.test.ts`,
`companion.test.ts` and `layout.test.ts` enforce ADR 0003.
`spec/site.test.ts` checks pages and shipped assets; `spec/invariants.test.ts`
is course-wide and stays unchanged. Whether a four-person picture reads as
one ink landscape, and whether the motion feels like breathing, is judged in
a real browser, with screenshots, each crit.

## Stack notes

Plain Node (`node:http`) plus `better-sqlite3` on the Fly volume at `/data`
and `ws` for presence; no framework, no build step: the server runs `.ts`
directly and the browser loads plain ES modules from `public/`.
`public/shared.js` and `public/motion.js` are plain JS. The Dockerfile copies
`src`, `public`, `docs` and `README.md`; add new runtime directories there
too. In `agent-browser`, use a named `--session` per window: the default
session is shared with other runs on this machine.
