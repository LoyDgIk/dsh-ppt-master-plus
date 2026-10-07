# Craft rules

Discipline that holds regardless of palette, brand or canvas. These are the
rules that catch real defects; the rest is taste.

They are stated as checks so they can be applied to a finished page rather than
aspired to during authoring.

## 1. Label every graphic element where it stands

Every sector, bar, node, tier and stage carries its own name and value **next to
it**.

A legend makes the reader hold a colour in memory and hunt for its meaning. On a
projected slide, at the back of a room, that hunt fails. Connect the label to
the mark with a leader line or a shared colour bar so the pair reads as one
object.

> Check: cover the legend. Can every element still be identified?

## 2. One statement per page, readable at a glance

Each page states one thing the audience can absorb in about two seconds. It is
carried by a headline, a large figure, or a conclusion bar — but it must be
there, and there must be only one.

> Check: name the page's single claim. If you need "and", the page is two pages.

## 3. The numbers must agree with each other

Every figure a page *states* — a percentage, a multiple, a total, a delta — must
be recomputable from that page's own data.

This is the rule most often broken, and the most damaging: an audience that
catches one arithmetic inconsistency stops trusting every other number.

> Check: recompute each stated figure from the chart's own values.
> `scripts/chart_plan.py` automates this; run it rather than trusting a re-read.

## 4. Accent discipline

Pick one accent colour. Use it once or twice per page, and only on the thing
that should be looked at: the maximum, the anomaly, the recommendation, the
conclusion.

An accent that marks three things marks nothing.

> Check: count accent uses. If it exceeds two, demote one.

## 5. Minimum type size, no exceptions

Set a floor for the deck and hold it everywhere — axis labels, footnotes,
source lines, chart tick labels included. Chart tick labels are the usual
offender, because the charting engine sets them, not the designer.

> Check: find the smallest text on the page. Is it at or above the floor?

## 6. Fill the canvas

Content spreads across the content area. Large dead zones read as unfinished,
and they make the pages that *do* have content look overcrowded by comparison.

When the lower half is empty, the answer is rarely "make things bigger" — it is
usually to add the page's conclusion as a bar, or to widen the content's
treatment.

> Check: squint at the page. Is there a quadrant doing nothing?

## 7. Native shapes only

Charts, diagrams and decoration are drawn as native shapes and text boxes. A
chart is never a pasted screenshot, and a diagram is never a flat image.

The exception is a logo, which is legitimately an image.

> Check: the file can be opened and every element retyped, recoloured and moved.

## 8. Renders consistently across viewers

The deck must look the same in PowerPoint, WPS and LibreOffice. Theme-default
shadows and effects are the usual source of divergence — many viewers render
`effectRef` differently, producing shadows that were never intended.

Set effects explicitly rather than inheriting them, and turn off inherited
shadow on shapes that should be flat.

> Check: if you cannot test all three, at least avoid relying on theme effects.

## 9. No overlap, no overflow

No text over text; no text outside its container; no element outside the content
area (background decoration excepted).

> Check: this is the defect most visible in a rendered thumbnail and least
> visible in the authoring view. Render, then look.

## 10. Data must be plausible, and labelled when it is not real

Illustrative data should look like real data: sensible magnitudes, decimals
where decimals occur, both increases and decreases.

But plausibility is not honesty. Any figure that is illustrative rather than
sourced must be **labelled as illustrative on the page**. Upstream's rule:
invented demo KPIs are labelled `scenario` and never promoted into the fact
registry.

> Check: for each number, can you name its source? If not, is it labelled?

## 11. Content restrictions

- No real third-party brand logos, company names or personal data in sample
  content. Use obviously fictional examples.
- Personal contact details are placeholders.
- No political symbols, flags, emblems or leader imagery; no political framing
  on maps.
- Quotes carry attribution and context.

## 12. One deck, one system

Every page shares the same title system, footer, spacing rhythm and accent. A
chart library is a system; a deck is a system.

The failure is a collection of individually fine pages that share no rhythm.
It reads as assembled, not designed.

> Check: lay the pages out as thumbnails. Do they look like one deck?

---

## Applying these

Rules 1–4 and 9–10 are checkable on the artifact. Rules 5–8 are checkable by
inspection. Rules 11–12 are checkable by review.

`scripts/chart_plan.py` automates what can be automated: rule 3 in full, and the
countable parts of rules 1, 2 and 4. The rest need a rendered page and a pair of
eyes — which is why upstream's own pipeline renders and reviews rather than
trusting the authoring view.

## Where these came from

Rules 1–4 and 9–12 are generalisations of the working discipline in the
commercial chart library that served as this skill's design reference. They were
rewritten to be style-independent: the source stated them alongside a specific
blue-gray palette, a specific typeface and a specific canvas, and none of that
is part of the rule.

See [`../NOTICE`](../../../NOTICE) for the attribution record.
