# Selecting a form

The procedure, and the failure modes it exists to prevent.

## The rule

**Choose the form from the information relationship, not from the look.**

Every bad chart-choosing habit is a variant of getting this backwards: starting
from a shape you like and forcing content into it. A funnel drawn over
non-sequential data does not merely look odd — it asserts a conversion loss that
is not there. A pyramid over unordered items asserts a hierarchy that is not
there. These are not aesthetic errors; they are false statements.

## Procedure

### 1. Write the message as one sentence, with the numbers

> 华东贡献 32% 的收入，却只用了 11% 的销售人力。

If you cannot write it, the page is a topic, not a page. A title like "区域业绩"
says what the page is *about*; it does not say what the audience should
conclude. Upstream's routing demands the same thing in its own terms.

### 2. Name the question

Reduce the sentence to the question the page answers. It is one of five:

| Question | Intent | Where the forms are |
| --- | --- | --- |
| What is it made of, and how do the parts relate? | Structure | `archetype-catalog.md` §1 |
| What happens first, and where is it stuck? | Process | `archetype-catalog.md` §2 |
| Which is better, by how much, and how do we choose? | Comparison | `archetype-catalog.md` §3 |
| What do the numbers say? | Data | `data-archetypes.md` §D |
| A set of parallel items, or a standard report page | Page | `data-archetypes.md` §E |

### 3. Shortlist two or three keys

Match the **Answers** column against your question. Do not shortlist by
appearance.

### 4. Kill candidates that fail the data shape

Read each candidate's **Data shape** column and ask whether your content fills
it. This is the step that matters — most bad chart choices die here, before a
slide exists.

Worked example. Message: *"交付延期的六大成因中，需求变更占 41%。"*

| Candidate | Data shape required | Verdict |
| --- | --- | --- |
| `fishbone` | Cause **categories** mapping to one effect | Fits — six causes, one effect |
| `pareto_chart` | Descending contributions + cumulative share | Fits too — and gives the 41% a visual weight |
| `funnel` | Monotonically non-increasing stages | **Fails** — causes are not sequential stages |
| `pyramid` | Ordered tiers | **Fails** — causes are unordered |

Two candidates survive. Pick between them on the message: if the point is *root
cause*, use the fishbone; if the point is *where to act first*, use the pareto.

### 5. Read "Avoid when"

If it applies, go back to step 3. This column names the specific misuse, so it
is worth more than the description.

### 6. Record and check

Write the choice into `chart_plan.json` and let `scripts/chart_plan.py` re-check
the shape mechanically. You will be surprised how often the mechanical check
disagrees with a confident first pass.

## Anti-patterns

Named, because they recur.

| Anti-pattern | What it looks like | Why it is wrong |
| --- | --- | --- |
| **Funnel over non-sequential data** | Categories arranged as narrowing stages | Asserts a conversion loss that does not exist |
| **Pyramid over unordered items** | Any list drawn as tiers | Asserts hierarchy and volume that is not there |
| **Pie with too many slices** | 8+ sectors | Angle comparison fails below ~5%; use a bar |
| **Radar with too many axes** | 9+ spokes | The shape becomes noise; use a table |
| **Loop with no return edge** | A ring drawn over a linear process | Asserts feedback that does not happen |
| **Venn whose intersection is empty** | Overlapping circles with cosmetic overlap only | The whole point of the form is the intersection |
| **Swimlane with one owner** | Lanes that all name the same team | Lanes add a dimension that carries no information |
| **Quadrant with unnamed axes** | Two dimensions implied but not labelled | Position becomes unreadable and unfalsifiable |
| **Weighted score with no weights** | Scores totalled without weights | A tally masquerading as a decision |
| **Icon grid with unequal quantities drawn equally** | "3 of 10" drawn as 5 filled squares | Pictographs must encode quantity truthfully |
| **Truncated axis** | Bar chart starting at 90% | Exaggerates differences; only acceptable with a marked break |
| **Decorative data** | Numbers added to fill a layout | Every figure must earn its place or be cut |
| **Dual axis with unrelated scales** | Two series scaled to cross meaningfully | Implies correlation that is an artefact of scaling |
| **Unlabelled "representative" figures** | Plausible numbers with no source | Fabrication. Upstream forbids unlabelled invented KPIs; a chart is where this is easiest to do by accident |

## Quantitative or qualitative?

A quick test, because the boundary is genuinely confusing.

Ask: **does the page encode values, or relationships?**

- If the geometry is *computed from numbers* — bar lengths, sector angles,
  positions on an axis — it is a **quantitative chart**. Use upstream's
  `chart/<key>` references and their value-driven authoring contract. Do not
  hand-place it.
- If the geometry encodes *relationships, sequence, or membership* — a pyramid,
  a fishbone, a swimlane, a Venn — it is a **qualitative diagram**. Use this
  skill's catalog. There are no values to compute from, and the shape carries
  the meaning.

Some forms are both. A `funnel` may carry measured values (quantitative) or
just ordered stages (qualitative). Decide which, because it changes who authors
it and whether the geometry must be computed:

| | Quantitative funnel | Qualitative funnel |
| --- | --- | --- |
| Stage widths | Proportional to values | Even, or stepped by rank |
| Owner | Upstream `chart/funnel_chart` | This catalog's `funnel` |
| Labels | Value + unit + share | Stage name + one line |

## When to use no form at all

A page with one number, one sentence, or one image does not need a diagram.
Upstream states the principle for charts — "zero Chart selections remains valid"
— and it generalises. A big number with a good sentence is a complete page, and
dressing it up weakens it.

Resist the pull toward a form on every page. A deck where every page is a
diagram has no emphasis left; the pages that matter stop standing out.
