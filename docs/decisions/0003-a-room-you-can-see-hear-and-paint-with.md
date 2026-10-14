# 0003: the whole picture at once, a living picture, cursors, chat and an AI companion

Status: accepted (crit 10, riff 8 pod brief). Keeps [0002](0002-shared-dream-custody.md)'s
consent model and [0001](0001-plain-node-and-sqlite.md)'s stack. Changes three of
0002's rules, listed below.

## Context

The crit-9 room was quiet: you noticed other people only through what they
placed, and the picture sat in a long scroll that each viewer panned and
zoomed alone. The crit-10 pod brief asks for a room that feels inhabited.
Everyone sees the whole picture at once and the picture breathes. You can see
where everyone is pointing and talk to them. When you're alone, you can
invite an AI companion to paint with you.

## Rules this changes

1. **"No chat" becomes "one chat".** The room has a single shared chat.
   Likes, rankings, streaks, scores, AI judging and autoplay audio stay out.
   The chat is the first free text in the app. It is plain text only, up to
   300 characters, with control characters stripped. Each person may send
   five messages in any 15 seconds. It says on its face that messages are
   public and kept. There is no moderation queue.
2. **"Never simulate other players" becomes "never pass a program off as a
   person".** The companion is allowed, but only when someone invites it.
   It is labelled as AI everywhere it appears: its 机 mark wears an "AI" tag
   and a hatched ring, and the same label appears on its cursor, in the
   inspector, in requests and on the archive's contributor marks.
3. **Pan, zoom, the overview strip and Fit are gone.** Every viewer sees the
   entire scene.

## Decisions

### The scene size: 1800×1000 for new rounds, stored per round

The 2400×900 scroll (8:3) shows as a thin band on a 16:10 laptop. To keep
2400 units across a 1440×900 window it has to draw at 0.6×, about 540 px tall.
On a portrait phone it is a sliver. We compared three shapes against the
real available area at 1440×900, 1280×720, 844×390 (a phone held sideways)
and 390×844. The available area is what's left after the header, tray and
tool rail:

- **16:9 (1920×1080).** Matches a monitor, but loses height to the
  header and tray at 16:10 and on landscape phones.
- **9:5 (1800×1000, chosen).** It fills the space between the floating header
  and tray at 1440×900 with the picture about 1150 px wide, and almost fills
  a 1280×720 window. It still fits a phone on its side.
- **4:3.** It would suit portrait phones better, but wastes most of a laptop,
  which is where the brief says people mostly play.

1800 is a little narrower than the old 2400, so the default motif sizes (a
560-unit water patch, a 230×330 pine) now take more of the picture. A
14–16 motif scene reads as a full landscape rather than scattered stickers,
and the 48-object and twelve-per-person limits still fit without crowding.
The existing scaffold (2400 wide) is centred, and the scene clips it.

Each round stores its own size (`rounds.scene_w`, `scene_h`). Rows from
before this change have none, which means 2400×900. Every archive draws at
its round's size, so the 16 dreams saved by the crit-9 app render
byte-for-byte as they did (`spec/layout.test.ts` checks one of them).
Positions are validated against the round's own size.

**Portrait phones** see the whole picture in the band between the header and
the tools, at about 380 px wide. That's small but playable, and a
dismissable hint suggests turning the phone sideways. We didn't make a
separate portrait layout, which would break "everyone sees the same picture".
We didn't force landscape either, because a phone that can't rotate would
lock its owner out.

**No black bars.** The SVG's viewBox follows the window's own shape, so a
textured paper bleed fills whatever the scene doesn't, out to every edge. The
picture itself has a faint deckle line so you can see where the paper's
edge is. A tap outside it doesn't place anything.

**Slow panorama** depended on the camera. **慢读 Slow reading** replaces it.
A soft pool of light moves right to left across the finished picture, the
way a handscroll is read. It rests on each object and names who brought it.
It is local to the viewer and steps rather than glides with motion off.

### The living picture: one shared wind, from the server's clock

`public/motion.js` holds pure functions of the server-corrected clock, the
round's lightning moment and each object's stored data (id, position, flip).
They never use per-client randomness, so two screens side by side show the
fish in the same place. We checked this in a real browser: both windows'
transforms matched the formula for every animated object. One wind field
drives everything that sways. It breathes, and a gust crosses the scene left
to right every 23 seconds. The lightning (电) is the same wind, much stronger
and faster. Boat bob, perching, lantern glow and the moon's reflection read
the same field.

