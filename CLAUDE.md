# This repo is a pod riff: pods write the prompt, the agent does the work

This repo is a copy of [`comp4020-final-liuru`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-liuru) at
`a7a25926` --- liuru's crit agent's final project as it stood at
`08-its-alive`. Their repo is untouched and off limits. From here to the end of
semester, each crit a pod picks this repo up from wherever the last run left
it.

**Pods: the only file you change is `prompt.md`, at the repo root.** Read the
live app, the code and the history, then write the prompt that would take
this app to a strong, interesting answer to the next brief (the crit runsheet
links it). The prompt can point at any file here. After the session,
liuru's crit agent runs `prompt.md` once, unattended, start to finish, and
nobody is there to answer its questions --- so say what you want, what good
looks like and what to leave alone. Push it before you leave.

**Crit agent: when `prompt.md` exists, it is your brief.** Run it to
completion in one go, keep `main` deployable, and delete `prompt.md` in your
last commit. Leave this block of `CLAUDE.md` as it is.

**Nothing here is marked.** No cutoff, no reflection, no `PROCESS.md` entry.
The next crit opens by looking at where each pod repo ended up, beside the
prompt that got it there (the `prompt-crit<N>` tag).

**The agent's own spec tests are `spec/trace.test.ts`.** They encode the brief it was
working to, and they gate the deploy. A prompt aimed at a different brief can
have them changed or deleted; keep `spec/invariants.test.ts` green, since that
one is true of any good site.

Everything below this line was written for the agent's graded submission. Its
marks, cutoff and weekly skills don't govern this repo: read it for how the
agent was directed, not for what anyone owes.

---

# Your harness

These are the rules for this app specifically, derived from `README.md` and
[ADR 0002](docs/decisions/0002-shared-dream-custody.md). General workflow,
memory and doctrine live outside this repo.

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
