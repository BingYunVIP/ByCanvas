import { tr } from './i18n-text.js'

export class StorageConflictError extends Error {
  constructor() {
    super(tr('此内容已在其他标签页修改，请刷新后重试；当前未保存的修改仍保留在本页。'))
    this.name = 'StorageConflictError'
  }
}

export const cloneState = (value) => value === undefined ? undefined : structuredClone(value)
export function equalState(a, b) {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equalState(a[key], b[key]))
}
const object = (value) => value != null && typeof value === 'object' && !Array.isArray(value)

// Untouched fields come from storage. Concurrent edits to the same scalar are
// reported instead of silently discarding either tab's work.
export function mergeState(base, local, remote) {
  if (equalState(local, base) || equalState(local, remote)) return cloneState(remote)
  if (equalState(remote, base)) return cloneState(local)
  if (Array.isArray(local) && Array.isArray(remote) && (base === undefined || Array.isArray(base))) {
    const all = [...(base || []), ...local, ...remote]
    const key = ['id', 'key'].find((field) => all.every((item) => object(item) && item[field] != null))
    if (key) {
      const map = (items) => new Map((items || []).map((item) => [item[key], item]))
      const before = map(base), ours = map(local), theirs = map(remote)
      const result = []
      for (const id of new Set([...theirs.keys(), ...ours.keys()])) {
        if (before.has(id) && (!ours.has(id) || !theirs.has(id))) continue
        const value = mergeState(before.get(id), ours.get(id), theirs.get(id))
        if (value !== undefined) result.push(value)
      }
      return result
    }
  }
  if (object(local) && object(remote) && (base === undefined || object(base))) {
    const result = {}
    for (const key of new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeState(base?.[key], local[key], remote[key])
      if (value !== undefined) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true })
    }
    return result
  }
  throw new StorageConflictError()
}