A crane that slides isn't walking, so six motifs are drawn from separate
parts: fish (tail), crane (neck and both legs), deer (head and four legs),
birds (each of three), lantern (light) and willow (fronds). The parts are
made by `scripts/split-motifs.py` and stack back into the original
pixel-for-pixel. A new `water-glint` overlay carries light along the water.
Durable state, hit testing, relationships and archives all use the placed
position. Only transforms and opacity change each frame, and nothing is
rebuilt. `prefers-reduced-motion` or the Motion toggle gives a still
picture. The archive stays still.

### Cursors: a WebSocket, never stored

Cursors are presence, not state. They go over one WebSocket per tab
(`src/presence.ts`, the `ws` package) and never touch SQLite or the event
stream. They're sent in scene units, so they line up on any screen. The
sender throttles to about 16 Hz and the server batches at 20 Hz, so locally
a cursor arrives in under 200 ms (`spec/presence.test.ts`). The upgrade
requires an existing `visitor` cookie and a same-site Origin. Messages are
capped at 512 bytes and rate-limited, every field is validated and clamped,
and pings drop dead sockets. Drag and ghost previews ride on the cursor
message, which replaces `POST /api/preview` and its SSE `preview` event.
**Durable actions stay as POSTs through `src/game.ts`.** There was no reason
to move them, and that keeps idempotency, monotonic events and gap-resync
exactly as they were.

### Chat: one room, durable, across rounds

`src/chat.ts` follows `src/game.ts`'s pattern. A message is one transaction
with an idempotency id, appending a monotonic `chat` event that SSE carries
to everyone. Each message records the round and phase it was sent in, so the
history reads dream by dream. The page loads the newest 50 messages, and
older ones page in on demand (capped at 100 per page). Exports in Markdown
(each dream's prompt as a heading), plain text and JSON are streamed with
`Content-Disposition`, for the whole history or one dream. A dream's
conversation is shown beneath its saved picture; the archived scene is
untouched. A message can point at one object ("about this"), which shows as a
link that highlights the object if it's still there.

### The companion: a server-side player that can only do what a person can

`src/companion.ts` is a `Participant` flagged `agent = 1`. Its identity is a
server-only token that can never be a visitor cookie. It has its own dealt
palette and a person's quotas, and it never holds one of the twelve people's
marks. At most one is present per round (a partial unique index), it leaves
when the round ends, and anyone can invite or dismiss it.

Every 5–30 seconds (`COMPANION_MIN_SECONDS`, `COMPANION_MAX_SECONDS`) it
takes the same snapshot a browser gets and lists candidate moves. Positions
come from relationship anchors, invitations and open space. **Each candidate
is filtered by running the real `src/game.ts` action inside a transaction
that is always rolled back** (`game.wouldAccept`), so "valid" means the
server accepted it, not that a second copy of the rules agreed. The survivors
are scored and one is sampled. Its cursor glides there, and then the move is
made through the same function with an idempotency id. "Do nothing" competes
with every move and usually wins. It answers requests aimed at it every
couple of seconds, well inside the 20-second expiry. With nobody connected
it holds no timers and makes no writes, and it never starts a round
(`startRound` refuses an agent).

**The model** is a linear scorer over ten features of "this motif, here, in
this scene": relationships formed, band height, overlap, gap, crowding,
edge, balance, fit to the prompt and how full the picture is
(`src/companion-model.ts`). Most weights are learned by
`scripts/train-companion.ts`, a conditional logit fitted to the 97 motifs
people actually placed in the live app's 16 public dream traces. Each real
spot is set against 24 random spots for the same motif in the same scene;
the real spot ranks first 21 times in 95, against a chance rate of about 4.
The fit can't see two features, prompt fit and fullness, because they're the
same for every spot in a group. Those two, an extra overlap penalty and the
per-action priors (how often to wait, borrow, offer) are set by hand and
marked as such in the weights file. That is 10 weights plus 13 priors and a
temperature, under 1 KB. An OpenAI-compatible adapter is optional. It is off
unless `COMPANION_LLM_URL` and `COMPANION_LLM_MODEL` are set, has a 3-second
timeout, receives the top candidates, returns a validated index and falls
back to the local model on any error. No service was signed up for and no
key is stored.

## What it costs

- One more transport. The socket has its own auth, limits and reconnect.
  Its rate limit drops messages rather than queuing them, so a fast mouse
  on a slow link loses intermediate positions. That is the right failure for
  presence.
- The chat is the first place a stranger can write words other people
  read. Escaping, length and rate limits, and an honest "public and kept"
  note are the only protections. There is no moderation.
- The companion adds a second kind of participant. Every surface that shows
  a person now has to show the companion differently.
- The 1800-wide paper narrows the scroll. A 2400-wide composition would
  no longer fit, which is why the old ones keep their own size.
