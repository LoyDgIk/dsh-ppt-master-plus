#!/usr/bin/env node
/**
 * `dsh-ppt-master-plus` operator CLI.
 *
 * Commands
 *   doctor    Report whether the plugin is usable: upstream checkout, pinned
 *             commit, pristine state, discoverable skills, and the optional
 *             Python/TeX toolchain the SCI skill can use.
 *   skills    List the skills the plugin would project, and from which root.
 *
 * `doctor` is read-only. Anything that mutates state lives in
 * `scripts/upstream.mjs`, which owns the pin.
 *
 * Exit codes: 0 healthy · 1 unhealthy · 2 usage error.
 *
 * @module scripts/cli
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(HERE, '..')
const UPSTREAM_DIR = join(PACKAGE_DIR, 'vendor', 'ppt-master')
const LOCK_FILE = join(PACKAGE_DIR, 'upstream.lock.json')

const OK = 'ok  '
const WARN = 'warn'
const BAD = 'FAIL'

/** Collected findings, so the exit code can reflect the worst one. */
const findings = []

/**
 * Record a check result.
 *
 * @param level - OK, WARN or BAD.
 * @param label - what was checked.
 * @param detail - the finding.
 */
function report(level, label, detail) {
  findings.push({ level, label, detail })
  console.log(`[${level}] ${label}${detail ? `: ${detail}` : ''}`)
}

/**
 * Run a command and return its result.
 *
 * @param cmd - executable.
 * @param args - arguments.
 * @param cwd - working directory.
 * @returns `{ ok, out }`.
 */
function run(cmd, args, cwd = PACKAGE_DIR) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true })
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}

/**
 * Find a Python 3 interpreter.
 *
 * @returns the command name, or undefined.
 */
function findPython() {
  for (const candidate of ['python3', 'python', 'py']) {
    const probe = run(candidate, ['--version'])
    if (probe.ok && /Python 3/.test(probe.out)) return candidate
  }
  return undefined
}

/**
 * Read and shape-check the lock file.
 *
 * @returns the lock, or undefined.
 */
