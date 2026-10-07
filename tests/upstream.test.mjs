/**
 * Repository-invariant tests.
 *
 * These assert the two properties the whole design rests on:
 *
 *   1. the upstream checkout is a *pristine git submodule* at the commit
 *      recorded in upstream.lock.json, so `git submodule update --remote`
 *      stays a clean fast-forward; and
 *   2. this plugin's own additions live entirely outside that tree.
 *
 * If either fails, the "reference upstream, never modify it" claim is not
 * merely untested — it is false, and the next upstream sync will conflict.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = join(HERE, '..')
const UPSTREAM_DIR = join(PACKAGE_DIR, 'vendor', 'ppt-master')
const LOCK_FILE = join(PACKAGE_DIR, 'upstream.lock.json')
const HAS_SUBMODULE = existsSync(join(UPSTREAM_DIR, '.git'))
const SKIP = HAS_SUBMODULE ? false : 'upstream submodule not initialised'

/**
 * Run git in a directory.
 *
 * @param args - git arguments.
 * @param cwd - working directory.
 * @returns trimmed stdout.
 */
function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return (result.stdout ?? '').trim()
}

describe('upstream lock', () => {
  test('the lock file exists and is well formed', () => {
    assert.ok(existsSync(LOCK_FILE), 'upstream.lock.json must be committed')
    const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8'))
    assert.equal(lock.schema, 'dsh-ppt-master-plus.upstream-lock.v1')
    assert.equal(lock.submodulePath, 'vendor/ppt-master')
    assert.match(lock.upstream.repo, /hugohe3\/ppt-master/)
    assert.equal(lock.upstream.ref, 'main')
    assert.match(lock.upstream.commit, /^[0-9a-f]{40}$/)
  })

  test('.gitmodules points at the canonical upstream, not at a vendored copy', () => {
    const gitmodules = readFileSync(join(PACKAGE_DIR, '.gitmodules'), 'utf8')
    assert.match(gitmodules, /path = vendor\/ppt-master/)
    assert.match(gitmodules, /url = https:\/\/github\.com\/hugohe3\/ppt-master\.git/)
  })
})

describe('upstream is pristine', { skip: SKIP }, () => {
  test('the checkout sits at the pinned commit', () => {
    const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8'))
    assert.equal(git(['rev-parse', 'HEAD'], UPSTREAM_DIR), lock.upstream.commit)
  })

  test('the checkout has no local modifications', () => {
    const status = git(['status', '--porcelain'], UPSTREAM_DIR)
    assert.equal(status, '', `upstream must be pristine but shows:\n${status}`)
  })

  test('the parent repo tracks nothing inside the submodule path', () => {
    const tracked = git(['ls-files', 'vendor/ppt-master'], PACKAGE_DIR)
      .split('\n')
      .filter((line) => line !== '' && line !== 'vendor/ppt-master')
    assert.deepEqual(tracked, [], 'only the gitlink may be tracked, never upstream files')
  })

  test('the upstream skill tree is present and unchanged in shape', () => {
    assert.ok(existsSync(join(UPSTREAM_DIR, 'skills', 'ppt-master', 'SKILL.md')))
    assert.ok(existsSync(join(UPSTREAM_DIR, 'skills', 'ppt-master', 'references', 'native-formula.md')))
  })
})

