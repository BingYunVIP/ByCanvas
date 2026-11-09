/**
 * Browser-local transport health state.
 *
 * Each browser profile has its own localStorage, so this state must be treated
 * as a short-lived hint rather than a permanent capability decision. A stale
 * hint is ignored and the next request probes direct access again.
 */

export const TRANSPORT_CACHE_KEY = 'bycanvas.cors';
export const TRANSPORT_CACHE_TTL_MS = 10 * 60 * 1000;

function safeStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

function readCache(storage) {
  const target = safeStorage(storage);
  if (!target) return {};
  try {
    const value = JSON.parse(target.getItem(TRANSPORT_CACHE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function cacheKey(baseUrl) {
  return String(baseUrl || '').trim();
}

export function writeTransportCache(storage, baseUrl, direct, at = Date.now()) {
  const target = safeStorage(storage);
  const key = cacheKey(baseUrl);
  if (!target || !key) return false;
  try {
    const cache = readCache(target);
    cache[key] = { ok: !!direct, at: Number.isFinite(at) ? at : Date.now() };
    target.setItem(TRANSPORT_CACHE_KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}

export function shouldUseDirect({ storage, baseUrl, now = Date.now(), override = '' } = {}) {
  if (override === 'proxy') return false;
  if (override === 'direct') return true;
  const hit = readCache(storage)[cacheKey(baseUrl)];
  if (!hit || typeof hit !== 'object') return true;
  const at = Number(hit.at);
  if (!Number.isFinite(at) || now - at < 0 || now - at >= TRANSPORT_CACHE_TTL_MS) return true;
  return hit.ok !== false;
}

/** Fetch failures that mean the browser could not complete the network path. */
export function isTransportFailure(error) {
  if (!error) return false;
  if (error.name === 'AbortError') return false;
  if (error.name === 'NetworkError') return true;
  if (error instanceof TypeError || error.name === 'TypeError') return true;
  return error.transportFailure === true;
}
