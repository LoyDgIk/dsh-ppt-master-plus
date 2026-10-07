/**
 * Tests for the `ppt-master-charts` skill.
 *
 * The load-bearing tests are in the second half: `chart_plan.py` exists to catch
 * the mistakes a model makes when it picks a visual form, so these tests plant
 * those mistakes deliberately and assert the tool reports each one. A validator
 * that passes a broken plan is worse than no validator, because it converts a
 * visible defect into an endorsed one.
 *
 * Skips itself when no Python 3 interpreter is on PATH.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = join(HERE, '..')
const SKILL = join(PACKAGE_DIR, 'skills', 'ppt-master-charts')
const SCRIPT = join(SKILL, 'scripts', 'chart_plan.py')
const PROFILES = join(SKILL, 'assets', 'style-profiles')

/**
 * Locate a usable Python 3 interpreter.
 *
 * @returns the command, or undefined.
 */
function findPython() {
  for (const candidate of ['python3', 'python', 'py']) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8', windowsHide: true })
    if (probe.status === 0 && /Python 3/.test(`${probe.stdout}${probe.stderr}`)) return candidate
  }
  return undefined
}

const PYTHON = findPython()
const SKIP = PYTHON === undefined ? 'no Python 3 interpreter on PATH' : false

let work

before(() => {
  work = mkdtempSync(join(tmpdir(), 'dsh-ppt-charts-test-'))
})

after(() => {
  if (work !== undefined) rmSync(work, { recursive: true, force: true })
})

/**
 * Run chart_plan.py.
 *
 * @param args - arguments.
 * @returns `{ status, stdout, stderr }`.
 */
