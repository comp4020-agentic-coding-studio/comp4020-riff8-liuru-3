"""Split selected motifs into separately animatable part files.

Run from anywhere:  python3 -I scripts/split-motifs.py

Reads public/motifs/<motif>.svg and writes public/motifs/parts/<part>.svg plus
public/motifs/parts/parts.json. Stdlib only, deterministic output.

Contract, for every split motif:
- each part file keeps the original root <svg> tag and its <defs> verbatim
- the parts partition the drawable content: every original subpath lands in
  exactly one part, inside a copy of the same wrapping <g> (filter, opacity...)
- within a part, original paint order is kept; the manifest lists parts in
  stacking order (bottom first)

Subpaths are the unit of assignment: a <path> whose `d` holds several
absolute `M...` subpaths (e.g. a fish's two tail strokes, or three birds in
one path) may be split across parts; each piece keeps the path's other
attributes. Rules classify each subpath by its bounding box (bbox) or fill,
and every motif asserts the subpath count it was written against, so a
redrawn original fails loudly instead of silently mis-splitting.

The motifs are flat, hand-authored files: top-level <g> groups whose children
are self-closing shapes (plus the odd top-level shape, e.g. the lantern's
glow circle). The tokeniser below handles exactly that shape of file.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "motifs"
OUT = SRC / "parts"

# ---------------------------------------------------------------- parsing

TAG = re.compile(r"<g\b[^>]*>|</g>|<[a-zA-Z]+\b[^>]*/>")
NUM_OR_CMD = re.compile(r"[MmLlHhVvQqTtCcSsZzAa]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?")
ARITY = dict(M=2, L=2, H=1, V=1, Q=4, T=2, C=6, S=4, Z=0, A=7)


@dataclass
class Leaf:
    """One subpath (or one non-path shape) with its ancestor groups."""

    index: int  # element order in the file (paint order)
    sub: int  # subpath index within the element
    groups: tuple[tuple[int, str], ...]  # (group id, open tag) chain
    tag: str  # element markup, with `d` replaced for split paths
    fill: str
    bbox: tuple[float, float, float, float] = field(default=(0, 0, 0, 0))


def path_points(d: str) -> list[tuple[float, float]]:
    """On-curve and control points of a path, enough for a bbox."""
    toks = NUM_OR_CMD.findall(d)
    pts: list[tuple[float, float]] = []
    i, cmd, x, y, sx, sy = 0, "", 0.0, 0.0, 0.0, 0.0
    while i < len(toks):
        if toks[i].isalpha():
            cmd = toks[i]
            i += 1
        if cmd in "Zz":
            x, y = sx, sy
            cmd = ""
            continue
        n = ARITY[cmd.upper()]
        a = [float(v) for v in toks[i : i + n]]
        i += n
        rel, c = cmd.islower(), cmd.upper()
        if c == "H":
            x = x + a[0] if rel else a[0]
        elif c == "V":
            y = y + a[0] if rel else a[0]
        elif c == "A":
            x, y = (x + a[5], y + a[6]) if rel else (a[5], a[6])
        else:
            here = [((x + a[k], y + a[k + 1]) if rel else (a[k], a[k + 1])) for k in range(0, n, 2)]
            pts.extend(here[:-1])
            x, y = here[-1]
            if c == "M":
                sx, sy = x, y
                cmd = "l" if rel else "L"
        pts.append((x, y))
    return pts


def split_subpaths(d: str) -> list[str]:
    """Split `d` at each absolute moveto. Relative `m` would need rebasing."""
    assert "m" not in d, "relative moveto: rebase before splitting"
    starts = [m.start() for m in re.finditer("M", d)]
    return [d[a:b].strip() for a, b in zip(starts, starts[1:] + [len(d)])]


def parse(svg: str) -> tuple[str, str, list[Leaf]]:
    root = re.match(r"<svg\b[^>]*>", svg).group(0)
    defs = re.search(r"<defs>.*?</defs>", svg, re.S).group(0)
    body = svg[svg.index(defs) + len(defs) : svg.rindex("</svg>")]
    leaves: list[Leaf] = []
    stack: list[tuple[int, str]] = []
    gid = 0
    for n, m in enumerate(TAG.finditer(body)):
        tok = m.group(0)
        if tok.startswith("<g"):
            gid += 1
            stack.append((gid, tok))
            continue
        if tok == "</g>":
            stack.pop()
            continue
        fill = re.search(r'fill="([^"]*)"', tok)
        fill = fill.group(1) if fill else ""
        d = re.search(r' d="([^"]*)"', tok)
        pieces = split_subpaths(d.group(1)) if d else [None]
        for s, piece in enumerate(pieces):
            if piece is None:
                tag, pts = tok, []
            else:
                tag, pts = tok.replace(d.group(0), f' d="{piece}"'), path_points(piece)
            xs, ys = [p[0] for p in pts] or [0], [p[1] for p in pts] or [0]
            leaves.append(Leaf(n, s, tuple(stack), tag, fill, (min(xs), min(ys), max(xs), max(ys))))
    assert not stack, "unbalanced <g>"
    return root, defs, leaves


def render(root: str, defs: str, leaves: list[Leaf]) -> str:
    """Emit leaves in order, reopening each ancestor <g> as it was.

    Consecutive subpaths of one original element are re-joined into one
    <path> so the output stays as compact as the original.
    """
    out = [root, defs]
    open_chain: tuple[tuple[int, str], ...] = ()
    prev: Leaf | None = None
    for leaf in leaves:
        if prev and prev.index == leaf.index and prev.groups == leaf.groups and "<path" in leaf.tag:
            # same element continues: append this subpath to the previous `d`
            d = re.search(r' d="([^"]*)"', leaf.tag).group(1)
            out[-1] = _join(out[-1], d)
            prev = leaf
            continue
        common = 0
        while common < min(len(open_chain), len(leaf.groups)) and open_chain[common] == leaf.groups[common]:
            common += 1
        out.extend("</g>" for _ in open_chain[common:])
        out.extend(tag for _, tag in leaf.groups[common:])
        open_chain = leaf.groups
        out.append(leaf.tag)
        prev = leaf
    out.extend("</g>" for _ in open_chain)
    out.append("</svg>\n")
    return "".join(out)


def _join(tag: str, d: str) -> str:
    m = re.search(r' d="([^"]*)"', tag)
    return tag[: m.start(1)] + m.group(1) + d + tag[m.end(1) :]


# ------------------------------------------------------------------ rules
# Each rule maps a Leaf to a part id. bbox = (x0, y0, x1, y1) in viewBox units.

Rule = Callable[[Leaf], str]


def x0(l: Leaf) -> float:
    return l.bbox[0]


def y0(l: Leaf) -> float:
    return l.bbox[1]


def fish(l: Leaf) -> str:
    # Tail fin: every stroke starting right of x=53 (the body's outlines end at
    # x=55 but start at x<=5). That is the tail wash, both fin-edge strokes
    # (one path, two subpaths) and the curved ray inside the fin.
    return "fish-tail" if x0(l) > 53 else "fish-body"


def crane(l: Leaf) -> str:
    b = l.bbox
    # Neck + head: the S-curved neck (x<41, reaching from y=18 down to the
    # back at y=60), the head blob, the crown highlight and the beak; all of
    # these live left of x=41 and above y=61.
    if b[2] < 41 and b[3] < 61:
        return "crane-neck"
    # Legs: everything that starts below the body's belly line (y>=75),
    # except the long ground shadow (x0=40, width 50).
    if b[1] >= 75 and b[2] - b[0] < 30:
        # The folded (raised) leg is the stroke right of x=64 and ending above
        # y=101; the standing leg, its knee and its three toes are the rest.
        if b[0] > 64 and b[3] < 101:
            return "crane-leg-far"
        return "crane-leg-near"
    return "crane-body"


def deer(l: Leaf) -> str:
    b = l.bbox
    # Head: head outline, nose, eye, ear, antlers and the head's wash, i.e.
    # everything whose bbox ends left of x=53 and above y=41. The neck's
    # outlines are NOT separable: the nape is one stroke with the back
    # (40,31)->(108,58) and the throat one stroke with the chest, so they and
    # the neck wash stay in the body and the head nods about the nape.
    if b[2] < 53 and b[3] < 41:
        return "deer-head"
    # Legs: narrow (<10 wide) strokes starting at y>=70, plus their hoof dots
    # (start y>=109). Grouped by x into the four legs.
    if b[2] - b[0] < 10 and b[1] >= 70:
        cx = (b[0] + b[2]) / 2
        if cx < 55:
            return "deer-leg-front-near"
        if cx < 70:
            return "deer-leg-front-far"
        if cx < 98:
            return "deer-leg-hind-far"
        return "deer-leg-hind-near"
    return "deer-body"


def birds(l: Leaf) -> str:
    # One path, nine subpaths: (left wing, right wing, body) per bird.
    # Bird a sits left of x=36, bird b left of x=69, bird c beyond.
    cx = (l.bbox[0] + l.bbox[2]) / 2
    return "birds-a" if cx < 36 else "birds-b" if cx < 68 else "birds-c"


def lantern(l: Leaf) -> str:
    # The light is the radial glow circle and the warm wash + highlight
    # (#D9A55B, #F3EBDD) inside the paper; cord, caps, ribs and tassel are
    # the frame.
    return "lantern-light" if l.fill in ("url(#lantern-r)", "#D9A55B", "#F3EBDD") else "lantern-frame"


def willow(l: Leaf) -> str:
    # Original paint order: [blur group] trunk wash, foot shadow, two green
    # foliage washes; [brush group] ~87 hanging strands and leaf-fleck runs,
    # then the dark trunk, two paper highlights and the six dark branches.
    # Three parts reproduce that order exactly when stacked:
    #   willow-trunk-wash: the two grey (#62665F) washes in the blur group
    #   willow-fronds:     the green washes and every strand / fleck run
    #   willow-trunk:      the ink in the brush group (#292B29 trunk and
    #                      branches, #F3EBDD highlights)
    in_blur = "willow-w" in l.groups[-1][1]
    if in_blur and l.fill == "#62665F":
        return "willow-trunk-wash"
    if not in_blur and l.fill in ("#292B29", "#F3EBDD"):
        return "willow-trunk"
    return "willow-fronds"


@dataclass
class Spec:
    rule: Rule
    order: list[str]  # stacking order, bottom first
    subpaths: int  # subpath count the rule was written against
    points: dict[str, dict[str, list[float]]]  # per-part named points
    extra: dict[str, list[float]] = field(default_factory=dict)  # motif-level points
    notes: str = ""


SPECS: dict[str, Spec] = {
    "fish": Spec(
        fish,
        # Tail under body: the fin then tucks under the body outline when it
        # swings, instead of its wash lying over the body's ink.
        ["fish-tail", "fish-body"],
        18,
        {"fish-tail": {"pivot": [54.5, 17.5]}},
        notes="Tail drawn under the body so the fin root stays tucked when it swings; "
        "rotate fish-tail about its pivot (about +/-12deg) or skewY.",
    ),
    "crane": Spec(
        crane,
        ["crane-body", "crane-neck", "crane-leg-near", "crane-leg-far"],
        23,
        {
            "crane-neck": {"pivot": [37, 58]},
            "crane-leg-near": {"pivot": [62, 76]},
            "crane-leg-far": {"pivot": [66.5, 76]},
        },
        extra={"head": [32, 15], "foot": [61, 130]},
        notes="The crane stands on one leg with the other folded up under the body "
        "(crane-leg-far is the raised leg, ending at the knee/foot near y=100), so it "
        "is not drawn mid-stride: animate a 'walk' as the standing leg rocking a few "
        "degrees and the folded leg lifting/swinging about its hip, with the neck "
        "bobbing (rotate about pivot, about +/-6deg). Legs sit above the body, as in "
        "the original.",
    ),
    "deer": Spec(
        deer,
        [
            "deer-body",
            "deer-leg-front-near",
            "deer-leg-front-far",
            "deer-leg-hind-far",
            "deer-leg-hind-near",
            "deer-head",
        ],
        38,
        {
            "deer-head": {"pivot": [37, 33]},
            "deer-leg-front-near": {"pivot": [51.5, 73]},
            "deer-leg-front-far": {"pivot": [60, 75]},
            "deer-leg-hind-far": {"pivot": [94, 75]},
            "deer-leg-hind-near": {"pivot": [101, 73]},
        },
        notes="The neck is not separable: its outlines are continuous strokes with the "
        "back and chest, so deer-head is head + ear + antlers only and nods about the "
        "nape (keep rotation within about +/-6deg or the jaw parts from the throat stroke; negative = lower, positive = raise). "
        "Legs are split one per part (pivot at each hip) rather than one deer-legs "
        "part, so they can swing in diagonal pairs.",
    ),
    "birds": Spec(
        birds,
        ["birds-a", "birds-b", "birds-c"],
        9,
        {
            "birds-a": {"pivot": [22, 18.8]},
            "birds-b": {"pivot": [54.3, 32.2]},
            "birds-c": {"pivot": [80.3, 13.3]},
        },
        notes="Pivot is each bird's body dot (where the wings meet); scaleY about it "
        "flaps, translate drifts. The birds do not overlap.",
    ),
    "lantern": Spec(
        lantern,
        ["lantern-light", "lantern-frame"],
        14,
        {
            "lantern-light": {"pivot": [22, 40]},
            "lantern-frame": {"pivot": [22, 1]},
        },
        extra={"hang": [22, 1]},
        notes="Swing both parts together about hang; flicker lantern-light alone "
        "(opacity, or scale about its pivot, the paper's centre).",
    ),
    "willow": Spec(
        willow,
        ["willow-trunk-wash", "willow-fronds", "willow-trunk"],
        203,
        {"willow-fronds": {"pivot": [122, 60]}},
        extra={"crown": [122, 60]},
        notes="Three parts so the stack keeps the original paint order: the trunk's "
        "soft wash under the fronds, the trunk and branch ink over them. Keep "
        "willow-trunk-wash and willow-trunk still. Sway with skewX about the pivot (a few degrees) so tips move most "
        "and the strands stay on their branches; the trunk stays still.",
    ),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}
    for motif, spec in SPECS.items():
        root, defs, leaves = parse((SRC / f"{motif}.svg").read_text())
        assert len(leaves) == spec.subpaths, f"{motif}: {len(leaves)} subpaths, rules expect {spec.subpaths}"
        by_part: dict[str, list[Leaf]] = {p: [] for p in spec.order}
        for leaf in leaves:
            part = spec.rule(leaf)
            assert part in by_part, f"{motif}: rule gave unknown part {part}"
            by_part[part].append(leaf)
        assert sum(map(len, by_part.values())) == len(leaves)
        parts = []
        for part in spec.order:
            assert by_part[part], f"{motif}: {part} is empty"
            (OUT / f"{part}.svg").write_text(render(root, defs, by_part[part]))
            parts.append({"id": part, **spec.points.get(part, {})})
        entry: dict = {"parts": parts, **spec.extra}
        if spec.notes:
            entry["notes"] = spec.notes
        manifest[motif] = entry
        counts = ", ".join(f"{p}={len(v)}" for p, v in by_part.items())
        print(f"{motif}: {counts}")
    manifest["water"] = {
        "parts": [{"id": "water-glint"}],
        "notes": "water-glint is new art (hand-written, not split): an overlay for "
        "water.svg with the same viewBox; translate it slowly along x (a few units) "
        "and/or fade it.",
    }
    (OUT / "parts.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
