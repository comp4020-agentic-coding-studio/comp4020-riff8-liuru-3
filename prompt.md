# Brief: 六如, a room you can see, hear and paint with

You are liuru's crit agent, running this once, unattended. Nobody will answer
questions: where this brief is silent, decide, act, and say which call you
made in the commit message. CLAUDE.md's "How you work" applies throughout.

## Where the app is, and where it's going

The app is a cooperative real-time ink-wash picture: one public room,
seven-minute rounds, a poetic prompt, dealt palettes of prepared SVG motifs,
consent-based handoffs (borrow, bubble, invitations) and an immutable dream
trace at the end. Before changing anything, read `README.md`,
`docs/decisions/0002-shared-dream-custody.md`, `src/game.ts`, `src/server.ts`,
`public/app.js`, `public/shared.js` and `spec/`. Open the live app at
https://comp4020-riff8-liuru-3.fly.dev/ as the baseline. Look at it, but never
post anything to it.

Today the room is quiet. You only notice other people through what they
place, and the picture sits in a long scroll you pan and zoom around. This
brief makes the room feel inhabited. You can see where everyone is pointing,
talk to them and watch the picture breathe. When you're alone, you can invite
an AI companion to paint with you. It has five parts:

1. The whole picture at once, filling the screen: no scrolling, no zooming.
2. A living picture: the motifs move.
3. Everyone's cursor, live, over a WebSocket.
4. A shared chat room with saved history and export.
5. An optional AI companion player that runs on the server.

Here is what good looks like. A newcomer opens the page on a laptop and the
whole scene fills the window. Pine needles stir, a fish turns under the
bridge, and light runs along the water. Two coloured cursors drift over the
picture, one labelled "竹 · 松 Pine". Someone types "moon over the water?" in
the chat, and a moment later a moon appears there. A visitor on their own
clicks "邀请画伴 / Invite a companion", and a clearly labelled AI painter
starts, unhurried, to answer their openings and set down the odd boat.

## Rules this brief changes

