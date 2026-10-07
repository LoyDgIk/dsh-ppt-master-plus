# The academic layout pack

## What it is

`assets/template-library/` is an **unregistered template workspace** shaped as a
project root:

```text
assets/template-library/
└── templates/
    ├── design_spec.layout.academic_defense.md
    ├── 01_cover.svg
    ├── 02_outline.svg
    ├── 03_section.svg
    ├── 04_content.svg
    ├── 05_two_column.svg
    ├── 06_figure_full.svg
    └── 07_ending.svg
```

Seven pages aimed at how research is presented: a title frame, an outline, a
section divider, a single-column content page with a reserved evidence strip, a
symmetric two-column page for matched comparisons (method versus baseline,
ours versus prior work), a figure-led page, and a closing frame.

## Why it can be used without registering it

Upstream resolves template choices from two provenances
(`workflows/routing.md` §7):

- **`library`** — the root exactly matches an entry in a registered
  `*_index.json`;
- **`explicit`** — any other exact root the caller supplies, including an
  unregistered one.

Registration would write into upstream's `templates/` tree and update its index
— a modification to a git submodule, which this plugin does not do. The
`explicit` path needs none of that: the caller hands upstream the workspace
root, and upstream validates it in place.

The shape matters. Upstream's workspace contract allows two forms:

| Shape | Spec file | Used by |
| --- | --- | --- |
| Library root | `<kind_dir>/<template_id>/templates/design_spec.md` | Upstream's own registered packs |
| **Project root** | one flat `templates/`, `design_spec.<kind>.<id>.md` | **This pack** |

This pack is the project-root form, so the filename carries kind and id
(`design_spec.layout.academic_defense.md`) and the frontmatter agrees:
`kind: layout`, `layout_id: academic_defense`.

**Hand upstream the workspace root, never its inner `templates/`.** Upstream
says so explicitly, and a root pointed one level too deep will not resolve.

```text
# correct
<plugin>/skills/ppt-master-sci/assets/template-library

# wrong - one level too deep
<plugin>/skills/ppt-master-sci/assets/template-library/templates
```

## Selecting it

In an interactive run, supply the root as the Stage-1 template candidate. The
Default profile preserves an exact path as a Stage-1 candidate; an explicit
Quick run validates and installs it directly. Classify it as `explicit`, not
`library` — it is not in any index.

## What it deliberately does not carry

The contract for a Layout says **structure only**. So this pack has:

- **no identity** — no logo, no brand palette, no typeface identity, no voice.
  The slate values in the SVGs are neutral *preview* values; real colour,
  typography and final scale come from a Brand, a Deck, or the confirmation
  stage;
- **no content** — no example claims, no invented metrics;
- **no narrative** — page types, not a required sequence.

That is what makes it reusable across a thesis defense, a group meeting and a
conference talk without pretending those are the same event.

## Validation

Upstream validates a workspace with its own checker:

```bash
python3 <upstream-skill>/scripts/svg_quality_checker.py <workspace>/templates --template-mode
```

Run it after editing this pack. If it reports a problem, fix the pack — never
"fix" the checker, and never copy the pack into the upstream tree to make
something resolve.

## Adapting it

Copy the pack into your own project workspace and edit there. Keep the upstream
copy as the reference version; if you improve a page, consider whether the
improvement is generic enough to come back here.

If you need a different academic format — a 4:3 projector, a vertical poster, a
journal-club one-pager — add a sibling page to this pack rather than forking the
whole thing.
