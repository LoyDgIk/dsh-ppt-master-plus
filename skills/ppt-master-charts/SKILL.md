---
name: ppt-master-charts
description: >
  Chart and diagram selection extension for the ppt-master deck pipeline. Use
  when a deck is data-led or structure-led — KPI dashboards, analysis reports,
  process and architecture pages, comparisons, matrices, timelines, funnels,
  org charts — or when the user asks for a chart, diagram, infographic or
  "visual" page, or wants a chart library or a set of reusable chart pages.
  Supplies a style-independent archetype catalog for the qualitative and
  structural forms upstream deliberately does not index, a selection procedure
  that starts from the page's message rather than from a look, mechanical
  arithmetic checking so a page's stated numbers agree with its own data, and a
  swappable theme profile. Load it together with ppt-master: this skill chooses
  and specifies the visual; the upstream skill authors and exports it.
metadata:
  version: "0.1.0"
  license: "MIT"
  upstream: "https://github.com/hugohe3/ppt-master"
---

# PPT Master Charts — form selection and visual discipline

This skill does not draw slides. It decides **which visual form a page should
take**, specifies it precisely enough to author, and checks the result is
internally consistent. Upstream `ppt-master` owns authoring and export.

## The gap this fills

Upstream already ships a strong **quantitative** chart system: 33 canonical
references in `templates/charts/`, catalogued by *encoded relationship* in
`templates/charts/chart-vocabulary.md`, and a value-driven authoring contract in
`references/executor-chart.md`.

What it does **not** have is a catalog for everything that is not a
quantitative chart. Upstream says so itself, in `templates/README.md`:

> Qualitative Structure is a Slide-local Executor method, not a catalog; only
> Layout and Deck own reusable Master/Layout, page types, slots, and placeholders.

That is the honest boundary, and it is exactly the territory this skill covers:
pyramids, honeycombs, fishbones, org trees, swimlanes, flywheels, Venn
intersections, maturity ladders, and the ~100 other forms a business deck
actually needs. Upstream has none of them *catalogued*, so a model authoring a
"structure" page improvises — and improvising is where a deck starts looking
like a template with words swapped in.

**Never restate upstream's 33 charts here.** They have one owner. This skill
points at them; see [`references/data-archetypes.md`](./references/data-archetypes.md).

## When to load this

Load alongside `ppt-master` when any of these hold:

- the deck is **data-led or evidence-led** — KPI dashboards, analysis findings,
  quarterly reviews, business cases;
- a page must show **structure, process, or comparison** rather than numbers —
  architecture, org, roadmap, swimlane, matrix, SWOT, maturity;
- the user says "chart", "diagram", "infographic", "visual", or points at a
  reference deck style;
- the user wants a **reusable chart library** or a set of chart pages;
- numbers on a page must be **defensible** — a conclusion whose figures have to
  agree with the chart beneath it.

For a plain narrative deck with no data and no structural content, skip this and
use upstream alone.

## Workflow

### Step 1 — Write the page's one sentence

Before choosing a form, write down what the page must make the audience
believe, in one sentence, **with the numbers in it**:

> "华东贡献了 32% 的收入，但只用了 11% 的销售人力。"

A page whose one-sentence message cannot be written is not ready to have a form
chosen for it — it is still a topic. Upstream's own routing makes the same
demand in other words: a page title that names a subject rather than a claim is
unfinished.

### Step 2 — Choose the form from the message

Read [`references/selection.md`](./references/selection.md). It routes from the
*question the page answers* to an archetype:

| The page answers | Intent | Catalog |
| --- | --- | --- |
| What is it made of, and how do the parts relate? | Structure | [`archetype-catalog.md`](./references/archetype-catalog.md) §1 |
| What happens first, and where is it stuck? | Process | [`archetype-catalog.md`](./references/archetype-catalog.md) §2 |
| Which is better, by how much, and how do we choose? | Comparison | [`archetype-catalog.md`](./references/archetype-catalog.md) §3 |
| What do the numbers say? | Data | [`data-archetypes.md`](./references/data-archetypes.md) — bridges to upstream's 33 |
| A set of parallel items, or a standard report page | Page | [`data-archetypes.md`](./references/data-archetypes.md) §E |

Pick the form that fits the **information relationship**. A good form for the
wrong relationship is worse than a plain one: a funnel drawn over non-sequential
data actively misleads.

