#!/usr/bin/env node
/**
 * Upstream lifecycle tooling for dsh-ppt-master-plus.
 *
 * The plugin does not contain ppt-master. It *references* it: the parent repo
 * carries a git submodule at `vendor/ppt-master`, and `upstream.lock.json`
 * records which commit that submodule is pinned to. This script is the only
 * sanctioned way to move that pin.
 *
 * Commands
 *   init [--soft]   Materialise the upstream checkout at the locked commit.
 *                   `--soft` never exits non-zero (used by `prepare`, so a
 *                   failed network fetch cannot break `pnpm install`).
 *   check           Report whether upstream has moved. Read-only.
 *   sync [--to REF] Fast-forward the pin to upstream's tip and stage the
 *                   submodule pointer + lock file.
 *   verify          Prove the upstream tree is pristine. This is the guard
 *                   that makes "we never modify upstream" checkable rather
 *                   than merely claimed.
 *   status          Print the resolved layout.
 *
 * Exit codes: 0 ok · 1 failure · 2 drift or dirty upstream (for `check` and
 * `verify`, so CI can branch on it).
 *
 * @module scripts/upstream
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PACKAGE_DIR = resolve(HERE, '..')
export const UPSTREAM_DIR = join(PACKAGE_DIR, 'vendor', 'ppt-master')
export const LOCK_FILE = join(PACKAGE_DIR, 'upstream.lock.json')

/** Canonical upstream. Changing this is a deliberate, reviewable act. */
export const UPSTREAM_REPO = 'https://github.com/hugohe3/ppt-master.git'
export const UPSTREAM_REF = 'main'
/** Path (relative to the parent repo) that the submodule must occupy. */
export const UPSTREAM_SUBPATH = 'vendor/ppt-master'

const SCHEMA = 'dsh-ppt-master-plus.upstream-lock.v1'

// ─── process helpers ────────────────────────────────────────────────────

/**
 * Run a command and return its trimmed stdout.
 *
 * @param cmd - executable.
 * @param args - arguments.
 * @param opts - `cwd` and `allowFail`.
 * @returns `{ ok, stdout, stderr }`.
 */
function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? PACKAGE_DIR,
    encoding: 'utf8',
    windowsHide: true,
    // HTTP/1.1 avoids the HTTP/2 stream resets this network produces on
    // large fetches; a 500 MB post buffer covers ppt-master's pack size.
    env: {
      ...process.env,
      GIT_HTTP_VERSION: process.env.GIT_HTTP_VERSION ?? 'HTTP/1.1',
    },
  })
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()
  if (result.error !== undefined && result.error !== null) {
    return { ok: false, stdout, stderr: String(result.error.message ?? result.error) }
  }
  return { ok: result.status === 0, stdout, stderr }
}

/**
 * Run git in `cwd`, throwing a contextual error on failure.
 *
 * @param args - git arguments.
 * @param cwd - working directory.
 * @param allowFail - return the result instead of throwing.
 * @returns the run result.
 */
