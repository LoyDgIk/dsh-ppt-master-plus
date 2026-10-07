/**
 * Plugin-level tests for dsh-ppt-master-plus.
 *
 * The load-bearing assertion in this file is that the upstream skill is
 * projected **byte-for-byte** as it appears on disk. That is the mechanism
 * behind the "we never modify upstream" claim: if a runtime preamble, a path
 * fixup, or any other rewrite ever leaks into the upstream projection, a
 * `git submodule update --remote` stops being a clean fast-forward and this
 * test fails first.
 *
 * Tests that need the submodule skip themselves when it is absent, so the
 * suite still runs on a fresh clone before `npm run upstream:init`.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  PROVIDER_NAME,
  PACKAGE_DIR,
  UPSTREAM_ENV,
  apply,
  parseFrontmatterYaml,
  parseSkillMarkdown,
  resolveUpstreamDir,
  runtimePreamble,
  skillRoots,
  splitFrontmatter,
} from '../index.js'

const UPSTREAM_DIR = resolveUpstreamDir()
const UPSTREAM_SKILL = join(UPSTREAM_DIR, 'skills', 'ppt-master', 'SKILL.md')
const HAS_UPSTREAM = existsSync(UPSTREAM_SKILL)

/**
 * Run `apply` against a stub context and return the registered provider.
 *
 * @returns the provider object the plugin registered.
 */
function captureProvider() {
  let provider
  const ctx = {
    skills: {
      registerProvider(factory) {
        provider = factory()
      },
    },
  }
  apply(ctx)
  assert.ok(provider, 'apply() must register a skills provider')
  return provider
}

/**
 * Load one skill definition by name.
 *
 * @param provider - the captured provider.
 * @param name - skill name.
 * @returns the definition, or undefined.
 */
async function getSkill(provider, name) {
  return provider.get({ name })
}

describe('provider registration', () => {
  test('registers exactly one provider under the documented name', () => {
    let calls = 0
    const ctx = {
      skills: {
        registerProvider(factory) {
          calls += 1
          assert.equal(factory().name, PROVIDER_NAME)
        },
      },
    }
    apply(ctx)
    assert.equal(calls, 1)
  })

  test('never throws when a root is missing', async () => {
    // A fresh install has no upstream checkout yet; listing must still work
    // and must still expose the bundled skills.
    const provider = captureProvider()
    const listed = await provider.list({})
    assert.ok(Array.isArray(listed))
    assert.ok(listed.some((entry) => entry.name === 'ppt-master-sci'))
  })

  test('list and get agree on the projected skill set', async () => {
    const provider = captureProvider()
    const listed = await provider.list({})
    for (const candidate of listed) {
      const definition = await getSkill(provider, candidate.name)
      assert.ok(definition, `${candidate.name} must be resolvable via get()`)
      assert.equal(definition.name, candidate.name)
    }
  })

  test('get() returns undefined for an unknown skill', async () => {
    const provider = captureProvider()
    assert.equal(await getSkill(provider, 'definitely-not-a-skill'), undefined)
  })

  test('honours an aborted signal', async () => {
    const provider = captureProvider()
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(() => provider.list({ signal: controller.signal }))
  })
})

describe('upstream projection', { skip: !HAS_UPSTREAM ? 'upstream submodule not initialised' : false }, () => {
  test('projects the upstream skill verbatim, with no injected preamble', async () => {
    const provider = captureProvider()
    const definition = await getSkill(provider, 'ppt-master')
    assert.ok(definition, 'the upstream skill must be registered')

    const onDisk = readFileSync(UPSTREAM_SKILL, 'utf8')
    const { body } = splitFrontmatter(onDisk)

    assert.equal(
      definition.content,
      body.trim(),
      'upstream content must be byte-identical to the file on disk',
    )
    assert.ok(
      !definition.content.includes('Runtime paths (injected by'),
      'the runtime preamble must never be injected into upstream',
    )
    assert.equal(definition.source, 'upstream')
    assert.equal(definition.provider, PROVIDER_NAME)
    assert.equal(definition.resourceBase.path, join(UPSTREAM_DIR, 'skills', 'ppt-master'))
  })

  test('projects the bundled skill with the runtime preamble', async () => {
    const provider = captureProvider()
    const definition = await getSkill(provider, 'ppt-master-sci')
    assert.ok(definition)
    assert.equal(definition.source, 'bundled')
    assert.ok(
      definition.content.startsWith('## Runtime paths (injected by the dsh-ppt-master-plus plugin)'),
      'bundled skills must carry the path bridge',
    )
    assert.ok(definition.content.includes(UPSTREAM_DIR), 'the bridge must publish the upstream root')
  })

  test('ranks bundled above upstream so a local skill can shadow without editing either tree', () => {
    const roots = skillRoots('/tmp/does-not-need-to-exist')
    const bundled = roots.find((root) => root.source === 'bundled')
    const upstream = roots.find((root) => root.source === 'upstream')
    assert.ok(bundled.rank > upstream.rank)
    assert.equal(bundled.preamble, true)
    assert.equal(upstream.preamble, false)
  })

  test('the upstream SKILL.md parses with its own name and description', async () => {
    const provider = captureProvider()
    const definition = await getSkill(provider, 'ppt-master')
    assert.equal(definition.name, 'ppt-master')
    assert.ok(definition.description.length > 40, 'the folded description must survive parsing')
    assert.match(definition.description, /presentation|PPTX/i)
  })
})

