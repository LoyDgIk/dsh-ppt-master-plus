# Building a chart library

The design reference for this skill is not a deck. It is a **library**: ~200
standalone chart pages, each complete and independent, sharing one visual
system. That is a different artifact with different requirements.

## Library or deck

| | **Deck** | **Chart library** |
| --- | --- | --- |
| Unit | A narrative argument | A reusable page |
| Order | Fixed and meaningful | Irrelevant; any page can be pulled |
| Page count | As many as the argument needs | Enough to cover the space |
| Reuse | Read once | Copy a page into a new deck |
| Success | The audience is convinced | A designer finds the page they need, fast |
| Failure | The argument does not land | The form they need is missing, or 40 pages are the same shape |

Confusing the two produces the classic bad library: 200 pages that are really
one deck's worth of ideas, or a deck padded with forms that do not serve it.

## When to build one

- a team produces decks regularly and keeps redrawing the same structures;
- a brand needs a consistent visual vocabulary across many authors;
- an organisation wants a starting catalogue rather than a blank slide.

Do **not** build one for a single deck. The cost is real and the payoff is
reuse.

## Coverage

A library's value is coverage, so plan it as a grid rather than a list.

Start from the five intents and allocate:

| Intent | Share of a balanced library | Why |
| --- | --- | --- |
| Structure | ~25% | Most business content is "what is this made of" |
| Process | ~20% | Roadmaps, swimlanes, funnels, lifecycles |
| Comparison | ~20% | Decisions dominate senior audiences |
| Data | ~25% | The quantitative half comes from upstream's 33 |
| Page furniture | ~10% | Covers, agendas, dividers, closings, appendices |

Then, inside each intent, cover the **distinct information relationships**, not
variations of one. Ten recoloured bar charts are one page of value.

### The coverage check

Build the matrix of `intent × archetype key` from your plan and look for:

- **Clusters** — many pages sharing one key. Legitimate only if each answers a
  genuinely different question.
- **Gaps** — an intent whose common questions have no page. This is the real
  defect; a library with no risk matrix will be worked around.
- **Orphans** — a page whose archetype no other page or brief calls for.

`chart_plan.py` warns on repeated archetypes, which is the cheap half of this
check. The gap analysis you have to do by reading the matrix.

## Consistency

A library is a system. Requirements that bind every page:

1. **One title system.** Same position, size and hierarchy on every page —
   including section dividers and the closing.
2. **One footer.** Page furniture in one place, with a consistent content.
3. **One accent, used the same way.** If the accent marks the maximum on one
   page, it marks the maximum on all of them. An accent whose meaning drifts is
   decoration.
4. **One type scale.** No page invents a size.
5. **One spacing rhythm.** Cards and modules align to the same gutters across
   pages, so two pages can sit side by side in a proposal without looking
   pasted.

These are the reason a library works and a folder of one-off slides does not.

## Building it in batches

The reference library was built in batches of ~10 pages per intent, each batch
followed by a rendered review. That is the right shape, for a reason worth
stating: **form fatigue**. After about ten pages of one intent, pages start
repeating without the author noticing. Batching forces the review at the point
where repetition is still visible.

Procedure per batch:

1. Pick the next 10 uncovered relationships from the coverage matrix.
2. Write each page's one-sentence message (yes, even for a library — it is how
   you tell whether two pages are actually different).
3. Add them to `chart_plan.json`.
4. Run `chart_plan.py --fail-on-issue`.
5. Author the pages.
6. **Render and review.** Overlap, overflow and dead space are invisible in the
   authoring view and obvious in a thumbnail grid. Upstream's pipeline renders
   and reviews for the same reason.
7. Update the coverage matrix before starting the next batch.

## Quality gates

```bash
python3 <this-skill>/scripts/chart_plan.py library/chart_plan.json --fail-on-issue
```

Then, over the whole library:

- [ ] Every intent has coverage proportional to its share of real use.
- [ ] No two pages answer the same question.
- [ ] Title, footer, accent, type scale and gutters are identical across pages.
- [ ] Every page's stated figures reconcile with its own data.
- [ ] Every graphic element is labelled where it stands.
- [ ] No page relies on a legend lookup.
- [ ] The smallest text anywhere is at or above the profile's floor.
- [ ] Every page opens and edits natively.
- [ ] Renders consistently in PowerPoint, WPS and LibreOffice.
- [ ] Illustrative data is labelled as illustrative.

## Keep the forms style-free

The single most valuable property of a library is that it can be **re-themed**.

The reference library hard-codes its style throughout — palette, typeface,
canvas, title system all stated as rules. For a published product that is
correct: consistency *is* the product.

But a library built that way can only ever be one look. If the organisation
rebrands, or a second division needs the same pages in their colours, the library
is worthless and gets rebuilt from scratch.

**So build the forms, then apply a profile.** Concretely:

- author each page's geometry with no colour decisions in it;
- take every colour from the style profile, by role — never as a literal;
- keep the type scale in the profile;
- verify by rendering the whole library twice, against two different profiles.

If any page breaks under the second profile, it had a style baked into its form.
Fix the page, not the profile.

That is the test that separates a library from a folder of one-off slides, and
it is the same test that separates this skill's catalog from the reference it
was derived from.

## Recording provenance

A library is long-lived and will outlive the people who built it. Record, in the
library itself:

- the style profile id and version each page was authored against;
- which data is sourced, and which is illustrative;
- the reference material the forms were derived from, with its licence.

See [`../NOTICE`](../../../NOTICE) for how this repository records the
commercial chart library that served as its design reference.
