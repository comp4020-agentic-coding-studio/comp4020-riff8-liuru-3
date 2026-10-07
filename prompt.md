# Riff 8 pod brief: 六如 · 共梦长卷 / Liuru — A Shared Dream Scroll

## 0. Your assignment and the Riff contract

Implement this brief in this pod repository, comp4020-riff8-liuru-3. You are the downstream crit agent executing a student-written prompt once, unattended. The pod-run doctrine allows up to four hours; use that budget to build, verify, and refine, while following any tighter actual runtime limit. Commit a working application; do not stop at a proposal, mockup, or implementation plan. Resolve routine details yourself using the priorities below. There is nobody available to answer questions.

This is the Riff 8 prompt aimed at C9, "All at once":
https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/09-all-at-once/

Riff workflow context:
https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/studio-crit-model/#the-riff

Read the repository's current CLAUDE.md, README.md, source, tests, deployment configuration, and relevant history before implementation. Inspect the pod's existing live app at https://comp4020-riff8-liuru-3.fly.dev/ as a baseline. Never post test data to that live app. Use disposable local data for your tests.

The special Riff block at the beginning of CLAUDE.md governs this run:
- Students change only prompt.md. That restriction does not prevent YOU, the downstream agent, from implementing this brief across the application.
- Keep that entire introductory Riff block, through the separator before "Your harness", unchanged.
- This prompt replaces conflicting old PRODUCT decisions below that block. The guestbook, permanent text traces, reverse-chronological wall, and six-category form are not the new product.
- You may rewrite application code, UI, old app-specific tests, and the lower project-specific portion of CLAUDE.md. Update README.md to explain the new design and its tradeoffs.
- Keep spec/invariants.test.ts unchanged and green. Keep the real checks; do not weaken CI to make the project appear finished.
- This pod riff has no graded submission cutoff, no new reflection, and no PROCESS.md entry. Leave the inherited PROCESS.md and reflections/ untouched. Existing evidence checks must still pass.
- Do not modify agent/ or external memory/, the original comp4020-final-liuru repository, other pods, course credentials, or course infrastructure.
- Work only in this clone. Make clear local commits, but DO NOT push or deploy during the downstream pod run: the course harness pushes after you stop, and CI deploys the pod app.
- Delete prompt.md in your LAST implementation commit, as the Riff contract requires. Do not invent or move course-managed prompt tags.

The C9 target that matters here: accepted shared actions must become visible in other open sessions within about one second without reload, and one meaningful multi-user behavior decision must be documented with alternatives and costs. The Riff-specific exemptions above override the ordinary C9 submission paperwork.

## 1. Product thesis and non-negotiable direction

Rebuild the site as a cooperative, real-time Chinese ink-wash handscroll assembled from prepared visual motifs. Working title: "六如 · 共梦长卷" / "Liuru — A Shared Dream Scroll".

Players do not need to draw. They choose, place, arrange, lend, and combine trees, boats, mountains, figures, pavilions, animals, water, moonlight, and other curated motifs. Everyone inhabits the SAME composition. Each round has a poetic situation to interpret, and each participant has a different limited selection of motifs.

Preserve the original six similes — 梦 dream, 幻 illusion, 泡 bubble, 影 shadow, 露 dew, 电 lightning — and their ideas of impermanence, changing appearances, passing things to others, and a brief shared encounter. Turn those ideas into visible behavior. Do not reduce them to six tags, six colors, a marketing paragraph, or unrelated collectible powers.

The core pleasure is: "I brought a boat; someone else gave it a river; another person sent us a moon; together we made a scene none of us planned." Theme interpretation and composition are the human challenge. There is no objectively correct collage.

Success must be apparent within 30 seconds: a newcomer understands the dream's prompt, can place a beautiful motif, sees another person change the same scene, and discovers at least one reason to interact.

