/**
 * dsh-ppt-master-plus — DSH bundle entry.
 *
 * Registers ONE skills provider that projects two disjoint roots onto
 * `ctx.skills`:
 *
 *   upstream  `vendor/ppt-master/skills/<name>/SKILL.md`
 *             The hugohe3/ppt-master git submodule. Content is registered
 *             byte-for-byte as it appears on disk. This plugin never writes
 *             into that tree, so `git submodule update --remote` stays a
 *             fast-forward with no local conflicts.
 *
 *   bundled   `skills/<name>/SKILL.md`
 *             This plugin's own skills. These are the extension layer (the
 *             SCI / academic additions). They receive a runtime preamble
 *             that publishes the absolute upstream paths, so they can drive
 *             upstream's scripts without patching them.
 *
 * Why a provider rather than N × `ctx.skills.register()`: the set of skills
 * on disk changes whenever upstream adds or removes one, and a provider is
 * evaluated lazily per listing, so a `git submodule update --remote` takes
 * effect without touching this file.
 *
 * Zero runtime dependencies by design (node builtins only): the plugin must
 * keep loading across DSH release-candidate surface drift.
 *
 * @module dsh-ppt-master-plus
 */

import { readdir, readFile, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Provider id reported on every projected skill. */
export const PROVIDER_NAME = 'dsh-ppt-master-plus'

/** Plugin/service id, matching `cordis.patch.yml`. */
export const name = 'dsh-ppt-master-plus'

/** Services this plugin needs before `apply` runs. */
export const inject = ['skills']

/** Package root (`<pkg>/index.js` → `<pkg>/`). */
export const PACKAGE_DIR = fileURLToPath(new URL('./', import.meta.url))

/**
 * Rank of the projected skills.
 *
 * Higher wins a name collision. Ours sits above upstream so that a local
 * skill can deliberately shadow an upstream one without either tree being
 * edited; today no name collides (`ppt-master` vs `ppt-master-sci`).
 */
const RANK_BUNDLED = 600
const RANK_UPSTREAM = 500

/** Skill names must be lower-kebab-case, matching DSH's own rule. */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Environment override for the upstream checkout.
 *
 * Set this to point at a ppt-master clone that lives somewhere else (a
 * developer working copy, a shared install, a CI cache) instead of
 * `<pkg>/vendor/ppt-master`.
 */
export const UPSTREAM_ENV = 'DSH_PPT_MASTER_PLUS_UPSTREAM'

/**
 * Source reported for every skill this plugin projects.
 *
 * This MUST be a value DSH recognises. An invented one is not rejected with an
 * error — the skill is simply absent from `skills.snapshot()`, so it never
 * reaches any consumer: not the skill centre, not the model's catalog. The
 * plugin looks installed and healthy while one of its skills is invisible, with
 * nothing anywhere to say so. That is exactly what happened when this was
 * `'upstream'`.
 */
const SKILL_SOURCE = 'bundled'

/**
 * Metadata key recording where a skill's files actually live: `upstream` (the
 * read-only submodule) or `plugin` (this repository).
 */
export const ORIGIN_METADATA_KEY = 'origin'

/** The one skills directory. */
export const SKILLS_DIR = join(PACKAGE_DIR, 'skills')

/** Where the upstream checkout lives, and what marks a skill as upstream's. */
export const VENDOR_DIR = join(PACKAGE_DIR, 'vendor')

/**
 * Every skills root the provider scans: exactly one.
 *
 * Why one root: an earlier version scanned `vendor/ppt-master/skills` beside
 * this one and treated the two differently. That made the upstream skill a
 * special case — it lived somewhere no other skill lived, and it carried a
 * different `source`, which made DSH drop it from its snapshot silently. A
 * plugin whose skills are found by looking in one place is easier to reason
 * about than one with a second, privileged location.
 *
 * Upstream still reaches this directory as a **link** created by
 * `upstream:init`, never as a copy, so upstream stays a pristine submodule and
 * `git submodule update --remote` stays a fast-forward. Which tree a skill
 * really lives in is then read off the filesystem
 * ({@link resolveSkillOrigin}) instead of being configured here.
 *
 * @returns the root descriptors.
 */
export function skillRoots() {
  return [{ dir: SKILLS_DIR, label: 'skills' }]
}

/**
 * Decide whether a skill directory belongs to upstream, by where it resolves.
 *
 * The link is what carries the fact: a skill whose real path lands inside
 * `vendor/` is upstream's, so it is registered verbatim and never gets the
 * runtime bridge — byte-identical content is what makes "we did not modify
 * upstream" externally checkable. Everything else is ours.
 *
 * Detecting it this way rather than configuring it means there is no second
 * list to keep in step with the filesystem.
 *
 * @param dir - the skill directory to classify.
 * @returns `{ origin, rank, preamble }`.
 */
export async function resolveSkillOrigin(dir) {
  let real
  try {
    real = await realpath(dir)
  } catch {
    // A missing or dangling directory is treated as ours: it will fail to read
    // its SKILL.md and be skipped anyway, and guessing "upstream" would excuse
    // it from the byte-identical guarantee.
    return { origin: 'plugin', rank: RANK_BUNDLED, preamble: true }
  }

  let vendorReal
  try {
    vendorReal = await realpath(VENDOR_DIR)
  } catch {
    vendorReal = VENDOR_DIR
  }

  const upstream = real === vendorReal || real.startsWith(vendorReal + sep)
  return upstream
    ? { origin: 'upstream', rank: RANK_UPSTREAM, preamble: false }
    : { origin: 'plugin', rank: RANK_BUNDLED, preamble: true }
}

/**
 * Resolve the upstream checkout directory.
 *
 * @param env - environment to read the override from.
 * @returns the absolute upstream directory.
 */
export function resolveUpstreamDir(env = process.env) {
  const override = env?.[UPSTREAM_ENV]
  if (typeof override === 'string' && override.trim() !== '') {
    return override.trim()
  }
  return join(PACKAGE_DIR, 'vendor', 'ppt-master')
}

/**
 * The runtime bridge prepended to this plugin's OWN skill bodies.
 *
 * Upstream's playbook addresses its scripts and references by paths relative
 * to its own skill directory. Our skills live in a different tree, so the
 * absolute locations are published here rather than hard-coded into any
 * SKILL.md. This is also the only place the plugin's own skills learn where
 * the (movable, syncable) upstream checkout ended up.
 *
 * @param paths - the resolved layout.
 * @returns the markdown preamble.
 */
export function runtimePreamble(paths) {
  const { upstreamDir, upstreamSkillDir, packageDir } = paths
  return [
    '## Runtime paths (injected by the dsh-ppt-master-plus plugin)',
    '',
    'This skill is the extension layer. The upstream `ppt-master` skill is a',
    'separate, unmodified git checkout. Use these absolute paths instead of',
    'guessing relative ones:',
    '',
    '| what | where |',
    '| --- | --- |',
    `| upstream checkout root | \`${upstreamDir}\` |`,
    `| upstream skill directory | \`${upstreamSkillDir}\` |`,
    `| upstream scripts | \`${join(upstreamSkillDir, 'scripts')}\` |`,
    `| upstream references | \`${join(upstreamSkillDir, 'references')}\` |`,
    `| this plugin's root | \`${packageDir}\` |`,
    '',
    'Rule: **never write into the upstream checkout.** It is a pristine git',
    'submodule; anything written there is a local modification that blocks the',
    'next upstream sync. All generated artifacts belong in the deck project',
    'workspace, and all of this plugin\u2019s own files live under the plugin root.',
  ].join('\n')
}

// ─── Cordis wiring ──────────────────────────────────────────────────────

/**
 * Plugin entry point.
 *
 * @param ctx - the Cordis context; `skills` is guaranteed by `inject`.
 */
export function apply(ctx) {
  const upstreamDir = resolveUpstreamDir()
  const roots = skillRoots()

  ctx.skills.registerProvider(() => ({
    name: PROVIDER_NAME,

    async list(options) {
      options?.signal?.throwIfAborted()
      const all = await loadAllRoots(roots, upstreamDir)
      options?.signal?.throwIfAborted()
      return all.map(toCandidate)
    },

    async get(candidate, options) {
      options?.signal?.throwIfAborted()
      const all = await loadAllRoots(roots, upstreamDir)
      const found = all.find((entry) => entry.name === candidate.name)
      return found === undefined ? undefined : toDefinition(found)
    },
  }))

  registerMineruShellEnv(ctx)
}

// ─── MinerU credential bridge ───────────────────────────────────────────

/**
 * Credential reference the settings page writes to.
 *
 * Also the environment variable the MinerU CLI and the skill script read, so
 * the same name works whether the user configures this in the UI or exports it
 * from a shell.
 */
export const MINERU_CREDENTIAL_REF = 'MINERU_API_TOKEN'

/**
 * Shell variable published to every model shell call.
 *
 * `ctx.shellEnv` accepts only `DSH_`-prefixed keys, so the credential cannot be
 * republished under its own name. The skill's `mineru_ingest.py` reads this
 * first and falls back to the unprefixed names for users who export a token
 * themselves.
 */
export const MINERU_SHELL_VAR = 'DSH_MINERU_API_TOKEN'

/** Contributor id reported by `ctx.shellEnv.list()`. */
export const SHELL_ENV_CONTRIBUTOR = PROVIDER_NAME

/**
 * Bridge the stored MinerU credential to the shell environment.
 *
 * Why this exists: storing the token is only half the feature. A key in DSH's
 * credential store that no consumer reads is decoration — the Python script
 * runs as an ordinary child process and sees only its environment. This
 * registers a `ctx.shellEnv` contributor, which is the documented seam for
 * adding per-execution variables to model shell calls, so a token saved in the
 * settings page reaches the skill with no environment fiddling by the user.
 *
 * Two constraints shape the implementation:
 *
 *   1. The namespace is `DSH_`-prefixed, so the value is published as
 *      {@link MINERU_SHELL_VAR} rather than under the reference name.
 *   2. `shellEnv.collect` is synchronous while credential resolution is not,
 *      so `resolve()` returns the last known value and refreshes in the
 *      background. The `credentials/reference-updated` listener is what
 *      normally keeps it current; the lazy refresh covers a missed event.
 *
 * Both dependencies are optional. A profile without them still gets the skills
 * — it just does not get the credential bridge, and says so once rather than
 * failing to load.
 *
 * @param ctx - the Cordis context.
 */
export function registerMineruShellEnv(ctx) {
  const get = typeof ctx.get === 'function' ? (name) => ctx.get(name) : () => undefined
  const shellEnv = get('shellEnv')
  const credentials = get('credentials')

  if (shellEnv === undefined || typeof shellEnv.register !== 'function') {
    console.warn(
      `[${PROVIDER_NAME}] shellEnv service unavailable; a MinerU key saved in the settings ` +
        'page will not reach the skill scripts. Export MINERU_API_TOKEN instead.',
    )
    return
  }
  if (credentials === undefined || typeof credentials.resolve !== 'function') {
    console.warn(
      `[${PROVIDER_NAME}] credentials service unavailable; the settings page cannot store a ` +
        'MinerU key. Export MINERU_API_TOKEN instead.',
    )
    return
  }

  /** Last successfully resolved token; '' when unconfigured. */
  let cached = ''
  /**
   * Resolution generation.
   *
   * Every refresh starts its own resolution and only the newest one is allowed
   * to write `cached`. Coalescing instead (returning an in-flight promise for a
   * second request) looks tidier and is wrong: a `resolve()` on the shell path
   * starts a resolution, and if the settings page commits a new key while that
   * one is still in flight, the change would be swallowed and the stale value
   * would win — the key would appear not to take effect until a restart, which
   * is precisely the bug the event listener exists to prevent.
   */
  let generation = 0

  const refresh = async () => {
    const mine = ++generation
    let next = ''
    try {
      const resolved = await credentials.resolve(MINERU_CREDENTIAL_REF)
      next = resolved !== undefined && typeof resolved.value === 'string' ? resolved.value : ''
    } catch {
      // A resolution failure must not take down the plugin or leak a partial
      // value; an empty token simply means the contributor publishes nothing.
      next = ''
    }
    if (mine === generation) cached = next
  }

  void refresh()

  if (typeof ctx.on === 'function') {
    ctx.on('credentials/reference-updated', (ref) => {
      if (ref === MINERU_CREDENTIAL_REF) void refresh()
    })
  }

  try {
    shellEnv.register({
      name: SHELL_ENV_CONTRIBUTOR,
      variables: {
        [MINERU_SHELL_VAR]: {
          description:
            'MinerU API token for the ppt-master-sci skill. Configure it in Plugins → ' +
            'dsh-ppt-master-plus, or export MINERU_API_TOKEN. Absent when no token is set.',
        },
      },
      resolve() {
        // Belt and braces: the event listener is what normally keeps this
        // current, and this covers an event missed while the plugin was
        // reloading. The value returned is the last resolved one, because
        // `collect` is synchronous.
        void refresh()
        return cached === '' ? {} : { [MINERU_SHELL_VAR]: cached }
      },
    })
  } catch (error) {
    console.error(`[${PROVIDER_NAME}] shellEnv contributor registration skipped: ${error}`)
  }
}

// ─── loading ────────────────────────────────────────────────────────────

/**
 * Scan every root and merge the results.
 *
 * A root that does not exist is skipped silently — a fresh install has no
 * upstream checkout until `upstream:init` runs, and that must not take the
 * whole provider down. A root that exists but holds a malformed SKILL.md is
 * an error worth surfacing, because it is the user's own file.
 *
 * @param roots - root descriptors from {@link skillRoots}.
 * @param upstreamDir - absolute upstream checkout, for the bridge preamble.
 * @returns every discoverable skill, deduplicated by name (plugin wins).
 */
async function loadAllRoots(roots, upstreamDir) {
  const upstreamSkillDir = join(upstreamDir, 'skills', 'ppt-master')
  const preamble = runtimePreamble({ upstreamDir, upstreamSkillDir, packageDir: PACKAGE_DIR })

  /** @type {Map<string, any>} */
  const byName = new Map()

  for (const root of roots) {
    let entries
    try {
      entries = await readdir(root.dir, { withFileTypes: true })
    } catch {
      continue // no skills directory yet
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const dir = join(root.dir, entry.name)
      const skillFile = join(dir, 'SKILL.md')

      let raw
      try {
        raw = await readFile(skillFile, 'utf8')
      } catch {
        continue // a directory without SKILL.md is not a skill
      }

      const parsed = parseSkillMarkdown(raw, skillFile)
      const { origin, rank, preamble: wantsPreamble } = await resolveSkillOrigin(dir)

      // Higher rank wins a name collision, so a local skill silently shadows an
      // upstream one without either tree being edited.
      const existing = byName.get(parsed.name)
      if (existing !== undefined && existing.rank >= rank) continue

      byName.set(parsed.name, {
        name: parsed.name,
        description: parsed.description,
        // Which tree the skill came from rides in metadata, never in `source`:
        // an unrecognised source value makes DSH drop the skill from its
        // snapshot entirely, which is silent — see SKILL_SOURCE.
        metadata: { ...(parsed.metadata ?? {}), [ORIGIN_METADATA_KEY]: origin },
        invocation: parsed.invocation,
        provider: PROVIDER_NAME,
        source: SKILL_SOURCE,
        resourceBase: { kind: 'directory', path: dir },
        rank,
        locator: skillFile,
        path: skillFile,
        content: wantsPreamble ? `${preamble}\n\n${parsed.body}` : parsed.body,
      })
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Split a SKILL.md into its frontmatter fields and body.
 *
 * @param raw - file contents.
 * @param skillFile - path, for error messages.
 * @returns the parsed skill fields plus the body.
 * @throws when the frontmatter is absent or lacks `name`/`description`, or
 *   when `name` violates the lower-kebab-case rule.
 */
export function parseSkillMarkdown(raw, skillFile = '<SKILL.md>') {
  const front = splitFrontmatter(raw)
  if (front === undefined) {
    throw new Error(`${PROVIDER_NAME}: ${skillFile} has no --- frontmatter block`)
  }

  const data = parseFrontmatterYaml(front.yaml)
  const skillName = asString(data.name)
  const description = asString(data.description)

  if (skillName === undefined || description === undefined) {
    throw new Error(`${PROVIDER_NAME}: ${skillFile} frontmatter requires name and description`)
  }
  if (!SKILL_NAME_RE.test(skillName)) {
    throw new Error(`${PROVIDER_NAME}: ${skillFile} has invalid skill name "${skillName}"`)
  }

  const body = front.body.trim()
  if (body === '') {
    throw new Error(`${PROVIDER_NAME}: ${skillFile} has an empty body`)
  }

  return {
    name: skillName,
    description,
    ...(isPlainObject(data.metadata) ? { metadata: data.metadata } : {}),
    invocation: {
      modelInvocable: data['disable-model-invocation'] !== true,
      userInvocable: data['user-invocable'] !== false,
    },
    body,
  }
}

/**
 * Split `---\n<yaml>\n---\n<body>` into its two halves.
 *
 * Tolerates CRLF and a leading BOM. The closing fence must be a line that is
 * exactly `---`, so a `---` inside the body is harmless.
 *
 * @param raw - file contents.
 * @returns the yaml text and body, or `undefined` when there is no block.
 */
export function splitFrontmatter(raw) {
  const text = raw.replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return undefined

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return {
        yaml: lines.slice(1, i).join('\n'),
        body: lines.slice(i + 1).join('\n'),
      }
    }
  }
  return undefined
}

/**
 * A deliberately small YAML subset parser, sufficient for SKILL.md
 * frontmatter.
 *
 * Supports `key: value`, quoted scalars, `>-`/`|`-style block scalars,
 * booleans, and one level of nested mappings (used by `metadata:`). Anything
 * it does not understand is skipped rather than guessed at, because a wrong
 * guess here would silently mis-register a skill.
 *
 * @param yaml - the frontmatter text.
 * @returns the parsed top-level mapping.
 */
export function parseFrontmatterYaml(yaml) {
  const lines = yaml.split('\n').map((line) => line.replace(/\r$/, ''))
  /** @type {Record<string, unknown>} */
  const out = {}
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      i++
      continue
    }

    const indent = line.length - line.trimStart().length
    const colon = trimmed.indexOf(':')
    if (colon < 0) {
      i++
      continue
    }

    const key = trimmed.slice(0, colon).trim()
    const rawValue = trimmed.slice(colon + 1).trim()

    if (/^[>|][+-]?$/.test(rawValue)) {
      const folded = rawValue.startsWith('>')
      const block = []
      i++
      while (i < lines.length) {
        const next = lines[i]
        if (next.trim() === '') {
          block.push('')
          i++
          continue
        }
        if (next.length - next.trimStart().length <= indent) break
        block.push(next.slice(indent + 2))
        i++
      }
      const joined = folded
        ? block.join(' ').replace(/\s+/g, ' ').trim()
        : block.join('\n').trim()
      out[key] = joined.replace(/\\n/g, '\n')
      continue
    }

    if (rawValue === '') {
      // Possibly a nested mapping. Collect the deeper-indented run.
      const block = []
      let j = i + 1
      while (j < lines.length) {
        const next = lines[j]
        if (next.trim() === '') {
          block.push(next)
          j++
          continue
        }
        if (next.length - next.trimStart().length <= indent) break
        block.push(next)
        j++
      }
      const nonEmpty = block.filter((l) => l.trim() !== '')
      if (nonEmpty.length > 0) {
        if (nonEmpty[0].trimStart().startsWith('- ')) {
          out[key] = nonEmpty
            .filter((l) => l.trimStart().startsWith('- '))
            .map((l) => stripQuotes(l.trimStart().slice(2).trim()))
        } else {
          out[key] = parseFrontmatterYaml(block.map((l) => l.replace(/^ {2}/, '')).join('\n'))
        }
        i = j
        continue
      }
      out[key] = null
      i++
      continue
    }

    out[key] = coerceScalar(rawValue)
    i++
  }

  return out
}