function readLock() {
  if (!existsSync(LOCK_FILE)) return undefined
  try {
    return JSON.parse(readFileSync(LOCK_FILE, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * List skills under a root.
 *
 * Symlinks and junctions count as skills: the upstream skill reaches this
 * directory through one, and `Dirent.isDirectory()` is false for a link even
 * when it resolves to a directory — so filtering on `isDirectory()` alone would
 * hide exactly the skill this layout exists to make visible.
 *
 * @param root - directory holding `<skill>/SKILL.md` entries.
 * @returns skill directory names.
 */
function listSkills(root) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink())
      && existsSync(join(root, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort()
}

/** Run the doctor. @returns the exit code. */
function doctor() {
  console.log('dsh-ppt-master-plus — doctor\n')

  console.log('Structure')
  report(existsSync(join(PACKAGE_DIR, 'index.js')) ? OK : BAD, 'plugin entry', 'index.js')
  report(existsSync(join(PACKAGE_DIR, 'cordis.patch.yml')) ? OK : BAD, 'bundle patch', 'cordis.patch.yml')

  console.log('\nUpstream')
  const lock = readLock()
  if (lock === undefined) {
    report(BAD, 'upstream lock', 'upstream.lock.json is missing or unparseable')
  } else {
    report(OK, 'upstream lock', `${lock.upstream.repo} @ ${lock.upstream.ref}`)
  }

  const populated = existsSync(join(UPSTREAM_DIR, 'skills', 'ppt-master', 'SKILL.md'))
  report(populated ? OK : BAD, 'upstream checkout', populated ? UPSTREAM_DIR : 'not initialised — run: npm run upstream:init')

  if (populated) {
    const head = run('git', ['rev-parse', 'HEAD'], UPSTREAM_DIR)
    if (head.ok && lock !== undefined) {
      if (head.out === lock.upstream.commit) {
        report(OK, 'pinned commit', head.out.slice(0, 12))
      } else {
        report(BAD, 'pinned commit', `checkout ${head.out.slice(0, 12)} != pinned ${lock.upstream.commit.slice(0, 12)}`)
      }
    }
    const status = run('git', ['status', '--porcelain'], UPSTREAM_DIR)
    if (status.ok && status.out === '') {
      report(OK, 'pristine', 'no local modifications')
    } else {
      report(BAD, 'pristine', `upstream has local modifications:\n${status.out}`)
    }
  }

  console.log('\nSkills')
  // One directory. The upstream skill is reached through a link inside it, so
  // listing per-tree would reintroduce the split this layout removes.
  const skills = listSkills(join(PACKAGE_DIR, 'skills'))
  report(skills.length > 0 ? OK : WARN, 'skills', skills.join(', ') || 'none')

  // Find skills the provider will actually see: a directory without a readable
  // SKILL.md is invisible everywhere, and a dangling link is the usual cause.
  const unreadable = []
  for (const name of skills) {
    const file = join(PACKAGE_DIR, 'skills', name, 'SKILL.md')
    try {
      if (readFileSync(file, 'utf8').trim() === '') unreadable.push(name)
    } catch {
      unreadable.push(name)
    }
  }
  if (unreadable.length > 0) {
    report(
      BAD,
      'skill files',
      `${unreadable.join(', ')} — SKILL.md is unreadable (a dangling link means upstream:init has not run)`,
    )
  } else {
    report(OK, 'skill files', 'every skill has a readable SKILL.md')
  }

  console.log('\nOptional toolchain (SCI skill)')
  const python = findPython()
  report(python !== undefined ? OK : WARN, 'python 3', python ?? 'not found — SCI ingestion and formula extraction need it')

  const texFound = ['latex', 'pdflatex', 'xelatex'].some((name) => run(name, ['--version']).ok)
  const dvisvgm = run('dvisvgm', ['--version']).ok
  if (texFound && dvisvgm) {
    report(OK, 'tex + dvisvgm', 'LaTeX preview rendering available')
  } else {
    report(WARN, 'tex + dvisvgm', 'absent — optional; only the preview step needs it, native formula markers do not')
  }

  // Checked in the same order the skill's script resolves them. A token set in
  // the settings page arrives as DSH_MINERU_API_TOKEN on a shell call, so this
  // script — running as one — sees it here too.
  const token = (
    process.env.DSH_MINERU_API_TOKEN
    ?? process.env.MINERU_API_TOKEN
    ?? process.env.MINERU_API_KEY
    ?? process.env.MINERU_TOKEN
    ?? ''
  ).trim()
  report(
    token !== '' ? OK : WARN,
    'mineru token',
    token !== ''
      ? `set (${process.env.DSH_MINERU_API_TOKEN ? 'from the plugin settings page' : 'from the environment'})`
      : 'not set — save one in 插件 → dsh-ppt-master-plus, export MINERU_API_TOKEN, or use --from-zip',
  )

  // The bridge is only observable from inside the host process, so report the
  // documented contract rather than guessing at the live state.
  const clientPath = join(PACKAGE_DIR, 'dsh', 'client.js')
  report(
    existsSync(clientPath) ? OK : WARN,
    'settings page',
    existsSync(clientPath)
      ? 'dsh/client.js present — appears under 插件 → dsh-ppt-master-plus once the bundle is installed'
      : 'dsh/client.js missing',
  )

  const failed = findings.filter((finding) => finding.level === BAD).length
  const warned = findings.filter((finding) => finding.level === WARN).length
  console.log(`\n${failed === 0 ? 'HEALTHY' : 'UNHEALTHY'} — ${findings.length - failed - warned} ok, ${warned} warning(s), ${failed} failure(s)`)
  if (failed > 0) {
    console.log('Run `npm run upstream:init` for a missing checkout, `npm run upstream:verify` to inspect a dirty one.')
  }
  return failed === 0 ? 0 : 1
}

/** Run the skills listing. @returns the exit code. */
function skills() {
  console.log('dsh-ppt-master-plus — projected skills\n')
  const groups = [
    ['upstream (read-only git submodule)', join(UPSTREAM_DIR, 'skills')],
    ['bundled (this plugin)', join(PACKAGE_DIR, 'skills')],
  ]
  for (const [label, root] of groups) {
    console.log(`${label}:`)
    const names = listSkills(root)
    if (names.length === 0) console.log('  (none)')
    for (const name of names) console.log(`  ${name}`)
    console.log('')
  }
  return 0
}

const USAGE = `usage: dsh-ppt-master-plus <doctor|skills>

  doctor   report plugin health (read-only)
  skills   list the skills this plugin projects
`

/**
 * CLI entry.
 *
 * @param argv - arguments after the script name.
 * @returns the exit code.
 */
function main(argv) {
  switch (argv[0]) {
    case 'doctor':
      return doctor()
    case 'skills':
      return skills()
    default:
      process.stdout.write(USAGE)
      return 2
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2))
}

export { doctor, skills, main }
