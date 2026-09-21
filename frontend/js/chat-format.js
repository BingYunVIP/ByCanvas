import { tr } from './i18n-text.js'

/** 对话文字的轻量排版。原文保持不变；HTML 一律作为文字，链接只接受安全协议。 */
export function escapeMarkup(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]))
}

const argumentPattern = /\{argument\s+name="([^"]+)"\s+default="([^"]*)"\}/g

function literal(text, state) {
  // 代码和链接中仍显示原文，但计入参数顺序，避免复用时把编辑值套到别的参数上。
  state.argumentIndex += Array.from(text.matchAll(argumentPattern)).length
  return escapeMarkup(text)
}

function inline(text, state) {
  // 逐段输出，生成的标签不会再次参与 Markdown 匹配。
  const tokens = /(`+)([^`\n]+)\1|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|~~([^~\n]+)~~|\{argument\s+name="([^"]+)"\s+default="([^"]*)"\}/g
  let html = '', offset = 0
  for (const match of text.matchAll(tokens)) {
    html += literal(text.slice(offset, match.index), state)
    if (match[1]) html += `<code>${literal(match[2], state)}</code>`
    else if (match[3]) {
      const href = match[4]
      const original = literal(match[0], state)
      html += /^(https?:\/\/|mailto:)/i.test(href)
        ? `<a href="${escapeMarkup(href)}" target="_blank" rel="noopener noreferrer">${escapeMarkup(match[3])}</a>`
        : original
    } else if (match[5] || match[6]) html += `<strong>${inline(match[5] || match[6], state)}</strong>`
    else if (match[7]) html += `<em>${inline(match[7], state)}</em>`
    else if (match[8]) html += `<del>${inline(match[8], state)}</del>`
    else {
      const index = state.argumentIndex++
      html += state.renderArgument ? state.renderArgument(match[9], match[10], index) : escapeMarkup(match[0])
    }
    offset = match.index + match[0].length
  }
  return html + literal(text.slice(offset), state)
}

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

function isTableDivider(line) {
  const cells = tableCells(line || '')
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

/** 支持常用标题、段落、列表、引用、表格与代码块，不执行原文里的 HTML。 */
export function renderMarkdown(value, { renderArgument } = {}) {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n')
  const state = { renderArgument, argumentIndex: 0 }
  const formatInline = (text) => inline(text, state)
  const out = []
  let i = 0
  const startsBlock = (line) => /^\s*(?:`{3,}|~{3,}|#{1,6}\s|>\s?|[-+*]\s|\d+[.)]\s|(?:-\s*){3,}$)/.test(line)
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    const fence = line.match(/^\s*(`{3,}|~{3,})([^\s`]*)\s*$/)
    if (fence) {
      const code = []
      i++
      const end = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`)
      while (i < lines.length && !end.test(lines[i])) code.push(lines[i++])
      if (i < lines.length) i++
      // 流式未闭合的代码块也能稳定展示。
      out.push(`<div class="chat-code"><div class="chat-code-bar"><span>${escapeMarkup(fence[2] || tr("代码"))}</span><button type="button" data-copy-code>${escapeMarkup(tr("复制代码"))}</button></div><pre><code>${literal(code.join('\n'), state)}</code></pre></div>`)
      continue
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*$/)
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6)
      out.push(`<h${level}>${formatInline(heading[2])}</h${level}>`)
      i++; continue
    }
    if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      out.push('<hr>'); i++; continue
    }
    if (line.includes('|') && isTableDivider(lines[i + 1])) {
      const headers = tableCells(line)
      const alignments = tableCells(lines[i + 1]).map((cell) => cell.endsWith(':') ? (cell.startsWith(':') ? 'center' : 'right') : 'left')
      const row = (cells, tag) => '<tr>' + headers.map((_, n) => `<${tag} style="text-align:${alignments[n] || 'left'}">${formatInline(cells[n] || '')}</${tag}>`).join('') + '</tr>'
      const headerRow = row(headers, 'th')
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(row(tableCells(lines[i++]), 'td'))
      out.push(`<div class="chat-table" tabindex="0" role="region" aria-label="${escapeMarkup(tr("消息中的表格"))}"><table><thead>${headerRow}</thead><tbody>${rows.join('')}</tbody></table></div>`)
      continue
    }
    if (/^\s*>/.test(line)) {
      const quote = []
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${quote.map(formatInline).join('<br>')}</blockquote>`)
      continue
    }
    const listItem = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/)
    if (listItem) {
      const ordered = /^\d/.test(listItem[1])
      const tag = ordered ? 'ol' : 'ul'
      const items = []
      while (i < lines.length) {
        const item = lines[i].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/)
        if (!item || /^\d/.test(item[1]) !== ordered) break
        items.push(`<li>${formatInline(item[2])}</li>`)
        i++
      }
      out.push(`<${tag}${ordered ? ` start="${Number.parseInt(listItem[1], 10)}"` : ''}>${items.join('')}</${tag}>`)
      continue
    }
    const paragraph = [line]
    i++
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !isTableDivider(lines[i + 1])) paragraph.push(lines[i++])
    out.push(`<p>${paragraph.map(formatInline).join('<br>')}</p>`)
  }
  return out.join('')
}

if (typeof window !== 'undefined') window.ByChatFormat = { renderMarkdown }
