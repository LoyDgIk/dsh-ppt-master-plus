# Acceptance record

What has been verified, how, and what has not. Kept honest on purpose.

An earlier version of this plugin claimed a set of invariants and had tests for
them, all of which passed while three of the claims were false. The tests ran
against the working copy, which had everything the tests needed. This file
exists so that "tested" and "true" are separate columns.

**Legend**

| Mark | Meaning |
| --- | --- |
| **verified** | a command in this repository fails if it stops being true |
| **probed** | checked once by hand against the live runtime; no automated guard |
| **assumed** | believed, not checked — stated so it can be argued with |
| **untested** | known to be uncovered |

---

## 1. Repository invariants

| Claim | Mark | Evidence |
| --- | --- | --- |
| Upstream sits at the commit in `upstream.lock.json` | **verified** | `tests/upstream.test.mjs`, `npm run upstream:verify` |
| Upstream has no local modifications | **verified** | same |
| The parent repo tracks nothing under `vendor/` but the gitlink | **verified** | same |
| Nothing has been *generated* inside the checkout (the gitignored case) | **verified** | `upstreamGeneratedLines()`, plus a probe test that plants a deck, asserts `git status` cannot see it, asserts the check can, and cleans up |
| `sync` refuses on a dirty or generated checkout | **probed** | run by hand on 2026-10-07; both refusals observed |
| A failed `sync` does not move the pin | **assumed** | the failure paths return before `writeLock`, but no test injects a failure |
| The upstream skill is registered byte-for-byte | **verified** | `tests/plugin.test.mjs` compares against the file on disk |
| The link mechanism survives a fresh install | **verified** | `upstream:init` created the junction in the installed copy on 2026-10-07 |

## 2. DSH surface

| Claim | Mark | Evidence |
| --- | --- | --- |
| `skills.registerProvider` projects three skills under one root | **verified** | `tests/plugin.test.mjs` |
| Every projected skill reports a `source` DSH recognises | **verified** | same — this is the check that was missing when `ppt-master` was invisible |
| Registration lands in `plugins.bundle.config` under the package name | **verified** | client half executed against a stub module loader |
| The settings page stores through the credential service | **probed** | end-to-end on 2026-10-07: a key saved in the page appeared in a shell call as `DSH_MINERU_API_TOKEN` |
| `systemPrompt.section` is available and accepts order 620 | **probed** | live runtime; the same service is used by `dsh-free-search` at order 500 |
| The client half renders correctly in the browser | **untested** | no automated UI check; observed only through the served API listing |
| The settings page behaves correctly on a narrow viewport or in dark mode | **untested** | theme tokens are used throughout, but not visually confirmed |
| Peer ranges admit the installed runtime | **assumed** | the union matches the pattern documented for the 0.1.x/0.2.x lines; the runtime's own gate has not been exercised here |

## 3. Packed artifact

| Claim | Mark | Evidence |
| --- | --- | --- |
| Every path read at runtime is in the pack | **verified** | `npm run smoke`, `tests/smoke-install.test.mjs` |
| Each required entry is individually load-bearing | **verified** | the test drops them one at a time and asserts each failure |
| `vendor/` and the generated link never ship | **verified** | prefix-aware check in `evaluatePack` |
| The check can fail at all | **verified** | synthetic packs; this caught a real bug — the violation branch compared a directory against a file list and could never fire |
| Installing the pack composes in a real DSH profile | **probed** | installed into the live profile on 2026-10-07; `fiberPhase: active`, skill count 39 → 40 |
| Installing into a *scratch* profile | **untested** | the check runs against the tarball listing, not a composed profile |

## 4. Skills

| Claim | Mark | Evidence |
| --- | --- | --- |
| MinerU ingestion produces upstream's `<stem>.md` + `<stem>_files/` shape | **verified** | `tests/sci-scripts.test.mjs` ingests a synthetic MinerU archive end to end |
| Image links are rebased, the manifest is written | **verified** | same |
| Formula extraction ignores fenced code and prose dollar amounts | **verified** | same |
| Matrix environments are accepted, document scaffolding is not | **verified** | same |
| Formula ids are stable across re-runs | **verified** | same |
| `chart_plan.py` catches each planted defect | **verified** | one test per defect class in `tests/chart-skill.test.mjs` |
| MinerU ingestion against the real API | **untested** | needs a token and network; only the offline `--from-zip` path is tested |
| Formula LaTeX renders through a real TeX install | **untested** | no TeX on this machine; the script's absence path is tested, the success path is not |
| The academic layout pack passes upstream's own template checker | **untested** | structural conformance is asserted; upstream's `svg_quality_checker.py --template-mode` has not been run |
| The layout SVGs produce valid PowerPoint Masters/Layouts | **untested** | requires an upstream export run |

## 5. Process gaps

| Gap | Consequence |
| --- | --- |
| No scratch-profile smoke | the pack is checked as a listing, not as a composed profile; a manifest that installs but fails to *load* would not be caught here |
| No runtime-version matrix | peer ranges are declared and pattern-checked, but no documented run against more than one DSH line |
| No rendered review of the settings page | the page is verified structurally, never visually |
| No CI | everything here is run by hand; nothing enforces it on a push |

---

## Failure history

Each of these shipped while the test suite was green. They are recorded because
the pattern matters more than the individual bugs.

| What was false | Why the tests missed it | What guards it now |
| --- | --- | --- |
| The upstream skill existed | It reported `source: 'upstream'`, which DSH drops from its snapshot **without an error**. Tests asserted content equality and never asked whether a consumer would see it. | `evaluate`-style assertion that every projected skill reports a recognised source |
| The installed plugin had an upstream checkout | Tests ran against the working copy, which has `vendor/`. npm never fetches submodules. | `npm run smoke`; `postinstall`; a doctor row that fails on an unreadable `SKILL.md` |
| The checkout was pristine | Upstream gitignores `projects/*`, so a generated deck left `git status` clean. The check asked a neighbouring, easier question. | `git clean -ndX` in `verify` and `sync`, plus a probe test |
| The deck initializer wrote outside the checkout | Nothing said where it wrote, and nothing looked. | A system-prompt section, the runtime preamble, `verify` exit 2, and `sync` refusing |
| The pack shipped the settings page's client half | Nothing checked the packed artifact. | `npm run smoke` |

The common shape: **a check that passed by asking a question adjacent to the one
that mattered.** The remedy applied throughout is to make each check provably
able to fail — the probe tests, the one-at-a-time removal test, and the
synthetic packs in `tests/smoke-install.test.mjs`.
