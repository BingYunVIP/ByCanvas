import { escapeMarkup } from './chat-format.js'
import { tr } from './i18n-text.js'

// 每个可见文字片段都保留原文位置。排版只改变显示，不改变提交给模型的 Markdown。
function sourceSpan(text, start, syntax = false) {
  return `<span data-md-start="${start}" data-md-end="${start + text.length}"${syntax ? ' class="md-syntax" aria-hidden="true"' : ''}>${escapeMarkup(text)}</span>`
}
function boundary(position) {
  return `<span data-md-start="${position}" data-md-end="${position}" class="md-boundary">\u200b</span>`
}
function isTableDivider(line = '') {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  return cells.length > 1 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))
}
function inlineMarkdown(text, start) {
  const tokens = /(`+)([^`\n]+)\1|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~\n]+)~~|\[([^\]\n]+)\]\(([^\s)]+)\)/g
  let html = '', last = 0
  for (const match of text.matchAll(tokens)) {
    html += sourceSpan(text.slice(last, match.index), start + last)
    const position = start + match.index
    const content = match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? match[7] ?? match[8]
    const prefix = match[1] || (match[3] || match[4] || match[7] ? match[0].slice(0, 2) : match[0][0])
    const suffix = match[0].slice(prefix.length + content.length)
    const tag = match[1] ? 'code' : match[3] || match[4] ? 'strong' : match[7] ? 'del' : match[8] ? 'span' : 'em'
    html += sourceSpan(prefix, position, true)
    html += `<${tag}${match[8] ? ' class="md-link"' : ''}>${match[1] ? sourceSpan(content, position + prefix.length) : inlineMarkdown(content, position + prefix.length)}</${tag}>`
    html += sourceSpan(suffix, position + prefix.length + content.length, true)
    html += boundary(position + match[0].length)
    last = match.index + match[0].length
  }
  return html + sourceSpan(text.slice(last), start + last)
}

export function renderEditableMarkdown(value) {
  const lines = String(value).split('\n')
  let start = 0, fence = null, inTable = false
  return lines.map((line, index) => {
    const end = start + line.length
    let content, classes = 'md-line', attrs = ''
    const marker = line.match(/^\s*(`{3,}|~{3,})([^\s`]*)\s*$/)
    if (marker && (!fence || (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2]))) {
      classes += ' md-fence'
      attrs = ` data-language="${escapeMarkup(fence ? '' : marker[2] || tr("代码"))}"`
      content = sourceSpan(line, start, true)
      fence = fence ? null : marker[1]
    } else if (fence) {
      classes += ' md-code-line'
      content = sourceSpan(line, start)
    } else {
      const heading = line.match(/^(\s*#{1,6}\s+)(.*)$/)
      const list = line.match(/^(\s*(?:[-+*]|\d+[.)])\s+)(.*)$/)
      const quote = line.match(/^(\s*>\s?)(.*)$/)
      const divider = isTableDivider(line)
      const table = line.includes('|') && (inTable || isTableDivider(lines[index + 1]))
      inTable = table
      if (divider && table) {
        classes += ' md-table-divider'
        content = sourceSpan(line, start, true)
      } else if (table) {
        classes += ' md-table-row'
        let cursor = 0
        content = line.split(/(?<!\\)\|/).map((cell, cellIndex, cells) => {
          const offset = start + cursor
          cursor += cell.length + 1
          const pipe = cellIndex < cells.length - 1 ? sourceSpan('|', offset + cell.length, true) : ''
          if (!cell && (cellIndex === 0 || cellIndex === cells.length - 1)) return pipe
          return `<span class="md-table-cell">${inlineMarkdown(cell, offset)}</span>${pipe}`
        }).join('')
      } else if (heading || list || quote) {
        const block = heading || list || quote
        if (heading) {
          classes += ' md-heading'
          attrs = ` data-level="${heading[1].trim().length}"`
        } else if (list) {
          classes += ' md-list-line'
          attrs = ` data-bullet="${escapeMarkup(/^\s*\d/.test(list[1]) ? list[1].trim() : '•')}"`
        } else classes += ' md-quote-line'
        content = sourceSpan(block[1], start, true) + boundary(start + block[1].length) + inlineMarkdown(block[2], start + block[1].length)
      } else if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
        classes += ' md-rule'
        content = sourceSpan(line, start, true)
      } else content = inlineMarkdown(line, start)
    }
    const html = `<div class="${classes}"${attrs}>${content}${boundary(end)}</div>`
    start = end + 1
    return html
  }).join('')
}

