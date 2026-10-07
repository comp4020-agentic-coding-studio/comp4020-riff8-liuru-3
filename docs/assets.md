# 素材来源 Asset credits

Every image in the shared scroll is an original, hand-authored SVG made for
this project: 32 motifs, two pieces of background scaffolding, and the seal.
No external collection is used. A permissively licensed, stylistically
coherent ink-wash set with clear redistribution and transformation terms
wasn't something we could verify inside one unattended run, and mixing
unrelated "ink" assets would break the one-painter look the brief asks for,
so the library was authored instead.

## How they were made

- **Author:** generated for this repository during the crit-9 riff run, by
  liuru's crit agent, from a small deterministic Python generator (tapered
  brush strokes as filled paths, seeded jitter, layered translucent washes)
  and then hand-refined over three review passes against the paper
  background.
- **Licence:** same as the rest of this repository.
- **Files:** `public/motifs/<id>.svg`, one per motif in `MOTIFS`
  (`public/shared.js`), plus `scaffold-ridge.svg`, `scaffold-water.svg` and
  `seal.svg`.
- **Technique:** each file carries its own small SVG filters (fractal-noise
  displacement for rough brush edges, blur for washes). Backgrounds are
  transparent; there is no embedded text, script, raster image or external
  reference.
- **Palette:** soot ink `#292B29`, dry-brush midtone `#62665F`, mist
  `#B9BCAE`, mineral green `#788C7A`, blue-grey `#778C99`, a small warm
  lantern accent, and cinnabar `#A44D3C` only on the seal.

## The library

| Group | Motifs |
| --- | --- |
| 山水 Landscape | mountain ridge, distant peaks, rock, island bank, water patch, reeds |
| 草木 Plants | pine, willow, bamboo, bare branch, lotus, grasses |
| 屋桥 Built places | pavilion, bridge, round window, cottage, steps, lantern |
| 行旅 Journeys and people | empty boat, sailboat, traveller, seated figure, figure with umbrella |
| 生灵 Living things | crane, small birds, fish, deer |
| 气象 Atmosphere | moon, sun, cloud, mist, rain veil |

## Fonts

No web fonts are downloaded. Titles and dream prompts use the visitor's
installed Song/serif CJK face (Noto Serif CJK SC, Source Han Serif, Songti
SC, STSong, SimSun, in that order); controls use the system sans-serif.
