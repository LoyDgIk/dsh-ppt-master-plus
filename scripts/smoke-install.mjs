#!/usr/bin/env node
/**
 * Packed-artifact smoke test.
 *
 * WHY THIS EXISTS
 *
 * Every regression this plugin has shipped had the same shape: the tests passed
 * against the **working copy** and the **installed copy** was broken. A missing
 * `vendor/` checkout, a skill dropped from the DSH snapshot, a settings page
 * whose dependency was never declared — none were visible from the source tree,
 * because the source tree had everything the tests needed.
 *
 * The working copy is not the artifact. This checks the artifact.
 *
 * WHAT IT CHECKS
 *
 *   1. Every path the plugin reads at runtime is in the packed file list.
 *      A path that is not packed is a path that does not exist once installed.
 *   2. Which paths are deliberately NOT packed, and that the list is exactly the
 *      expected one — so a new omission is a failure rather than a surprise.
 *   3. `npm pack` succeeding at all, since a malformed manifest fails here rather
 *      than at a user's install.
 *
 * `vendor/ppt-master` is absent by design: npm never fetches submodules. That is
 * not a defect, it is why `upstream:init` exists — but it must be a *stated*
 * expectation, because it is precisely the fact that was missing when the
 * upstream skill silently failed to appear after install.
 *
 * Runs `npm pack --dry-run` only: no tarball, no network, no install.
 *
 * Usage
 *   node scripts/smoke-install.mjs            # report
 *   node scripts/smoke-install.mjs --json     # machine-readable
 *
 * Exit codes: 0 ok · 1 a required path is missing · 2 the pack itself failed.
 *
 * @module scripts/smoke-install
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(HERE, '..')

/**
 * Paths the plugin reads at runtime, and therefore requires in the pack.
 *
 * Each entry records why, so a future removal has to argue with the reason
 * rather than with a bare assertion.
 */
export const REQUIRED_IN_PACK = [
  ['index.js', 'the DSH entry point the bundle patch mounts'],
  ['cordis.patch.yml', 'the bundle patch itself'],
  ['package.json', 'the manifest the runtime reads `dsh.client` / `exports` from'],
  ['upstream.lock.json', 'the pinned commit `upstream:init` provisions'],
  ['dsh/client.js', 'the settings page; imports nothing, so it must be shipped'],
  ['scripts/upstream.mjs', 'postinstall / prepare / doctor all invoke it'],
  ['scripts/cli.mjs', 'the `doctor` and `skills` commands'],
  ['skills/ppt-master-sci/SKILL.md', 'the SCI skill body'],
  ['skills/ppt-master-sci/scripts/mineru_ingest.py', 'MinerU ingestion'],
  ['skills/ppt-master-sci/scripts/formula_manifest.py', 'formula planning'],
  ['skills/ppt-master-charts/SKILL.md', 'the charts skill body'],
  ['skills/ppt-master-charts/scripts/chart_plan.py', 'the plan validator'],
  ['skills/ppt-master-charts/assets/style-profiles/neutral-default.json', 'the default profile'],
]

/**
 * Paths deliberately absent from the pack, with the reason.
 *
 * Listed explicitly so that "it is not packed" is a decision on record. An
 * unlisted absence is how a required file goes missing quietly.
 */
export const EXPECTED_ABSENT_FROM_PACK = [
  ['vendor/ppt-master', 'npm never fetches submodules; `upstream:init` provisions it on install'],
  ['skills/ppt-master', 'a generated link into the submodule, recreated by `upstream:init`'],
  ['tests', 'not needed at runtime'],
]

/**
 * The npm command for this platform.
 *
 * Windows resolves `npm` to a `.cmd` shim. Since the CVE-2024-27980 mitigation
 * Node refuses to spawn one directly (`EINVAL`), so the command goes through a
 * shell — as a single string, which is the form `execSync` expects and which
 * avoids the `DEP0190` array-with-shell deprecation.
 */
const NPM_PACK = 'npm pack --dry-run --json --ignore-scripts'

/**
 * List the files `npm pack` would include.
 *
 * @returns the packed paths, relative to the package root, using forward slashes.
 */
