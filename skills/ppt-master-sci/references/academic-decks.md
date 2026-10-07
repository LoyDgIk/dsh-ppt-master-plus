# Turning a paper into a deck

Upstream owns slide authoring. This file covers only what is different when the
content is research and the audience is academic — the parts an author who has
never given a conference talk tends to get wrong.

## The deck is not the paper

A paper is written to survive scrutiny by a reader who can re-read. A talk is
delivered once, to people who cannot. The mapping is not "one section, one
slide".

| Paper element | What it becomes | What it must not become |
| --- | --- | --- |
| Abstract | Nothing. It is a summary of a summary | Slide 2 |
| Introduction | The *problem* and why it is unsolved — 1–2 slides | A literature tour |
| Related work | One comparison slide, or one two-column slide | A citation wall |
| Method | The idea first, then the mechanism, then the detail | The full derivation |
| Results | Each figure with its *reading* stated | A table dump |
| Ablation | One slide, only if it changes what the audience believes | Completeness for its own sake |
| Limitations | One slide, stated plainly | Omitted |
| Conclusion | What is now true that was not before | A repeat of the outline |

**The load-bearing rule**: every results slide states what the figure shows. A
figure without its reading is a puzzle, not a claim. This is what the academic
layout's caption and annotation slots on `06_figure_full` exist for — they are
placeholders so the reading is authored, not implied.

## Structural discipline

**One claim per slide.** If a slide's title is a topic ("Results") rather than a
claim ("Compression holds to 4× on the long-context split"), it is not finished.
Topic titles are the single strongest predictor of a talk that cannot be
followed.

**The talk is a sequence of claims**, and the outline is that sequence. Use the
`02_outline` page for it and keep it to six items or fewer; the layout has six
fixed rows precisely so an over-long outline is visible rather than silently
compressed.

**Sections are cheap; use them.** `03_section` costs one slide and resets
attention. Three to five sections is normal for a 15–20 minute talk.

**Matched comparisons belong on the two-column page.** Method versus baseline,
before versus after, ours versus prior work. The layout is symmetric so neither
side reads as subordinate — do not let a comparison quietly favour the author's
method through placement.

## Formulas

Formulas are the hardest part to get right, and the failure is usually
editorial rather than technical.

- **Most formulas should not be on a slide.** A slide that reproduces a
  derivation has moved the paper onto the wall. Show the one expression the
  argument turns on.
- **Notation must be defined where it first appears**, on the slide or in the
  speaker notes. A talk is not a paper; there is no notation table to flip back
  to.
- **Formulas stay editable.** Upstream compiles them to native Office Math. See
  [`formula-planning.md`](./formula-planning.md) and reserve the native height —
  overlapping layout around a formula is the most common defect in a
  formula-dense deck.
- **Symbols in prose are ordinary text.** `O(n log n)` inline is editable SVG
  text and needs no marker at all.

## Figures

- **Use the source figure, not a screenshot of it.** A cropped screenshot loses
  vector quality and is unreadable when projected.
- **One figure per slide**, unless the comparison *is* the content — then use
  the two-column page with one figure per column.
- **Say what to look at.** "Note the crossover at n=512" beats a caption.
- **Respect resolution.** A figure that was fine in print at 300 dpi may still
  be too small on a projector; zoom to the region that matters.

## Citations and provenance

- **The evidence strip is not optional decoration.** Reserve the source line on
  every slide that carries borrowed content. Attribution that lives only in the
  speaker's mouth is attribution the audience cannot check.
- **Never invent a number.** Not a percentage, not a baseline, not a
  "representative" result. Upstream separately forbids unlabeled invented KPIs;
  in an academic setting an unlabeled invented metric is misconduct, not a style
  choice.
- **`sources/*.facts.json` is the traceability spine.** Upstream's fact
  provenance contract maps stable ids to claims and sources; keep the values
  unchanged when they reach a slide.
- **Label your own interpretation.** If a grouping or framing is yours rather
  than the source's, say so on the page.

## Speaker notes carry the paper

The notes field is where the derivations, caveats, and full citations belong.
Upstream supports narration and notes passes; a defense deck with strong notes
survives questions that the slides alone cannot answer.

Write notes as spoken prose, not as slide fragments. They may be read aloud.

## A workable 15-minute defense shape

| Section | Slides | Job |
| --- | --- | --- |
| Framing | 3 | Cover, the problem, why existing work is not enough |
| Approach | 3–4 | The idea, then the mechanism, then the one formula that matters |
| Evidence | 3–5 | Setup, the main figure, the ablation if it changes a belief |
| Close | 2–3 | Limitations stated plainly, what is now known, Q&A |

Honest limitations earn more credit than an unblemished claim. State them before
the committee asks.

## Checks before delivery

- [ ] Every slide title is a claim, or is deliberately a section/organisational frame.
- [ ] Every borrowed figure and number has a source on the page.
- [ ] No number appears that is not in the source or explicitly labelled as illustrative.
- [ ] Every formula is editable Office Math, not a picture, and has room reserved.
- [ ] Notation used early is defined early.
- [ ] Limitations are on a slide.
- [ ] Nothing was written into the upstream checkout.
