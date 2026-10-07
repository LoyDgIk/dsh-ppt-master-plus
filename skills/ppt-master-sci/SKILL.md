---
name: ppt-master-sci
description: >
  Scientific and academic extension for the ppt-master deck pipeline. Use when
  the source material is a research paper, thesis, preprint, technical report,
  or a formula-dense PDF/DOCX, or when the target is an academic deliverable —
  a thesis defense, research progress report, journal-club talk, or conference
  presentation. Adds MinerU-based document ingestion that preserves reading
  order, tables and LaTeX math, a formula plan that routes each expression to
  editable native Office Math, and an unregistered academic layout pack. Load it
  together with ppt-master: this skill supplies the scientific front end and the
  upstream skill owns slide authoring and PPTX export.
metadata:
  version: "0.1.0"
  license: "MIT"
  upstream: "https://github.com/hugohe3/ppt-master"
  upstream_reference: "hugohe3/ppt-master, pinned as a git submodule at vendor/ppt-master"
---

# PPT Master SCI — scientific front end

This skill does not replace `ppt-master`. It runs **before** it and hands it
better input.

## The split, and why

| Layer | Lives in | Who owns it |
| --- | --- | --- |
| Upstream `ppt-master` playbook, scripts, templates | the `vendor/ppt-master` git submodule | upstream. Read-only here. |
| This skill's scripts, references, layout pack | this plugin's own tree | this plugin. |

The upstream checkout is a **pristine git submodule**. Nothing in this skill
writes into it — not a template registration, not a config file, not a cache.
That is what lets `git submodule update --remote` fast-forward cleanly on the
next upstream release. See the *Runtime paths* table at the top of this
document for the absolute locations; never hard-code them.

If you find yourself needing to edit something under `vendor/ppt-master/`, stop:
that is the signal to put the change in this skill instead.

## When to load this

Load this skill alongside `ppt-master` when **any** of these hold:

- the source is a paper, thesis, preprint, or technical report, especially a
  two-column or formula-dense PDF;
- the source is a scanned PDF (needs OCR);
- equations must survive into the deck and stay **editable** in PowerPoint;
- the deliverable is academic: thesis defense, group meeting, journal club,
  conference talk, research progress report;
- the source has meaningful tables or figures whose structure matters.

For a plain business or marketing deck from an already-clean Markdown file,
skip this skill and use upstream alone.

## Workflow

### Step 0 — Read the upstream contract first

Before authoring anything, load upstream's three contract documents. They are
the source of truth; this skill never restates them, because a restated
contract is one upstream release away from being wrong:

| Contract | Path (relative to the upstream skill directory) |
| --- | --- |
| Formula markers | `references/native-formula.md` |
| Project workspace and artifact ownership | `references/artifact-ownership.md` |
| Layout / template workspace shape | `templates/README.md`, `templates/layouts/README.md` |

### Step 1 — Ingest the source

Run the MinerU ingestion script, writing into the deck project's `sources/`
directory so the upstream pipeline finds it where it already looks:

```bash
python3 <this-skill>/scripts/mineru_ingest.py <paper.pdf> \
  -o <project_path>/sources/<stem>.md
```

Add `--is-ocr` for scanned input. The script prints `OUTPUT: <path>` on stdout,
matching upstream's own line protocol.

It writes `<stem>.md` plus a sibling `<stem>_files/` directory holding the
figures and an `image_manifest.json`.

**Requires** a MinerU API token in `MINERU_API_TOKEN`. If no token is available
or the network is blocked, stop and say so plainly — do **not** silently fall
back to a lower-quality parse and present it as equivalent. If a MinerU result
archive already exists, `--from-zip` works fully offline.

**What this buys you**: MinerU reconstructs reading order, tables and LaTeX for
scientific PDFs, where a text-layer extractor typically returns interleaved
columns and mangled math. Everything downstream — outlining, chart values,
formula markers — inherits that quality.

Do not hand-edit the generated Markdown to "clean it up" beyond fixing obvious
OCR slips; the figure links and the manifest are machine-owned.

### Step 2 — Build the formula plan

```bash
python3 <this-skill>/scripts/formula_manifest.py \
  <project_path>/sources/<stem>.md \
  -o <project_path>/images/formula_manifest.json
```

