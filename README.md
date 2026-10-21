# 六如 · 共梦图 — a shared dream picture

A small group opens the same page and, for about seven minutes, arranges one
Chinese ink-wash picture together. Each round starts from a line of poetry
("雨停了，人还没回来。The rain has stopped. Someone has not returned.").
Each person is dealt a different eight kinds of prepared motif (boats,
pines, a pavilion, a moon, mist), and nobody needs to draw. The pleasure is
the one the pod's brief named: I brought a boat, someone else gave it a
river, another person sent us a moon, and together we made a scene none of
us planned. Then the picture freezes, is saved as a dream trace (梦痕), and
fades back into paper.

Since crit 10 the room feels inhabited. The whole picture fills the window,
and pine needles stir, a fish turns under the bridge and light runs along the
water. Everyone else's pointer drifts over it, labelled with what they're
holding, and a chat sits at the edge. If you're alone you can invite an
AI companion (画伴), clearly labelled as AI, to paint with you.

## Why the wall became a picture

The crit-8 version of this app was a permanent wall: visitors left short text
traces tagged with one of the six similes from the Diamond Sūtra's closing
line (dream, illusion, bubble, shadow, dew, lightning). That wall argued for
impermanence while keeping every post forever. It also reduced the six
similes to six tags on a form, and it had nothing to do with being there at
the same time as anyone else, which is what crit 9 asked for.

The crit-9 riff took the theme literally instead. The live picture is
temporary by design: it exists for one round and then dissolves. What stays
is a single frozen snapshot per round, read-only, so a dream can be
revisited without anything being kept "live" forever. The old `traces` table
is still in the database, untouched; it's simply no longer shown. Crit 10
kept the round and turned the long scroll into one picture you see whole
([ADR 0003](docs/decisions/0003-a-room-you-can-see-hear-and-paint-with.md)).
The dreams saved as long scrolls still open as long scrolls.

## How to play

1. **Read the dream.** The line at the top is the theme. There is no correct
   answer, and a tiger at an empty ferry landing may tell a better story than
   a boat.
2. **Arrange your motifs.** Pick one from your tray and tap the picture (or
   drag it on). Select your own object to change its size, angle, ink, depth,
   or flip it. Two swaps per round replace a tray slot you don't want.
3. **Complete someone else's scene.** Suggest a move for their object (借景),
   catch a bubble they offered (泡), or answer an opening they left (留白邀作).
4. **Talk, point, or invite a companion.** The chat (谈) is one public line
   for the room; select an object first to say something about it. Others see
   your pointer, and you see theirs. "邀请画伴 / Invite an AI companion" in
   the top bar brings in a program that paints alongside you until the dream
   ends. Anyone can dismiss it.

A round runs 0--300 s compose, 300--360 s refine (no new placements, only
adjustments and handoffs: "留一点空白 / make room for the scene"), 360--390 s
reveal, 390--420 s dissolve. During the reveal, 慢读 Slow reading walks a soft
light across the finished picture from right to left, naming who brought
each thing. Anyone can begin a dream from the waiting screen, and anyone
can begin another once it ends. Nothing starts on its own, so an empty room
doesn't churn out empty rounds. There is one shared room: the root URL is the
dream. The [how to play](/how/) page has worked examples.

## What good means here

Good is a single readable picture that several people made, with room left
in it. Concretely, the picture should look like one painter's vocabulary (one
coherent motif library on one paper ground, never a sticker sheet). It should
leave deliberate empty space, and it should make other people's
contributions something you can build on rather than something that gets in
your way. There are no accounts, likes, rankings, streaks or scores, and
no aesthetic judge: whether a scene is good is the call of the people in the
room. The companion doesn't judge either; it only paints, quietly.

Being there together matters more than being efficient. The whole
multi-user decision ([ADR 0002](docs/decisions/0002-shared-dream-custody.md))
follows from that: you can always place your own motifs freely, but other
people's work only changes with their consent. Nothing added in crit 10 is a
way around that. Cursors and chat only show and say things, and the
companion asks like anyone else.

## The six similes, as behaviour