Do not deliver a text message wall with a decorative background, a freehand drawing editor, a solo sticker collage with nominal online presence, an abstract particle field, or a competitive guessing game. No accounts, chat feed, likes, rankings, streaks, paid services, AI aesthetic scoring, or obligatory audio.

## 2. A complete round

Use one public shared room initially; the same root URL brings classmates into the same active dream. Optimize for 2–4 people, and remain usable with one person and at least eight connected browsers. Multiple private rooms are optional future work, not this run's priority.

Use a server-owned round state machine. Default duration: seven minutes.
1. Waiting: show the available dream title, faint landscape scaffolding, and a clear "入梦 / Begin dream" button. Anyone can start; simultaneous start requests create exactly one round.
2. Compose, 0–300 seconds: deal motif palettes, allow placement, invitations, borrowing, transfers, and effects.
3. Refine, 300–360 seconds: stop palette rerolls and new motif placements. Allow moving, withdrawing, lending existing objects, and resolving invitations. Say clearly "留一点空白 / Make room for the scene".
4. Reveal, 360–390 seconds: freeze the final composition, cancel unresolved proposals consistently, persist the final snapshot, hide editing chrome, and offer a slow optional panorama. Do not seize the camera from a person using reduced motion or interacting with controls.
5. Dissolve, 390–420 seconds: the active scene gently fades back into paper. The saved record remains available as a dream trace.
6. Finished: offer the saved dream and "再入一梦 / Another dream". Starting again is explicit, server-authoritative, and idempotent. Do not generate endless empty rounds while nobody is present.

A visitor can join an active round without resetting it. Late joiners get the current scene, correct phase/deadline, and a palette if placement is still open. During reveal/dissolve, explain that they can watch and join the next dream.

One person can begin, arrange, try effects, and finish a valid scene. Explain quietly that lending and collaboration become available when another visitor joins. Never simulate human collaborators. Provide a copy-link control with a manual-copy fallback.

Time uses server timestamps. After a server restart or empty room, reconcile elapsed deadlines once; do not restart the timer, create duplicate archives, or replay every missed animation. The last persisted valid composition is the basis for the frozen snapshot if a deadline elapsed while the server was down. Do not start the next round automatically.

Use these initial dream prompts, with thoughtful short English translations:
- 雨停了，人还没回来。 / The rain has stopped. Someone has not returned.
- 有人住在月亮经过的地方。 / Someone lives where the moon passes.
- 一艘没有目的地的船。 / A boat with no destination.
- 山的另一边传来了灯火。 / Beyond the mountains, a light appears.
- 热闹散去以后。 / After the gathering has gone.
- 风把远方带到了窗前。 / The wind brought somewhere far away to the window.

Choose one prompt per round from a seeded sequence. All participants see the same prompt. The first round should use the rain/return prompt for a coherent first encounter. Do not automatically reject an unexpected motif: a tiger at an empty ferry landing may tell an excellent story.

## 3. Motifs, palettes, and composition rules

Aim for 36–48 distinct, finished motifs; the minimum acceptable library is 24 across every group below. Variants must differ meaningfully in silhouette, not just color.
- Landscape: mountain ridge, distant peaks, rock, island/bank, water patch, reeds.
- Plants: pine, willow, bamboo, bare branch, lotus, grasses.
- Built places: pavilion, bridge, window, cottage, steps, lantern.
- Journeys and people: empty boat, sailboat, traveller, seated figure, umbrella.
- Living things: crane, small birds, fish, deer.
- Atmosphere: moon, sun, cloud, mist, rain veil.

These are prepared assets, not drawing prompts. The default interaction is select-and-place. Freehand brushes and arbitrary uploads are out of scope.

At round entry, deal each participant eight motif TYPES. Types can be reused within placement limits; the palette is not a consumable economy. Palettes should overlap a little but differ enough to invite exchange. Each palette must contain at least one landscape/water type, one focal subject, and one small atmospheric/detail type. With 2–4 players, distribute complementary types across palettes. Solo users get a balanced palette.

