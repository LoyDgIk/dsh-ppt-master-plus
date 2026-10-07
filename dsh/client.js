// Browser half of the dsh-ppt-master-plus DSH plugin: the MinerU API key
// settings page.
//
// Hand-written in the lazy-CJS bundle protocol (`window.__ModuleLoader__.load`
// with a factory returning cordis-plugin exports), matching the host half's
// zero-dependency, zero-build stance: no JSX, no bundler, and `react` arrives
// through the same `require` the loader hands back, so this package declares no
// react dependency of its own.
//
// WHAT THIS PAGE IS FOR
//
// The SCI skill's `mineru_ingest.py` needs a MinerU API token. Without a UI the
// only ways to supply one were an exported environment variable or a `.env`
// file — neither of which a user can set from the app, and the second of which
// leaves a plaintext secret on disk.
//
// So the key is stored through DSH's own credential service under the
// reference `MINERU_API_TOKEN`. Nothing is written to a file here, and the
// value is never read back into this component: `describe()` reports whether a
// reference is configured, and never its value.
//
// HOW THE TOKEN REACHES THE SKILL
//
// Storing it is only half the job — a key in the credential store that no
// consumer reads is decoration. The host half registers a `ctx.shellEnv`
// contributor that resolves this reference fresh on every model shell call and
// publishes it as `DSH_MINERU_API_TOKEN`, which `mineru_ingest.py` reads first.
// The two halves are one feature; see `../index.js`.
//
// SCOPE — deliberately narrow. Only the official MinerU cloud API is supported;
// there is no provider picker and no self-hosted base URL, so there is nothing
// here to configure beyond the key itself.