function runPlan(args) {
  const result = spawnSync(PYTHON ?? 'python', [SCRIPT, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    cwd: work,
    // Force UTF-8 so CJK messages survive the pipe on Windows.
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  assert.notEqual(result.status, null, `script did not exit: ${result.error}`)
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/**
 * Write a plan and validate it.
 *
 * @param name - file name.
 * @param plan - plan object.
 * @param extraArgs - additional CLI arguments.
 * @returns `{ status, stdout, stderr, json }`.
 */
function checkPlan(name, plan, extraArgs = []) {
  const path = join(work, name)
  writeFileSync(path, JSON.stringify(plan, null, 2), 'utf8')
  const result = runPlan([path, '--json', ...extraArgs])
  let json
  try {
    json = JSON.parse(result.stdout)
  } catch {
    json = undefined
  }
  return { ...result, json }
}

/**
 * Codes reported for a plan.
 *
 * @param result - a checkPlan result.
 * @returns the finding codes.
 */
function codes(result) {
  return (result.json?.findings ?? []).map((finding) => finding.code)
}

/** A minimal valid page, so each test varies exactly one thing. */
function page(overrides) {
  return {
    id: 'p01',
    archetype: 'number_wall',
    message: '四项指标合计 1,280 万元',
    series: [{ label: 'a', value: 400 }, { label: 'b', value: 300 },
      { label: 'c', value: 300 }, { label: 'd', value: 280 }],
    claims: [{ kind: 'total', expect: 1280, text: '合计 1,280' }],
    conclusion: '合计 1,280 万元',
    accentUses: 1,
    ...overrides,
  }
}

describe('chart skill layout', () => {
  test('ships the artifacts the SKILL.md promises', () => {
    for (const relative of [
      'SKILL.md',
      'scripts/chart_plan.py',
      'references/selection.md',
      'references/archetype-catalog.md',
      'references/data-archetypes.md',
      'references/craft-rules.md',
      'references/style-profiles.md',
      'references/library-build.md',
    ]) {
      assert.ok(existsSync(join(SKILL, relative)), `missing ${relative}`)
    }
  })

  test('every reference linked from SKILL.md exists on disk', () => {
    const raw = readFileSync(join(SKILL, 'SKILL.md'), 'utf8')
    const links = [...raw.matchAll(/\]\(\.\/(references\/[a-z-]+\.md)\)/g)].map((m) => m[1])
    assert.ok(links.length >= 5, 'SKILL.md should link its references')
    for (const link of new Set(links)) {
      assert.ok(existsSync(join(SKILL, link)), `SKILL.md links missing ${link}`)
    }
  })

  test('declares the required frontmatter', () => {
    const raw = readFileSync(join(SKILL, 'SKILL.md'), 'utf8')
    assert.match(raw, /^name: ppt-master-charts$/m)
    assert.match(raw, /^description: >$/m)
    assert.match(raw, /vendor\/ppt-master/, 'it must state the upstream boundary')
  })

  test('does not restate upstream chart keys as its own catalog', () => {
    // Upstream owns the 33 quantitative charts. This skill may point at them but
    // must not re-describe them, or the two catalogs will drift.
    const catalog = readFileSync(join(SKILL, 'references', 'archetype-catalog.md'), 'utf8')
    assert.ok(
      !/^\|\s*`chart\/line_chart`/m.test(catalog),
      'the archetype catalog must not re-list upstream chart references',
    )
    const data = readFileSync(join(SKILL, 'references', 'data-archetypes.md'), 'utf8')
    assert.match(data, /chart\/line_chart/, 'the data reference should bridge to upstream')
    assert.match(data, /one owner|upstream already owns/i, 'the bridge must state the ownership rule')
  })
})

describe('style profiles are style-only', { skip: SKIP }, () => {
  test('both profiles validate against the schema', () => {
    const names = ['blue-gray-business', 'neutral-default']
    for (const name of names) {
      const plan = { schema: 'dsh-ppt-master-plus.chart-plan.v1', profile: name, pages: [page({})] }
      const result = checkPlan(`profile-${name}.json`, plan)
      assert.ok(result.json, `no JSON output for profile ${name}: ${result.stderr}`)
      assert.equal(result.json.profile, name)
      assert.equal(result.json.errors, 0, `profile ${name} produced errors: ${JSON.stringify(result.json.findings)}`)
    }
  })

  test('a profile carrying form decisions is rejected', () => {
    const bad = JSON.parse(readFileSync(join(PROFILES, 'neutral-default.json'), 'utf8'))
    bad.archetypes = ['funnel']
    const path = join(work, 'profile-with-forms.json')
    writeFileSync(path, JSON.stringify(bad), 'utf8')
    const result = runPlan([join(work, 'plan-for-bad-profile.json'), '--profile', path, '--json'])
    // The plan file itself does not exist, so the profile is only loaded once a
    // plan exists. Write one and re-run.
    const planPath = join(work, 'plan-for-bad-profile.json')
    writeFileSync(planPath, JSON.stringify({ schema: 'dsh-ppt-master-plus.chart-plan.v1', pages: [page({})] }), 'utf8')
    const second = runPlan([planPath, '--profile', path, '--json'])
    const json = JSON.parse(second.stdout)
    assert.ok(json.findings.some((f) => f.code === 'profile-carries-forms'), 'a profile must not declare forms')
    void result
  })

  test('an unknown profile exits 2 with the available list', () => {
    const path = join(work, 'plan-unknown-profile.json')
    writeFileSync(path, JSON.stringify({ schema: 'dsh-ppt-master-plus.chart-plan.v1', pages: [page({})] }), 'utf8')
    const result = runPlan([path, '--profile', 'does-not-exist'])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /not found/)
  })
})

describe('chart_plan.py catches planted defects', { skip: SKIP }, () => {
  test('a clean plan passes and exits 0', () => {
    const result = checkPlan('clean.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({})],
    })
    assert.equal(result.json.errors, 0, JSON.stringify(result.json.findings))
    assert.equal(result.json.result, 'ok')
  })

  test('an unknown archetype is an error', () => {
    const result = checkPlan('unknown.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({ archetype: 'waterfall_pyramid' })],
    })
    assert.ok(codes(result).includes('unknown-archetype'))
  })

  test('a funnel over increasing values is an error', () => {
    const result = checkPlan('funnel.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({
        archetype: 'funnel',
        series: [{ label: 'a', value: 100 }, { label: 'b', value: 420 }, { label: 'c', value: 900 }],
        claims: [],
      })],
    })
    assert.ok(codes(result).includes('shape-not-monotonic'), 'a funnel must not increase')
  })

  test('a wrong stated percentage is an error', () => {
    const result = checkPlan('share.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({
        archetype: 'kpi_dashboard',
        // 180/1000 = 18%, so a page claiming 12% is wrong.
        series: [{ label: '成单', value: 180 }, { label: '流失', value: 820 }],
        claims: [{ kind: 'share', of: '成单', total: 1000, expect: 12, text: '转化 12%' }],
      })],
    })
    const finding = (result.json.findings ?? []).find((f) => f.code === 'claim-1')
    assert.ok(finding, 'the arithmetic claim must be checked')
    assert.equal(finding.level, 'error')
    assert.match(finding.message, /18/, `the message should name the real value: ${finding.message}`)
  })

  test('a wrong stated total is an error', () => {
    const result = checkPlan('total.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({ claims: [{ kind: 'total', expect: 9999, text: '合计 9,999' }] })],
    })
    assert.ok(codes(result).includes('claim-1'))
    assert.equal(result.json.errors > 0, true)
  })

  test('a wrong ratio is an error', () => {
    const result = checkPlan('ratio.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({
        archetype: 'arrow_chain',
        series: [{ label: '2024', value: 100 }, { label: '2026', value: 240 }],
        claims: [{ kind: 'ratio', from: '2024', to: '2026', expect: 3.0, text: '增长 3 倍' }],
      })],
    })
    assert.ok(codes(result).includes('claim-1'), '2.4x must not pass as 3x')
  })

  test('a correct claim passes', () => {
    const result = checkPlan('ratio-ok.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({
        archetype: 'arrow_chain',
        series: [{ label: '2024', value: 100 }, { label: '2026', value: 240 }],
        claims: [{ kind: 'ratio', from: '2024', to: '2026', expect: 2.4, text: '增长 2.4 倍' }],
      })],
    })
    assert.equal(result.json.errors, 0, JSON.stringify(result.json.findings))
  })

  test('weights that do not sum are an error', () => {
    const result = checkPlan('weights.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({ archetype: 'scoring_matrix', weights: { cost: 0.4, speed: 0.4 } })],
    })
    assert.ok(codes(result).includes('weights-do-not-sum'))
  })

  test('a quadrant without named axes is an error', () => {
    const result = checkPlan('quadrant.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({ archetype: 'quadrant_2x2' })],
    })
    assert.ok(codes(result).includes('shape-needs-axes'))
  })

  test('a loop without a return edge is an error', () => {
    const result = checkPlan('loop.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({ archetype: 'closed_loop', hasReturnEdge: false })],
    })
    assert.ok(codes(result).includes('shape-loop-without-return'))
  })

  test('shares that do not total 100 are an error', () => {
    const result = checkPlan('shares.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({
        archetype: 'likert',
        valuesAreShares: true,
        series: [{ label: 'x', value: 40 }, { label: 'y', value: 35 }, { label: 'z', value: 10 }],
        claims: [],
      })],
    })
    assert.ok(codes(result).includes('shares-do-not-total'))
  })

  test('accent overuse is an error', () => {
    const result = checkPlan('accent.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({ accentUses: 5 })],
    })
    assert.ok(codes(result).includes('accent-overuse'))
  })

  test('an unlabelled series item is an error', () => {
    const result = checkPlan('unlabelled.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({ series: [{ label: 'a', value: 1 }, { value: 2 }] })],
    })
    assert.ok(codes(result).includes('unlabelled-series'))
  })

  test('a pyramid without tiers is an error', () => {
    const result = checkPlan('pyramid.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({ archetype: 'pyramid', tiers: ['only one'] })],
    })
    assert.ok(codes(result).includes('shape-needs-tiers'))
  })

  test('a Venn with no intersection is an error', () => {
    const result = checkPlan('venn.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({ archetype: 'venn' })],
    })
    assert.ok(codes(result).includes('shape-venn-empty'))
  })

  test('duplicate page ids are an error', () => {
    const result = checkPlan('dup.json', {
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({}), page({})],
    })
    assert.ok(codes(result).includes('duplicate-id'))
  })

  test('the gate exits 1 on errors and 0 on a clean plan', () => {
    const badPath = join(work, 'gate-bad.json')
    writeFileSync(badPath, JSON.stringify({
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({ archetype: 'not_a_form' })],
    }), 'utf8')
    assert.equal(runPlan([badPath, '--fail-on-issue']).status, 1)

    const goodPath = join(work, 'gate-good.json')
    writeFileSync(goodPath, JSON.stringify({
      schema: 'dsh-ppt-master-plus.chart-plan.v1',
      pages: [page({})],
    }), 'utf8')
    assert.equal(runPlan([goodPath, '--fail-on-issue']).status, 0)
  })
})

describe('chart_plan.py CLI', { skip: SKIP }, () => {
  test('--init writes a skeleton that validates cleanly', () => {
    const path = join(work, 'skeleton', 'plan.json')
    const init = runPlan(['--init', path])
    assert.equal(init.status, 0, init.stderr)
    assert.ok(existsSync(path))

    const validated = runPlan([path])
    assert.equal(validated.status, 0, validated.stderr)
    assert.match(validated.stdout, /RESULT: ok/)
  })

  test('refuses to overwrite an existing plan', () => {
    const path = join(work, 'exists.json')
    writeFileSync(path, '{}', 'utf8')
    assert.equal(runPlan(['--init', path]).status, 2)
  })

  test('exits 2 on a missing plan', () => {
    assert.equal(runPlan([join(work, 'nope.json')]).status, 2)
  })

  test('exits 2 on malformed JSON', () => {
    const path = join(work, 'broken.json')
    writeFileSync(path, '{ not json', 'utf8')
    assert.equal(runPlan([path]).status, 2)
  })
})
