import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
import { renderMarkdown } from '../js/chat-format.js'

const source = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8')
function setup(saved = null, blocked = false) {
  const storage = new Map(saved == null ? [] : [['byimage.language', saved]])
  const listeners = new Map()
  const ctx = vm.createContext({
    document: { documentElement: {}, title: '', querySelectorAll: () => [], getElementById: () => null, addEventListener() {} },
    localStorage: {
      getItem(key) { if (blocked) throw new Error('blocked'); return storage.get(key) ?? null },
      setItem(key, value) { if (blocked) throw new Error('blocked'); storage.set(key, value) },
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } },
    addEventListener(type, callback) { listeners.set(type, callback) },
    dispatchEvent(event) { listeners.get(event.type)?.(event) },
  })
  ctx.window = ctx
  vm.runInContext(source, ctx)
  return { ctx, storage, listeners, i18n: ctx.ByImageI18n }
}

test('language is restored before rendering and brand names match both languages', () => {
  const { ctx, i18n, storage } = setup('en')
  assert.equal(ctx.document.title, 'ByImage')
  assert.equal(ctx.document.documentElement.lang, 'en')
  for (const [zh, en] of [['冰云生图', 'ByImage'], ['冰云AI', 'ByAI'], ['冰云小店', 'ByShop'], ['冰云文档', 'ByDocs']]) assert.equal(i18n.tr(zh), en)
  i18n.setLanguage('zh-CN')
  assert.equal(ctx.document.title, '冰云生图')
  assert.equal(storage.get('byimage.language'), 'zh-CN')
  assert.equal(i18n.setLanguage('unsupported'), false)
  assert.equal(i18n.language, 'zh-CN')
})

test('message parameters stay verbatim, including Chinese names and placeholder-like text', () => {
  const { i18n } = setup('en')
  assert.equal(i18n.tr('已删除分组「{0}」', '设置 {1} <script>'), 'Deleted group "设置 {1} <script>"')
  assert.equal(i18n.tr('用时 {0}', i18n.tr('{0} 秒', '12.5')), 'Time: 12.5 s')
  assert.equal(i18n.tr('unknown custom content'), 'unknown custom content')
})

test('disabled storage still permits switching; tabs follow storage changes', () => {
  const { i18n, listeners } = setup(null, true)
  i18n.setLanguage('en')
  assert.equal(i18n.language, 'en')
  listeners.get('storage')({ key: 'byimage.language', newValue: 'zh-CN' })
  assert.equal(i18n.language, 'zh-CN')
  listeners.get('storage')({ key: 'unrelated', newValue: 'en' })
  assert.equal(i18n.language, 'zh-CN')
})

test('saved application errors switch languages and preserve original provider details', () => {
  const { i18n } = setup('en')
  assert.equal(i18n.message('上游没有返回任何图片。'), 'The provider returned no images.')
  assert.equal(i18n.message('上游返回 HTTP 429：服务商原始错误 {0}'), 'Provider returned HTTP 429: 服务商原始错误 {0}')
  assert.equal(i18n.message('Unknown provider error'), 'Unknown provider error')
  const english = i18n.message('上游主机无法解析：example.test')
  i18n.setLanguage('zh-CN')
  assert.equal(i18n.message(english), '上游主机无法解析：example.test')
})

test('Markdown controls follow language while message text and code remain unchanged', () => {
  const { i18n } = setup('en')
  const previous = globalThis.ByImageI18n
  globalThis.ByImageI18n = i18n
  try {
    const markdown = '用户原文 设置\n\n```\nconst name = "冰云生图";\n```'
    const english = renderMarkdown(markdown)
    assert.ok(english.includes('Copy code'))
    assert.ok(english.includes('用户原文 设置'))
    assert.ok(english.includes('冰云生图'))
    i18n.setLanguage('zh-CN')
    assert.ok(renderMarkdown(markdown).includes('复制代码'))
  } finally {
    if (previous === undefined) delete globalThis.ByImageI18n
    else globalThis.ByImageI18n = previous
  }
})

test('every literal UI message and static binding has an English translation', () => {
  const { i18n } = setup('en')
  const keys = new Set(i18n.keys)
  const dir = new URL('../js/', import.meta.url)
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.js') && !name.startsWith('i18n'))) {
    const code = readFileSync(new URL(file, dir), 'utf8')
    for (const match of code.matchAll(/\btr\(\s*((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))/g)) {
      const key = vm.runInNewContext(match[1])
      assert.ok(keys.has(key), `${file}: ${key}`)
    }
  }
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  for (const [, key] of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) assert.ok(keys.has(key), key)
  for (const key of keys) {
    assert.ok(!/\p{Script=Han}/u.test(i18n.tr(key)), key)
    const placeholders = (text) => [...text.matchAll(/\{\d+\}/g)].map(([value]) => value).sort()
    assert.deepEqual(placeholders(i18n.tr(key)), placeholders(key), key)
  }
})