Allow two palette-slot rerolls per participant during Compose. Existing placed objects survive rerolls. Persist each deal and reroll count so reloading does not redeal unlimited choices.

Default limits: 48 placed objects across the scene and 12 under one participant's current care. These are generous anti-clutter limits, not a score. Explain limits calmly; withdrawing one's own object frees capacity. No currency, purchases, rarity tiers, or loot-box presentation.

An object supports position, bounded scale, horizontal flip, modest rotation, ink density, and background/middle/foreground depth. Keep transformations visually sensible; do not allow a stamp to cover the entire scroll. Default sizes should already make trees, people, boats, and buildings compose naturally.

Separate original contributor from current custodian. Custody determines who may directly move, alter, withdraw, or offer an object; original contribution remains in the archived record. Withdrawing removes a current scene object and frees a slot; it does not delete prior archives or mint extra palette types.

## 4. Three essential multiplayer mechanics

### 4.1 留白邀作 / Leave an opening

A player can place up to two unobtrusive invitation marks in empty space. Choose from preset intentions, with brief bilingual labels:
- 一点生气 / A sign of life
- 有人来过 / Someone was here
- 通向远处 / A way into the distance
- 一处归宿 / Somewhere to return
- 留白 / Leave this open

Another player can propose a motif at the invitation. Show a translucent preview before acceptance, visible to both parties. The inviter can accept or decline. Acceptance atomically places the respondent's motif under the respondent's care and closes the invitation; validate phase and capacity at acceptance. Proposals expire after 20 seconds and cannot be accepted after they become stale.

For "Leave this open", the response is a simple acknowledgement, not a forced object. It communicates a compositional intention without creating a permanent forbidden zone. When Compose ends, cancel unaccepted invitations that would create a new object; during Refine only acknowledgements and transfers/moves of existing objects may complete.

A player can always place their own motifs normally; requests are opportunities, not mandatory approval for every action. At most one outstanding proposal per invitation. Nobody can consume somebody else's palette or silently edit their work.

### 4.2 借景 / Borrow a view

Selecting somebody else's object opens "借景 / Suggest a move", not unrestricted editing. The requester positions a ghost preview; the original remains where it is. The current custodian sees an anchored accept/decline choice and a preview of the destination/transform.

Acceptance applies the proposed transform and transfers custody to the requester in one transaction. It preserves the original contributor and observes capacity limits. Decline or a 20-second timeout leaves the original unchanged. A disconnected custodian does not imply consent. Allow the proposer to cancel.

A proposal uses the object's current version. Any intervening object change makes it stale; show a human-readable message instead of overwriting the newer state. Do not add whole-scene drag, delete-other-people, or "clear all" controls.

The core must work for a single object. Group borrowing is optional polish only after the single-object flow is robust.

### 4.3 景物相应 / Motifs respond to one another

Implement at least four observable relationships using motif metadata and geometric anchors:
- Boat on water: gentle bobbing and a small wake.
- Bird near tree: a perched pose and occasional wing motion.
- Lantern inside/near pavilion or window: a restrained warm glow.
- Moon above/near a water patch: a clipped, rippled reflection.

If time allows, a bridge between two bank anchors gains an occasional small passing silhouette.

Use transparent, deterministic rules based on tags, anchors, and proximity; no image recognition, LLM calls, or external services. Author water surfaces, branch/perch points, and shelter anchors in asset metadata. Pair objects deterministically so clients agree. End the response when the spatial relation ends. Effects must not recursively spawn more effects or count as inventory objects.

Relationships work in solo mode too. When two contributors create one together, show a brief local acknowledgement such as "你们让这盏灯有了归处 / Together, you gave the light a home". Avoid scores, reward banners, and repetitive notifications.

Players need to discover these relationships: give a small contextual hint for a selected boat, lamp, bird, or moon. Do not hide all affordances behind poetry.

## 5. The six similes as a coherent interaction system

Make all six perceptible, but do not build six elaborate minigames. The simple versions below are sufficient.

