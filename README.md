# dsh-ppt-master-plus

A [DeepSeek Harness](https://github.com/deepseek-ai) plugin that turns
[ppt-master](https://github.com/hugohe3/ppt-master) into an installable DSH
bundle — and layers scientific/academic capability on top **without touching a
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
│   └── ppt-master-sci/      ← this plugin's own skill (the SCI layer)
├── scripts/
│   ├── upstream.mjs         init / check / sync / verify / status
│   └── cli.mjs              doctor / skills
└── tests/                   46 tests, including the "upstream is pristine" invariants
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

## Verify

```bash
npm test                      # 46 tests
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
| Python 3.9+ | for the SCI skill's scripts (stdlib only) |
| `MINERU_API_TOKEN` | for MinerU ingestion; optional with `--from-zip` |
| MiKTeX / TeX Live + `dvisvgm` | optional, preview only |

## Attribution

Upstream ppt-master is MIT, © Hugo He, and is **not** included in this
repository — it is fetched as a submodule and carries its own licence. The two
reference plugins informed the design without any code being copied. See
[`NOTICE`](./NOTICE) for the full record, including every place where this
plugin deliberately diverges from the sci-fork.

## Licence

MIT — see [`LICENSE`](./LICENSE).