function git(args, cwd = PACKAGE_DIR, allowFail = false) {
  const result = run('git', args, { cwd })
  if (!result.ok && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}\n${result.stderr || result.stdout}`)
  }
  return result
}

/**
 * @returns true when `dir` is inside a git working tree.
 */
export function isGitRepo(dir) {
  return git(['rev-parse', '--is-inside-work-tree'], dir, true).stdout === 'true'
}

// ─── lock file ──────────────────────────────────────────────────────────

/**
 * Read `upstream.lock.json`.
 *
 * @returns the lock, or `undefined` when it is absent.
 */
export function readLock() {
  if (!existsSync(LOCK_FILE)) return undefined
  return JSON.parse(readFileSync(LOCK_FILE, 'utf8'))
}

/**
 * Write `upstream.lock.json` deterministically (stable key order, LF, and a
 * trailing newline so the file diffs cleanly).
 *
 * @param lock - the lock payload.
 * @param commitDate - ISO date the commit was authored, when known.
 */
export function writeLock(lock, commitDate) {
  const payload = {
    schema: SCHEMA,
    upstream: {
      repo: lock.repo,
      ref: lock.ref,
      commit: lock.commit,
      ...(commitDate !== undefined && commitDate !== '' ? { commitDate } : {}),
    },
    submodulePath: UPSTREAM_SUBPATH,
    note:
      'Pinned by `npm run upstream:sync`. The submodule checkout is read-only ' +
      'for this plugin: nothing under vendor/ppt-master may be edited, ' +
      'generated into, or committed from here. `npm run upstream:verify` ' +
      'enforces that.',
  }
  writeFileSync(LOCK_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

// ─── checkout helpers ───────────────────────────────────────────────────

/**
 * @returns true when `vendor/ppt-master` looks like a usable checkout.
 */
function upstreamPopulated() {
  return existsSync(join(UPSTREAM_DIR, '.git')) && existsSync(join(UPSTREAM_DIR, 'skills'))
}

/**
 * The commit the upstream checkout currently sits at.
 *
 * @returns a SHA, or `undefined`.
 */
function upstreamHead() {
  if (!existsSync(UPSTREAM_DIR)) return undefined
  const result = git(['rev-parse', 'HEAD'], UPSTREAM_DIR, true)
  return result.ok ? result.stdout : undefined
}

/**
 * Uncommitted changes inside the upstream checkout.
 *
 * @returns porcelain lines; empty means pristine.
 */
export function upstreamDirtyLines() {
  if (!upstreamPopulated()) return []
  const result = git(['status', '--porcelain'], UPSTREAM_DIR, true)
  if (!result.ok || result.stdout === '') return []
  return result.stdout.split('\n').filter((line) => line.trim() !== '')
}

/**
 * Ensure the submodule registration exists in the parent repo.
 *
 * `git submodule add` records the URL in `.gitmodules` and creates the gitlink
 * entry. When npm installed this package there is no parent git repo at all,
 * so this is skipped and `cloneDirect` is used instead.
 */
function registerSubmodule() {
  const modules = git(['config', '-f', '.gitmodules', '--get-regexp', 'path'], PACKAGE_DIR, true)
  if (modules.stdout.includes(UPSTREAM_SUBPATH)) return

  console.log(`[upstream] registering submodule ${UPSTREAM_SUBPATH}`)
  git(['submodule', 'add', '--force', UPSTREAM_REPO, UPSTREAM_SUBPATH], PACKAGE_DIR)
}

/**
 * Plain clone fallback for installs that are not a git checkout (npm tarball).
 *
 * Uses a blobless clone so a full 130 MB history is never transferred, then a
 * depth-1 fetch of the exact ref.
 *
 * @param ref - branch or commit to check out.
 */
function cloneDirect(ref) {
  console.log(`[upstream] cloning ${UPSTREAM_REPO} → ${UPSTREAM_SUBPATH} (blobless)`)
  mkdirSync(dirname(UPSTREAM_DIR), { recursive: true })
  rmSync(UPSTREAM_DIR, { recursive: true, force: true })
  const clone = run(
    'git',
    ['clone', '--filter=blob:none', '--no-checkout', '--depth', '1', '--branch', ref, UPSTREAM_REPO, UPSTREAM_DIR],
    { cwd: PACKAGE_DIR },
  )
  if (!clone.ok) throw new Error(`clone failed:\n${clone.stderr || clone.stdout}`)
  git(['checkout', ref], UPSTREAM_DIR)
}

// ─── commands ───────────────────────────────────────────────────────────

/**
 * `init` — materialise the upstream checkout at the locked commit.
 *
 * @param opts - `soft` suppresses the non-zero exit.
 * @returns the process exit code.
 */
export function cmdInit(opts = {}) {
  const lock = readLock()
  if (upstreamPopulated()) {
    const head = upstreamHead()
    console.log(`[upstream] already present at ${head?.slice(0, 12) ?? 'unknown'}`)
    if (lock !== undefined && head !== undefined && head !== lock.upstream.commit) {
      console.warn(
        `[upstream] WARNING: checkout is at ${head.slice(0, 12)} but the lock pins ` +
          `${lock.upstream.commit.slice(0, 12)}. Run \`npm run upstream:sync\` to move the pin deliberately.`,
      )
    }
    return 0
  }

  const ref = lock?.upstream?.commit ?? lock?.upstream?.ref ?? UPSTREAM_REF
  console.log(`[upstream] initialising at ${ref}`)

  try {
    if (isGitRepo(PACKAGE_DIR)) {
      registerSubmodule()
      const update = run('git', ['submodule', 'update', '--init', '--depth', '1', UPSTREAM_SUBPATH], {
        cwd: PACKAGE_DIR,
      })
      if (!update.ok) {
        console.warn(`[upstream] submodule update failed, falling back to a direct clone`)
        cloneDirect(ref)
      }
    } else {
      cloneDirect(ref)
    }
  } catch (error) {
    if (opts.soft === true) {
      console.warn(`[upstream] init skipped: ${error instanceof Error ? error.message : String(error)}`)
      console.warn('[upstream] run `npm run upstream:init` when the network is available')
      return 0
    }
    throw error
  }

  if (!upstreamPopulated()) {
    const message = 'upstream checkout is still missing after init'
    if (opts.soft === true) {
      console.warn(`[upstream] ${message}`)
      return 0
    }
    throw new Error(message)
  }

  const head = upstreamHead()
  console.log(`[upstream] ready at ${head?.slice(0, 12)}`)
  return 0
}