### 梦 Dream — the shared life of the scroll
The poetic prompt, communal composition, timed reveal, and eventual dissolution form one dream. Use a paper-unfurl entrance and faint distant scenery, clearly environmental rather than fake player contributions.

During editing, preserve legibility and stability: do not continuously erase people's placed assets. Impermanence happens through transient proposals/shadows, temporary effects, and the shared closing dissolution. This intentionally replaces the earlier idea of every object independently expiring, which would undermine careful composition.

### 幻 Illusion — the same motif acquires another meaning
Give the current custodian a "化影 / Become a reflection" toggle: turn their object into a vertically reflected, lower-opacity version attached to a nearby water surface. Returning to solid form restores its regular placement. Disable with a clear contextual hint if no water is nearby.

This is a reversible state of the original object, not an inventory-duplicating exploit. A reflected object cannot simultaneously generate an automatic second reflection. If the supporting water disappears, restore the solid version to its last valid placement. A small mist treatment can reinforce the change, but meaning must come from spatial reinterpretation, not a generic blur button.

### 泡 Bubble — passing something to another person
A custodian can offer one of their placed objects inside a floating ink bubble. The object stays reserved, visibly offered, and cannot simultaneously be moved or offered again. Another participant selects the bubble, claims it, then chooses its new location within a short placement window.

First valid claim wins atomically. Everyone sees the result; later claimants see "已被接住 / Someone has already received it". Transfer custody only on a completed valid placement. An unclaimed offer expires after 20 seconds; a valid claim grants an eight-second placement lease, never beyond the editing cutoff. If the offer or lease expires, the recipient cancels, disconnects without completing, or editing closes, restore the object at its original location and custody. Keep claims versioned.

Offer drift is bounded and deterministic, computed from a server seed/start time. Include a tap/button route, not just chasing a moving target. No duplicate stamp is created. Receiving a bubble grants custody of that object, not an unlimited new palette type.

### 影 Shadow — a trace of a former place
A successful move or handoff leaves a faint noninteractive silhouette at the old location for roughly 10 seconds. Another player can compose around the gap. Shadows neither block placement nor count toward the object limit. Bound their number and clean them up. Under reduced motion, use a static pale outline that disappears quietly.

### 露 Dew — blend the composition
Each participant has two dew applications per round. A small visible droplet can be placed over a limited region; nearby ink gains a soft wet edge/halo for about 15 seconds before settling. This helps discrete motifs feel painted on one surface.

Dew never changes ownership, hit targets, or geometry, and must not permanently blur someone else's work. Apply the effect to artwork only, never to controls or text. Broadcast the region and timestamp; all clients derive the same temporary appearance. Provide a small preview of the affected area before applying.

### 电 Lightning — a fleeting alternate atmosphere
Once during Compose, at around 210 seconds, a shared atmospheric event arrives. Give a quiet five-second cloud/wind cue. Show a gentle local sky illumination, a brief gust, bird wing motion, lantern movement, and ripples; then settle back into the same composition.

Do not use a full-screen white flash, strobing, loud sound, or destructive relocation. It changes how the picture is perceived, not anyone's ownership or carefully chosen positions. Reduced-motion users see a still tonal change and a short status description. Joining late must not replay a stale flash.

## 6. Art direction and asset production

The visual target is a restrained Chinese literati landscape handscroll, with the spacious composition of ink painting and very light blue-green landscape accents. The scene should look assembled from one painter's coherent vocabulary.

Use:
- Warm xuan-paper ground: approximately #F3EBDD, with very subtle fibre/grain.
- Soot ink: #292B29; dry-brush midtone: #62665F; mist: #B9BCAE.
- Muted mineral green #788C7A and blue-grey #778C99 for occasional washes.
- Sparse cinnabar #A44D3C for small seals and selected states.
- Tiny warm lantern accents, never a neon glow.
- Uneven brush edges, tapered strokes, layered translucent washes, atmospheric depth, and transparent cutouts.
- Broad negative space, low distant hills, overlapping depth planes, and asymmetrical focal points.

