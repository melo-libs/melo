---
name: design-craft
description: Melo UI implementation conventions — pixel-grid discipline, token usage, and the design-source restoration workflow. Use when porting components from the design source, writing or changing SCSS, or fixing visual polish issues (blur, misalignment, washed-out colors).
---

# Design craft — Melo

The design source is the single truth for visuals; this skill is about porting
it into product code with craft. Two failure modes to avoid: improvising values
the design already specifies, and copying the design's own bad habits into the
app verbatim.

## Restoration workflow

1. Pull the latest design source before restoring anything — the local
   `.reference/design/` bundle is a snapshot and goes stale. Compare against
   the source file, not a screenshot.
2. Restore faithfully first. Apply only the port-time normalizations below;
   anything else that changes the look is a deviation and needs a user call.
3. Every intentional deviation gets a comment at the site (what changed, why),
   is surfaced to the user, and — once approved in-app — should be backported
   to the design project so the source stays true.

## Port-time normalizations (apply silently, they fix the mock, not the design)

The design mock is a hand-tuned webpage viewed on a retina display. These
habits of it are bugs at product quality; fix them while porting:

- **Fractional font sizes** (`12.5px`, `11.5px`…) → nearest integer per role.
  Half-pixel type makes text metrics, line boxes, and every layout they drive
  fractional.
- **`color-mix(in oklch, …, var(--paper))`** → mix in `srgb`. oklch is polar
  and paper's explicit 0° hue drags azure mixes toward red (the pink-tint bug).
- **Blanket svg sizing** (`.foo svg { width: … }`) that catches unrelated
  glyphs (carets, badges) → scope the selector to what it means.
- **Remote font/CDN references** → bundled local assets only.
- **"vault" in copy** → "workspace" (product language).

## Pixel-grid rules (all new/changed styles)

- Font sizes: integers only.
- Sizes of crisp elements (icons, separators, chips, swatches): same parity as
  their container, so flex centering lands on whole pixels — a 14px icon in a
  26px button sits at 6px ✓; a 13px separator in a 26px row sits at 6.5px ✗.
- JS-positioned overlays: `Math.round()` measured coordinates before writing
  `style.left/top` — `coordsAtPos`/`getBoundingClientRect` return fractions,
  and a 1px border on a half-pixel position renders as a two-pixel smear.
- Flex rows mixing text-sized children with 1px separators: text measures
  fractional and pushes everything after it off-grid; snap those children's
  widths (`Math.ceil` of measured width) — see the BubbleMenu width-snap.
- Legitimate fractions — do not "fix": `0.5px`/`1.5px` borders (intentional
  retina hairlines) and sub-pixel transform nudges on press states.
- Existing approved surfaces are not retro-swept for these rules; clean a spot
  only when it visibly misrenders or you're already changing it.

## Token discipline

- Never hard-code a color that exists as a token (`--ink*`, `--paper*`,
  `--hairline*`, `--accent`, `--link`, `--ai`, `--selection`). A genuinely new
  hue needs a token plus its dark-theme value in `tokens.scss`.
- Radii from `--r-sm/md/lg` and shadows from `--shadow-*` unless the design
  explicitly sets a one-off (then keep it proportional: radius scales with the
  element's height).
- Interactive glyphs and labels rest at `--ink-2` or darker; `--ink-3`/`--ink-4`
  are for secondary/tertiary _text_, not for controls someone must find.

## When there is no design source (the design decision falls to us)

New UI the design project doesn't cover yet (a marker, a menu, a control) —
method adapted from Anthropic's frontend-design skill:

- Propose a compact plan before building: what it does, the values it uses
  (in tokens, not raw hex), and the one detail that carries its character.
  Get the user's call, then build exactly that.
- Self-check: "would I produce this for any app?" If yes, it's a default, not
  a decision — revise before proposing.
- Spend boldness in one place, keep the rest quiet (the Ask Melo button is
  one gold spark on an otherwise plain button — that's the register).
- Approved outcomes get backported to the design project, same as deviations.

Interface copy is design material, same discipline:

- Name things by what the user controls and recognizes, never by how the
  system is built.
- A control says what happens ("Save changes", not "Submit"), and an action
  keeps its name through the flow — "Copy as Markdown" ends in "Copied".
- Errors state what went wrong and how to fix it, without apologizing or
  vagueness. An empty state is an invitation to act, not a mood.
- Product language: "workspace", never "vault".

## Diagnosing "looks blurry / not crisp"

Find the rendering cause before touching values, in this order: sub-pixel
position of the element itself → fractional widths of earlier flex siblings →
odd-in-even centering → scale/rasterization during animation → inherent
antialiasing (diagonal strokes, 1x displays). Each has a different fix; only
the first three are fixable with the rules above.

## Verify

- `pnpm run typecheck:web` + prettier on touched files.
- The user validates in the running app before commit; don't claim visual
  results you haven't seen.
- Cross-review non-trivial changes (codex loop) — accept its problem reports,
  judge its fix directions yourself.
