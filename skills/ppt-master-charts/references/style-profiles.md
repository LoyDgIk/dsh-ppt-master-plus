# Style profiles

**Form is style-independent. Look is not.**

The design reference for this skill was authored in one fixed style — a
blue-gray business palette, a specific typeface, a specific canvas — and that
style is baked into it. This skill keeps the *forms* and the *craft*, and treats
the look as a **swappable profile**.

Concretely: nothing in [`archetype-catalog.md`](./archetype-catalog.md) names a
colour. A `fishbone` is a fishbone in any palette. If a rule only holds in one
style, it belongs in a profile, not in the catalog.

## Precedence

Resolve the profile from the first source that exists:

1. **A workspace the user supplied.** An upstream Stage-1 template choice —
   a brand, style, layout or deck workspace — carries identity and outranks
   everything here.
2. **A profile in `assets/style-profiles/`.** Named by the user, or chosen by
   the brief.
3. **A profile derived from the brief.** See "Deriving one" below.
4. **`neutral-default.json`.** A deliberately colourless fallback, so that
   "no style given" never silently means "blue-gray".

**Never let this skill's sample palette override a supplied brand.** The
blue-gray profile exists to show what a complete profile looks like, not to be
the house style.

## Schema

A profile is a plain JSON file. Every field is optional; an absent field means
"resolve it upstream" rather than "use a hidden default".

```jsonc
{
  "schema": "dsh-ppt-master-plus.style-profile.v1",
  "id": "blue-gray-business",
  "name": "Blue-gray business",
  "provenance": { "kind": "reference-sample", "note": "..." },

  "canvas":      { "format": "ppt169", "width": 1920, "height": 1080 },
  "contentArea": { "left": 150, "right": 1770, "top": 120, "bottom": 960 },

  "palette": {
    "primaryRamp": ["#0B3E8F", "..."],   // ordered dark → light
    "text":        { "primary": "...", "secondary": "...", "muted": "..." },
    "surfaces":    { "card": "...", "track": "..." },
    "accent":      { "base": "...", "gradient": ["...", "..."] },
    "background":  { "gradient": ["...", "...", "..."] },
    "inverse":     { "fill": "...", "text": "...", "textSecondary": "..." }
  },

  "typography": {
    "cjk": "Microsoft YaHei", "latin": "Arial",
    "roles":   { "title": 44, "itemTitle": 25, "body": 17.5, "label": 16, "footer": 14 },
    "display": { "min": 40, "max": 72 },
    "minSize": 14
  },

  "shape": {
    "cornerRadius": { "card": [16, 26], "barTop": [8, 10] },
    "shadow":   { "card": "0 8 24 rgba(10,58,136,.10)" },
    "strokeWidth": 2,
    "iconStroke": "round"
  },

  "rules": {
    "maxAccentUsesPerPage": 2,
    "minContrastRatio": 4.5,
    "categoricalUsesRampOnly": true
  }
}
```

### Field notes

- **`palette.primaryRamp`** is ordered dark → light. Categorical series take
  their colours from this ramp by depth, so a chart never introduces an
  unrelated hue. This is what keeps a multi-series chart on-brand without the
  author choosing colours.
- **`contentArea`** is the safe region. Everything except background decoration
  stays inside it. Expressing it as numbers rather than "margins" makes it
  checkable.
- **`typography.minSize`** is a hard floor, and it applies to chart tick labels
  and source lines too — the two places it is usually violated.
- **`rules.maxAccentUsesPerPage`** turns craft rule 4 into a number
  `chart_plan.py` can enforce.
- **`rules.categoricalUsesRampOnly`** encodes "do not introduce green, purple or
  red for series" as policy rather than habit. Negative values use the accent,
  not a red/green opposition — which also avoids the red-green colour-vision
  failure.

## Deriving one

From a brand, in this order:

1. **Primary colour → a ramp.** Take the brand's primary and generate 6–8 steps
   from a dark shade to a light tint. Keep the hue; vary lightness. This ramp is
   the whole categorical palette.
2. **A neutral text scale.** Three levels: primary text (near-black, tinted
   toward the brand hue), secondary, muted. Pure `#000` on white is harsh and
   reads as unfinished next to a brand colour.
3. **Surfaces.** A card fill and a track fill, both very light, both derived
   from the brand hue rather than neutral gray.
4. **One accent.** Pick a hue far enough from the primary ramp to read as a
   signal. It marks only the conclusion, the maximum, or the anomaly.
5. **Type.** Map the brand's CJK and Latin faces into the five roles. If the
   brand face is unavailable, name the closest widely-installed fallback — a
   deck that renders in a substitute face is better than one that renders in
   boxes.
6. **Set `minSize`.** Pick a floor you will actually hold, then hold it.

From a reference deck: sample the dominant ramp, the text levels and the accent;
record `provenance.kind` as `derived-from-reference`.

From a brief in words ("clean, technical, cool"): choose the ramp's hue and
saturation from the description, then derive as above. Record
`provenance.kind` as `derived-from-brief` — the record matters, because a
derived profile is a proposal, not an authority.

## Adding a profile

Put a JSON file in `assets/style-profiles/`. Requirements:

1. It validates against the schema above (the test suite checks the shipped
   ones).
2. `provenance` names where it came from. A profile with no provenance is a
   palette with no owner, and nobody can tell whether it is current.
3. `rules.minContrastRatio` is met by every text/fill pairing you specify —
   4.5:1 for body text is the floor, and a projector only makes it worse.
4. It contains **no** form decisions. A profile that says "use a funnel here" is
   a layout; put it upstream as a template workspace instead.

## Why this split matters

The reference library this skill draws on hard-codes its style throughout: the
palette, the typeface, the canvas and the title system are stated as rules, and
every one of its ~200 pages inherits them. That is correct for a **published
library** — consistency is the product.

It is wrong for a **skill**. A skill that bakes in one palette can only produce
one look, so it gets used once and then fights every brand it meets. Extracting
the style into a profile is what makes the same catalog usable for a bank, a
hospital and a research group.

The test: swap `blue-gray-business.json` for a profile derived from a red
brand. Every archetype in the catalog must still be selectable, and every craft
rule must still hold. If something breaks, it was a style pretending to be a
form.