/**
 * Coerce an inline YAML scalar to a JS value.
 *
 * @param value - the raw scalar text.
 * @returns a boolean, number, null or string.
 */
function coerceScalar(value) {
  const unquoted = stripQuotes(value)
  if (unquoted !== value) return unquoted // was quoted: stays a string
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  if (/^-?\d+$/.test(value)) return Number(value)
  return unquoted
}

/**
 * Remove one layer of matching single or double quotes.
 *
 * @param value - candidate scalar.
 * @returns the unquoted string.
 */
function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

/**
 * @param value - candidate.
 * @returns the trimmed string, or `undefined` when it is not a usable string.
 */
function asString(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * @param value - candidate.
 * @returns true for a non-null, non-array object.
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ─── provider projections ───────────────────────────────────────────────

/**
 * Project a skill onto the provider's `list` shape (no body).
 *
 * @param skill - a loaded skill.
 * @returns the candidate record.
 */
function toCandidate(skill) {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.metadata !== undefined ? { metadata: skill.metadata } : {}),
    invocation: skill.invocation,
    provider: skill.provider,
    source: skill.source,
    resourceBase: skill.resourceBase,
    rank: skill.rank,
    locator: skill.locator,
    path: skill.path,
  }
}

/**
 * Project a skill onto the provider's `get` shape (with body).
 *
 * @param skill - a loaded skill.
 * @returns the full definition record.
 */
function toDefinition(skill) {
  const { locator, ...rest } = toCandidate(skill)
  void locator
  return { ...rest, content: skill.content }
}
