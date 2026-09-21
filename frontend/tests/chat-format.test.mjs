import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../js/chat-format.js'

test('回复中的 HTML 保持为文字，不能创建可执行标签', () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)">\n<script>alert(1)</script>')
  assert.ok(html.includes('&lt;img'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<img'))
  assert.ok(!html.includes('<script'))
})

test('链接限制协议，并转义属性中的引号', () => {
  const html = renderMarkdown('[安全](https://example.com/?q="x") [危险](javascript:alert) [数据](data:text/html,x)')
  assert.match(html, /href="https:\/\/example.com\/\?q=&quot;x&quot;"/)
  assert.equal((html.match(/<a /g) || []).length, 1)
  assert.ok(!html.includes('href="javascript:'))
  assert.ok(!html.includes('href="data:'))
})

test('标题、列表与段落分别排版，中文原文保留', () => {
  const html = renderMarkdown('## 构图建议\n\n人物居中，**背景简洁**。\n\n- 暖光\n- 竖图\n\n2. 上传参考图\n3. 生成')
  assert.match(html, /<h3>构图建议<\/h3>/)
  assert.match(html, /<strong>背景简洁<\/strong>/)
  assert.match(html, /<ul><li>暖光<\/li><li>竖图<\/li><\/ul>/)
  assert.match(html, /<ol start="2"><li>上传参考图<\/li><li>生成<\/li><\/ol>/)
})

test('代码块内不解析 Markdown 和 HTML，保留换行和缩进', () => {
  const html = renderMarkdown('```html\n<div>\n  **原样**\n</div>\n```')
  assert.match(html, /data-copy-code/)
  assert.match(html, /<pre><code>&lt;div&gt;\n  \*\*原样\*\*\n&lt;\/div&gt;<\/code><\/pre>/)
  assert.ok(!html.includes('<strong>'))
})

test('流式尚未闭合的代码块也能显示，完成后正文接在代码后', () => {
  const partial = renderMarkdown('```js\nconst x = 1')
  assert.match(partial, /const x = 1<\/code><\/pre>/)
  const complete = renderMarkdown('```js\nconst x = 1\n```\n完成。')
  assert.match(complete, /<\/div><p>完成。<\/p>$/)
})

test('行内代码中的星号不会被当成加粗', () => {
  assert.equal(renderMarkdown('使用 `**abc**`'), '<p>使用 <code>**abc**</code></p>')
})

test('表格支持对齐、空单元格与转义竖线', () => {
  const html = renderMarkdown('| 参数 | 值 |\n| :--- | ---: |\n| 尺寸 | 1024 |\n| a\\|b | |')
  assert.match(html, /role="region"/)
  assert.match(html, /<th style="text-align:right">值<\/th>/)
  assert.match(html, /<td style="text-align:left">a\|b<\/td><td style="text-align:right"><\/td>/)
})

test('引用和波浪线代码块可阅读，空文本不产生多余段落', () => {
  assert.equal(renderMarkdown(''), '')
  assert.match(renderMarkdown('> 第一行\n> 第二行'), /<blockquote>第一行<br>第二行<\/blockquote>/)
  assert.match(renderMarkdown('~~~text\n<原文>\n~~~'), /&lt;原文&gt;/)
})

test('Markdown 内可编辑的参数保持原文顺序，代码示例不转换成编辑控件', () => {
  const argument = (name) => `{argument name="${name}" default="蓝色"}`
  const seen = []
  const markdown = [
    '`' + argument('行内示例') + '`',
    '**' + argument('加粗参数') + '**',
    '```text', argument('代码示例'), '```',
    `| 名称 | ${argument('表头参数')} |`, '| --- | --- |',
    `| 值 | ${argument('单元格参数')} |`, '',
    argument('正文参数'),
  ].join('\n')
  const html = renderMarkdown(markdown, {
    renderArgument(name, value, index) {
      seen.push([name, value, index])
      return `<span data-argument-index="${index}">${value}</span>`
    },
  })
  assert.deepEqual(seen, [
    ['加粗参数', '蓝色', 1], ['表头参数', '蓝色', 3],
    ['单元格参数', '蓝色', 4], ['正文参数', '蓝色', 5],
  ])
  assert.match(html, /<strong><span data-argument-index="1">蓝色<\/span><\/strong>/)
  assert.match(html, /<code>\{argument name=&quot;行内示例/)
  assert.match(html, /<pre><code>\{argument name=&quot;代码示例/)
})
