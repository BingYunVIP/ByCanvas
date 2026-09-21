export function composerHeightBounds({ bottom, toolbarBottom, bottomPadding, chromeHeight }) {
  const max = Math.max(0, Math.floor(bottom - bottomPadding - toolbarBottom))
  return { min: Math.min(max, Math.ceil(chromeHeight + 44)), max }
}

export function clampComposerHeight(height, bounds) {
  return Math.min(bounds.max, Math.max(bounds.min, height))
}

export function createComposerResizer({ composer, area, handle, toolbar }) {
  const doc = composer.ownerDocument
  const win = doc.defaultView
  const main = area.parentElement
  const inputWrap = composer.querySelector('.composer-input-wrap')
  let desiredHeight = null, drag = null

  function bounds() {
    return composerHeightBounds({
      bottom: main.getBoundingClientRect().bottom,
      toolbarBottom: toolbar.getBoundingClientRect().bottom,
      bottomPadding: Number.parseFloat(win.getComputedStyle(area).paddingBottom) || 0,
      chromeHeight: composer.getBoundingClientRect().height - inputWrap.getBoundingClientRect().height,
    })
  }
  function sync() {
    const limits = bounds()
    // 手动拉高时去掉上方间距，输入栏的顶边可正好到达标题栏底边。
    const topGap = desiredHeight == null ? Number.parseFloat(win.getComputedStyle(area).paddingTop) || 0 : 0
    composer.style.maxHeight = `${Math.max(0, limits.max - topGap)}px`
    if (desiredHeight != null) composer.style.height = `${clampComposerHeight(desiredHeight, limits)}px`
    handle.setAttribute('aria-valuemin', String(limits.min))
    handle.setAttribute('aria-valuemax', String(limits.max))
    handle.setAttribute('aria-valuenow', String(Math.round(composer.getBoundingClientRect().height)))
  }
  function setHeight(height) {
    desiredHeight = clampComposerHeight(height, bounds())
    area.classList.add('is-resized')
    sync()
  }
  function stop(event) {
    if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return
    const id = drag.pointerId
    drag = null
    doc.body.classList.remove('is-composer-resizing')
    if (handle.hasPointerCapture?.(id)) handle.releasePointerCapture(id)
  }
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return
    event.preventDefault()
    drag = { pointerId: event.pointerId, y: event.clientY, height: composer.getBoundingClientRect().height }
    handle.setPointerCapture(event.pointerId)
    doc.body.classList.add('is-composer-resizing')
  })
  handle.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    setHeight(drag.height + drag.y - event.clientY)
  })
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(name, stop)
  win.addEventListener('blur', stop)
  handle.addEventListener('keydown', (event) => {
    const limits = bounds()
    const height = composer.getBoundingClientRect().height
    const next = { ArrowUp: height + 24, ArrowDown: height - 24, Home: limits.min, End: limits.max }[event.key]
    if (next == null) return
    event.preventDefault()
    setHeight(next)
  })
  win.addEventListener('resize', sync)
  win.visualViewport?.addEventListener('resize', sync)
  if (win.ResizeObserver) {
    const observer = new win.ResizeObserver(sync)
    for (const node of [main, toolbar, composer.querySelector('.composer-divider'), composer.querySelector('.composer-images')]) {
      if (node) observer.observe(node)
    }
  }
  sync()
  return { sync }
}

if (typeof window !== 'undefined') window.ByChatResize = { createComposerResizer }
