// Modules also run in Node tests, where the browser language service is absent.
export function tr(key, ...values) {
  if (globalThis.ByCanvasI18n) return globalThis.ByCanvasI18n.tr(key, ...values)
  return String(key).replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match)
}