describe('frontmatter parsing', () => {
  test('splits a block and tolerates CRLF', () => {
    const parsed = splitFrontmatter('---\r\nname: x\r\n---\r\nbody\r\n')
    assert.equal(parsed.yaml, 'name: x')
    assert.equal(parsed.body.trim(), 'body')
  })

  test('returns undefined without a frontmatter block', () => {
    assert.equal(splitFrontmatter('# no frontmatter\n'), undefined)
  })

  test('parses a folded block scalar into one line', () => {
    const data = parseFrontmatterYaml('description: >\n  one\n  two\n')
    assert.equal(data.description, 'one two')
  })

  test('parses a literal block scalar keeping newlines', () => {
    const data = parseFrontmatterYaml('description: |\n  one\n  two\n')
    assert.equal(data.description, 'one\ntwo')
  })

  test('parses nested mappings and arrays', () => {
    const data = parseFrontmatterYaml('metadata:\n  version: "1.2"\n  tags:\n    - a\n    - b\n')
    assert.equal(data.metadata.version, '1.2')
    assert.deepEqual(data.metadata.tags, ['a', 'b'])
  })

  test('coerces booleans and numbers but keeps quoted strings quoted', () => {
    const data = parseFrontmatterYaml('a: true\nb: false\nc: 42\nd: "42"\ne: hello\n')
    assert.equal(data.a, true)
    assert.equal(data.b, false)
    assert.equal(data.c, 42)
    assert.equal(data.d, '42')
    assert.equal(data.e, 'hello')
  })

  test('ignores comments and blank lines', () => {
    const data = parseFrontmatterYaml('# lead\na: 1\n\n# mid\nb: 2\n')
    assert.deepEqual(data, { a: 1, b: 2 })
  })

  test('honours invocation flags', () => {
    const parsed = parseSkillMarkdown('---\nname: ok\ndescription: d\ndisable-model-invocation: true\n---\nbody\n')
    assert.equal(parsed.invocation.modelInvocable, false)
    assert.equal(parsed.invocation.userInvocable, true)
  })

  test('rejects a missing description', () => {
    assert.throws(
      () => parseSkillMarkdown('---\nname: ok\n---\nbody\n'),
      /requires name and description/,
    )
  })

  test('rejects a non-kebab-case name', () => {
    assert.throws(
      () => parseSkillMarkdown('---\nname: Not_Cool\ndescription: d\n---\nbody\n'),
      /invalid skill name/,
    )
  })

  test('rejects an empty body', () => {
    assert.throws(
      () => parseSkillMarkdown('---\nname: ok\ndescription: d\n---\n\n'),
      /empty body/,
    )
  })
})

describe('layout resolution', () => {
  test('defaults to <package>/vendor/ppt-master', () => {
    assert.equal(resolveUpstreamDir({}), join(PACKAGE_DIR, 'vendor', 'ppt-master'))
  })

  test('honours the environment override and ignores a blank one', () => {
    assert.equal(resolveUpstreamDir({ [UPSTREAM_ENV]: '  /custom/upstream  ' }), '/custom/upstream')
    assert.equal(resolveUpstreamDir({ [UPSTREAM_ENV]: '   ' }), join(PACKAGE_DIR, 'vendor', 'ppt-master'))
  })

  test('the preamble names the upstream scripts and references directories', () => {
    const upstreamDir = join('/u', 'ppt-master')
    const upstreamSkillDir = join(upstreamDir, 'skills', 'ppt-master')
    const preamble = runtimePreamble({ upstreamDir, upstreamSkillDir, packageDir: join('/p') })
    // Paths are emitted with native separators, so build expectations the same way.
    assert.ok(preamble.includes(join(upstreamSkillDir, 'scripts')))
    assert.ok(preamble.includes(join(upstreamSkillDir, 'references')))
    assert.ok(preamble.includes(upstreamDir))
    assert.match(preamble, /never write into the upstream checkout/i)
  })
})
