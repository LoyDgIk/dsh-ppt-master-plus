/**
 * End-to-end tests for the SCI skill's scripts.
 *
 * `mineru_ingest.py --from-zip` is exercised for real: a synthetic MinerU
 * bundle is zipped, ingested, and then asserted on. This is the offline half of
 * the ingestion path, which is also the half that matters most — it runs
 * without a token, without the network, and without MinerU.
 *
 * The suite skips itself when no Python 3 interpreter is on PATH.
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
const SCRIPTS = join(PACKAGE_DIR, 'skills', 'ppt-master-sci', 'scripts')

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

/** One byte-valid 1x1 PNG. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000a49444154789c6300010000050001' +
    '0d0a2db40000000049454e44ae426082',
  'hex',
)

const PAPER = `# Attention Is All You Need

The scaled dot-product attention is

$$\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}\\left(\\frac{QK^{T}}{\\sqrt{d_k}}\\right)V$$

where $d_k$ is the key dimension and $O(n^2 d)$ complexity applies.

A matrix form:

$$\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}$$

![Figure 1](images/fig1.png)

Inline price mention: it costs $5 and $7 today.

\`\`\`python
# not math: sqrt(2) inside a code fence
\`\`\`
`

let work

before(() => {
  work = mkdtempSync(join(tmpdir(), 'dsh-ppt-sci-test-'))
  const bundle = join(work, 'bundle')
  mkdirSync(join(bundle, 'images'), { recursive: true })
  writeFileSync(join(bundle, 'paper.md'), PAPER, 'utf8')
  writeFileSync(join(bundle, 'images', 'fig1.png'), PNG)

  // Zip via Python's stdlib so the test needs no archiver on PATH.
  const zipped = spawnSync(
    PYTHON ?? 'python',
    ['-c', 'import shutil,sys; shutil.make_archive(sys.argv[1], "zip", sys.argv[2])',
      join(work, 'result'), bundle],
    { encoding: 'utf8', windowsHide: true, cwd: work },
  )
  assert.equal(zipped.status, 0, `zip fixture failed: ${zipped.stderr}`)
})

after(() => {
  if (work !== undefined) rmSync(work, { recursive: true, force: true })
})

/**
 * Run one of the skill's scripts.
 *
 * @param script - file name under `scripts/`.
 * @param args - arguments.
 * @returns `{ status, stdout, stderr }`.
 */