- **梦 Dream.** The round itself: one shared prompt, one picture, a common
  clock, the paper settling in on entry, and a closing dissolve. Placed
  objects don't expire one by one, so careful composition holds until the
  end.
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
- **电 Lightning.** Around 210 s into compose comes a quiet cue, a gentle sky
  illumination, and the shared wind turning into a strong gust that crosses
  the picture from left to right. Trees lean, birds ruffle, lanterns swing,
  boats rock; then the same composition settles back.

Four motif relationships respond on their own, from tags and anchors in the
catalogue. A boat on water bobs with a small wake, and a bird in a tree's
crown perches. A lantern near a pavilion, window or cottage glows, and a moon
above water drops a reflection. When two different people make one, they
both get a quiet note ("你们让这盏灯有了归处 / Together, you gave the light a
home").

## The living picture

Everything that would move in a real landscape moves a little. Fish swim a
small loop and turn at its ends, and water carries light along its surface.
Pines, bamboo, willow, reeds, grass and bare branches lean in one shared
wind, while clouds and mist drift and rain falls through its veil. The crane
paces a few steps and back, dipping its head; small birds flap or, perched,
ruffle; the deer grazes, then lifts its head. Lanterns flicker. Mountains,
rocks, buildings and people stay still.

All of it is a pure function of the server's clock, the round's lightning
moment and each object's own stored data (`public/motion.js`), so two screens
side by side show the fish in the same place. Six motifs are drawn from
separate parts so that, for example, a crane's legs swing rather than the
whole bird sliding (`public/motifs/parts/`, made by `scripts/split-motifs.py`).
Motion only changes transforms and opacity; durable position, hit testing,
relationships and archives all use the placed position. `prefers-reduced-motion`
or the Motion toggle (in the ⋯ menu) gives a still picture. The archive is
always still.

## The multi-user decision

We share one changing composition, while direct manipulation follows
temporary custody. Each object has an original contributor and a current
custodian, and only the custodian edits it. Others propose a move (accepted
or declined, with a 20-second expiry and a stale check against the object's
version), catch an offered bubble, or answer an invitation. The record
compares this with "everyone edits everything" and "everything stays
private", and says what it costs: more steps, and timeouts when a custodian
leaves. It also covers reconnects, the common clock, the immutable archive
and the line between ephemeral effects and durable state:
[docs/decisions/0002-shared-dream-custody.md](docs/decisions/0002-shared-dream-custody.md).
Crit 10's changes (the scene size, cursors, chat and the companion) are in
[docs/decisions/0003-a-room-you-can-see-hear-and-paint-with.md](docs/decisions/0003-a-room-you-can-see-hear-and-paint-with.md).
Both are served at [/decision/](/decision/).

## The chat

There is one chat for the room, spanning rounds; each message records the
dream it was sent in. It is plain text only (never HTML), up to 300
characters, with control characters stripped and five messages per person in
any 15 seconds. Only a visitor the server already knows can post, and there
are also caps per address (10 per 15 s) and for the whole room (40 per 15 s),
so minting a new cookie for each message doesn't get round the limit. There are no images, no link previews and no moderation queue,
so the chat says plainly that messages are public and kept. A message can
point at one object in the picture. History survives reloads, reconnects and
restarts; the page shows the most recent 50 and pages older ones in. Anyone
can download the whole history or one dream's as Markdown (each dream's
prompt as a heading), plain text or JSON, and a dream's conversation also
appears under its saved picture. The companion doesn't chat.

## The AI companion

The companion (画伴) is an optional player that runs inside the server. Anyone
in the room can invite it into the current round, and anyone can dismiss it.
There is at most one per round, it leaves when the round ends, and it acts
only while at least one person has the page open. It never starts a round. It
is a participant like anyone else, with its own dealt palette and the same
quotas, flagged as an agent in the database. Its identity is held by the
server and can never be a visitor cookie. It wears its own mark (机, with an
"AI" tag and a hatched ring) on its cursor, in the inspector, in requests and
on the archive.