Avoid generic dashboard cards around the picture, purple gradients, glass panels, emoji scenery, flat clip-art icons as finished motifs, thick cartoon outlines, plastic 3D objects, and decorative "Asian" clichés. Do not fill the background with temples, dragons, lotus symbols, or faux calligraphy merely to signal the theme.

Typography: a readable CJK serif/Song-style face for titles and dream prompts; a clean readable interface face for controls and guidance. Prefer a licensed local/subset font or dependable system fallbacks. Never block the app on a remote font provider. Main controls must remain readable at normal size; decorative calligraphy is optional only for a small title mark.

Primary interface language: Simplified Chinese with short English labels/translations on essential controls, onboarding, prompts, and explanations so classmates can play. Do not require a complete translation framework. Set document language correctly and mark English fragments where practical.

Asset workflow:
1. First look for a coherent reusable ink-wash collection with explicit permission for redistribution and transformation. Verify the original source and licence; search-result visibility is not permission. Record source page, author, licence, local file, and modifications in docs/assets.md or an equivalent manifest.
2. Curate for a matching brush language and viewpoint. Do not assemble mismatched assets merely because each is called "ink".
3. If usable external assets are unavailable, create an original coordinated set, using available image-generation tooling if present or carefully authored vector motifs. Do not spend the entire run sourcing assets, purchase anything, or require a new account/API key.
4. Hand-authored SVG is acceptable if it genuinely uses layered brushlike silhouettes and washes. A triangle mountain, stick tree, and emoji boat are not acceptable finished art.
5. Ship all used assets locally; no hotlinks or runtime image generation. Follow the repository's media constraints: raster assets at most 2560px and AVIF where required, transparent cutouts preserved, every file below 5 MB. Original sanitized vector assets may remain SVG. Optimize total transfer size; load palette thumbnails and current scene assets first.
6. Inspect real cutouts on the actual paper background. Eliminate white rectangles, edge halos, inconsistent scale, and blurry enlarged thumbnails.

Include an attribution page linked from the application. The final result needs a coherent library, not only a promise to replace placeholders later.

## 7. Website structure and exact responsibilities

The root should open the shared workspace immediately. A compact first-visit guide may overlay it, but do not put the playable app behind a long landing page.

### A. Header / room context
A narrow top bar: title/seal at left; current dream title and phase/deadline centrally; Share, How to play, Dream archive, and About at right. Show connection state quietly. Small anonymous session marks can indicate actual recent collaborators; do not show public identity profiles, follower counts, popularity indicators, or fabricated activity.

### B. Main handscroll
The dominant visual region: approximately two-thirds or more of the desktop viewport. Use a fixed logical coordinate space such as 2400 by 900, independent of browser size. Map pointers through the camera transform.

Support pan, bounded zoom, Fit scroll, and a small overview strip. The artwork can extend horizontally beyond the viewport, but do not automatically pan while someone is placing an object. Every browser shares artwork coordinates; each viewer controls their own camera. The optional closing reveal can tour the whole scroll.

Background scaffolding is faint and sparse: one far ridge and a suggestion of water/ground are enough. It must still feel inviting when no player objects exist. Show a contextual first-placement cue, not a blank editor.

Display remote manipulation previews subtly. Ownership hints and handles appear on selection, not as permanent colored boxes covering the picture.

### C. 素材匣 / Motif tray
A compact bottom tray on desktop, organized by the participant's available types. Each thumbnail has a name and remaining reroll affordance. Show the broader catalogue in a secondary drawer as discoverable art, clearly separating "available to you" from "ask another player / unavailable this round".

Drag-to-place on desktop, and select-then-tap on all devices. A visible selected state and Cancel are required. Placement should not accidentally pan the scroll.

