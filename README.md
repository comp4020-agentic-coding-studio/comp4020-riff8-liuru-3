# 六如 · 共梦长卷 — a shared dream scroll

A small group opens the same page and, for about seven minutes, arranges one
Chinese ink-wash handscroll together. Each round starts from a line of
poetry ("雨停了，人还没回来。The rain has stopped. Someone has not
returned."). Each person is dealt a different eight kinds of prepared motif
(boats, pines, a pavilion, a moon, mist), and nobody needs to draw. The
pleasure is the one the pod's brief names: I brought a boat, someone else
gave it a river, another person sent us a moon, and together we made a scene
none of us planned. Then the scroll freezes, is saved as a dream trace (梦痕),
and fades back into paper.

## Why the wall became a scroll

The crit-8 version of this app was a permanent wall: visitors left short text
traces tagged with one of the six similes from the Diamond Sūtra's closing
line (dream, illusion, bubble, shadow, dew, lightning). That wall argued for
impermanence while keeping every post forever, and it reduced the six
similes to six tags on a form. It also had nothing to do with being there at
the same time as anyone else, which is what crit 9 asks for.

The pod's riff takes the theme literally instead. The live picture is
temporary by design: it exists for one round and then dissolves. What stays
is a single frozen snapshot per round, read-only, so a dream can be
revisited without anything being kept "live" forever. The old `traces` table
is still in the database, untouched; it's simply no longer shown.

## How to play

1. **Read the dream.** The line at the top is the theme. There is no correct
   answer, and a tiger at an empty ferry landing may tell a better story than
   a boat.
2. **Arrange your motifs.** Pick one from your tray and tap the scroll (or
   drag it on). Select your own object to change its size, angle, ink, depth,
   or flip it. Two swaps per round replace a tray slot you don't want.
3. **Complete someone else's scene.** Suggest a move for their object (借景),
   catch a bubble they offered (泡), or answer an opening they left (留白邀作).

A round runs 0--300 s compose, 300--360 s refine (no new placements, only
adjustments and handoffs: "留一点空白 / make room for the scene"), 360--390 s
reveal, 390--420 s dissolve. Anyone can begin a dream from the waiting
screen and anyone can begin another once it ends; nothing starts on its own,
so an empty room doesn't churn out empty rounds. There is one shared room:
the root URL is the dream. The [how to play](/how/) page has worked
examples.

## What good means here

Good is a single readable picture that several people made, with room left
in it. Concretely: the scroll should look like one painter's vocabulary (one
coherent motif library on one paper ground, never a sticker sheet), leave
deliberate empty space, and make other people's contributions something you
can build on rather than something that gets in your way. No accounts, no
chat, no likes, rankings, streaks or scores, and no aesthetic judge: whether
a scene is good is the people in the room's call.

Being there together matters more than being efficient. The whole
multi-user decision ([ADR 0002](docs/decisions/0002-shared-dream-custody.md))
follows from that: you can always place your own motifs freely, but other
people's work only changes with their consent.

## The six similes, as behaviour

- **梦 Dream.** The round itself: one shared prompt, one picture, a common
  clock, a paper-unfurl entrance, and a closing dissolve. Placed objects don't
  expire one by one, so careful composition holds until the end.
- **幻 Illusion.** A custodian can turn an object by the water into its own
  reflection (化影): mirrored below the surface, paler, rippled. It's the same
  object in another state, not a copy, and it returns to solid if the water
  moves away.
- **泡 Bubble.** Offer an object in a floating bubble; the first valid catch
  wins, and the catcher has eight seconds to set it down. Unclaimed bubbles
  float home after twenty.
- **影 Shadow.** A moved, handed-off or withdrawn object leaves a faint
  silhouette where it was for about ten seconds.
- **露 Dew.** Two drops per person per round. Nearby ink gains a soft wet edge
  for about fifteen seconds; it never changes ownership or geometry.
- **电 Lightning.** Around 210 s into compose, a quiet five-second cue, a
  gentle sky illumination and a gust (birds flutter, lanterns swing, boats
  rock) pass through, then the same composition settles back.

