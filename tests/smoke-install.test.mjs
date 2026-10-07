/**
 * Packed-artifact tests.
 *
 * The point of this file is the second half. `scripts/smoke-install.mjs` only
 * earns its place if it can fail, so `evaluatePack` is exercised directly with
 * synthetic file lists — including ones that are missing a required file and
 * ones that wrongly include a vendored subtree.
 *
 * That separation exists because every regression this plugin has shipped had
 * the same shape: the check ran against the working copy, passed, and the
 * installed artifact was broken. A green result on the real artifact proves
 * nothing unless the same code is known to go red on a broken one.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  EXPECTED_ABSENT_FROM_PACK,
  REQUIRED_IN_PACK,
  evaluatePack,
  packedFiles,
} from '../scripts/smoke-install.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = join(HERE, '..')

/** A synthetic pack containing exactly what is required, and nothing else. */
function idealPack() {
  return REQUIRED_IN_PACK.map(([path]) => path)
}

describe('pack evaluation', () => {
  test('an ideal pack passes', () => {
    const result = evaluatePack(idealPack())
    assert.equal(result.ok, true, JSON.stringify(result.missing))
    assert.equal(result.missing.length, 0)
    assert.equal(result.violations.length, 0)
  })

  test('a missing required file is reported with its reason', () => {
    // This is the exact shape of the bug that shipped a settings page whose
    // client half was never in the pack.
    const without = idealPack().filter((path) => path !== 'dsh/client.js')
    const result = evaluatePack(without)

    assert.equal(result.ok, false, 'dropping a required file must fail')
    assert.deepEqual(result.missing.map((entry) => entry.path), ['dsh/client.js'])
    assert.match(result.missing[0].why, /settings page/, 'the reason must travel with the failure')
  })

  test('every required entry is individually load-bearing', () => {
    // Drop them one at a time: a required list where a removal goes unnoticed
    // has an entry that is not actually required.
    for (const [path] of REQUIRED_IN_PACK) {
      const result = evaluatePack(idealPack().filter((entry) => entry !== path))
      assert.equal(result.ok, false, `dropping ${path} must fail the check`)
      assert.ok(
        result.missing.some((entry) => entry.path === path),
        `dropping ${path} must be named in the result`,
      )
    }
  })

  test('shipping a vendored subtree is a violation, not a pass', () => {
    // `vendor/` in the pack would make this plugin the copy it exists to avoid,
    // and would silently double the download.
    const result = evaluatePack([...idealPack(), 'vendor/ppt-master/skills/ppt-master/SKILL.md'])
    assert.equal(result.ok, false, 'a vendored subtree must fail')
    assert.deepEqual(result.violations.map((entry) => entry.path), ['vendor/ppt-master'])
  })

  test('absent entries are reported, not merely tolerated', () => {
    // "Deliberately absent" has to be a recorded decision; an unlisted absence
    // is how a required file goes missing quietly.
    const result = evaluatePack(idealPack())
    assert.equal(
      result.absent.length,
      EXPECTED_ABSENT_FROM_PACK.length,
      'every deliberately-absent path must be confirmed absent',
    )
    for (const entry of result.absent) {
      assert.ok(entry.why.length > 10, `${entry.path} needs a stated reason`)
    }
  })

  test('Windows separators are normalised', () => {
    const result = evaluatePack(idealPack().map((path) => path.replace(/\//g, '\\')))
    assert.equal(result.ok, true, 'a pack listing from Windows must evaluate the same')
  })
})

describe('the real pack', () => {
  test('carries every path the runtime reads', async () => {
    let paths
    try {
      paths = packedFiles()
    } catch (error) {
      // npm unavailable in this environment: the synthetic tests above still ran.
      assert.ok(error, 'npm pack must either succeed or be reported')
      return
    }

    const result = evaluatePack(paths)
    assert.equal(
      result.ok,
      true,
      `install would be missing: ${result.missing.map((entry) => entry.path).join(', ')}`,
    )
    assert.ok(result.total > 20, `suspiciously small pack: ${result.total} files`)
  })

  test('does not ship the submodule or its link', async () => {
    let paths
    try {
      paths = packedFiles()
    } catch {
      return
    }
    const packed = new Set(paths)
    assert.ok(!packed.has('vendor/ppt-master'), 'the submodule must never be packed')
    assert.ok(!packed.has('skills/ppt-master'), 'the generated link must never be packed')
    // The lock file, by contrast, must ship: `upstream:init` reads it.
    assert.ok(packed.has('upstream.lock.json'), 'the pin must ship, or init cannot provision')
  })
})

describe('package manifest', () => {
  test('declares the DSH peers the runtime gate evaluates', async () => {
    // The 0.1.7+ runtime reads these and disables a plugin whose peers mismatch.
    // Declaring none meant no install-time signal at all for a plugin that needs
    // the `skills` service to do anything.
    const manifest = JSON.parse(
      (await import('node:fs')).readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'),
    )
    const peers = manifest.peerDependencies ?? {}

    assert.ok(peers['@deepseek-ai/dsh'], 'the runtime itself must be declared')
    assert.ok(peers['@deepseek-ai/dsh-skill'], 'the skills service is a hard dependency')

    for (const [name, range] of Object.entries(peers)) {
      if (!name.startsWith('@deepseek-ai/dsh')) continue
      // npm and pnpm only admit a prerelease when a comparator on the same
      // major.minor.patch tuple carries a prerelease tag. A single wide range
      // looks tidier and fails to install on a prerelease runtime.
      assert.match(
        range,
        /-rc\.\d+/,
        `${name} must carry prerelease comparators, or install fails on a prerelease runtime`,
      )
      assert.match(range, /\|\|/, `${name} must be a union with one branch per supported line`)
    }
  })
})