### D. Contextual object inspector
A small side panel or anchored toolbar, only when needed. Show motif name, custody status, scale/rotation/flip/density/depth, withdraw for one's own object, illusion state, bubble offer, and borrow request for another person's object.

Give actions plain labels alongside the poetic names. Disable unavailable actions with a short reason. Accept/decline requests must have touch-sized, keyboard-accessible controls.

### E. Invitation and effects tools
A restrained tool rail: Place, Leave an opening, Dew, Pan. The explanation panel shows the six similes and where each appears in play; do not invent six empty buttons just to complete a set.

Outstanding invitations/borrow requests have a small actionable list so they can be found even when outside the current viewport. No chat stream.

### F. Closing reveal and 梦痕 / Dream traces
Persist one immutable final scene per completed round, with its dream prompt, asset references, transforms, contributor marks, and enough bounded events/keyframes for a short replay or stepped before/after view.

An archive route such as /dreams/ shows modest thumbnail-like scene previews and titles, not a social feed. A detail route such as /dreams/:id supports read-only viewing, fitting the scroll, and the replay/keyframes. Do not require server-side screenshot rendering: re-rendering saved scene JSON with the same local assets is acceptable. Preserve the final scene's pre-dissolve legibility.

Archive storage and list queries must be bounded/paginated. No likes, public rankings, or comments. PNG export is optional, not a dependency of saving.

### G. Guidance and source pages
"How to play" explains in three steps: read the dream; arrange your motifs; complete another person's scene. Then show borrowing, bubbles, and the temporary nature of a round in concise examples.

Keep /readme/ serving the full current README.md as server-rendered HTML, with its headings in order. Link the asset credits and the design/ADR explanation from appropriate places. Include useful empty, loading, offline, full-capacity, and expired-request states.

### Mobile and accessibility
At a phone width around 390px, use a large central scene with a collapsible bottom motif drawer. The object inspector becomes a sheet; no horizontal overflow of the PAGE. The scroll itself remains intentionally pannable. Do not shrink the whole desktop interface into unreadable controls.

Every drag action needs a select/tap alternative. Provide keyboard selection via an object list, arrow-key nudging, scale/depth controls, and Escape to cancel. Use at least 44px touch targets, visible focus, sufficient text contrast, labelled buttons, and a restrained live region for meaningful connection/request/round changes. Do not announce every animation frame.

Respect prefers-reduced-motion and provide a manual motion toggle. The game's actions and outcomes must remain understandable without animation. No autoplay audio. The designed paper palette can stay light even on a dark OS theme; do not inadvertently invert artwork or lose control contrast.

## 8. Technical and persistence contract

The existing stack is plain Node HTTP with TypeScript, better-sqlite3, server-rendered templates, and Vitest. Prefer extending it with a small browser module and an SVG scene graph. Using SVG image elements for transparent assets gives explicit transforms, hit targets, layering, and accessible controls. Canvas is acceptable if the alternate controls and consistent coordinate mapping are implemented.

You may add a modest dependency where it materially helps. Do not introduce a framework migration, separate database/service, paid API, or build pipeline solely for prestige. Keep the Docker image, package lock, and start command working.

The fixed hosting shape remains one Fly machine with 256 MB RAM, one persistent /data volume, HTTP on 0.0.0.0:$PORT, and the existing deploy workflow. Do not create a second app or database, change machine size, or edit course secrets. Leave fly.toml's infrastructure settings intact.

Prefer SSE for server-to-client events and HTTP POST for actions. WebSockets are acceptable with a documented reason. Local optimistic previews are fine, but accepted server state must determine every durable change.

Persist at least:
- Rounds: ID, prompt, seed, phase timing, finalization/archive status.
- Anonymous participants: server-issued identity, palette, reroll/effect usage, within-round session mark.
- Scene objects: motif ID, transform, depth, original contributor, current custodian, version, illusion state.
- Proposals/offers/invitations: versions, parties, states, expiration timestamps, reservation semantics.
- An ordered stream of committed scene events or sufficient bounded keyframes, and final archive snapshots.

