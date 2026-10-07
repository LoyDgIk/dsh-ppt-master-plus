# Architecture

## The problem

ppt-master is a large, fast-moving workflow package: ~13,000 files, released
often. Three things are wanted at once, and they pull against each other:

1. **Use it as-is.** Its playbook is the product; a stale copy is worse than none.
2. **Track its releases.** Without a manual merge each time.
3. **Extend it.** With scientific/academic capability that upstream does not have.

Vendoring a copy satisfies (1) and blocks (2). Forking satisfies (1) and (3) and
makes (2) permanently expensive. Something has to be the seam.

## The seam: a submodule plus two projected roots

```text
                       ┌──────────────────────────────────────────┐
   DSH runtime ──────► │  ctx.skills.registerProvider()           │
                       │  (index.js — one provider)               │
                       └───────────────┬──────────────────────────┘
                                       │ projects
                       ┌───────────────┴───────────────┐
                       ▼                               ▼
        ┌──────────────────────────┐    ┌──────────────────────────┐
        │ vendor/ppt-master/skills │    │ skills/                  │
        │ (git submodule)          │    │ (this plugin)            │
        │                          │    │                          │
        │ source: upstream         │    │ source: bundled          │
        │ verbatim, no preamble    │    │ runtime preamble injected│
        │ rank 500                 │    │ rank 600                 │
        └──────────────────────────┘    └──────────────────────────┘
                 ▲
                 │ pinned by upstream.lock.json
                 │ advanced by `npm run upstream:sync`
                 │ guarded by `npm run upstream:verify`
```

Upstream stays a **checkout**, not a copy. Nothing in this plugin writes there,
so `git submodule update --remote` is a fast-forward and the pin is a
one-line reviewable diff.

## Four invariants

Each is enforced by code and tested, not merely intended.

### 1. Upstream is registered byte-for-byte

`index.js` reads each upstream `SKILL.md` and projects it **verbatim**. The
runtime preamble — which publishes absolute paths — is applied to the
`bundled` root only.

This is the subtle one. Injecting a path fixup into the upstream skill would
"work" and would quietly make this plugin a fork: upstream's rendering would
diverge from upstream's source, so nothing about the running system could be
compared against the pinned commit any more.

`tests/plugin.test.mjs` asserts byte equality against the file on disk.

### 2. Upstream has no local modifications

`upstreamDirtyLines()` reads `git status --porcelain` in the submodule.

- `sync` **refuses to run** when it is non-empty. A dirty submodule means the
  invariant is already broken; fast-forwarding would either fail confusingly or
  discard work.
- `verify` reports it and exits 2.
- `tests/upstream.test.mjs` asserts it.

### 3. The parent repo tracks nothing under `vendor/`

A submodule contributes exactly one gitlink. If upstream files ever became
tracked by the parent — the classic "I edited inside the submodule and committed
from the parent" accident — the submodule would stop being a reference.

`verify` and the test suite both check `git ls-files vendor/ppt-master`.

### 4. Extensions live outside the upstream tree

The SCI skill, its scripts, its layout pack and its references are all siblings
of `vendor/`, never children. Enforced by test.

## Why a provider instead of N registrations

`ctx.skills.registerProvider()` is called once; its `list`/`get` run against
whatever is on disk at call time.

The alternative — calling `ctx.skills.register()` once per skill at load — would
hard-code the skill inventory into this plugin. Upstream would add a skill and
this plugin would silently fail to project it. A provider makes the inventory
upstream's business.

The `rank` field breaks name collisions in favour of `bundled` (600 over 500),
so a local skill can deliberately shadow an upstream one without either tree
being edited. Today nothing collides (`ppt-master` vs `ppt-master-sci`).

## Bridging paths without editing upstream

Upstream's playbook addresses its scripts and references by paths relative to
its own skill directory. Our skill lives elsewhere and cannot hard-code those
paths — they move whenever upstream restructures, and the upstream root itself is
relocatable (a submodule, a direct clone, or a checkout named by
`DSH_PPT_MASTER_PLUS_UPSTREAM`).

So the resolution happens at registration time: the provider computes the layout
and prepends a *Runtime paths* table to each **bundled** skill body. Upstream
never sees it.

The preamble also states the boundary in-band ("never write into the upstream
checkout"), because a model reading the skill is a future writer.

## The SCI layer, and why it is a separate skill

Upstream's job is authoring slides and exporting PPTX. The SCI layer's job is
the **front end**: getting a research PDF into a shape upstream already
understands, and planning what happens to the mathematics.

That split is what makes the extension durable. The SCI skill:

- writes Markdown into `<project>/sources/`, upstream's existing convention;
- writes `formula_manifest.json` into `<project>/images/`, a reviewable plan;
- ships academic layouts as an **unregistered explicit workspace root**, using
  upstream's documented `explicit` provenance — so no index is touched;
- produces LaTeX → SVG only as a labelled **preview**, never as slide output.

It never needs upstream to know it exists. Upstream may restructure its scripts
entirely and the SCI layer's contract — Markdown in `sources/`, a manifest in
`images/`, native formula markers — is unaffected.

### Where the sci-fork was deliberately not followed

The sci-fork renders formulas to SVG **images** and patches upstream's
`svg_quality_checker.py` to size them. Current upstream compiles LaTeX to
**native, editable Office Math** and forbids the picture branch in
`references/native-formula.md`. Porting the image path would have been a
regression dressed as fidelity. See [`../NOTICE`](../NOTICE) §3.

## Failure behaviour

The design assumes the environment is hostile, because it is: a 130 MB upstream
over an intermittent network, an optional hosted API, and an optional TeX
install.

| Situation | Behaviour |
| --- | --- |
| Upstream missing | The provider still lists bundled skills. `doctor` reports it; `upstream:init` fixes it. |
| Not a git checkout (npm install) | `upstream:init` falls back to a blobless `git clone` at the pinned commit. |
| Network down during `init` | `prepare` runs `init --soft`, which warns and exits 0 — a failed fetch must not break `npm install`. |
| Network down during `sync` | Reports the failure and exits 1 **without** moving the pin. |
| Dirty upstream | `sync` refuses; `verify` exits 2. |
| No MinerU token | `mineru_ingest.py` exits 2 with guidance, and the skill tells the user rather than silently degrading. |
| No TeX | `latex_preview.py` exits 2 and points at the native marker path, which needs no TeX. |
| No Python | SCI tests skip; `doctor` warns. |
