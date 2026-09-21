import test from 'node:test'
import assert from 'node:assert/strict'
import { renderEditableMarkdown, deletionRange, MarkdownDraft } from '../js/composer-editor.js'
import { composerHeightBounds, clampComposerHeight } from '../js/composer-resize.js'

test('实时排版覆盖标题、加粗、列表、引用及表格，并保留原文坐标', () => {
  const html = renderEditableMarkdown('# 构图\n\n**暖光**\n- 人物\n> 背景\n| 参数 | 值 |\n| --- | --- |\n| 尺寸 | 竖图 |')
  assert.match(html, /md-heading" data-level="1"/)
  assert.match(html, /<strong><span data-md-start="8" data-md-end="10">暖光<\/span><\/strong>/)
  assert.match(html, /md-list-line" data-bullet="•"/)
  assert.match(html, /md-quote-line/)
  assert.match(html, /md-table-cell/)
  assert.match(html, /md-table-divider/)
})

test('代码保持字面内容，HTML 和链接不能在输入区域执行', () => {
  const html = renderEditableMarkdown('```html\n<img src=x onerror=alert(1)>\n**不是粗体**\n```\n[地址](javascript:alert)\n`**字面值**`')
  assert.ok(!html.includes('<img'))
  assert.ok(!html.includes('<strong>'))
  assert.ok(!html.includes('href='))
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /md-code-line/)
  assert.match(html, /<code><span[^>]+>\*\*字面值\*\*<\/span><\/code>/)
})

test('粘贴长分隔线时保持线性解析，不阻塞编辑器', () => {
  const raw = '| --- |' + '-'.repeat(5000) + 'x'
  assert.ok(renderEditableMarkdown(raw).includes('x'))
})

test('替换选区和撤销重做恢复原文及光标，不把显示用标记写入草稿', () => {
  const draft = new MarkdownDraft('**暖光**')
  draft.selection = { anchor: 2, focus: 4 }
  draft.replace(2, 4, '自然光')
  assert.equal(draft.value, '**自然光**')
  assert.deepEqual(draft.selection, { anchor: 5, focus: 5 })
  draft.undo()
  assert.equal(draft.value, '**暖光**')
  assert.deepEqual(draft.selection, { anchor: 2, focus: 4 })
  draft.redo()
  assert.equal(draft.value, '**自然光**')
  draft.reset('下一条')
  draft.undo()
  assert.equal(draft.value, '下一条')
})

test('删除完整 emoji、组合字符和中文，不产生半个字符', () => {
  const value = '中文👨‍👩‍👧‍👦e\u0301'
  const [start, end] = deletionRange(value, value.length, value.length, 'deleteContentBackward')
  assert.equal(value.slice(start, end), 'e\u0301')
  const emoji = deletionRange(value, start, start, 'deleteContentBackward')
  assert.equal(value.slice(...emoji), '👨‍👩‍👧‍👦')
  assert.deepEqual(deletionRange('中文', 1, 1, 'deleteContentBackward'), [0, 1])
  assert.deepEqual(deletionRange(value, 2, 2, 'deleteContentForward'), emoji)
})

test('连续编辑清空重做记录，Windows 换行统一保存为 Markdown 换行', () => {
  const draft = new MarkdownDraft('a\r\nb')
  assert.equal(draft.value, 'a\nb')
  draft.replace(3, 3, 'c')
  draft.undo()
  draft.replace(0, 1, '新')
  draft.redo()
  assert.equal(draft.value, '新\nb')
})

test('拖动高度在输入区域最小高度和标题栏下边界之间', () => {
  const bounds = composerHeightBounds({ bottom: 986, toolbarBottom: 110, bottomPadding: 24, chromeHeight: 106 })
  assert.deepEqual(bounds, { min: 150, max: 852 })
  assert.equal(clampComposerHeight(1500, bounds), 852)
  assert.equal(986 - 24 - clampComposerHeight(1500, bounds), 110)
  assert.equal(clampComposerHeight(30, bounds), 150)
  assert.equal(clampComposerHeight(420, bounds), 420)
})

test('窗口缩小时重新限制最大高度，极小窗口不会得到负高度', () => {
  const bounds = composerHeightBounds({ bottom: 500, toolbarBottom: 110, bottomPadding: 24, chromeHeight: 106 })
  assert.equal(clampComposerHeight(852, bounds), 366)
  const small = composerHeightBounds({ bottom: 100, toolbarBottom: 110, bottomPadding: 24, chromeHeight: 106 })
  assert.deepEqual(small, { min: 0, max: 0 })
})