Use additive, repeatable migrations. Preserve the old traces table and existing data, though the old wall may disappear from the UI. Do not wipe /data or silently delete old user contributions. For this new product, withdrawing a scene object and dissolving the active picture are authorized design changes, not permission to erase historical records.

Authenticate anonymous actions with a server-issued persistent cookie, not a client-supplied owner ID. Treat client requests as untrusted: validate allowed motif IDs, coordinates, finite numbers, transform bounds, custody, object version, phase, quotas, and effect limits. Limit request sizes and abusive write frequency without implementing a sprawling moderation product.

Use same-origin write checks and appropriate cookie attributes. Keep identity tokens out of public payloads; send only safe participant marks. There is no arbitrary HTML/SVG upload or unescaped free-text message feature.

Important concurrency rules:
- One transaction per accepted mutation, with monotonic room event IDs.
- Each action has an idempotency identifier to prevent duplicate retries.
- Proposals and claims use expected object versions and explicit expirations.
- First valid bubble claim wins; failed claims never duplicate or remove the asset.
- Selection previews do not grant ownership. Any short manipulation lease expires safely and cannot strand an object.
- One participant opening two tabs must not gain duplicate palettes, quotas, or competing identities.
- Reconnect obtains a consistent snapshot and event cursor, then catches up without a gap between snapshot and subscription. Duplicate events are ignored; missed events lead to a resync.
- Phase transitions and final archival are atomic and idempotent. Late edits after freeze are rejected.
- Disconnect disables committing new actions and offers reconnect guidance. Do not silently queue gestures to replay in a later phase.
- Share server time/seed for animation derivation. Do not stream frames or broadcast a database write for every pointer pixel.
- Throttle ephemeral cursor/drag previews; commit bounded updates during meaningful movement and on release. Other viewers should see useful changes in about one second.
- Pending transfers/proposals expire or resolve correctly after restart; no item remains permanently locked.
- Keep memory, event replay size, animation instances, and assets bounded. Do not allocate a giant scene buffer per participant on the server.

## 9. The required multi-user decision record

Write docs/decisions/0002-shared-dream-custody.md, or the next free ADR number if this path already exists.

The decision must address behavior, not only "SSE versus WebSockets":
"We share one changing composition, while direct manipulation follows temporary custody. Others can propose a new view or receive an offered object; consent and atomic handoffs prevent a shared canvas becoming a fight."

Compare at least:
1. Everyone can edit everything immediately.
2. Each person's objects remain private and immutable to others.
3. The chosen proposal/bubble handoff model.

Explain what the chosen model enables and costs: meaningful exchange and protection from casual destruction, but more interaction steps and timeouts when the custodian leaves. Also document reconnect behavior, the common round clock, the immutable archive, and the distinction between ephemeral effects and durable scene state.

Update README.md with the new purpose, how to play, what "good" means, six-simile mapping, architecture, run/test instructions, and honest limitations. Explicitly explain why the old permanent guestbook has become a temporary shared scene with a saved dream trace. Update only the lower app-specific CLAUDE.md section to match reality; do not leave contradictory old wall rules directing the next agent.

Do not create a new reflection or rewrite PROCESS.md. Run the existing evidence check against the inherited files, and report an actual failure honestly rather than fabricating course evidence.

## 10. Verification and acceptance

Test the finished product, not just successful HTTP responses. Preserve the invariant tests and replace obsolete guestbook-only expectations with relevant scene behavior tests. Do not leave stale tests as a reason to keep the old UI.

Required automated or reproducible integration coverage:
- Palette assignment persists across reload and remains distinct for independent cookie sessions.
- A valid placement appears to another subscribed client without reload, targeting about one second under normal local conditions.
- Invalid transforms, spoofed custody, absent assets, and wrong-phase writes are rejected without corrupting the scene.
- Two users racing for the same bubble produce exactly one successful transfer.
- A stale/declined/expired borrow proposal cannot move the original object.
- Repeated action IDs do not duplicate objects, effects, or archives.
- Disconnection and resynchronization recover canonical state.
- Restarting on the same temporary data directory preserves scene, palette, and archive; expired states reconcile.
- Round freeze rejects late writes and archives once, even under simultaneous transitions.
- Relationship eligibility is stable and ends when motifs move apart.
- / and /readme/ still meet the unchanged course invariants.