function runScript(script, args) {
  const result = spawnSync(PYTHON ?? 'python', [join(SCRIPTS, script), ...args], {
    encoding: 'utf8',
    windowsHide: true,
    cwd: work,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

describe('mineru_ingest.py', { skip: SKIP }, () => {
  test('ingests a MinerU archive into <stem>.md plus <stem>_files/', () => {
    const out = join(work, 'sources', 'paper.md')
    const result = runScript('mineru_ingest.py', [join(work, 'result.zip'), '--from-zip', '-o', out])

    assert.equal(result.status, 0, result.stderr)
    assert.ok(existsSync(out), 'markdown must be written')
    assert.ok(existsSync(join(work, 'sources', 'paper_files', 'fig1.png')), 'figure must be copied')
    assert.ok(
      existsSync(join(work, 'sources', 'paper_files', 'image_manifest.json')),
      'image manifest must be written',
    )

    // Upstream's own line protocol, so a caller can parse either tool alike.
    assert.match(result.stdout, /^OUTPUT: .+paper\.md$/m)

    const markdown = readFileSync(out, 'utf8')
    assert.match(markdown, /!\[Figure 1\]\(\.\.\/paper_files\/fig1\.png\)/, 'image links must be rebased')
    assert.match(markdown, /\\frac\{QK\^\{T\}\}/, 'LaTeX must survive ingestion untouched')
  })

  test('--json emits a single parseable object', () => {
    const out = join(work, 'sources2', 'paper.md')
    const result = runScript('mineru_ingest.py', [
      join(work, 'result.zip'), '--from-zip', '-o', out, '--json',
    ])
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.ok, true)
    assert.equal(payload.imageCount, 1)
  })

  test('exits 2 on a non-zip input with --from-zip', () => {
    const bogus = join(work, 'not-a-zip.txt')
    writeFileSync(bogus, 'plain text', 'utf8')
    const result = runScript('mineru_ingest.py', [bogus, '--from-zip', '-o', join(work, 'x.md')])
    assert.equal(result.status, 2)
  })

  test('exits 2 when the input does not exist', () => {
    const result = runScript('mineru_ingest.py', [join(work, 'missing.pdf'), '-o', join(work, 'x.md')])
    assert.equal(result.status, 2)
  })
})

describe('formula_manifest.py', { skip: SKIP }, () => {
  let manifestPath
  let manifest

  before(() => {
    manifestPath = join(work, 'images', 'formula_manifest.json')
    const result = runScript('formula_manifest.py', [
      join(work, 'sources', 'paper.md'), '-o', manifestPath,
    ])
    assert.equal(result.status, 0, result.stderr)
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  })

  test('finds only real math', () => {
    const latex = manifest.formulas.map((entry) => entry.latex)
    assert.ok(latex.some((value) => value.includes('softmax')), 'display math must be found')
    assert.ok(latex.includes('d_k'), 'inline math must be found')
    assert.ok(
      !latex.some((value) => value.includes('sqrt(2)')),
      'a fenced code block must not yield formulas',
    )
    assert.equal(manifest.counts.total, 4)
  })

  test('does not mistake prose dollar amounts for math', () => {
    const joined = JSON.stringify(manifest)
    assert.ok(!joined.includes('"5 and "'), 'price prose must not be extracted as a formula')
  })

  test('accepts matrix environments as supported', () => {
    const matrix = manifest.formulas.find((entry) => entry.latex.includes('bmatrix'))
    assert.ok(matrix, 'the bmatrix formula must be present')
    assert.deepEqual(matrix.unsupported, [], 'the matrix family is inside the accepted profile')
    assert.deepEqual(matrix.unsupportedEnvironments, [])
    assert.deepEqual(matrix.blockEnvironments, ['bmatrix'])
    assert.equal(matrix.suggestedMarker, 'block', 'a matrix must be routed to a block marker')
  })

  test('classifies display math with structural notation as a block', () => {
    const attention = manifest.formulas.find((entry) => entry.latex.includes('softmax'))
    assert.equal(attention.suggestedMarker, 'block')
    assert.ok(attention.structural.includes('\\frac'))
  })

  test('flags the code-fence test value as unsupported when it is genuine TeX', () => {
    const bad = join(work, 'bad.md')
    writeFileSync(bad, 'Bad: $$\\begin{document} x \\end{document}$$\n', 'utf8')
    const result = runScript('formula_manifest.py', [
      bad, '-o', join(work, 'bad.json'), '--fail-on-unsupported',
    ])
    assert.equal(result.status, 3, 'a CI gate must trip on document scaffolding')
    const flagged = JSON.parse(readFileSync(join(work, 'bad.json'), 'utf8'))
    assert.ok(flagged.formulas[0].unsupported.includes('documentclass') === false)
    assert.deepEqual(flagged.formulas[0].unsupportedEnvironments, ['document'])
  })

  test('ids are stable across re-runs', () => {
    const again = runScript('formula_manifest.py', [
      join(work, 'sources', 'paper.md'), '-o', join(work, 'again.json'), '--json',
    ])
    assert.equal(again.status, 0)
    const second = JSON.parse(readFileSync(join(work, 'again.json'), 'utf8'))
    assert.deepEqual(
      second.formulas.map((entry) => entry.id),
      manifest.formulas.map((entry) => entry.id),
    )
  })
})

describe('latex_preview.py', { skip: SKIP }, () => {
  test('--check reports the toolchain, or exits 2 with guidance when TeX is absent', () => {
    const result = runScript('latex_preview.py', ['--check'])
    assert.ok([0, 2].includes(result.status), `unexpected exit ${result.status}: ${result.stderr}`)
    if (result.status === 2) {
      assert.match(result.stderr, /no TeX compiler found/)
      assert.match(result.stderr, /native marker/, 'it must point at the supported path')
    }
  })

  test('exits 2 without an argument', () => {
    const result = runScript('latex_preview.py', [])
    assert.equal(result.status, 2)
  })
})