describe('plugin additions live outside upstream', () => {
  test('the SCI skill is a sibling of the upstream tree, not inside it', () => {
    const sci = join(PACKAGE_DIR, 'skills', 'ppt-master-sci')
    assert.ok(existsSync(join(sci, 'SKILL.md')))
    assert.ok(existsSync(join(sci, 'scripts', 'mineru_ingest.py')))
    assert.ok(existsSync(join(sci, 'scripts', 'formula_manifest.py')))
    assert.ok(existsSync(join(sci, 'scripts', 'latex_preview.py')))
    assert.ok(!sci.startsWith(UPSTREAM_DIR), 'the skill must not live under vendor/')
  })

  test('the charts skill is a sibling too, and duplicates no upstream file', () => {
    const charts = join(PACKAGE_DIR, 'skills', 'ppt-master-charts')
    assert.ok(existsSync(join(charts, 'SKILL.md')))
    assert.ok(existsSync(join(charts, 'scripts', 'chart_plan.py')))
    assert.ok(existsSync(join(charts, 'assets', 'style-profiles', 'neutral-default.json')))
    assert.ok(existsSync(join(charts, 'assets', 'style-profiles', 'blue-gray-business.json')))
    assert.ok(!charts.startsWith(UPSTREAM_DIR))

    // Upstream's chart SVGs must not be copied in: this skill selects and
    // specifies forms, it does not re-host upstream's assets.
    const upstreamCharts = join(UPSTREAM_DIR, 'skills', 'ppt-master', 'templates', 'charts')
    if (existsSync(upstreamCharts)) {
      const chartNames = readdirSync(upstreamCharts).filter((n) => n.endsWith('.svg'))
      const bundled = existsSync(join(charts, 'assets', 'charts'))
        ? readdirSync(join(charts, 'assets', 'charts')) : []
      for (const name of chartNames) {
        assert.ok(!bundled.includes(name), `${name} duplicates an upstream chart asset`)
      }
    }
  })

  test('the SCI SKILL.md declares the required frontmatter', () => {
    const raw = readFileSync(join(PACKAGE_DIR, 'skills', 'ppt-master-sci', 'SKILL.md'), 'utf8')
    assert.match(raw, /^---\r?\n/)
    assert.match(raw, /^name: ppt-master-sci$/m)
    assert.match(raw, /^description: >$/m)
    assert.match(raw, /^---\r?\n/m)
    assert.ok(raw.length > 2000, 'the skill body must be substantive')
    assert.match(raw, /vendor\/ppt-master/, 'it must state the upstream boundary')
  })

  test('the academic layout pack uses the project-root workspace shape', () => {
    const root = join(PACKAGE_DIR, 'skills', 'ppt-master-sci', 'assets', 'template-library')
    const templates = join(root, 'templates')
    assert.ok(existsSync(templates), 'the workspace root must contain templates/')

    // Project-root shape: one flat templates/ with design_spec.<kind>.<id>.md.
    const spec = join(templates, 'design_spec.layout.academic_defense.md')
    assert.ok(existsSync(spec), 'the spec filename must carry kind and id')

    const raw = readFileSync(spec, 'utf8')
    assert.match(raw, /^kind: layout$/m)
    assert.match(raw, /^layout_id: academic_defense$/m)
    assert.match(raw, /^native_structure_mode: structured$/m)

    const pageTypes = ['01_cover', '02_outline', '03_section', '04_content',
      '05_two_column', '06_figure_full', '07_ending']
    const files = readdirSync(templates)
    for (const page of pageTypes) {
      assert.ok(files.includes(`${page}.svg`), `missing roster page ${page}.svg`)
    }

    // The deck project root must NOT be the directory handed to upstream.
    assert.ok(!files.includes('design_spec.md'), 'a project root must not use the library spec name')
  })

  test('every roster SVG carries a master and a layout identity', () => {
    const templates = join(PACKAGE_DIR, 'skills', 'ppt-master-sci', 'assets', 'template-library', 'templates')
    const svgs = readdirSync(templates).filter((name) => name.endsWith('.svg'))
    assert.equal(svgs.length, 7)

    for (const name of svgs) {
      const svg = readFileSync(join(templates, name), 'utf8')
      assert.match(svg, /data-pptx-master="academic_defense_(cover|body)_master"/, `${name}: master id`)
      assert.match(svg, /data-pptx-layout="[a-z_]+"/, `${name}: layout key`)
      assert.match(svg, /data-pptx-layout-name="[^"]+"/, `${name}: layout name`)
      assert.match(svg, /data-pptx-placeholder="[a-z-]+"/, `${name}: at least one placeholder`)
      assert.match(svg, /data-pptx-carrier="true"/, `${name}: a carrier element`)
      assert.match(svg, /\{\{[A-Z0-9_]+\}\}/, `${name}: a {{PLACEHOLDER}} name`)
    }
  })

  test('a project-root workspace holds exactly one spec per kind', () => {
    const templates = join(PACKAGE_DIR, 'skills', 'ppt-master-sci', 'assets', 'template-library', 'templates')
    const specs = readdirSync(templates).filter((name) => name.startsWith('design_spec.'))
    assert.deepEqual(specs, ['design_spec.layout.academic_defense.md'])
  })
})