window.__ModuleLoader__.load({
  id: 'dsh-ppt-master-plus',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    /** i18n namespace; also the slot entry key's `locale` field. */
    var NS = 'dsh-ppt-master-plus'

    /** The credential reference. Also the environment variable the skill reads. */
    var CREDENTIAL_REF = 'MINERU_API_TOKEN'

    /** The shell variable the host half publishes, and the skill reads first. */
    var SHELL_VAR = 'DSH_MINERU_API_TOKEN'

    /** Fixed endpoint. Not configurable by design: official API only. */
    var ENDPOINT = 'https://mineru.net/api/v4'

    var zh = {
      title: 'MinerU 配置',
      subtitle: '配置 MinerU 文档解析的 API Key，供 ppt-master-sci 技能的论文解析使用。',
      endpointLabel: 'API 服务地址',
      endpointHint: '仅支持 MinerU 官方云服务（v4 API），不支持本地部署。',
      keyLabel: 'API Key',
      keyPlaceholder: '粘贴 MinerU API Key',
      keyPlaceholderConfigured: '已配置；留空将保留当前 Key',
      save: '保存',
      saving: '保存中…',
      clear: '清除',
      clearing: '清除中…',
      configured: '已配置',
      notConfigured: '未配置',
      source: '来源',
      shadowed: '当前 Key 来自只读来源，无法在此覆盖。请先移除该来源（例如进程环境变量或 .env 文件）再保存。',
      readOnlyEnv: '环境变量',
      readOnlyFile: '.env 文件',
      storeNote: 'Key 保存在 DeepSeek Harness 凭据服务中，不写入任何文件，也不会回显。',
      shellNote: '每次模型执行 Shell 时，宿主会把该 Key 解析为 ${name} 供技能脚本读取。',
      scopeNote: '仅需配置这一个 Key；接口地址与服务范围固定。',
      gotIt: '知道了',
      placeholderNote: '未配置时，技能会明确报错并提示配置，不会静默降级解析质量。',
      noValue: '请输入 API Key。',
      busy: '正在与宿主通信…',
      okSaved: '已保存。',
      okCleared: '已清除。',
      failed: '操作失败：',
      unavailable: '凭据服务不可用，无法在此配置；请改用环境变量 MINERU_API_TOKEN。',
      helpTitle: '没有 Key？',
      helpBody: '在 mineru.net 注册后可获取 API Key。离线场景可用 mineru_ingest.py --from-zip 直接解析已有的 MinerU 归档，无需 Key。',
    }

    var en = {
      title: 'MinerU configuration',
      subtitle: 'Set the MinerU API key used by the ppt-master-sci skill for parsing papers.',
      endpointLabel: 'API endpoint',
      endpointHint: 'Official MinerU cloud only (v4 API). Self-hosted deployments are not supported.',
      keyLabel: 'API key',
      keyPlaceholder: 'Paste your MinerU API key',
      keyPlaceholderConfigured: 'Configured; leave blank to keep the current key',
      save: 'Save',
      saving: 'Saving…',
      clear: 'Clear',
      clearing: 'Clearing…',
      configured: 'Configured',
      notConfigured: 'Not configured',
      source: 'Source',
      shadowed: 'The current key comes from a read-only source and cannot be overridden here. Remove that source first (a process environment variable or a .env file).',
      readOnlyEnv: 'environment variable',
      readOnlyFile: '.env file',
      storeNote: 'Stored in the DeepSeek Harness credential service. Never written to a file and never echoed back.',
      shellNote: 'On every model shell call the host resolves it as ${name} for the skill scripts.',
      scopeNote: 'This key is the only setting; the endpoint and service scope are fixed.',
      gotIt: 'Got it',
      placeholderNote: 'Without a key the skill fails loudly and says so, rather than silently degrading parse quality.',
      noValue: 'Enter an API key.',
      busy: 'Talking to the host…',
      okSaved: 'Saved.',
      okCleared: 'Cleared.',
      failed: 'Failed: ',
      unavailable: 'The credential service is unavailable, so this page cannot store a key. Use the MINERU_API_TOKEN environment variable instead.',
      helpTitle: 'No key yet?',
      helpBody: 'Register at mineru.net to get one. Offline, mineru_ingest.py --from-zip parses an existing MinerU archive with no key at all.',
    }

    var TOKENS = {
      border: 'var(--dsw-alias-border-l1, rgba(127,127,127,0.24))',
      borderStrong: 'var(--dsw-alias-border-l2, rgba(127,127,127,0.4))',
      text: 'var(--dsw-alias-label-primary, inherit)',
      dim: 'var(--dsw-alias-label-secondary, rgba(127,127,127,0.9))',
      surface: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.06))',
      surface2: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.1))',
      brand: 'var(--dsw-alias-brand-primary, #4b6bfb)',
      ok: 'var(--dsw-alias-state-success-primary, #2e7d32)',
      warn: 'var(--dsw-alias-state-warn-primary, #b26a00)',
      bad: 'var(--dsw-alias-state-error-primary, #c0392b)',
      idle: 'var(--dsw-alias-state-idle-primary, rgba(127,127,127,0.6))',
    }

    /**
     * Unwrap an RPC result.
     *
     * The client connection hands back either a resolved value or a failure
     * envelope depending on transport version, so both shapes are handled here
     * rather than assuming one.
     *
     * @param {*} result - whatever the RPC returned.
     * @returns {{ ok: boolean, value?: *, error?: string }}
     */
    function unwrap(result) {
      if (result === undefined || result === null) return { ok: true, value: undefined }
      if (typeof result === 'object' && 'ok' in result) {
        if (result.ok) return { ok: true, value: result.value }
        var message = result.error
        if (message && typeof message === 'object') {
          message = message.message || message.code || JSON.stringify(message)
        }
        return { ok: false, error: String(message || 'unknown error') }
      }
      return { ok: true, value: result }
    }

    /** Normalise a thrown value into a readable string. */
    function reasonOf(error) {
      if (error && typeof error === 'object' && error.message) return String(error.message)
      return String(error)
    }

    /**
     * The settings page.
     *
     * Renders the key form when the plugin page asks for `view: 'page'`, and a
     * one-line status when it asks for `view: 'summary'`.
     */
    function SettingsPage(props) {
      var react = require('react')
      var h = react.createElement
      var t = props.t

      var credentials = props.credentials
      var view = props.view

      var statusState = react.useState(null)
      var status = statusState[0]
      var setStatus = statusState[1]

      var draftState = react.useState('')
      var draft = draftState[0]
      var setDraft = draftState[1]

      var busyState = react.useState('')
      var busy = busyState[0]
      var setBusy = busyState[1]

      var noteState = react.useState(null)
      var note = noteState[0]
      var setNote = noteState[1]

      var refresh = react.useCallback(
        function () {
          if (!credentials || typeof credentials.describe !== 'function') {
            setStatus({ unavailable: true })
            return
          }
          credentials.describe([CREDENTIAL_REF]).then(
            function (raw) {
              var result = unwrap(raw)
              var entry = result.ok && result.value ? result.value[CREDENTIAL_REF] : undefined
              setStatus(entry || { configured: false, writable: true })
            },
            function (error) {
              setStatus({ unavailable: true, error: reasonOf(error) })
            },
          )
        },
        [credentials],
      )

      react.useEffect(function () {
        refresh()
      }, [refresh])

      if (view === 'summary') {
        // The bundle list asks for one line: state the fact, not the form.
        return h(
          'span',
          { style: { color: TOKENS.dim, fontSize: 12 } },
          status === null
            ? t('busy')
            : status.unavailable
              ? t('unavailable')
              : status.configured
                ? t('configured')
                : t('notConfigured'),
        )
      }

      var unavailable = status !== null && status.unavailable === true
      var configured = status !== null && status.configured === true
      var writable = status === null || status.writable !== false
      var shadowed = configured && !writable

      /** Persist the typed key. */
      function save() {
        if (draft.trim() === '') {
          setNote({ kind: 'bad', text: t('noValue') })
          return
        }
        setBusy('save')
        setNote(null)
        credentials.set(CREDENTIAL_REF, draft.trim()).then(
          function (raw) {
            var result = unwrap(raw)
            setBusy('')
            if (result.ok) {
              setDraft('')
              setNote({ kind: 'ok', text: t('okSaved') })
              refresh()
            } else {
              setNote({ kind: 'bad', text: t('failed') + result.error })
            }
          },
          function (error) {
            setBusy('')
            setNote({ kind: 'bad', text: t('failed') + reasonOf(error) })
          },
        )
      }

      /** Remove the stored key. */
      function clear() {
        setBusy('clear')
        setNote(null)
        credentials.unset(CREDENTIAL_REF).then(
          function (raw) {
            var result = unwrap(raw)
            setBusy('')
            if (result.ok) {
              setDraft('')
              setNote({ kind: 'ok', text: t('okCleared') })
              refresh()
            } else {
              setNote({ kind: 'bad', text: t('failed') + result.error })
            }
          },
          function (error) {
            setBusy('')
            setNote({ kind: 'bad', text: t('failed') + reasonOf(error) })
          },
        )
      }

      var fieldStyle = {
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 10px',
        fontSize: 13,
        color: TOKENS.text,
        background: TOKENS.surface,
        border: '1px solid ' + TOKENS.border,
        borderRadius: 8,
        outline: 'none',
      }

      function button(label, onClick, kind, disabled) {
        var primary = kind === 'primary'
        return h(
          'button',
          {
            type: 'button',
            onClick: onClick,
            disabled: disabled === true,
            style: {
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 8,
              cursor: disabled === true ? 'not-allowed' : 'pointer',
              color: primary ? '#fff' : TOKENS.text,
              background: primary ? TOKENS.brand : TOKENS.surface2,
              border: '1px solid ' + (primary ? TOKENS.brand : TOKENS.border),
              opacity: disabled === true ? 0.55 : 1,
            },
          },
          label,
        )
      }

      function badge() {
        if (status === null) return null
        var color = configured ? TOKENS.ok : TOKENS.warn
        var label = configured ? t('configured') : t('notConfigured')
        return h(
          'span',
          {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 10px',
              fontSize: 12,
              fontWeight: 500,
              color: color,
              border: '1px solid ' + color,
              borderRadius: 999,
            },
          },
          h('span', {
            style: { width: 6, height: 6, borderRadius: 999, background: color, display: 'inline-block' },
          }),
          label,
        )
      }

      var children = [
        h(
          'div',
          { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 } },
          h('div', { style: { fontSize: 14, fontWeight: 600, color: TOKENS.text } }, t('title')),
          unavailable ? null : badge(),
        ),
        h('div', { key: 'sub', style: { fontSize: 12, color: TOKENS.dim, marginBottom: 14 } }, t('subtitle')),
      ]

      if (unavailable) {
        children.push(
          h(
            'div',
            {
              key: 'unavailable',
              style: {
                fontSize: 12,
                color: TOKENS.bad,
                background: TOKENS.surface,
                border: '1px solid ' + TOKENS.border,
                borderRadius: 8,
                padding: '10px 12px',
              },
            },
            t('unavailable'),
          ),
        )
        return h('div', { style: { padding: '4px 0' } }, children)
      }

      children.push(
        h(
          'div',
          { key: 'endpoint', style: { marginBottom: 14 } },
          h('div', { style: { fontSize: 12, fontWeight: 500, color: TOKENS.text, marginBottom: 4 } }, t('endpointLabel')),
          h(
            'div',
            {
              style: {
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12,
                color: TOKENS.dim,
                background: TOKENS.surface,
                border: '1px solid ' + TOKENS.border,
                borderRadius: 8,
                padding: '8px 10px',
              },
            },
            ENDPOINT,
          ),
          h('div', { style: { fontSize: 11, color: TOKENS.dim, marginTop: 4 } }, t('endpointHint')),
        ),
      )

      children.push(
        h(
          'div',
          { key: 'key', style: { marginBottom: 12 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } },
            h('div', { style: { fontSize: 12, fontWeight: 500, color: TOKENS.text } }, t('keyLabel')),
            configured
              ? h(
                  'span',
                  { style: { fontSize: 11, color: TOKENS.dim } },
                  t('source') + ': ' + (status.source || t('storeNote')),
                )
              : null,
          ),
          h('input', {
            type: 'password',
            value: draft,
            placeholder: configured ? t('keyPlaceholderConfigured') : t('keyPlaceholder'),
            disabled: busy !== '' || shadowed,
            autoComplete: 'off',
            spellCheck: false,
            onChange: function (event) {
              setDraft(event.target.value)
            },
            onKeyDown: function (event) {
              if (event.key === 'Enter') save()
            },
            style: Object.assign({}, fieldStyle, shadowed ? { opacity: 0.55, cursor: 'not-allowed' } : {}),
          }),
        ),
      )

      if (shadowed) {
        children.push(
          h(
            'div',
            {
              key: 'shadowed',
              style: {
                fontSize: 12,
                color: TOKENS.warn,
                background: TOKENS.surface,
                border: '1px solid ' + TOKENS.border,
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 12,
              },
            },
            t('shadowed'),
          ),
        )
      }

      children.push(
        h(
          'div',
          { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
          button(busy === 'save' ? t('saving') : t('save'), save, 'primary', busy !== '' || shadowed),
          button(busy === 'clear' ? t('clearing') : t('clear'), clear, 'plain', busy !== '' || !configured),
          note
            ? h(
                'span',
                {
                  style: {
                    fontSize: 12,
                    color: note.kind === 'ok' ? TOKENS.ok : TOKENS.bad,
                  },
                },
                note.text,
              )
            : null,
        ),
      )

      children.push(
        h(
          'div',
          {
            key: 'notes',
            style: {
              fontSize: 11,
              lineHeight: 1.75,
              color: TOKENS.dim,
              borderTop: '1px solid ' + TOKENS.border,
              paddingTop: 10,
            },
          },
          h('div', null, t('storeNote')),
          h('div', null, t('shellNote').replace('${name}', SHELL_VAR)),
          h('div', null, t('scopeNote')),
          h('div', { style: { marginTop: 6 } }, t('placeholderNote')),
        ),
      )

      return h('div', { style: { padding: '4px 0', color: TOKENS.text } }, children)
    }

    var inject = ['slots', 'locale', 'connection', 'remote', 'remote.credentials']

    function apply(ctx) {
      ctx.effect(
        function () {
          return ctx.locale.register(NS, { zh: zh, en: en })
        },
        'dsh-ppt-master-plus: dictionaries',
      )

      var connection = ctx.get('connection')
      if (connection === undefined) {
        // Without a connection there is no credential RPC, so the page could
        // only render a form that cannot save. Say so instead of shipping it.
        console.error('dsh-ppt-master-plus: connection service unavailable; settings page not mounted')
        return
      }

      var injected = function () {
        return { credentials: ctx.remote.credentials }
      }

      ctx.slots.inject('plugins.bundle.config', function () {
        return ctx.slots.register(
          {
            name: 'plugins.bundle.config',
            key: 'dsh-ppt-master-plus',
            locale: NS,
            inject: injected,
          },
          SettingsPage,
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
