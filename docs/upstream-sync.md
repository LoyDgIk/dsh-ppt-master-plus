# Upstream sync runbook

How to move the pinned ppt-master commit, and what to do when it goes wrong.

## Model

| Artifact | Role |
| --- | --- |
| `.gitmodules` | Declares `vendor/ppt-master` → `https://github.com/hugohe3/ppt-master.git` |
| the gitlink | Records *which* commit the parent expects |
| `upstream.lock.json` | Records the same commit, plus the tracked ref, in a human-readable file |
| `vendor/ppt-master/` | The working checkout. **Read-only for this plugin.** |

The gitlink and the lock file are two views of one fact. `sync` writes both and
stages both, so they cannot drift apart in a commit.

## Routine check

```bash
npm run upstream:check
```

| Exit | Meaning |
| --- | --- |
| 0 | Upstream is at the pin |
| 2 | Upstream has moved — sync when ready |
| 1 | The lock or the network is unusable |

Read-only. Safe to run in CI on a schedule.

## Syncing

```bash
npm run upstream:sync -- --dry-run    # see what would change
npm run upstream:sync                 # move the pin
npm test                              # 46 tests
npm run upstream:verify               # prove upstream is pristine
git add -A && git commit              # one reviewable diff
```

`sync` does the following, in order:

1. **Refuses** if `vendor/ppt-master` has uncommitted changes.
2. Fetches a depth-1 copy of the tracked ref.
3. Checks out the new commit detached.
4. Rewrites `upstream.lock.json`, preserving the configured repo and ref.
5. Stages the gitlink and the lock file together.

To move to something other than the tip of `main`:

```bash
node scripts/upstream.mjs sync --to <ref-or-sha>
```

## Why sync refuses a dirty submodule

A local modification inside `vendor/ppt-master` means the "we never modify
upstream" invariant is already broken. At that point:

- the fast-forward may silently discard the change, or fail in a way that reads
  like a git problem rather than a design violation;
- and any verification result becomes untrustworthy, because the running system
  is no longer the pinned commit.

So `sync` stops and shows the offending paths. The fix is not to stash them; it
is to decide which tree they actually belong to:

| The change is… | It belongs in… |
| --- | --- |
| A new script or reference | `skills/ppt-master-sci/` |
| A template or layout | `skills/ppt-master-sci/assets/template-library/` |
| A fix to upstream's own logic | upstream — as a PR, never as a local edit |
| A generated artifact (SVG, PPTX, cache) | the deck project workspace, never the submodule |

Then:

```bash
cd vendor/ppt-master && git checkout -- . && git clean -fd
cd ../.. && npm run upstream:verify
```

## After a sync: what to check

The plugin's contract with upstream is narrow, which is what keeps a sync cheap.
Confirm each part still holds:

1. **`npm test`** — the provider still discovers upstream skills, and upstream is
   still registered verbatim.
2. **The upstream skill count.** `npm run doctor` prints the projected skills.
   If upstream split or renamed `ppt-master`, the provider picks it up
   automatically, but `ppt-master-sci`'s references to `ppt-master` by name may
   need updating.
3. **The contract documents the SCI skill cites.** These are the ones that
   matter, and a rename is the realistic breakage:
   - `references/native-formula.md` — the formula marker contract
   - `references/artifact-ownership.md` — the project workspace layout
   - `templates/README.md`, `templates/layouts/README.md` — layout workspace shape
   - `workflows/routing.md` §7 — `library` vs `explicit` root selection

   If one moved, fix the pointer in the SCI skill. Do not restate the contract in
   our own docs to avoid the dependency — a restated contract is one release away
   from being wrong.
4. **`scripts/source_to_md.py`** — the SCI skill's ingestion targets the
   `OUTPUT: <path>` line protocol this script uses. Confirm it survived.

## Recovering a broken submodule

| Symptom | Cause | Fix |
| --- | --- | --- |
| `fatal: not a git repository` inside `vendor/ppt-master` | Submodule never initialised | `npm run upstream:init` |
| Checkout at the wrong commit | Someone checked out manually | `npm run upstream:sync` (or `sync --to <pinned sha>`) |
| `verify` exit 2, files listed | Local edits in the submodule | Decide ownership (table above), move them out, `git checkout -- .` |
| `verify` exit 2, "tracked by the parent" | Upstream files were `git add`-ed from the parent | `git rm -r --cached vendor/ppt-master` (keeps files), keep the gitlink, commit |
| Clone wants 130 MB and keeps failing | Large pack over a flaky link | `http.version=HTTP/1.1` is already set by the tooling; prefer `npm run upstream:init`, which clones blobless |
| `index.lock` exists | A previous git process was killed | Confirm no `git` process is running, then delete the lock |

