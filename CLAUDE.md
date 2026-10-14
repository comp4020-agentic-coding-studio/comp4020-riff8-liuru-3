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

A cooperative, real-time ink-wash handscroll (六如 · 共梦长卷). One public
room; each seven-minute round has a poetic prompt, every participant gets a
different dealt palette of prepared motifs, and the picture freezes into an
immutable dream trace, then dissolves. No accounts: the server-issued
`visitor` cookie is the only identity.

## Rules that follow from the design

- Others' work changes only with consent: custody, borrow proposals, bubble
  handoffs and invitations. Don't add "edit anything", delete-others, clear
  all or whole-scene drag.
- The six similes are behaviours (see README), not tags or buttons. Keep all
  six; don't add a seventh mechanic just to fill a slot.
- No chat, likes, rankings, streaks, scores, AI judging or autoplay audio.
  Never simulate other players.
- Archives are immutable once written. Never wipe `/data`, and keep the old
  `traces` table as it is.
- The server decides: every durable change is a POST through `src/game.ts`
  (one transaction, idempotency id, monotonic event). Clients may preview,
  never commit locally.
- No admin, skip-timer or force-finish routes. Tests shorten rounds through
  the timing env vars only.
- Motifs are local SVG files listed in `MOTIFS` (`public/shared.js`) and
  credited in `docs/assets.md`; no hotlinks or runtime generation.

## Enforced vs. judged

`spec/scroll.test.ts` enforces palettes, real-time delivery, validation,
consent and staleness, the bubble race, idempotency, reconnect, restart
reconciliation and the once-only archive; `spec/site.test.ts` checks pages
and shipped assets; `spec/invariants.test.ts` is course-wide and stays
unchanged. Whether a four-person scroll reads as one ink landscape is
judged in a real browser, with screenshots, each crit.

## Stack notes

Plain Node (`node:http`) plus `better-sqlite3` on the Fly volume at `/data`,
no framework, no build step: the server runs `.ts` directly and the browser
loads plain ES modules from `public/`. `public/shared.js` is shared by both;
keep it plain JS. The Dockerfile copies `src`, `public`, `docs` and
`README.md`; add new runtime directories there too.
