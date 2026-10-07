# 0002: one shared dream, temporary custody, consent to change hands

Status: accepted (crit 9, riff 8 pod brief). Supersedes the product half of
[0001](0001-plain-node-and-sqlite.md); the stack decision there still holds.

## Context

The crit-9 brief asks for real time (one person's change reaches everyone
else within about a second, no reload) and one decision about how the app
behaves when several people use it at once. The pod's brief turns the old
permanent wall into a seven-minute cooperative ink handscroll: everyone
arranges prepared motifs on one composition, then it freezes, is saved as a
dream trace, and dissolves.

The question that matters is not the transport. It is what happens when two
people want the same thing on the same picture: the boat one person placed
is exactly where another person's river wants it.

## Decision

We share one changing composition, while direct manipulation follows
temporary custody. Others can propose a new view or receive an offered
object; consent and atomic handoffs prevent a shared canvas becoming a fight.

- Every scene object has an original **contributor** (fixed forever, kept in
  the archive) and a current **custodian**. Only the custodian moves,
  transforms, withdraws, reflects (幻) or offers it.
- Anyone else can **suggest a move** (借景): they place a ghost, the custodian
  sees it on the scroll and in their request list, and accepts or declines.
  Acceptance applies the transform and transfers custody in one SQLite
  transaction. A proposal names the object version it was made against; any
  intervening change marks it stale instead of overwriting newer work.
- A custodian can **offer** an object in a bubble (泡). The first valid claim
  wins (a conditional `UPDATE … WHERE status = 'floating'` is the race), then
  the catcher has a short lease to set it down. Expiry, cancellation or a
  missed lease returns the object to its old place and custodian.
- **Invitations** (留白邀作) are the third route: the inviter marks an empty
  spot with an intention; a respondent proposes one of their own motifs, and
  the inviter accepts it into the scene under the respondent's care.
- Proposals expire after 20 seconds and leases after 8, so nothing stays
  locked when someone walks away. A disconnected custodian is not consent.

## Alternatives weighed

1. **Everyone edits everything immediately.** The most fluid, the fewest
   steps, and the closest to a shared whiteboard. But with 2–4 people and
   prepared motifs, the dominant move becomes rearranging other people's
   work, and last-write-wins means careful placement is undone silently. It
   also erases the thing worth noticing (someone *gave* you their boat).
   Conflict handling would be either a lock (a fight over who grabbed first)
   or a merge nobody can see happening.
2. **Each person's objects stay private and immutable to others.** Simple,
   safe and conflict-free. But it makes the scroll four solo collages that
   happen to overlap: nobody can complete anybody else's scene, which is the
   core pleasure the brief names ("I brought a boat; someone else gave it a
   river"). The six similes about passing things on (泡, 影) would have
   nothing to act on.
3. **Shared composition, temporary custody, consent to change hands**
   (chosen). Exchange is meaningful because it is visible and agreed, and no
   one can casually destroy another person's careful placement.

## What it costs

- More steps. Moving someone else's boat is a ghost, a send, and a wait,
  not a drag. The request list, timers and stale messages exist only because
  of this model.
- Timeouts when the custodian leaves. A request to someone who has closed
  their laptop waits 20 seconds and expires; their objects stay where they
  are until the round ends. We accept this rather than letting absence count
  as consent.
- More state to keep correct: object versions, proposal and offer states,
  leases, and expiry that must survive a restart.

## Related behaviour this decision depends on

- **Reconnect.** The SSE stream opens with a full snapshot and its event
  cursor, registered in the same synchronous turn so nothing can commit in
  between. Each later event has a monotonic id; a client ignores ids it has
  seen and resyncs from a fresh snapshot on any gap or round boundary. While
  disconnected, the UI disables actions and drops in-progress gestures; it
  never queues them to replay later.
- **A common round clock.** Phases are server timestamps (compose 0–300 s,
  refine to 360 s, reveal to 390 s, dissolve to 420 s). Clients derive the
  countdown, the lightning (电) window, bubble drift and effect fades from
  those timestamps and a clock offset, so everyone sees the same moment. A
  server-side tick (and every request) reconciles expiries and phase changes;
  after a restart it reconciles elapsed deadlines once and never restarts the
  timer.
- **An immutable archive.** At the end of refine, unresolved proposals are
  cancelled, bubbles return home, and the final composition plus up to
  eleven keyframes are written once (a conditional status update guards it),
  then never changed. The round's raw event log is dropped after archiving
  to keep storage bounded.
- **Ephemeral versus durable.** Durable: objects, custody, versions,
  invitations, proposals, offers, dew quota, palettes, archives. Ephemeral:
  drag previews (broadcast without touching the database or the cursor),
  shadows (影, held in memory for 10 s), and visual effects (dew halos,
  relationships, lightning), which clients derive from durable state and
  timestamps rather than receive frame by frame.