Re-initialising from scratch is always safe, because the pin is recorded outside
the checkout:

```bash
git submodule deinit -f vendor/ppt-master
rm -rf vendor/ppt-master .git/modules/vendor/ppt-master
npm run upstream:init
```

## Installing without git

An npm install has no parent git repo, so there is no submodule to update.
`upstream:init` detects this and falls back to:

```bash
git clone --filter=blob:none --no-checkout --depth 1 --branch <ref> <repo> vendor/ppt-master
git checkout <ref>
```

`prepare` runs `upstream:init --soft`, which warns and exits 0 on failure — a
failed network fetch must never break `npm install`. Materialise the checkout
afterwards with `npm run upstream:init`.

## Pointing at a different checkout

```bash
export DSH_PPT_MASTER_PLUS_UPSTREAM=/path/to/ppt-master
```

Useful for a developer working copy, a shared install, or a CI cache. The
provider reads it at registration; the `upstream:*` scripts keep operating on
`vendor/ppt-master` regardless, so the pin remains the repo's contract.

## CI

```yaml
- run: npm run upstream:verify    # exit 2 if upstream was modified
- run: npm test                   # includes the same invariants
- run: npm run upstream:check     # optional: exit 2 when upstream has moved
```

Gate on `verify` and `test`. Treat `check` exit 2 as a routine notification, not
a build failure — otherwise every upstream release turns CI red.

## Deck projects must not be created inside the checkout

The one upstream behaviour that fights this layout, and the one easiest to miss.

### What happens

Upstream derives its project destination from its own location:

```python
# skills/ppt-master/scripts/project_management/paths.py
SKILL_DIR     = SCRIPTS_DIR.parent
REPO_ROOT     = SKILL_DIR.parent.parent
PROJECTS_ROOT = REPO_ROOT / "projects"
```

So `project_manager.py init <name>` creates the deck at
`vendor/ppt-master/projects/<name>/` — inside the read-only reference. There is
**no environment variable** to redirect it; `REPO_ROOT` is computed from
`__file__`.

### Why it goes unnoticed

Upstream's own `.gitignore` contains:

```gitignore
projects/*
!projects/README.md
```

Everything the initializer writes there is therefore **ignored by git**. The
checkout reports a clean `git status`, `git submodule update --remote` proceeds
happily, and the first sign of trouble is someone listing the directory.

That is why `verify` does not stop at `git status`. It also runs
`git clean -ndX -- projects`, which lists the ignored paths that *exist*. The
question actually being asked is "was anything written here?"; tracked
cleanliness is a different question that happens to agree when nothing is wrong.

### The fix

`init` accepts `--dir`. Always pass it:

```bash
python3 <upstream>/skills/ppt-master/scripts/project_manager.py init <name> \
  --dir <workspace>/ppt-decks
```

`project_name` must stay a single path component — no separators, not absolute —
so `--dir` is the only lever. Every other subcommand (`import-sources`,
`validate`, `info`, `page-context`, …) takes an explicit project path, so once
the project exists outside the checkout nothing else needs redirecting.

### How this is enforced

| Layer | What it does |
| --- | --- |
| **System prompt** | The plugin registers a short section naming the checkout and the `--dir` form. It reaches every model step — including a run that loads upstream's `ppt-master` alone, which the plugin's skill preamble cannot cover, because that skill is registered verbatim. |
| **`verify`** | Fails (exit 2), prints the offending paths, and prints the `mv` that fixes them. |
| **`sync`** | Refuses to run while generated files are present. |
| **`test`** | Asserts the checkout holds nothing generated, and plants a probe to prove the check can actually fail. |

### If it has already happened

```bash
mkdir -p <workspace>/ppt-decks
mv vendor/ppt-master/projects/<name> <workspace>/ppt-decks/
npm run upstream:verify
```

The project itself is fine — it is an ordinary deck directory and every upstream
command accepts it by path. Only its location was wrong.