Every 5--30 seconds it looks at the whole room: phase, time, prompt, every
object with custody and relationships, open invitations, proposals, bubbles,
and its own palette and quotas. It lists what it could do: place, adjust,
withdraw, reflect, swap, leave or answer an opening, suggest a move, offer or
catch a bubble, apply dew, or do nothing. **Each candidate is tested by
running the real action in a transaction that is always rolled back**, so it
can only choose what the server would accept. The survivors are scored and
one is sampled. Its cursor glides there, and the move goes through the same
`src/game.ts` function as a person's click. Doing nothing often wins. It
checks every couple of seconds for requests aimed at it, so a borrow is
answered well inside its 20 seconds, and it accepts any move that keeps its
object on the paper. It stays at five objects or fewer.

**The model** is a linear scorer over ten features of a placement:
relationships formed (and with whom), how well its height suits the motif,
overlap with others, distance to the nearest object, crowding, hanging off
the edge, left--right balance, fit to the dream's line, and how full the
picture is. Seven of the weights were fitted by `scripts/train-companion.ts`,
a conditional logit over the 97 motifs people placed in the 16 public dream
traces on the live app. Each real spot was compared with 24 random spots for
the same motif. The real spot ranks first 21 times in 95, where chance is
about 4. Prompt fit and fullness can't be learned that way, so they're set by
hand, as are an extra overlap penalty ("don't pile onto someone's work") and
one prior per kind of action. All of it is in
`src/companion-weights.json`, under 1 KB (10 weights, 13 priors, a
temperature of 0.6 for sampling). An online model is optional. It is an
adapter for any OpenAI-compatible endpoint, off unless `COMPANION_LLM_URL` and
`COMPANION_LLM_MODEL` are set, with a 3-second timeout. It returns an index
that is validated, and it falls back to the local model on any error.

## Architecture

Plain Node (`node:http`, no framework) and `better-sqlite3` on the Fly volume,
unchanged from [ADR 0001](docs/decisions/0001-plain-node-and-sqlite.md), plus
the `ws` package for the presence socket. There is no build step: the server
runs its TypeScript directly, and the browser loads plain ES modules.

- `public/shared.js` is imported by both sides. It holds the motif catalogue
  and anchors, transform limits, the relationship rules, bubble drift and
  phase maths. It also holds the SVG markup builders, so the live picture and
  the archive draw identically.
- `public/motion.js` holds the living picture's motion and the shared wind.
- `src/game.ts` holds every mutation. Each accepted action is one SQLite
  transaction, keyed by an idempotency id per participant, that also appends
  an event with a monotonic id. A 250 ms tick (and every request) reconciles
  expiries, phase changes, the companion's departure and the once-only
  archive. Each round stores its scene size; older rounds without one are
  2400×900.
- `src/chat.ts` is the room's chat, with the same transaction, idempotency
  and event pattern.
- `src/presence.ts` is the WebSocket for cursors and drag previews. It checks
  the cookie and Origin on upgrade, allows six tabs per person and 200
  sockets in all, caps messages at 512 bytes, rate-limits,
  clamps every field, pings, batches at 20 Hz, and stores nothing.
- `src/companion.ts` and `src/companion-model.ts` are the AI companion and its
  model.
- `src/server.ts` serves pages, assets, `GET /api/state`, the SSE stream
  `GET /api/events` (snapshot plus cursor, then change events), chat history
  and export, and the `POST /api/*` actions. Those have same-origin checks, a
  4 KB body cap and a small per-participant rate limit. Identity is the
  server-issued `visitor` cookie, and payloads only ever carry a public
  participant id. Each action logs one line,
  `action pid=<participant> <route> ok|refused:<code>`, so the logs show who
  did what without the cookie ever appearing in them.
- `public/app.js` is the live client. It fits the whole scene to the window
  with no camera, draws the motifs and their motion, other people's cursors
  and the chat. It applies patches with gap detection and resync.
- The motif library is 32 original SVGs, 20 part files, a water glint,
  scaffolding and a seal; see [asset credits](docs/assets.md) (also at
  [/credits/](/credits/)).

### Memory