Use configurable local test timings or an injectable clock to exercise phases efficiently. Do not add public "skip timer", "force finish", or admin backdoors for testing.

Required browser playtest, using independent identities rather than two tabs with the same cookie:
1. Open two real browser contexts, preferably four for the shared-creation test.
2. Place different motifs and observe both screens updating.
3. Form a boat/water or lantern/pavilion relationship using two people.
4. Leave and complete an invitation.
5. Propose a borrow and accept it; also decline or expire one.
6. Send and claim a bubble; exercise a race through integration testing.
7. Apply dew, use illusion near water, observe a shadow and the lightning event.
8. Disconnect one context, change the scene elsewhere, reconnect, and compare final object IDs/transforms/custody.
9. Complete a shortened LOCAL test round, see the reveal/dissolution, reload its saved archive, and begin another round.
10. Repeat essential placement, selection, and one handoff at mobile width and with reduced motion.

Use screenshots to inspect the whole workspace and actual motifs, not just DOM assertions. Check at least desktop 1440x900, a smaller laptop, and phone 390x844. Verify no rectangular image backgrounds, missing assets, overlapping controls, trapped scroll, or console errors.

Run pnpm check against the running app and pnpm check:evidence. Build/test the real Docker image if the environment supports Docker, because native SQLite dependencies and included assets matter. Report unavailable tooling explicitly; never claim browser/Docker tests ran if they did not.

Aesthetic acceptance: at least one four-person composition should feel like a single readable ink landscape, while allowing strange interpretations. Look for deliberate empty space, consistent line/wash treatment, clear focal scale, and effects subtle enough to keep the composition legible. No algorithmic harmony score.

## 11. Work order, scope discipline, and final handoff

Use the one-shot run well. Suggested order:
1. Inspect current app and constraints; establish scene schema, additive migration, and a thin real-time placement loop in two sessions.
2. Establish the actual paper/ink visual system and produce a coherent first 12 motifs. Resolve asset quality early.
3. Complete the shared round, persistent palettes, transforms, consent-based borrowing, bubbles, and invitation responses.
4. Add four motif relationships and the simple versions of all six similes.
5. Expand to at least 24 finished motifs, complete mobile/keyboard controls and archive rendering, then playtest and refine.
6. Complete ADR/README/lower CLAUDE updates, required checks, and a clean final commit that removes this prompt.

Must ship: one shared playable scroll; a real prepared motif library; poetic shared prompts; differing palettes; placement/transforms; invitations; consent-based borrowing; atomic bubble handoffs; four motif relationships; all six similes in their simple forms; a complete timed round and persisted archive; sub-second-target shared updates; restart/reconnect correctness; usable mobile controls; attribution; documented multi-user decision; green core checks.

Polish only after that works: 36–48 assets, grouping, elaborate ink diffusion, bridge pedestrians, continuous cinematic replay, PNG export, a theme chooser, or private rooms. If time is tight, reduce those optional items and visual complexity, not the central multiplayer interaction. Use bounded procedural shading instead of expensive simulations. A stepped replay is enough.

Do not substitute buttons that do nothing, mocked remote users, static images of a game, or descriptions of missing mechanics. If a required item truly cannot be finished, identify it honestly in the final report and README limitations; do not disguise it as completed.

Final downstream response should briefly state what was built, which tests actually ran, meaningful limitations, and that the course harness must push/CI-deploy the result. Do not claim the new live site was verified before that deployment. Leave main deployable, leave the Riff header untouched, and delete prompt.md only in your final implementation commit.
