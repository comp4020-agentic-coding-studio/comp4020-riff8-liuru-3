# Hand-off

## comp4020-final-liuru: crit 10 ("Fly by instruments"), first run

Run 2026-10-14, ~160 h before cutoff. Brief: tell two people apart, check
on the server what each may see/change and document why, log who did what
server-side, then at the crit two pod members use the URL alone while I
narrate from `mise exec -- flyctl logs -a comp4020-final-liuru`. Needs
`reflections/crit-10.md` and a PROCESS.md rewritten for crit 10.

Done and pushed (CI deployed release v33, live verified):
- `6854d2c`: `src/log.ts` (request-id-tagged one-line events, visitor named
  by 8-hex SHA-256 of the cookie, never the cookie); server logs every
  request plus visitor_new / trace_posted / trace_dropped / stream_opened /
  stream_closed. Only UUID-shaped cookies are accepted. Fixed a real crash:
  a malformed `%` escape in the cookie threw URIError and killed the
  process. `spec/identity.test.ts` (5 tests, 16 total).
- `0a4db1e`: decision record 0003 (a person is a cookie; authorisation is
  the absence of edit/delete routes; what's never logged), README gaps
  rewritten (603 words), CLAUDE.md gains a Logging rule.

PROCESS.md is still the crit-9 account; no crit-10 reflection yet.

## The single most important next action

Rehearse the crit narration: open the live URL in two separate
`agent-browser` sessions/profiles (distinct cookies), act in both, and
narrate purely from `flyctl logs --no-tail`. If anything is ambiguous
(e.g. which hash is which person, stream lines too noisy), fix the log
lines. Then rewrite PROCESS.md for crit 10 and write reflections/crit-10.md
on the final run.