/**
 * `check` — is upstream ahead of our pin? Read-only, exit 2 on drift.
 *
 * @returns the process exit code.
 */
export function cmdCheck() {
  const lock = readLock()
  if (lock === undefined) {
    console.error('[upstream] no upstream.lock.json — run `npm run upstream:sync` first')
    return 1
  }

  const pinned = lock.upstream.commit
  const remote = run('git', ['ls-remote', UPSTREAM_REPO, `refs/heads/${lock.upstream.ref}`])
  if (!remote.ok) {
    console.error(`[upstream] cannot reach ${UPSTREAM_REPO}:\n${remote.stderr || remote.stdout}`)
    return 1
  }

  const tip = remote.stdout.split(/\s+/)[0] ?? ''
  console.log(`[upstream] pinned  ${pinned}`)
  console.log(`[upstream] remote  ${tip}`)

  if (tip === '') {
    console.error('[upstream] could not parse the remote ref')
    return 1
  }
  if (tip === pinned) {
    console.log('[upstream] up to date')
    return 0
  }

  console.log('[upstream] DRIFT: upstream has moved. Run `npm run upstream:sync`.')
  return 2
}

/**
 * `sync` — move the pin to upstream's tip and stage the resulting changes.
 *
 * @param opts - `to` overrides the target ref; `dryRun` reports only.
 * @returns the process exit code.
 */
export function cmdSync(opts = {}) {
  const lock = readLock()
  const ref = opts.to ?? lock?.upstream?.ref ?? UPSTREAM_REF

  if (opts.dryRun === true) {
    const remote = run('git', ['ls-remote', UPSTREAM_REPO, `refs/heads/${ref}`])
    if (!remote.ok) {
      console.error(`[upstream] cannot reach ${UPSTREAM_REPO}`)
      return 1
    }
    console.log(`[upstream] would move pin ${lock?.upstream?.commit ?? '(none)'} → ${remote.stdout.split(/\s+/)[0]}`)
    return 0
  }

  // A dirty upstream tree means someone edited or generated into the
  // submodule. Refuse to sync: the fast-forward would either fail or silently
  // discard that work, and either way the "pristine upstream" invariant is
  // already broken.
  const dirty = upstreamDirtyLines()
  if (dirty.length > 0) {
    console.error('[upstream] refusing to sync: the upstream checkout is not pristine.')
    for (const line of dirty.slice(0, 20)) console.error(`  ${line}`)
    console.error('')
    console.error('Upstream must stay a read-only reference. Move the changes out of')
    console.error('vendor/ppt-master (into this plugin\'s own trees) and re-run.')
    return 1
  }

  if (!upstreamPopulated()) {
    const code = cmdInit()
    if (code !== 0) return code
  }

  console.log(`[upstream] fetching ${ref} …`)
  const fetch = run('git', ['fetch', '--depth', '1', 'origin', ref], { cwd: UPSTREAM_DIR })
  if (!fetch.ok) {
    console.error(`[upstream] fetch failed:\n${fetch.stderr || fetch.stdout}`)
    return 1
  }

  const fetched = git(['rev-parse', 'FETCH_HEAD'], UPSTREAM_DIR, true)
  if (!fetched.ok) {
    console.error('[upstream] could not resolve FETCH_HEAD')
    return 1
  }
  const target = fetched.stdout
  const current = upstreamHead()

  if (target === current) {
    console.log(`[upstream] already at ${target.slice(0, 12)}; nothing to do`)
    refreshLock(target, ref)
    return 0
  }

  console.log(`[upstream] moving ${current?.slice(0, 12) ?? '(none)'} → ${target.slice(0, 12)}`)
  const checkout = run('git', ['checkout', '--detach', target], { cwd: UPSTREAM_DIR })
  if (!checkout.ok) {
    console.error(`[upstream] checkout failed:\n${checkout.stderr || checkout.stdout}`)
    return 1
  }

  refreshLock(target, ref)

  // Stage the gitlink + lock in the parent so the bump is one reviewable diff.
  if (isGitRepo(PACKAGE_DIR)) {
    git(['add', UPSTREAM_SUBPATH, 'upstream.lock.json'], PACKAGE_DIR, true)
    console.log('[upstream] staged the submodule pointer and upstream.lock.json')
  }
  console.log('[upstream] done. Review, then commit.')
  return 0
}

/**
 * Rewrite the lock for a commit, preserving the configured repo/ref.
 *
 * @param commit - the commit SHA.
 * @param ref - the tracked ref.
 */