The machine has 256 MB for everything. We measured the production Docker
image run with `--memory=256m --memory-swap=256m` and a throwaway `/data`.
The load was 8 real Chromium sessions connected over SSE and WebSocket with
their pointers moving, 4 more scripted cursor sockets at 16 Hz, a chat
message every 0.9 s for 75 s (84 stored), a 21-object scene and the
companion playing. Under that load the container peaked at **53 MiB** of the
256 MiB cgroup limit (`docker stats`), and Node reported an RSS of **98 MB**.
RSS counts shared library pages the cgroup doesn't charge, which is why it's
higher. The container was never OOM-killed. An idle server sits at about the
same RSS, so the presence socket, chat and companion add little on top of
Node and SQLite.

## Running and testing

```sh
pnpm install
pnpm start                       # http://localhost:8080
APP_URL=http://localhost:8080 pnpm check
pnpm check:evidence
node scripts/train-companion.ts  # refit the companion's weights
node scripts/fetch-archives.ts   # refetch the dream traces it is fitted to
```

`scripts/data/archives.json` (the 16 public dream traces) is committed: the
fit and `spec/layout.test.ts` read it from the repo, never over the network.

`pnpm check` typechecks and runs `spec/`. `invariants.test.ts` and
`site.test.ts` read the app at `APP_URL` without writing to it. The other
files start their own server processes on free ports, with throwaway data
directories and shortened timings (`COMPOSE_SECONDS`, `REFINE_SECONDS`,
`REVEAL_SECONDS`, `DISSOLVE_SECONDS`, `LIGHTNING_SECONDS`, `PROPOSAL_SECONDS`,
`LEASE_SECONDS`, and `COMPANION_MIN_SECONDS`, `COMPANION_MAX_SECONDS`,
`COMPANION_GLIDE_SECONDS` and `COMPANION_CHECK_SECONDS` for the companion).
That way a whole dream, a bubble race, a restart mid-round, a reconnect and a
companion's round all play out in seconds.

- `scroll.test.ts` covers palettes, real time, consent, staleness, the
  bubble race, idempotency, reconnect, restart and the archive.
- `chat.test.ts` covers delivery, persistence, escaping, limits, idempotency,
  paging and export.
- `presence.test.ts` covers socket auth, latency, clamping and disconnects,
  and checks that nothing is stored.
- `companion.test.ts` covers invite and dismiss, a whole round with no
  rejected writes, intervals, borrow answers, idleness and restarts.
- `layout.test.ts` checks that an old 2400×900 archive renders exactly as
  saved and that new rounds use the new size.

`EXPOSE_STATS=1` adds a read-only `/api/companion/stats` and a memory log
line every 5 s, for tests and measurement only. Production runs the defaults,
and no HTTP route skips time.

## Honest limitations

- One public room. Private rooms were out of scope.
- The chat has no moderation beyond rate and length limits, no way to delete
  a message, and no way to report one. It says plainly that messages are
  public and kept, and the export keeps them too.
- On a portrait phone the whole picture is about 380 px wide. That's playable
  but small, and the app suggests turning the phone sideways rather than
  showing a different picture.
- Animation is in sync to within one frame and the clock offset (measured at
  about 30 ms apart in two windows), not to the millisecond.
- Cursors are best effort: a socket over its rate limit drops positions
  rather than queuing them, and a dropped connection reconnects with backoff.
- The companion's placement model was fitted on 97 placements, which is small,
  and its action priors are hand-set. It plays plausibly, not brilliantly. It
  only sees what a snapshot shows, so it has no idea what anyone is about to
  do.
- Shadows live in server memory, so a restart clears any still fading.
  Everything else (scene, palettes, custody, pending proposals and bubbles,
  quotas, chat, the companion's presence, archives) is in SQLite and
  reconciles on boot.
- Hit testing and relationships use each object's unrotated box. With
  rotation capped at ±20° that's close, not exact.
- The art is a hand-authored vector set rather than a sourced collection. A
  few motifs (cottage, steps, bamboo, sun) are plainer than the rest, and the
  deer's neck doesn't separate from its body, so it nods only a little.
- Not built: group borrowing, bridge passers-by, a continuous cinematic
  replay (the archive steps through keyframes), and PNG export.
