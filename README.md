# dsh-ppt-master-plus

A [DeepSeek Harness](https://github.com/deepseek-ai) plugin that turns
[ppt-master](https://github.com/hugohe3/ppt-master) into an installable DSH
bundle — and layers scientific and chart capability on top **without touching a
single upstream file**.

The design rests on one decision: upstream is a **git submodule**, not a
vendored copy and not a fork.

```text
dsh-ppt-master-plus/
├── index.js                 DSH entry: one skills provider, two roots
├── cordis.patch.yml         bundle patch that mounts the plugin
├── upstream.lock.json       the pinned upstream commit
├── .gitmodules              → vendor/ppt-master
├── vendor/
│   └── ppt-master/          ← git submodule. READ-ONLY. never edited.
│       └── skills/ppt-master/    upstream skill, registered verbatim
├── skills/
│   ├── ppt-master-sci/      ← scientific front end (MinerU, formulas, academic layouts)
│   └── ppt-master-charts/   ← chart/diagram selection and visual discipline
├── scripts/
│   ├── upstream.mjs         init / check / sync / verify / status
│   └── cli.mjs              doctor / skills
└── tests/                   75 tests, including the "upstream is pristine" invariants
```

## Why a submodule, and why that matters

The three reference projects take three different approaches. Only one of them
survives an upstream release.

| Approach | Problem |
| --- | --- |
| **Vendor a copy** ([pn1024/dsh-ppt-master](https://github.com/pn1024/dsh-ppt-master)) | ~13,000 upstream files become *your* files. "Syncing" means diffing and merging them by hand. |
| **Fork and patch** ([hongyi652/ppt-master-sci-fork](https://github.com/hongyi652/ppt-master-sci-fork)) | Every upstream change is a merge conflict, forever. |
| **Git submodule + overlay** (this plugin) | `git submodule update --remote`. Upstream stays upstream. |

Here, upstream is a *reference*, and the pin lives in `upstream.lock.json` where
it is reviewable in the diff of every sync. The extension layer is a **separate
skill** that upstream knows nothing about.

### Syncing upstream

```bash
npm run upstream:check     # is upstream ahead?  exit 2 = drift
npm run upstream:sync      # fast-forward the pin, stage the submodule + lock
npm run upstream:verify    # prove upstream is pristine (exit 2 = broken)
```

`sync` **refuses to run** if the upstream tree has local modifications. That is
not a nicety: a dirty submodule means the "we never modify upstream" invariant
is already broken, and fast-forwarding would silently discard work or fail
confusingly. It also stages the gitlink and the lock file together, so the bump
is one reviewable diff.

`verify` is the enforceable version of the claim. It checks three things: the
checkout is at the pinned commit, it has no local modifications, and the parent
repo tracks nothing inside `vendor/` except the gitlink. CI can gate on it, and
`tests/upstream.test.mjs` runs the same checks.

## Install

```bash
# as a DSH bundle
dsh plugin install dsh-ppt-master-plus      # or add it to your profile's bundles

# from a clone
git clone --recurse-submodules <this repo>
cd dsh-ppt-master-plus
npm run upstream:init      # idempotent; fetches the pinned commit
npm run doctor
```

`--recurse-submodules` gets you upstream in one step. If you cloned without it,
`npm run upstream:init` materialises the checkout at the pinned commit.

Check the install:

```bash
npm run doctor
```

```text
[ok  ] upstream checkout: .../vendor/ppt-master
[ok  ] pinned commit: 440557b8dc7c
[ok  ] pristine: no local modifications
[ok  ] upstream skills: ppt-master
[ok  ] bundled skills: ppt-master-sci
```

## What the plugin registers

One `ctx.skills.registerProvider()` projecting two roots onto `ctx.skills`:

| Skill | Root | Registered as |
| --- | --- | --- |
| `ppt-master` | `vendor/ppt-master/skills/` | **Byte-for-byte** as it exists on disk, `source: upstream` |
| `ppt-master-sci` | `skills/` | With a runtime preamble that publishes the upstream paths |
| `ppt-master-charts` | `skills/` | Same — bundled skills are siblings of the upstream tree, never inside it |

Two details carry weight:

- **Upstream is registered verbatim** — no injected preamble, no path fixup, no
  rewriting. A test asserts byte equality, because the moment a rewrite leaks
  into the upstream projection, a `git submodule update --remote` stops being a
  clean fast-forward and this plugin has become a fork by accident.
- **Only our own skills get the preamble.** Ours live in a different tree, so
  they are told where the (movable) upstream checkout is, rather than
  hard-coding paths that break the moment it moves.

A provider rather than N `register()` calls, so a `git submodule update
--remote` that adds or removes an upstream skill takes effect with no code
change here.

## The SCI layer

`ppt-master-sci` is an **independent skill**, not a patch. It supplies the
scientific front end and hands upstream better input.

| Component | What it does |
| --- | --- |
| `scripts/mineru_ingest.py` | Scientific PDF/DOCX → the Markdown shape upstream already consumes (`<stem>.md` + `<stem>_files/`) via [MinerU](https://github.com/opendatalab/MinerU). Needs no third-party Python packages. |
| `scripts/formula_manifest.py` | Extracts LaTeX into a reviewable `formula_manifest.json`: stable ids, inline/block classification, and a pre-flight against the Microsoft 365 LaTeX profile upstream compiles with. |
| `scripts/latex_preview.py` | *Optional* LaTeX → SVG preview for visual QA. Requires MiKTeX/TeX Live + `dvisvgm`. |
| `assets/template-library/` | An academic layout pack (7 pages), selected as an **unregistered explicit workspace root** — no registration, so nothing is written into upstream. |
| `references/` | Ingestion contract, formula workflow, academic deck structure, layout usage. |

### On formulas: the fork is behind upstream

The sci-fork renders LaTeX to **SVG images** and patches upstream's quality
checker to size them. Current upstream does something strictly better: it
compiles LaTeX to **native, editable Office Math** through its own markers, and
its `references/native-formula.md` forbids the picture branch outright:

> Never substitute a PNG, flatten structural math into ordinary text, hand-write
> OMML, or leave raw LaTeX visible.

So this plugin routes formulas to upstream's native markers, and keeps LaTeX →
SVG as an explicitly-labelled **preview** step. Porting the fork's image path
would have been a regression.

### Ingestion, honestly

MinerU is a hosted API and needs `MINERU_API_TOKEN` (from
<https://mineru.net>). Without a token or network, `--from-zip` processes an
existing MinerU archive fully offline.

When neither is available, the skill **says so** and offers upstream's own
`pdf_to_md.py` as a knowingly weaker option. Presenting a text-layer extraction
as equivalent to MinerU is the failure mode this plugin is written to avoid:
the downstream formula plan and table values are materially worse.

## The charts layer

`ppt-master-charts` fills a gap that upstream **declares**. Upstream ships 33
canonical **quantitative** chart references, catalogued by encoded relationship.
For everything that is not a quantitative chart, upstream says:

> Qualitative Structure is a Slide-local Executor method, not a catalog.

So pyramids, honeycombs, fishbones, org trees, swimlanes, flywheels, Venn
intersections and the rest are left to be improvised — which is where a deck
starts looking like a template with the words swapped in.

| Component | What it does |
| --- | --- |
| `references/archetype-catalog.md` | ~110 qualitative forms across Structure / Process / Comparison, each with the relationship it encodes, the **data shape** it requires, and when to avoid it |
| `references/data-archetypes.md` | Data/page forms, plus the **bridge** to upstream's 33 — which stay upstream's, with one owner |
| `references/selection.md` | Message → intent → archetype routing, and 13 named anti-patterns |
| `references/craft-rules.md` | Style-independent visual discipline |
| `references/style-profiles.md` | How to derive a theme profile |
| `references/library-build.md` | Building a reusable chart *library* rather than one deck |
| `scripts/chart_plan.py` | Validates a `chart_plan.json`: archetype knowledge, data-shape fit, arithmetic consistency, craft counts |
| `assets/style-profiles/` | Two sample profiles |

### The numbers must add up — mechanically

The single most damaging defect in a data page is a stated figure that does not
reconcile with the chart beneath it. An audience that catches one stops
trusting every other number.

Upstream's guidance and the design reference behind this skill both handle it as
advice ("recheck the numbers before output"). This plugin makes it a **gate**:

```bash
python3 skills/ppt-master-charts/scripts/chart_plan.py projects/demo/chart_plan.json --fail-on-issue
```

Every figure a page *states* — a percentage, a multiple, a total, a delta — is
recomputed from that page's own data:

```text
ERROR [p01] '整体转化 12%': states 12% but 成单/1000 = 18%.  (claim-1)
ERROR [p01] a funnel encodes loss through ordered stages, but values increase
            at position 2 (100 → 420). Change the form or the data — do not bend
            the data.  (shape-not-monotonic)
```

It also refuses forms their data cannot support: a funnel over increasing values,
a Venn with no intersection, a quadrant with unnamed axes, weighted scores whose
weights do not sum, a loop with no return edge.

### Style is a profile, not a hard-coding

This is the part that makes the skill **reusable** rather than one look.

The reference library for this skill hard-codes its style — one palette, one
typeface, one canvas, stated as rules across all its pages. That is right for a
published product and wrong for a skill, which would then fight every brand it
met.

So the forms are style-free and the look lives in a swappable profile:

| | |
| --- | --- |
| `neutral-default.json` | The **default**. Deliberately colourless. |
| `blue-gray-business.json` | A `reference-sample` profile, shipped to show what a complete profile looks like. Explicitly not the house style; every value is meant to be replaced. |

Precedence: a brand workspace the user supplied → a named profile → a profile
derived from the brief → `neutral-default`. Nothing in the archetype catalog
names a colour, and there is a stated test for that: swap the profile and every
archetype must still be selectable.

## Verify

```bash
npm test                      # 75 tests
npm run doctor                # health check
npm run upstream:verify       # upstream is pristine and at the pin
```

The suite covers the provider contract, the frontmatter parser, the SCI scripts
end to end (a synthetic MinerU archive is ingested and asserted on), the
repository invariants, and the layout pack's conformance to upstream's
workspace shape. It skips cleanly when the submodule or Python is absent.

## Requirements

| | |
| --- | --- |
| Node | ≥ 20 (24 tested) |
| DSH | ≥ 0.1.1-rc.1 |
| Python 3.9+ | for both skills' scripts (stdlib only) |
| `MINERU_API_TOKEN` | for MinerU ingestion; optional with `--from-zip` |
| MiKTeX / TeX Live + `dvisvgm` | optional, preview only |

## Attribution

Upstream ppt-master is MIT, © Hugo He, and is **not** included in this
repository — it is fetched as a submodule and carries its own licence. The two
reference plugins, and a third-party commercial chart library used as a design
reference, informed this plugin without any of their content being copied or
redistributed. See [`NOTICE`](./NOTICE) for the full record, including every
place where this plugin deliberately diverges from its references.

## Licence

MIT — see [`LICENSE`](./LICENSE).
