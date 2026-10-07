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
  MINERU_CREDENTIAL_REF,
  MINERU_SHELL_VAR,
  ORIGIN_METADATA_KEY,
  PROMPT_SECTION,
  PROVIDER_NAME,
  PACKAGE_DIR,
  SHELL_ENV_CONTRIBUTOR,
  SKILLS_DIR,
  UPSTREAM_ENV,
  apply,
  parseFrontmatterYaml,
  parseSkillMarkdown,
  registerDeckProjectsPrompt,
  registerMineruShellEnv,
  resolveSkillOrigin,
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
    assert.equal(
      definition.source,
      'bundled',
      'source must be a value DSH recognises, or the skill vanishes from every consumer',
    )
    assert.equal(definition.metadata[ORIGIN_METADATA_KEY], 'upstream')
    assert.equal(definition.provider, PROVIDER_NAME)
    // Discovered in skills/, like every other skill; the link is what points it
    // at the submodule, so relative paths in its own SKILL.md still resolve.
    assert.equal(definition.resourceBase.path, join(SKILLS_DIR, 'ppt-master'))
  })

  test('projects the bundled skill with the runtime preamble', async () => {
    const provider = captureProvider()
    const definition = await getSkill(provider, 'ppt-master-sci')
    assert.ok(definition)
    assert.equal(definition.source, 'bundled')
    assert.equal(definition.metadata[ORIGIN_METADATA_KEY], 'plugin')
    assert.ok(
      definition.content.startsWith('## Runtime paths (injected by the dsh-ppt-master-plus plugin)'),
      'bundled skills must carry the path bridge',
    )
    assert.ok(definition.content.includes(UPSTREAM_DIR), 'the bridge must publish the upstream root')
  })

  test('scans exactly one skills root', () => {
    // A second, privileged root is what made the upstream skill unfindable: it
    // carried a different `source`, and DSH drops an unrecognised source from
    // its snapshot without an error, so the skill existed everywhere in this
    // plugin's head and nowhere in any consumer.
    const roots = skillRoots()
    assert.equal(roots.length, 1, 'one skills directory, no special cases')
    assert.equal(roots[0].dir, SKILLS_DIR)
  })

  test('every skill is projected with a source DSH recognises', async () => {
    const recognised = new Set(['bundled', 'project', 'user', 'custom', 'runtime'])
    const provider = captureProvider()
    for (const candidate of await provider.list({})) {
      const definition = await getSkill(provider, candidate.name)
      assert.ok(
        recognised.has(definition.source),
        `${definition.name} reports source "${definition.source}", which no consumer groups on`,
      )
    }
  })

  test('classifies a skill by where its files really live', async () => {
    // The link is what carries the fact, so nothing has to be configured twice.
    const upstream = await resolveSkillOrigin(join(SKILLS_DIR, 'ppt-master'))
    const ours = await resolveSkillOrigin(join(SKILLS_DIR, 'ppt-master-sci'))

    assert.equal(upstream.origin, 'upstream')
    assert.equal(upstream.preamble, false, 'upstream must stay byte-identical')
    assert.equal(ours.origin, 'plugin')
    assert.equal(ours.preamble, true, 'our skills need the path bridge')
    assert.ok(ours.rank > upstream.rank, 'a local skill may shadow an upstream one')
  })

  test('treats an unresolvable directory as ours, never as upstream', async () => {
    // Excusing a broken directory from the byte-identical guarantee would be
    // the wrong way round: it would hide a problem rather than surface it.
    const missing = await resolveSkillOrigin(join(SKILLS_DIR, 'does-not-exist'))
    assert.equal(missing.origin, 'plugin')
    assert.equal(missing.preamble, true)
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

describe('MinerU credential bridge', () => {
  /**
   * Build a stub context exposing the two optional services.
   *
   * @param options - `token` seeds `credentials.resolve`, `omit` drops a service.
   * @returns `{ ctx, contributor, emitted, resolveCalls }`.
   */
  function harness(options = {}) {
    const state = { token: options.token, resolveCalls: 0 }
    const emitted = new Map()

    const credentials = {
      async resolve(ref) {
        state.resolveCalls += 1
        assert.equal(ref, MINERU_CREDENTIAL_REF, 'only the MinerU reference is consulted')
        if (state.token === undefined || state.token === '') return undefined
        return { value: state.token, source: 'provider-managed' }
      },
    }

    let contributor
    const shellEnv = {
      register(definition) {
        contributor = definition
        return () => {}
      },
    }

    const services = { shellEnv, credentials, skills: { registerProvider() {} } }
    if (options.omit !== undefined) delete services[options.omit]

    const ctx = {
      get: (name) => services[name],
      on: (event, listener) => {
        emitted.set(event, listener)
        return () => {}
      },
      skills: services.skills,
    }

    registerMineruShellEnv(ctx)
    return { ctx, contributor, emitted, state, getContributor: () => contributor }
  }

  test('publishes exactly the documented variable', () => {
    const { contributor } = harness({ token: 'k' })
    assert.ok(contributor, 'a contributor must be registered')
    assert.equal(contributor.name, SHELL_ENV_CONTRIBUTOR)
    assert.deepEqual(Object.keys(contributor.variables), [MINERU_SHELL_VAR])
    assert.match(contributor.variables[MINERU_SHELL_VAR].description, /MinerU API token/)
  })

  test('variables are DSH_-prefixed, as the namespace requires', () => {
    // shellEnv accepts only `${DSH_}${string}` keys; a name without the prefix
    // would be rejected by the registry and silently publish nothing.
    assert.match(MINERU_SHELL_VAR, /^DSH_/)
    assert.equal(MINERU_CREDENTIAL_REF, 'MINERU_API_TOKEN')
  })

  test('publishes nothing while no token is stored', async () => {
    const { contributor } = harness({})
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(contributor.resolve({}), {})
  })

  test('publishes the resolved token once it is stored', async () => {
    const { contributor } = harness({ token: 'mineru-secret' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(contributor.resolve({}), { [MINERU_SHELL_VAR]: 'mineru-secret' })
  })

  test('a changed credential reaches the next shell call', async () => {
    const { contributor, emitted, state } = harness({ token: 'first' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(contributor.resolve({})[MINERU_SHELL_VAR], 'first')

    // The settings page writes through the RPC, which commits and emits.
    state.token = 'second'
    const listener = emitted.get('credentials/reference-updated')
    assert.ok(listener, 'the plugin must listen for credential changes')
    listener(MINERU_CREDENTIAL_REF)
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(
      contributor.resolve({})[MINERU_SHELL_VAR],
      'second',
      'a saved key must take effect without a restart',
    )
  })

  test('ignores updates to other credential references', async () => {
    const { contributor, emitted, state } = harness({ token: 'first' })
    await new Promise((resolve) => setImmediate(resolve))
    state.resolveCalls = 0

    emitted.get('credentials/reference-updated')('SOME_OTHER_KEY')
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(state.resolveCalls, 0, 'an unrelated reference must not trigger work')
    assert.equal(contributor.resolve({})[MINERU_SHELL_VAR], 'first')
  })

  test('a disappearing token stops being published', async () => {
    const { contributor, emitted, state } = harness({ token: 'gone-soon' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.ok(contributor.resolve({})[MINERU_SHELL_VAR])

    state.token = ''
    emitted.get('credentials/reference-updated')(MINERU_CREDENTIAL_REF)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(contributor.resolve({}), {}, 'clearing the key must stop publishing it')
  })

  test('degrades with a warning when a service is missing', () => {
    // Neither optional dependency may take the plugin down: the skills still
    // work, only the bridge is absent.
    for (const missing of ['shellEnv', 'credentials']) {
      const warns = []
      const original = console.warn
      console.warn = (message) => warns.push(String(message))
      try {
        assert.doesNotThrow(() => harness({ token: 'k', omit: missing }))
      } finally {
        console.warn = original
      }
      assert.ok(
        warns.some((line) => line.includes(missing)),
        `a missing ${missing} service must be reported, not swallowed`,
      )
    }
  })

  test('apply() wires the bridge alongside the skills provider', () => {
    // The bridge is part of apply(), so a profile that never calls it would
    // silently lose the settings-page feature.
    const registered = []
    const ctx = {
      get: (name) => (name === 'shellEnv' || name === 'credentials'
        ? { register: (d) => { registered.push(d); return () => {} }, resolve: async () => undefined }
        : undefined),
      on: () => () => {},
      skills: { registerProvider: () => {} },
    }
    apply(ctx)
    assert.equal(registered.length, 1, 'apply() must register the shellEnv contributor')
    assert.deepEqual(Object.keys(registered[0].variables), [MINERU_SHELL_VAR])
  })
})

describe('settings page client half', () => {
  const CLIENT = join(PACKAGE_DIR, 'dsh', 'client.js')

  test('is declared in the manifest and shipped', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'))
    assert.equal(manifest.exports['./client'], './dsh/client.js')
    assert.ok(manifest.files.includes('dsh'), 'the client half must be published')
    assert.equal(manifest.dsh.client.platform, 'web')
    // `immediately` is unnecessary here: the plugin-manager page imports the
    // bundle, so the lazy module table loads it. flashmade needs the flag
    // because nothing imports its id.
    assert.ok(existsSync(CLIENT), 'dsh/client.js must exist')
  })

  test('reads and writes the same reference the host half resolves', () => {
    const source = readFileSync(CLIENT, 'utf8')
    assert.ok(source.includes(`'${MINERU_CREDENTIAL_REF}'`), 'client must use the shared reference')
    assert.ok(source.includes(MINERU_SHELL_VAR), 'client must document the shell variable')
    assert.match(source, /credentials\.set\(/, 'client must persist through the credential service')
    assert.match(source, /credentials\.unset\(/, 'client must be able to clear the key')
    assert.match(source, /credentials\.describe\(/, 'client must report configured state')
  })

  test('registers into the plugin config slot under the package name', () => {
    const source = readFileSync(CLIENT, 'utf8')
    assert.match(source, /window\.__ModuleLoader__\.load\(/)
    assert.match(source, /ctx\.slots\.inject\('plugins\.bundle\.config'/)
    assert.match(source, /key: 'dsh-ppt-master-plus'/)
  })

  test('never writes the token to disk and never echoes it back', () => {
    const source = readFileSync(CLIENT, 'utf8')
    // A settings page that mirrors a secret into the DOM is a leak; the value
    // is only ever sent host-ward, never read back out.
    assert.ok(!/localStorage/.test(source), 'a secret must not be persisted in the browser')
    assert.ok(!/writeFile|fs\.write/.test(source), 'the client half has no filesystem access')
  })

  test('the skill reads the plugin-published variable first', () => {
    const script = readFileSync(
      join(PACKAGE_DIR, 'skills', 'ppt-master-sci', 'scripts', 'mineru_ingest.py'),
      'utf8',
    )
    const order = script.match(/TOKEN_ENV_KEYS = \(([^)]*)\)/)
    assert.ok(order, 'TOKEN_ENV_KEYS must be declared')
    const names = order[1].split(',').map((part) => part.trim().replace(/^"|"$/g, '')).filter(Boolean)
    assert.equal(names[0], MINERU_SHELL_VAR, 'the plugin-published name must be consulted first')
    assert.ok(names.includes('MINERU_API_TOKEN'), 'the manual name must still work')
  })

  /**
   * Execute the client bundle against a stub module loader.
   *
   * The client half is delivered in DSH's lazy-CJS protocol, so the only way to
   * exercise its registration path without a browser is to provide the globals
   * it expects and capture what it does. This is deliberately not a render
   * test: what matters here is that the page registers under the right slot and
   * key, because getting that wrong fails silently — the page simply never
   * appears, with no error anywhere.
   *
   * @returns `{ exports, ctx, registered, injected }`.
   */
  function loadClient() {
    const source = readFileSync(CLIENT, 'utf8')
    const registered = []
    const injected = []
    let captured

    const sandbox = {
      window: {
        __ModuleLoader__: {
          load(definition) {
            captured = definition
          },
        },
      },
    }

    // A React stub sufficient for module initialisation: nothing renders here,
    // so only the call surface has to exist.
    const react = {
      createElement: (...args) => ({ type: 'stub', args }),
      useState: (initial) => [initial, () => {}],
      useEffect: () => {},
      useCallback: (fn) => fn,
    }

    const require = (name) => {
      if (name === 'react') return react
      throw new Error(`client half must not require ${name}`)
    }

    const previousWindow = globalThis.window
    globalThis.window = sandbox.window
    try {
      // eslint-disable-next-line no-new-func
      new Function('window', source)(sandbox.window)
    } finally {
      globalThis.window = previousWindow
    }

    assert.ok(captured, 'the bundle must call window.__ModuleLoader__.load')
    assert.equal(captured.id, 'dsh-ppt-master-plus')

    const clientExports = captured.factory(require)

    const ctx = {
      get: (name) => (name === 'connection' ? { rpc: {} } : undefined),
      effect: (fn) => fn(),
      locale: { register: () => () => {} },
      remote: { credentials: { describe: async () => ({ ok: true, value: {} }) } },
      slots: {
        inject: (key, callback) => {
          injected.push(key)
          return callback()
        },
        register: (options, component) => {
          registered.push({ options, component })
          return () => {}
        },
      },
    }

    return { exports: clientExports, ctx, registered, injected }
  }

  test('registers under the plugin config slot with the package name as key', () => {
    const { exports: clientExports, ctx, registered, injected } = loadClient()

    assert.deepEqual(clientExports.inject, [
      'slots',
      'locale',
      'connection',
      'remote',
      'remote.credentials',
    ])
    clientExports.apply(ctx)

    assert.deepEqual(injected, ['plugins.bundle.config'])
    assert.equal(registered.length, 1)
    assert.equal(registered[0].options.name, 'plugins.bundle.config')
    assert.equal(
      registered[0].options.key,
      'dsh-ppt-master-plus',
      'the key must be the bundle package name or the page renders nowhere',
    )
    assert.equal(registered[0].options.locale, 'dsh-ppt-master-plus')
    assert.equal(typeof registered[0].component, 'function')
    assert.equal(typeof registered[0].options.inject, 'function')
    assert.ok(registered[0].options.inject().credentials, 'the page needs the credential client')
  })

  test('refuses to mount a page it cannot save from', () => {
    // Without a connection there is no credential RPC. Mounting anyway would
    // render a form whose Save button cannot work, which is worse than an
    // absent page: it looks like the plugin is broken.
    const { exports: clientExports, ctx, registered } = loadClient()
    const broken = { ...ctx, get: () => undefined }
    const errors = []
    const original = console.error
    console.error = (message) => errors.push(String(message))
    try {
      clientExports.apply(broken)
    } finally {
      console.error = original
    }
    assert.equal(registered.length, 0, 'no page may be mounted without credential access')
    assert.ok(errors.some((line) => line.includes('connection')), 'and it must say why')
  })
})

describe('deck project guardrail', () => {
  /**
   * Capture the prompt section the plugin registers.
   *
   * @returns `{ sections, register }`.
   */
  function captureSection() {
    const sections = []
    registerDeckProjectsPrompt(
      { get: (name) => (name === 'systemPrompt' ? { section: (s) => { sections.push(s); return () => {} } } : undefined) },
      UPSTREAM_DIR,
    )
    return sections
  }

  test('tells every model step not to create decks in the checkout', () => {
    // This is the case a skill note cannot reach: upstream's skill is registered
    // verbatim, so the runtime preamble never arrives on a run that loads
    // `ppt-master` alone — which is exactly the run that writes into the
    // checkout. A prompt section is the only place that covers it.
    const sections = captureSection()
    assert.equal(sections.length, 1)

    const section = sections[0]
    assert.equal(section.name, PROMPT_SECTION)
    assert.ok(Number.isFinite(section.order), 'DSH rejects a non-finite section order')
    assert.match(section.text, /Never create a deck inside the ppt-master reference checkout/)
    assert.match(
      section.text,
      /--dir/,
      'the rule is useless without the flag that makes it satisfiable',
    )
  })

  test('names the real initializer path and the gitignore trap', () => {
    const [section] = captureSection()
    assert.ok(
      section.text.includes(join(UPSTREAM_DIR, 'skills', 'ppt-master', 'scripts', 'project_manager.py')),
      'the command must be runnable as printed',
    )
    assert.match(section.text, /gitignored/, 'say why the mistake is invisible')
    assert.match(section.text, /git status/)
  })

  test('stays short enough to belong in a system prompt', () => {
    const [section] = captureSection()
    assert.ok(section.text.split('\n').length <= 16, 'a prompt section is not free space')
  })

  test('is optional — a profile without the service still loads', () => {
    assert.doesNotThrow(() => registerDeckProjectsPrompt({ get: () => undefined }, UPSTREAM_DIR))
    assert.doesNotThrow(() => registerDeckProjectsPrompt({}, UPSTREAM_DIR))
  })

  test('a misbehaving service cannot stop the plugin loading', () => {
    const errors = []
    const original = console.error
    console.error = (message) => errors.push(String(message))
    try {
      assert.doesNotThrow(() =>
        registerDeckProjectsPrompt(
          { get: () => ({ section: () => { throw new Error('boom') } }) },
          UPSTREAM_DIR,
        ),
      )
    } finally {
      console.error = original
    }
    assert.ok(errors.some((line) => line.includes('boom')))
  })
})