These override the matching lines in CLAUDE.md ("Rules that follow from the
design") and README. Update both, and record what changed and why in a new
decision record, `docs/decisions/0003-*.md` (more than one if the decisions
are separate):

- **"No chat" is lifted.** There is now one shared chat room (part 4). Likes,
  rankings, streaks, scores, AI judging and autoplay audio stay out.
- **"Never simulate other players" becomes "never pass a program off as a
  person".** The AI companion is allowed. It joins only when someone invites
  it, and it is labelled as AI everywhere it appears.
- **Pan, zoom, the overview strip and Fit go away.**

Everything else in CLAUDE.md still holds. Others' work changes only with
consent. The six similes stay behaviours. The server decides every durable
change through `src/game.ts`. There are no admin or skip-timer routes. Motifs
stay local SVGs. Archives are immutable, and `/data` is never wiped.

## 1. The whole picture, filling the screen

- Remove the per-viewer camera: no pan, no zoom, no wheel or pinch zoom, no
  overview strip, no Fit button, no keyboard panning. Every viewer sees the
  entire shared scene at once.
- The scene fills the viewport and the page itself never scrolls. The header,
  tray, inspector and chat float over the picture or tuck against its edges,
  and they stay out of the way until needed.
- The scene must not be cropped. Everyone has to see the same picture, or
  cursors and chat references stop making sense. When the viewport's shape
  differs from the scene's, the paper ground bleeds out to the screen edges.
  Never show black bars.
- The current scene is 2400×900. That whole width fits a 16:10 laptop as a
  thin band and a 390×844 portrait phone as a sliver. You decide how to
  handle this: re-proportion the scene for new rounds, use a layout that
  suits portrait phones, ask phones to turn sideways, or something better. If
  you change the size, store it per round so every existing archive still
  renders exactly as saved. Pick whatever makes the picture biggest and most
  legible on a laptop and still playable on a phone, and explain why in the
  decision record. Default motif sizes and the limits must still compose
  naturally at the new size.
- A "全屏 / Full screen" toggle using the Fullscreen API is welcome where the
  browser supports it.
- Pointer mapping, drag-to-place, select-then-tap, keyboard selection and
  nudging, and 44 px touch targets must all keep working without the camera.
  The reveal's "慢游全卷 / Slow panorama" tour depends on the camera, so
  replace it with something that suits a picture already fully in view.
- If the name 长卷 (long scroll) stops fitting the new shape, you may rename
  it. Keep 六如.

## 2. A living picture

Every motif that would move in a real landscape gets a small, continuous idle
motion:

- fish swim
- water moves and catches the light
- trees, bamboo, willow, reeds, grass and clouds feel the wind
- mist drifts and rain falls
- the crane walks, birds flutter and the deer lifts its head
- lanterns flicker

Mountains, rocks and buildings stay still. The existing relationship effects
(boat bob, perch, lantern glow, moon reflection) and the lightning gust keep
working, and should become part of the same system.

What good looks like:

- **Ink-wash restraint.** Motion is slow, small and eased. It should feel like
  breathing, not a cartoon. A screenshot taken at any moment still reads as
  one composed picture.
- **One shared wind.** Things that sway lean the same way, and a gust can be
  seen travelling across the scene. The lightning gust becomes a strong
  instance of this wind. Water shimmer and drift follow the same field.
- **The same on every screen.** Derive every animation from the server clock
  and the object's own data, never from per-client randomness. Two screens
  side by side should show the fish in the same place. This matters now that
  people point at things.
- **Bounded.** Motion stays close to where the object was placed: the fish
  loops within a small range, and the crane paces a few steps and back.
  Durable position, hit testing, relationships and archives all use the
  placed position, never the animated one.
- **Real motion, not a wobble.** A crane that slides sideways isn't walking,
  and a fish that only translates isn't swimming. Each motif is currently a
  single `<image>`. Whole-object transforms are cheap but limited, so where a
  motif needs it, split or inline its SVG into parts. New or changed art
  still goes through `MOTIFS` and `docs/assets.md`.
- **Cheap.** Animate transforms and opacity only, with no layout thrash. It
  stays smooth with a full 48-object scene and pauses while the tab is hidden.
- **Reduced motion.** `prefers-reduced-motion` and a manual motion toggle
  (add one if it's missing) both give a still picture. Nothing important is
  conveyed only through motion. Whether reveal, dissolve and the archive view
  animate is your call, but the archive data stays exactly as saved.

## 3. Everyone's cursor, over WebSocket

- **What it shows.** Show every other participant's pointer live on the scene,
  in their session-mark colour (`MARKS` in `public/shared.js`). Each cursor
  has a small label: the person's glyph and what the pointer is on.
  - Build the label from what the pointer is over and what that person is
    doing: holding a tray motif, dragging, proposing a borrow, aiming dew.
  - Examples: "梅 · 松 Pine (竹's)", "竹 · holding 舟 Boat",
    "松 · 水面 Water", "云 · empty paper".
- **Quiet.**
  - Labels fade when a pointer rests.
  - A cursor fades after a few idle seconds and vanishes when its owner
    disconnects.
  - Don't draw the viewer's own cursor.
  - Touch has no hover, so show a touch user's point only while they're
    touching or dragging.
  - Give each viewer a toggle to hide others' cursors, and hide them anyway
    during reveal so the finished picture can be seen clean.
- **Presence, not state.**
  - Cursors travel over a WebSocket. They are never written to SQLite or the
    event stream.
  - Send scene coordinates so cursors line up across screen sizes.
  - Throttle on the sender (about 15–20 Hz) and batch on the server. Locally,
    other screens should follow within about 100–200 ms.
- **Transport.**
  - The plain `node:http` server can accept the WebSocket upgrade through the
    `ws` package or a careful hand-rolled implementation. If you add `ws`,
    update `pnpm-lock.yaml`, because Docker installs with `--frozen-lockfile`.
  - Authenticate the upgrade with the `visitor` cookie and check Origin the
    same way the POST routes do.
  - Cap message size and rate, validate and clamp every field, and ping to
    drop dead sockets.
  - Fly's proxy passes WebSockets through.
- **Previews.** The ghost previews currently sent through `POST /api/preview`
  and SSE are the same kind of ephemeral presence. Moving them onto the
  socket is encouraged.
- **Durable state stays where it is.** It still goes as a POST through
  `src/game.ts` and arrives over the SSE event stream with gap detection.
  Don't move durable actions onto the socket unless you have a strong
  reason. If you do, keep idempotency, monotonic events and resync, and
  explain why in the decision record.

## 4. A shared chat room

- **Where it lives.** There is one chat for the room, beside the picture. It
  can be collapsed so it doesn't cut into the scene, and it becomes a drawer
  on phones.
- **Messages.** Each message is plain text and shows the sender's mark glyph
  and colour plus a time. A message may optionally point at an object ("about
  this boat"), shown as a small link that highlights the object.
- **Saved in real time.**
  - Every message is a durable write: a POST through `src/game.ts`, or a
    sibling module that follows the same pattern (one transaction, an
    idempotency id, a monotonic event).
  - Other people see it within a second over the existing real-time path.
  - History survives reloads, reconnects and restarts.
  - Late joiners see recent history, and older messages page in on demand.
    Keep every query bounded.
- **Rounds.** The chat is the room's conversation, not one dream's, so it
  spans rounds. Each message records the round it was sent in, so the history
  reads as a sequence of dreams. Showing a round's conversation on its
  dream-trace page is a nice touch, as long as the archived scene itself
  doesn't change.
- **Export.**
  - Anyone can download the history as a file, both the whole history and a
    single round.
  - Offer at least two formats: readable text or Markdown with each round's
    prompt as a heading, and JSON.
  - Make it a real download (`Content-Disposition`), and stream or page it so
    a long history doesn't exhaust memory.
- **Safety.** This is the first free text in the app.
  - Escape everything: render messages as text, never as HTML.
  - Cap message length at about 300 characters, strip control characters,
    and rate-limit each participant.
  - No images and no link previews.
  - There's no moderation queue, but the chat must say plainly that messages
    are public and kept. README currently says there is no free text
    anywhere, so correct that and list the chat's limits honestly.
- The AI companion doesn't chat.

## 5. The AI companion (画伴)

The companion is an optional AI player that runs inside the server process and
paints alongside people.

**Joining and leaving**

- Anyone in the room can invite a companion into the current round with a
  visible control, and anyone can dismiss it. Everyone sees it arrive and
  leave.
- There is at most one companion per round. It leaves when the round ends, so
  people invite it again for each dream.
- It is a `Participant` like anyone else, flagged as an agent in the
  database. Its identity is held by the server and is never a cookie anyone
  else could hold. It gets its own dealt palette and the same quotas as a
  person.
- It is labelled as AI everywhere: its mark (a distinct glyph and treatment,
  such as 机), its cursor, the inspector, request prompts and the archive's
  contributor marks.
- It acts only while at least one human is connected, and it never starts a
  round. When the last person leaves it stops cleanly, so an empty room still
  lets the Fly machine auto-stop.

**Playing**

- Every 5–30 seconds (a random interval whose bounds come from env vars, so
  tests can shorten them the way they shorten round timings), the companion
  observes the full current state:
  - the phase, time left and prompt
  - every object, with its custody and relationships
  - open invitations, proposals and bubbles
  - its own palette and quotas
- It then chooses one action from everything that is valid right now: place,
  adjust or withdraw its own object, reflect, reroll, leave or answer an
  invitation, propose a borrow, offer or catch a bubble, apply dew, or do
  nothing. Doing nothing should often win, because the companion leaves
  room.
- "Valid" means "the server would accept it":
  1. Enumerate candidates, taking positions from anchors, water surfaces,
     open space and invitations.
  2. Filter them through the same validation code the HTTP routes use.
  3. Score the survivors.
  4. Execute the choice through the same `src/game.ts` functions, with an
     idempotency id.

  This way it can't do anything a person couldn't, and its moves reach
  everyone as ordinary events.
- It is a custodian too. When someone proposes to borrow one of its objects,
  it must answer before the 20-second expiry, so it checks for requests aimed
  at it more often than it acts.
- It is a generous collaborator. It answers invitations, accepts reasonable
  borrows and catches bubbles. It doesn't hog the scene (it stays well under
  its quota), and it doesn't pile onto someone else's work uninvited.
- Its cursor glides to where it is about to act a moment before it acts, so
  people can see what it's doing.

**The model**

- The fixed machine has 256 MB for everything: Node, SQLite, sockets and the
  companion. A local LLM won't fit.
- The default must be a tiny decision model that runs locally with no network
  and no key. For example, use a small learned scorer (linear or a tiny MLP)
  over features of each candidate action and the scene:
  - Does it form a boat-on-water or lantern-by-pavilion relationship?
  - Does it fill empty space, or protect it?
  - Does it balance depth?
  - Does it fit the prompt?
  - Does it answer someone?

  Keep the weights in a data file and sample with a temperature so the
  companion doesn't play mechanically.
- A hand-written if/else script isn't a model. A model whose weights came from
  something you can explain is. Document the features, where the weights came
  from, and the model's size.
- An online model is optional. It would be an adapter for an
  OpenAI-compatible endpoint with these properties:
  - It is enabled only when its env vars are set.
  - It has a hard timeout of a few seconds.
  - It receives the candidate list and returns an index, which is validated.
  - On any error it falls back to the local model.

  Don't sign up for services, add secrets, or depend on a free service
  staying up.
- Put model files somewhere the Dockerfile copies (it copies only `src`,
  `public`, `docs` and `README.md`), or add their directory to it.
- Measure peak RSS with a companion playing, eight browsers connected and the
  chat active. Ideally do this in the Docker image run with `--memory=256m`.
  Put the numbers in README.

## What to leave alone

- The opening block of CLAUDE.md.
- `spec/invariants.test.ts`: leave it unchanged and keep it green.
- `agent/`, `PROCESS.md` and `reflections/`.
- The machine, volume and port settings in `fly.toml`.
- The old `traces` table, every written archive, and `/data`.
- The consent model and the six similes. No new feature may become a way to
  change someone else's work.
- The live app: inspect it, but never post to it. Test against local servers
  with throwaway data directories.
- liuru's original repo and the other pods' repos.

## Verification

Extend `spec/` (`scroll.test.ts`, `site.test.ts` or new files) so the new
behaviour is enforced by tests, not just claimed. At least:

- **Chat**
  - A message persists, reaches another session within a second, and
    survives a restart.
  - Messages are escaped, and length and rate are limited.
  - A repeated action id stores one message.
  - Export returns the right content type and contents, for the whole
    history and for one round.
  - History paging is bounded.
- **WebSocket**
  - An upgrade without a `visitor` cookie, or from a foreign Origin, is
    refused.
  - A cursor from one client reaches another quickly.
  - Oversized or malformed messages are dropped.
  - Nothing cursor-related lands in SQLite.
  - When a client disconnects, its cursor disappears for everyone else.
- **Companion**
  - Inviting and dismissing it are visible to everyone.
  - Every action it takes is accepted: no rejected writes over a test round.
  - Its intervals stay within the configured range.
  - It does nothing when no humans are connected, and it never starts a
    round.
  - It answers a borrow proposal before the proposal expires.
  - There is at most one per round, and it is gone at round end.
  - A restart mid-round reconciles it.
- **Layout**
  - No pan, zoom or overview controls remain.
  - Old 2400×900 archives still render.
- **Existing tests.** The existing `scroll.test.ts` guarantees stay green:
  palettes, consent, staleness, the bubble race, idempotency, reconnect,
  restart and the once-only archive. Change a test only where this brief
  changed the behaviour it checks, and say so in the commit.

Then judge the app in a real browser, with screenshots. Use independent
browser contexts (separate cookies) at 1440×900, around 1280×720, and
390×844. Check that:

- the whole picture is visible and large
- each screen shows the other cursors with correct labels
- chat works across contexts
- animations stay in sync between two windows side by side
- reduced motion gives a still picture
- the companion plays a shortened local round end to end, through the reveal
  and the archive
- there are no console errors, no page scroll and no overlapping controls

Run `pnpm check` against a running local server, and run
`pnpm check:evidence`. If Docker is available, build and run the image. Never
claim a check ran if it didn't.

## Order and finishing

A suggested order:

1. Remove the camera and fill the screen. Everything else builds on this
   coordinate setup.
2. WebSocket presence and cursors.
3. Chat.
4. Animation.
5. The companion.
6. Docs.

Commit in small working steps and keep `main` deployable at every commit.
Don't deploy by hand; CI deploys `main`.

Update:

- `README.md`: what the app is now, how to play, the architecture (including
  the socket, the companion and its model), the memory numbers, and honest
  limitations.
- The lower part of `CLAUDE.md`, so it matches the new rules.
- The decision record or records.

Delete `prompt.md` in the commit that completes this brief. After that, as
CLAUDE.md says, keep going: playtest, find what's weakest, and improve it.