export function deletionRange(value, start, end, inputType) {
  if (start !== end) return [start, end]
  const backwards = /Backward$/.test(inputType)
  if (/Line/.test(inputType)) return backwards
    ? [value.lastIndexOf('\n', start - 1) + 1, start]
    : [start, value.indexOf('\n', start) < 0 ? value.length : value.indexOf('\n', start)]
  if (/Word/.test(inputType)) return backwards
    ? [start - (value.slice(0, start).match(/\s*\S+\s*$/)?.[0].length || 0), start]
    : [start, start + (value.slice(start).match(/^\s*\S+\s*/)?.[0].length || 0)]
  // 中文、emoji 和组合字符以完整字素为单位删除。
  const segments = typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), (s) => s.index)
    : Array.from(value).reduce((positions, char) => [...positions, positions.at(-1) + char.length], [0])
  return backwards
    ? [segments.filter((position) => position < start).at(-1) ?? 0, start]
    : [start, segments.find((position) => position > start) ?? value.length]
}

export class MarkdownDraft {
  constructor(value = '') {
    this.reset(value)
  }
  reset(value) {
    this.value = String(value).replace(/\r\n?/g, '\n')
    this.selection = { anchor: this.value.length, focus: this.value.length }
    this.past = []
    this.future = []
  }
  snapshot() { return { value: this.value, selection: { ...this.selection } } }
  replace(start, end, text) {
    this.past.push(this.snapshot())
    if (this.past.length > 200) this.past.shift()
    this.future = []
    const insert = String(text).replace(/\r\n?/g, '\n')
    this.value = this.value.slice(0, start) + insert + this.value.slice(end)
    this.selection = { anchor: start + insert.length, focus: start + insert.length }
  }
  undo() {
    if (!this.past.length) return
    this.future.push(this.snapshot())
    Object.assign(this, this.past.pop())
  }
  redo() {
    if (!this.future.length) return
    this.past.push(this.snapshot())
    Object.assign(this, this.future.pop())
  }
}