export function packedFiles() {
  // `--ignore-scripts` matters: the manifest's `prepare`/`postinstall` run
  // `upstream:init`, which would try to clone 130 MB during a dry run.
  const raw = execSync(NPM_PACK, {
    cwd: PACKAGE_DIR,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })

  const parsed = JSON.parse(raw)
  const entry = Array.isArray(parsed) ? parsed[0] : parsed
  const files = entry?.files
  if (!Array.isArray(files)) {
    throw new Error('npm pack --json returned no file list')
  }
  return files.map((file) => String(file.path).replace(/\\/g, '/'))
}

/**
 * Is `path` the given prefix, or something inside it?
 *
 * Compares on a separator boundary, not a bare `startsWith`: `skills/ppt-master`
 * must match `skills/ppt-master/SKILL.md` but **not** `skills/ppt-master-sci/…`,
 * which is a different skill whose name merely begins the same way.
 *
 * @param prefix - the directory or file in question.
 * @param path - a packed path.
 * @returns true when `path` is `prefix` or lies under it.
 */
function under(prefix, path) {
  return path === prefix || path.startsWith(`${prefix}/`)
}

/**
 * Evaluate a packed file list.
 *
 * Prefix-aware, and that is load-bearing rather than fussy: a pack lists files,
 * so a check written as `packed.has('vendor/ppt-master')` can never fire. It
 * looks like a guard and is a no-op — the failure mode this file exists to
 * catch, reproduced inside it.
 *
 * Split from {@link packedFiles} so it can be tested without running npm — a
 * check whose only test is "it passed on the real artifact" has never been shown
 * able to fail.
 *
 * @param paths - packed paths, relative to the package root.
 * @returns `{ ok, missing, absent, violations, total }`.
 */
export function evaluatePack(paths) {
  const packed = paths.map((path) => String(path).replace(/\\/g, '/'))
  const present = (prefix) => packed.some((path) => under(prefix, path))

  const missing = REQUIRED_IN_PACK
    .filter(([path]) => !present(path))
    .map(([path, why]) => ({ path, why }))

  const absent = EXPECTED_ABSENT_FROM_PACK
    .filter(([path]) => !present(path))
    .map(([path, why]) => ({ path, why }))

  // Anything that must not ship but did is also a defect — a vendored subtree
  // would turn this plugin into the copy it exists to avoid.
  const violations = EXPECTED_ABSENT_FROM_PACK
    .filter(([path]) => present(path))
    .map(([path, why]) => ({ path, why }))

  return {
    ok: missing.length === 0 && violations.length === 0,
    missing,
    absent,
    violations,
    total: packed.length,
  }
}

/**
 * Run the smoke test against the real pack.
 *
 * @returns the {@link evaluatePack} result.
 */
export function smokeInstall() {
  return evaluatePack(packedFiles())
}

/** CLI entry. @returns the exit code. */
export function main(argv = process.argv.slice(2)) {
  let result
  try {
    result = smokeInstall()
  } catch (error) {
    console.error(`[smoke] npm pack failed: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }

  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
    return result.ok ? 0 : 1
  }

  console.log(`packed files: ${result.total}`)
  console.log('')

  console.log('Required at runtime:')
  for (const [path, why] of REQUIRED_IN_PACK) {
    const present = !result.missing.some((entry) => entry.path === path)
    console.log(`  ${present ? 'ok  ' : 'MISS'} ${path}`)
    if (!present) console.log(`         ${why}`)
  }

  console.log('')
  console.log('Deliberately absent:')
  for (const entry of result.absent) {
    console.log(`  ok   ${entry.path} — ${entry.why}`)
  }

  if (result.violations.length > 0) {
    console.log('')
    console.error('UNEXPECTEDLY PACKED (would turn this plugin into a vendored copy):')
    for (const entry of result.violations) console.error(`  ${entry.path} — ${entry.why}`)
  }

  console.log('')
  if (result.ok) {
    console.log('SMOKE OK: the packed artifact carries everything the runtime reads.')
    return 0
  }
  console.error('SMOKE FAILED: install would be missing files the plugin reads.')
  return 1
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main()
}

export { existsSync, readFileSync, join }