This writes `formula_manifest.json`: every LaTeX expression found, with a
stable id, its line, its display/inline origin, a complexity score, a suggested
marker (`inline` or `block`), and a pre-flight result.

**Review it with the user before authoring slides.** For each entry worth
showing:

- set `"include": true`;
- set `"placement"` to the slide or section it belongs on;
- when `warnings` is non-empty, **repair the LaTeX in the manifest first**.

Entries with a non-empty `unsupported` or `unsupportedEnvironments` field use
TeX that upstream's Microsoft 365 LaTeX profile will reject. Upstream's rule is
explicit and this skill enforces it: repair the LaTeX at review time. Never
substitute a picture, never hand-write OMML, never leave raw LaTeX visible on a
slide.

Read [`references/formula-planning.md`](./references/formula-planning.md) for
the placement and sizing rules, and the read/write protocol for this file.

### Step 3 — Hand off to upstream

From here the **upstream** `ppt-master` skill owns the work. Load it, point it
at `<project_path>`, and let its own routing pick the profile. The ingested
Markdown is ordinary Markdown as far as upstream is concerned — that is the
whole point of the design.

Two things this skill adds at hand-off:

1. **Formula markers.** Author them per upstream's `native-formula.md`, using
   the `suggestedMarker` and repaired LaTeX from the manifest. One-line
   structural math in prose becomes an inline `data-pptx-inline-formula`
   `tspan`; matrices, `cases`, `aligned` blocks and standalone high-structure
   math become a block `data-pptx-replace-with="formula"` group with its
   `<metadata>` JSON.
2. **The academic layout pack** (optional), selected as an **unregistered
   explicit workspace root** — no registration step, so nothing is written into
   upstream:

   ```
   <this-skill>/assets/template-library
   ```

   Pass that directory as the template workspace root. Upstream classifies an
   exact-but-unregistered root as `explicit` and validates it in place; see
   upstream's `workflows/routing.md` §7. Read
   [`references/academic-layouts.md`](./references/academic-layouts.md) before
   using it.

### Step 4 — Verify before delivery

Upstream's own checker is the authority. Confirm it passes, and confirm that
nothing you did left a modification inside the upstream checkout:

```bash
git -C <plugin-root> submodule status vendor/ppt-master   # expected: clean, at the pinned commit
```

If the submodule shows local modifications, something wrote into upstream. Move
that change into this skill before delivering.

## Optional: preview a formula

`scripts/latex_preview.py` renders LaTeX to SVG through a local TeX
distribution plus `dvisvgm`, so a human or vision model can check that an
expression looks right before it is locked into a slide.

**The output is a preview, never a slide asset.** Upstream compiles markers to
editable Office Math; substituting a picture forfeits editability and upstream's
checker rejects it. Treat a rendered preview as scratch, and keep it out of the
project's `images/`.

This step needs a TeX distribution. Without one the script exits 2 with a clear
message — that is expected, not a failure, and the native path needs no TeX.

## Guardrails

- **Never write into `vendor/ppt-master/`.** It is a git submodule pinned by
  `upstream.lock.json`; a local edit there blocks the next sync.
- **Never present a formula as an image** when a native marker is possible.
- **Never invent citations, metrics or figure values.** The deck must be
  traceable to the source. Upstream separately forbids unlabeled invented KPIs;
  in an academic deck the same rule applies with more force.
- **Say when ingestion failed.** If MinerU is unavailable, report it and let the
  user choose between a token, an existing archive, or accepting upstream's
  weaker text extractor knowingly.
- **Do not restate upstream's playbook here.** Link to it.

## Reference map

| File | Contents |
| --- | --- |
| [`references/ingestion.md`](./references/ingestion.md) | MinerU ingestion: flags, outputs, failures, offline path |
| [`references/formula-planning.md`](./references/formula-planning.md) | Manifest protocol, inline vs block, sizing, repair rules |
| [`references/academic-layouts.md`](./references/academic-layouts.md) | The academic layout pack and how to select it |
| [`references/academic-decks.md`](./references/academic-decks.md) | Paper-to-deck structure, figure and citation discipline |
