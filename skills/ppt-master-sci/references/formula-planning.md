# Formula planning

## The one rule that shapes everything

Upstream compiles LaTeX into **editable Office Math** through its own markers.
`references/native-formula.md` in the upstream skill is the authority, and it
forbids the alternatives outright:

> Never substitute a PNG, flatten structural math into ordinary text, hand-write
> OMML, or leave raw LaTeX visible.

So this skill's job is not to render formulas. It is to produce a **reviewed,
repaired, classified** plan that makes authoring the markers mechanical.

## Step 1 — extract

```bash
python3 <skill>/scripts/formula_manifest.py \
  <project_path>/sources/<stem>.md \
  -o <project_path>/images/formula_manifest.json
```

Recognised forms: `$$…$$`, `\[…\]`, `\(…\)`, `$…$`, and fenced ```math blocks.
Fenced blocks in any other language are ignored, so a code sample never yields
markers. Inline `$…$` matching is deliberately conservative — prose like
"costs $5 and $7" does not register as math.

| Flag | Effect |
| --- | --- |
| `-o, --output` | Manifest path. Default `<project>/images/formula_manifest.json`, else beside the source. |
| `--min-length` | Ignore formulas shorter than N characters. Default 3. |
| `--fail-on-unsupported` | Exit 3 if any formula is outside the accepted profile (CI gate). |
| `--json` | Print one JSON object. |

## Step 2 — review the manifest

`formula_manifest.json` carries a `counts` summary and a `formulas` array.

Each entry:

| Field | Meaning |
| --- | --- |
| `id` | Stable hash of the LaTeX. Survives re-extraction, so a decision is not lost when the source is re-parsed. |
| `latex` | The expression, delimiter-free, whitespace-trimmed. |
| `display` | Whether it came from a display context. |
| `line`, `occurrences`, `origins` | Where it appears, and in which syntax. |
| `complexity` | Non-whitespace character count — a rough visual weight. |
| `suggestedMarker` | `inline` or `block`. A suggestion; your judgement wins. |
| `structural` | Structural constructors found (`\frac`, `\sqrt`, `\sum`, …). These drive the reserved native height. |
| `blockEnvironments` | e.g. `bmatrix`, `cases`, `aligned`. |
| `unsupported`, `unsupportedEnvironments` | TeX outside the Microsoft 365 LaTeX profile. Must be repaired. |
| `warnings` | Human-readable problems. |
| `include` | **You set this.** `true` = author a marker for it. |
| `placement` | **You set this.** The slide or section it belongs on. |

Nothing is included by default. A formula on a slide is a deliberate editorial
choice, never an artefact of parsing.

### The review conversation

Show the user the count and the notable entries, then decide together:

- which formulas are load-bearing enough to appear on a slide;
- anything ambiguous, especially a formula whose meaning depends on surrounding
  prose;
- any entry with warnings, since those block authoring until repaired.

## Step 3 — repair before authoring

An entry with non-empty `unsupported` or `unsupportedEnvironments` **cannot**
become a marker. Upstream's rule: repair the LaTeX upstream of the marker,
without changing the mathematics, or hand it back to the content owner.

Typical repairs:

| Found | Why it blocks | Repair |
| --- | --- | --- |
| `\documentclass`, `\usepackage`, `\begin{document}` | Document scaffolding, not a formula body | Strip to the math |
| `\hbox`, `\vbox`, `\def`, `\newcommand`, `\catcode` | TeX programming primitives | Rewrite in the math profile |
| `\includegraphics`, `tikzpicture`, `pgfplots` | Drawing, not notation | Author as an ordinary SVG figure instead |
| Unescaped `%` | Starts a LaTeX comment | Escape as `\%` |
| A nested `$…$` | Markers carry delimiter-free bodies | Remove the inner delimiters |
| `\verbatim`, `lstlisting` | Environments outside the profile | Convert to SVG text |

`\begin{bmatrix}`, `cases`, `aligned`, `array` and the rest of the matrix and
equation-array families **are** supported — the extractor only flags an
environment that is outside that set. Do not "fix" a supported environment.

## Step 4 — choose inline or block

Upstream's own table, in short:

| Content | Authoring choice |
| --- | --- |
| Short variables, percentages, simple assignments, `O(n log n)` | Ordinary editable SVG text — **no marker** |
| One-line structural math in prose that fits its reserved row | Inline marker |
| Matrix, `cases`, `aligned`, multiline derivation, standalone high-structure math | Block marker |

Two consequences worth stating plainly:

- **Simple notation should not become a marker at all.** `O(n log n)` as
  ordinary SVG text is editable and simpler; converting it to Office Math adds
  cost and no capability. The `suggestedMarker` field only distinguishes inline
  from block — deciding "no marker" is yours.
- **Reserve the native height.** Upstream: the parsed formula structure, not its
  flat preview, is vertical layout truth. A fraction, radical, nested script,
  n-ary limit or accent needs more room than its flat preview suggests. If the
  prose row cannot reserve that space, isolate the formula on its own line or
  use a block marker. This is the most common source of overlapping layout in a
  formula-dense deck.

## Step 5 — author the markers

Follow upstream's `references/native-formula.md` exactly. The shapes, for
orientation only — the upstream file is authoritative:

Inline, a leaf `<tspan>` with delimiter-free LaTeX and a plain-text preview:

```xml
<tspan data-pptx-inline-formula="\frac{a_i}{b_i}">aᵢ/bᵢ</tspan>
```

Block, a group with its `<metadata>` JSON and an ordinary SVG preview:

```xml
<g data-pptx-replace-with="formula" data-pptx-x="190" data-pptx-y="245"
   data-pptx-width="900" data-pptx-height="180"
   data-pptx-bounds="190 245 900 180">
  <metadata type="application/json"><![CDATA[
    {"latex":"\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}","display":"block",
     "font_size":42,"color":"#173B57","align":"center"}
  ]]></metadata>
  <text ...>(-b ± √(b²−4ac)) / 2a</text>
</g>
```

Both carry a **preview**: real SVG text and shapes that read as the formula. The
preview is not a fallback — the exporter discards it and emits Office Math — but
it must be semantically equivalent, because it is what a viewer sees before
export and what a checker compares.

## Optional — visual preview

To check an expression looks right before locking it in:

```bash
python3 <skill>/scripts/latex_preview.py "\\frac{a}{b}" -o /tmp/check.svg
python3 <skill>/scripts/latex_preview.py --manifest <project>/images/formula_manifest.json
```

Manifest mode renders entries marked `"include": true` and needs a TeX
distribution plus `dvisvgm`. **The output is scratch.** Upstream forbids the
picture branch, so a preview SVG must never enter the deck project's `images/`
or be referenced from a slide.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Manifest written |
| 1 | IO failure |
| 2 | Usage error |
| 3 | Unsupported LaTeX found, with `--fail-on-unsupported` |