### Step 3 — Specify the page as a plan

Write the page into a `chart_plan.json`, then check it:

```bash
python3 <this-skill>/scripts/chart_plan.py <project_path>/chart_plan.json
```

The tool validates two things that a model reliably gets wrong:

1. **Data-shape fit.** A funnel's stages must not increase; a waterfall's deltas
   must sum to its ending total; a share series must be non-negative; a
   `matrix_2x2` needs both axes; a pyramid needs an ordering. If the data cannot
   support the chosen form, the tool says so before a slide is authored.
2. **Arithmetic self-consistency.** Every figure a page *states* — the
   percentage in the conclusion bar, the multiple in the headline, the total in
   a KPI card — is recomputed from the page's own data. This is the reference
   library's rule ("结论里的数字必须能从数据算出来") turned into a gate instead
   of a good intention.

Run it with `--fail-on-issue` in a loop to gate a whole library.

### Step 4 — Apply the theme profile

Form is style-independent; look is not. The reference material for this skill
was authored in a fixed blue-gray style, and that style is **one profile among
many**, not a default — see [`references/style-profiles.md`](./references/style-profiles.md).

Resolve the profile from, in order of precedence:

1. an explicit brand/style/layout/deck workspace the user supplied (upstream's
   Stage-1 template choice);
2. a profile in `assets/style-profiles/`;
3. a profile derived from the user's brief.

Never let this skill's sample palette override a supplied brand. The palette in
`assets/style-profiles/blue-gray-business.json` is an **example**, and every
number in it is meant to be replaced.

### Step 5 — Hand off to upstream

From here the upstream `ppt-master` skill owns the work. Load it, point it at
`<project_path>`, and let its routing pick the profile.

Two hand-off notes:

- **Quantitative charts go to upstream's references.** When the plan names a
  `chart/<key>` from upstream's 33, author it per
  `templates/charts/chart-vocabulary.md` and `references/executor-chart.md`.
  This skill's `chart_plan.json` records the choice; upstream owns construction.
- **Decide the output type deliberately.** A `chart/<key>` compiled as a native
  PowerPoint chart gives a live, editable data sheet; the same chart drawn as
  value-driven geometry gives shapes that render identically in PowerPoint, WPS
  and LibreOffice. Upstream supports both. Ask which matters — see
  [`references/data-archetypes.md`](./references/data-archetypes.md) § "Native
  chart or drawn geometry".

### Step 6 — Check before delivery

```bash
python3 <this-skill>/scripts/chart_plan.py <project_path>/chart_plan.json --fail-on-issue
```

Then walk [`references/craft-rules.md`](./references/craft-rules.md). The rules
that catch the most real defects: every graphic element carries an adjacent
label, one statement per page is readable at a glance, and no number appears
that the page's own data cannot produce.

## Guardrails

- **Pick the form from the message, never from the look.** A beautiful wrong
  diagram is worse than a plain right one.
- **Never invent data to fit a form.** If the data cannot support a funnel, do
  not bend the data — change the form, or say the page needs different content.
  This includes "representative" numbers. Upstream separately forbids unlabeled
  invented KPIs; a chart is where that rule is easiest to break by accident.
- **Never restate upstream's chart catalog.** Link to it.
- **Never write into `vendor/ppt-master/`.** It is a pristine git submodule;
  see the Runtime paths table at the top of this document.
- **Do not bake a style into a form.** If a choice only works in one palette, it
  is a style, not an archetype — record it as a style profile instead.
- **One accent, used once or twice.** An accent that marks three things marks
  nothing.

## Reference map

| File | Contents |
| --- | --- |
| [`references/selection.md`](./references/selection.md) | Message → intent → archetype routing, and the anti-patterns |
| [`references/archetype-catalog.md`](./references/archetype-catalog.md) | Structure / Process / Comparison archetypes (upstream's gap) |
| [`references/data-archetypes.md`](./references/data-archetypes.md) | Data and page archetypes, and the bridge to upstream's 33 charts |
| [`references/craft-rules.md`](./references/craft-rules.md) | Style-independent visual discipline |
| [`references/style-profiles.md`](./references/style-profiles.md) | Deriving a theme profile; the sample blue-gray profile |
| [`references/library-build.md`](./references/library-build.md) | Building a reusable chart *library* rather than one deck |