Four motif relationships respond on their own, from tags and anchors in the
catalogue: a boat on water bobs with a small wake, a bird in a tree's crown
perches, a lantern near a pavilion, window or cottage glows, and a moon above
water drops a reflection. When two different people make one, they both get
a quiet note ("你们让这盏灯有了归处 / Together, you gave the light a home").

## The multi-user decision

We share one changing composition, while direct manipulation follows
temporary custody: each object has an original contributor and a current
custodian, and only the custodian edits it. Others propose a move (accepted
or declined, with a 20-second expiry and a stale check against the object's
version), catch an offered bubble, or answer an invitation. The record
compares this with "everyone edits everything" and "everything stays
private", says what it costs (more steps, timeouts when a custodian leaves),
and covers reconnects, the common clock, the immutable archive and the line
between ephemeral effects and durable state:
[docs/decisions/0002-shared-dream-custody.md](docs/decisions/0002-shared-dream-custody.md)
(also served at [/decision/](/decision/)).

## Architecture

Plain Node (`node:http`, no framework) and `better-sqlite3` on the Fly volume,
unchanged from [ADR 0001](docs/decisions/0001-plain-node-and-sqlite.md). No
build step: the server runs its TypeScript directly, and the browser loads
plain ES modules.

- `public/shared.js` is imported by both sides: the motif catalogue and
  anchors, transform limits, the relationship rules, bubble drift, phase
  maths, and the SVG markup builders, so the live scroll and the archive
  draw identically.
- `src/game.ts` holds every mutation. Each accepted action is one SQLite
  transaction, keyed by an idempotency id per participant, that also appends
  an event with a monotonic id. A 250 ms tick (and every request) reconciles
  expiries, phase changes and the once-only archive.
- `src/server.ts` serves pages, assets, `GET /api/state`, the SSE stream
  `GET /api/events` (snapshot plus cursor, then change events), and
  `POST /api/*` actions with same-origin checks, a 4 KB body cap and a small
  per-participant rate limit. Identity is the server-issued `visitor` cookie;
  payloads only ever carry a public participant id and a session mark.
- `public/app.js` is the live client: an SVG scene graph in a fixed
  2400×900 coordinate space with a per-viewer camera, pointer and keyboard
  controls, and patch application with gap detection and resync.
- The motif library is 32 original SVGs plus scaffolding and a seal; see
  [asset credits](docs/assets.md) (also at [/credits/](/credits/)).

## Running and testing

```sh
pnpm install
pnpm start                       # http://localhost:8080
APP_URL=http://localhost:8080 pnpm check
pnpm check:evidence
```

`pnpm check` typechecks and runs `spec/`. `invariants.test.ts` and
`site.test.ts` read the app at `APP_URL` without writing to it.
`scroll.test.ts` starts its own server processes on free ports with
throwaway data directories and shortened timings (`COMPOSE_SECONDS`,
`REFINE_SECONDS`, `REVEAL_SECONDS`, `DISSOLVE_SECONDS`, `LIGHTNING_SECONDS`,
`PROPOSAL_SECONDS`, `LEASE_SECONDS`), so a whole dream, a bubble race, a
restart mid-round and a reconnect all play out in seconds. Production runs
the defaults; there is no HTTP route that skips time.

## Honest limitations

- One public room. Private rooms were out of scope for this run.
- Shadows live in server memory, so a restart clears any still fading.
  Everything else (scene, palettes, custody, pending proposals and bubbles,
  quotas, archives) is in SQLite and reconciles once on boot.
- Hit testing and relationships use each object's unrotated box. With
  rotation capped at ±20° that's close, not exact.
- The browser's offline emulation doesn't close an open SSE stream, so the
  reconnect playtest used a real server stop and restart. The gap-and-resync
  path is also covered by `scroll.test.ts`.
- The art is a hand-authored vector set rather than a sourced collection. A
  few motifs (cottage, steps, bamboo, sun) are plainer than the rest.
- Not built: group borrowing, bridge passers-by, a continuous cinematic
  replay (the archive steps through keyframes), and PNG export.
- No moderation beyond rate limits. There's no free text anywhere, so the
  worst a stranger can do is place motifs badly, which the custody model
  already confines to their own objects.