function refreshLock(commit, ref) {
  const date = git(['show', '-s', '--format=%cI', commit], UPSTREAM_DIR, true)
  writeLock({ repo: UPSTREAM_REPO, ref, commit }, date.ok ? date.stdout : undefined)
  console.log(`[upstream] lock updated → ${commit}`)
}

/**
 * `verify` — prove the upstream checkout is pristine and matches the pin.
 *
 * @returns the process exit code (2 on drift or dirt).
 */
export function cmdVerify() {
  const lock = readLock()
  if (lock === undefined) {
    console.error('[upstream] no upstream.lock.json')
    return 1
  }
  if (!upstreamPopulated()) {
    console.error('[upstream] upstream checkout is missing — run `npm run upstream:init`')
    return 1
  }

  let failed = false

  const head = upstreamHead()
  if (head !== lock.upstream.commit) {
    console.error(`[upstream] FAIL: checkout ${head?.slice(0, 12)} != pinned ${lock.upstream.commit.slice(0, 12)}`)
    failed = true
  } else {
    console.log(`[upstream] ok: at the pinned commit ${head.slice(0, 12)}`)
  }

  const dirty = upstreamDirtyLines()
  if (dirty.length > 0) {
    console.error(`[upstream] FAIL: ${dirty.length} uncommitted change(s) inside the upstream checkout:`)
    for (const line of dirty.slice(0, 20)) console.error(`  ${line}`)
    failed = true
  } else {
    console.log('[upstream] ok: no local modifications')
  }

  // Nothing tracked by the parent may live inside the submodule path.
  if (isGitRepo(PACKAGE_DIR)) {
    const tracked = git(['ls-files', UPSTREAM_SUBPATH], PACKAGE_DIR, true)
    const files = tracked.stdout.split('\n').filter((line) => line !== '' && line !== UPSTREAM_SUBPATH)
    if (files.length > 0) {
      console.error(`[upstream] FAIL: ${files.length} file(s) under ${UPSTREAM_SUBPATH} are tracked by the parent repo:`)
      for (const file of files.slice(0, 20)) console.error(`  ${file}`)
      failed = true
    } else {
      console.log('[upstream] ok: nothing under vendor/ is tracked by the parent')
    }
  }

  if (failed) {
    console.error('\n[upstream] the "upstream is never modified" invariant is broken.')
    return 2
  }
  console.log('\n[upstream] verify passed: upstream is a pristine checkout at the pinned commit.')
  return 0
}

/**
 * `status` — print the resolved layout, for humans and bug reports.
 *
 * @returns the process exit code.
 */
export function cmdStatus() {
  const lock = readLock()
  const head = upstreamHead()
  console.log('dsh-ppt-master-plus')
  console.log(`  package      ${PACKAGE_DIR}`)
  console.log(`  upstream dir ${UPSTREAM_DIR}`)
  console.log(`  populated    ${upstreamPopulated()}`)
  console.log(`  checkout     ${head ?? '(none)'}`)
  console.log(`  pinned       ${lock?.upstream?.commit ?? '(no lock file)'}`)
  console.log(`  ref          ${lock?.upstream?.ref ?? UPSTREAM_REF}`)
  console.log(`  repo         ${lock?.upstream?.repo ?? UPSTREAM_REPO}`)
  const bundled = existsSync(join(PACKAGE_DIR, 'skills'))
  console.log(`  bundled skills ${bundled ? '(present)' : '(none)'}`)
  return 0
}

// ─── entry point ────────────────────────────────────────────────────────

const USAGE = `usage: node scripts/upstream.mjs <init|check|sync|verify|status> [options]

  init [--soft]      materialise the upstream checkout at the pinned commit
  check              report whether upstream has moved (exit 2 = drift)
  sync [--to REF]    move the pin to upstream's tip
  sync --dry-run     report what sync would do
  verify             prove upstream is pristine and at the pin (exit 2 = broken)
  status             print the resolved layout
`

/**
 * CLI entry.
 *
 * @param argv - process arguments after the script name.
 * @returns the exit code.
 */
export function main(argv) {
  const command = argv[0]
  const flags = new Set(argv.slice(1).filter((arg) => arg.startsWith('--')))
  const toIndex = argv.indexOf('--to')
  const to = toIndex >= 0 ? argv[toIndex + 1] : undefined

  switch (command) {
    case 'init':
      return cmdInit({ soft: flags.has('--soft') })
    case 'check':
      return cmdCheck()
    case 'sync':
      return cmdSync({ to, dryRun: flags.has('--dry-run') })
    case 'verify':
      return cmdVerify()
    case 'status':
      return cmdStatus()
    default:
      process.stdout.write(USAGE)
      return command === undefined ? 1 : 1
  }
}

// Only auto-run when executed directly, so tests can import the functions.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`[upstream] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

export { execFileSync }