export function createMarkdownEditor(element, { shouldSubmit = () => false, onSubmit = () => {} } = {}) {
  const doc = element.ownerDocument
  const win = doc.defaultView
  const draft = new MarkdownDraft()
  let composition = null, compositionEnded = false, emitting = false

  function sourcePoint(node, offset) {
    if (node.nodeType === 3) {
      const span = node.parentElement.closest('[data-md-start]')
      if (!span) return 0
      return Math.min(Number(span.dataset.mdEnd), Number(span.dataset.mdStart) + offset)
    }
    const after = node.childNodes[offset]
    const next = after?.nodeType === 1 ? (after.matches('[data-md-start]') ? after : after.querySelector('[data-md-start]')) : after?.parentElement
    if (next?.dataset.mdStart != null) return Number(next.dataset.mdStart)
    const before = node.childNodes[offset - 1]
    const previous = before?.nodeType === 1 ? (before.matches('[data-md-start]') ? before : Array.from(before.querySelectorAll('[data-md-start]')).at(-1)) : before?.parentElement
    if (previous?.dataset.mdEnd != null) return Number(previous.dataset.mdEnd)
    return node.dataset?.mdStart != null ? Number(node.dataset.mdStart) : draft.value.length
  }
  function readSelection() {
    const selection = win.getSelection()
    if (selection?.anchorNode && element.contains(selection.anchorNode) && element.contains(selection.focusNode)) {
      draft.selection = {
        anchor: sourcePoint(selection.anchorNode, selection.anchorOffset),
        focus: sourcePoint(selection.focusNode, selection.focusOffset),
      }
    }
    return draft.selection
  }
  function domPoint(position) {
    if (position === 0) return [element, 0]
    const spans = Array.from(element.querySelectorAll('[data-md-start]:not(.md-syntax)'))
    const span = spans.find((el) => Number(el.dataset.mdStart) === position && el.firstChild)
      || spans.find((el) => Number(el.dataset.mdStart) < position && Number(el.dataset.mdEnd) >= position && el.firstChild)
      || spans.find((el) => Number(el.dataset.mdStart) > position && el.firstChild)
      || spans.at(-1)
    const offset = Math.max(0, Math.min(position - Number(span.dataset.mdStart), Number(span.dataset.mdEnd) - Number(span.dataset.mdStart)))
    return [span.firstChild || span, offset]
  }
  function restoreSelection() {
    const anchor = domPoint(draft.selection.anchor), focus = domPoint(draft.selection.focus)
    win.getSelection().setBaseAndExtent(...anchor, ...focus)
  }
  function render(focus = doc.activeElement === element) {
    const scroll = element.scrollTop
    element.innerHTML = renderEditableMarkdown(draft.value)
    element.dataset.empty = String(!draft.value)
    if (focus) restoreSelection()
    element.scrollTop = scroll
    if (focus) win.requestAnimationFrame?.(() => {
      if (doc.activeElement !== element) return
      const selection = win.getSelection()
      if (!selection?.rangeCount || !element.contains(selection.focusNode)) return
      const range = selection.getRangeAt(0).cloneRange()
      range.collapse(false)
      const caret = range.getClientRects?.()[0]
      if (!caret) return
      const box = element.getBoundingClientRect()
      if (caret.bottom > box.bottom - 6) element.scrollTop += caret.bottom - box.bottom + 6
      else if (caret.top < box.top + 6) element.scrollTop -= box.top + 6 - caret.top
    })
  }
  function notify() {
    emitting = true
    element.dispatchEvent(new win.Event('input', { bubbles: true }))
    emitting = false
  }
  function change(start, end, text) {
    draft.replace(start, end, text)
    render(true)
    notify()
  }
  function selectedRange() {
    const { anchor, focus } = readSelection()
    return [Math.min(anchor, focus), Math.max(anchor, focus)]
  }
  function history(redo = false) {
    readSelection()
    if (redo) draft.redo()
    else draft.undo()
    render(true)
    notify()
  }
  function insertNewline() {
    const [start, end] = selectedRange()
    const lineStart = draft.value.lastIndexOf('\n', start - 1) + 1
    const prefix = draft.value.slice(lineStart, start).match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/)
    const codeLine = win.getSelection()?.anchorNode?.parentElement?.closest('.md-code-line, .md-fence')
    if (prefix && !codeLine) {
      if (!prefix[3]) { change(lineStart, end, '\n'); return }
      const marker = /^\d/.test(prefix[2]) ? `${Number.parseInt(prefix[2], 10) + 1}${prefix[2].at(-1)}` : prefix[2]
      change(start, end, `\n${prefix[1]}${marker} `)
    } else change(start, end, '\n')
  }

  Object.defineProperty(element, 'value', {
    configurable: true,
    get: () => draft.value,
    set: (value) => { draft.reset(value); render() },
  })
  element.addEventListener('focus', restoreSelection)
  element.addEventListener('beforeinput', (event) => {
    if (composition || event.isComposing) return
    event.preventDefault()
    if (compositionEnded && /^(insertFromComposition|insertText)$/.test(event.inputType)) return
    if (event.inputType === 'historyUndo') { history(); return }
    if (event.inputType === 'historyRedo') { history(true); return }
    if (/^insert(Paragraph|LineBreak)$/.test(event.inputType)) { insertNewline(); return }
    let [start, end] = selectedRange()
    const target = event.getTargetRanges?.()[0]
    if (event.inputType === 'insertReplacementText' && target && element.contains(target.startContainer) && element.contains(target.endContainer)) {
      start = sourcePoint(target.startContainer, target.startOffset)
      end = sourcePoint(target.endContainer, target.endOffset)
    }
    if (/^delete/.test(event.inputType)) change(...deletionRange(draft.value, start, end, event.inputType), '')
    else if (/^insert/.test(event.inputType) && event.data != null) change(start, end, event.data)
  })
  element.addEventListener('compositionstart', () => { composition = { range: selectedRange(), selection: { ...draft.selection } } })
  element.addEventListener('compositionend', (event) => {
    if (!composition) return
    const saved = composition
    composition = null
    draft.selection = saved.selection
    if (event.data) change(...saved.range, event.data)
    else render(true)
    compositionEnded = true
    win.setTimeout(() => { compositionEnded = false }, 0)
  })
  element.addEventListener('input', (event) => {
    // 输入法组合期间保留浏览器正在编辑的 DOM，其余输入由 beforeinput 统一提交。
    if (emitting || composition || event.isComposing) return
    render()
  })
  element.addEventListener('keydown', (event) => {
    if (composition || event.isComposing || event.keyCode === 229) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      draft.selection = { anchor: 0, focus: draft.value.length }
      restoreSelection()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); history(event.shiftKey); return
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); history(true); return }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (shouldSubmit(event)) onSubmit()
      else insertNewline()
    }
  })
  element.addEventListener('paste', (event) => {
    event.preventDefault()
    if (Array.from(event.clipboardData?.items || []).some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return
    const text = event.clipboardData?.getData('text/plain')
    if (text) change(...selectedRange(), text)
  })
  for (const type of ['copy', 'cut']) element.addEventListener(type, (event) => {
    const [start, end] = selectedRange()
    if (start === end || !event.clipboardData) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', draft.value.slice(start, end))
    if (type === 'cut') change(start, end, '')
  })
  element.addEventListener('click', (event) => {
    // 编辑链接文字时不离开当前页面。
    if (event.target.closest('a')) event.preventDefault()
  })
  render(false)
  return { draft, readSelection, restoreSelection, insertText: (text) => change(...selectedRange(), text) }
}

if (typeof window !== 'undefined') window.ByCanvasComposer = { createMarkdownEditor }
