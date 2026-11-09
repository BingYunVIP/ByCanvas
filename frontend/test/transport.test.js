import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRANSPORT_CACHE_TTL_MS,
  isTransportFailure,
  shouldUseDirect,
  writeTransportCache,
} from '../js/transport.js';
import { ApiError, editImage, fetchModels, generateImage, setTransportOverride } from '../js/api.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('expired transport cache is ignored so each browser can re-probe', () => {
  const firstBrowser = storage();
  const secondBrowser = storage();
  const baseUrl = 'https://api.example/v1';
  const now = 1_000_000;

  writeTransportCache(firstBrowser, baseUrl, false, now - TRANSPORT_CACHE_TTL_MS - 1);
  writeTransportCache(secondBrowser, baseUrl, true, now);

  assert.equal(shouldUseDirect({ storage: firstBrowser, baseUrl, now }), true);
  assert.equal(shouldUseDirect({ storage: secondBrowser, baseUrl, now }), true);
});

test('fresh failed cache still selects proxy without affecting another browser', () => {
  const blockedBrowser = storage();
  const healthyBrowser = storage();
  const baseUrl = 'https://api.example/v1';

  writeTransportCache(blockedBrowser, baseUrl, false, 2_000);
  writeTransportCache(healthyBrowser, baseUrl, true, 2_000);

  assert.equal(shouldUseDirect({ storage: blockedBrowser, baseUrl, now: 2_001 }), false);
  assert.equal(shouldUseDirect({ storage: healthyBrowser, baseUrl, now: 2_001 }), true);
});

test('network and CORS failures are eligible for channel fallback', () => {
  assert.equal(isTransportFailure(new TypeError('Failed to fetch')), true);
  assert.equal(isTransportFailure(new DOMException('NetworkError', 'NetworkError')), true);
  assert.equal(isTransportFailure(Object.assign(new Error('no response'), { status: 0 })), false);
  assert.equal(isTransportFailure({ status: 0, transportFailure: true }), true);
  assert.equal(isTransportFailure({ name: 'TypeError', message: 'NetworkError' }), true);
  assert.equal(isTransportFailure({ name: 'ApiError', status: 502 }), false);
  assert.equal(isTransportFailure({ name: 'ApiError', status: 401 }), false);
});

test('image URL download network failure falls back to backend proxy', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = storage();
  setTransportOverride('');
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === 'https://api.example/v1/images/generations') {
      return response(200, { data: [{ url: 'https://cdn.example/generated.png' }] });
    }
    if (String(url) === 'https://cdn.example/generated.png') {
      throw new DOMException('NetworkError', 'NetworkError');
    }
    if (String(url) === '/api/images/generate') {
      return response(200, { images: [{ b64: 'aGVsbG8=', mime: 'image/png' }], usage: null });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const result = await generateImage({ baseUrl: 'https://api.example/v1', apiKey: 'test-key' }, {
      model: 'test-image-model', prompt: 'test',
    });
    assert.equal(result.images.length, 1);
    assert.deepEqual(calls, [
      'https://api.example/v1/images/generations',
      'https://cdn.example/generated.png',
      '/api/images/generate',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
    setTransportOverride('');
  }
});

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

test('model fetch falls back to backend after a direct network failure', async () => {
  const originalFetch = globalThis.fetch;
  const browserStorage = storage();
  globalThis.localStorage = browserStorage;
  setTransportOverride('');
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://api.example/v1/')) throw new TypeError('Failed to fetch');
    if (String(url) === 'file:///root/ByCanvas/frontend/data/model-capabilities.json') return response(200, {});
    if (String(url) === '/api/models') return response(200, [{ id: 'test-chat-model', kind: 'chat' }]);
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const models = await fetchModels({ baseUrl: 'https://api.example/v1', apiKey: 'test-key' });
    assert.deepEqual(models.map((model) => model.id), ['test-chat-model']);
    assert.equal(calls.some((url) => url === '/api/models'), true);
    assert.equal(shouldUseDirect({ storage: browserStorage, baseUrl: 'https://api.example/v1' }), false);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
  }
});

test('image generation falls back after network failure but preserves HTTP errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = storage();
  setTransportOverride('');
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === 'https://api.example/v1/images/generations') throw new TypeError('NetworkError');
    if (String(url) === '/api/images/generate') return response(200, {
      images: [{ b64: 'aGVsbG8=', mime: 'image/png' }], usage: null,
    });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const result = await generateImage({ baseUrl: 'https://api.example/v1', apiKey: 'test-key' }, {
      model: 'test-image-model', prompt: 'test',
    });
    assert.equal(result.images.length, 1);
    assert.deepEqual(calls, ['https://api.example/v1/images/generations', '/api/images/generate']);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
  }

  globalThis.localStorage = storage();
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return response(401, { error: { message: 'unauthorized' } });
  };
  try {
    await assert.rejects(
      generateImage({ baseUrl: 'https://api.example/v1', apiKey: 'test-key' }, { model: 'test-image-model', prompt: 'test' }),
      (error) => error instanceof ApiError && error.status === 401,
    );
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
    setTransportOverride('');
  }
});

test('an empty successful image response is not retried through the proxy', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = storage();
  setTransportOverride('');
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === 'https://api.example/v1/images/generations') return response(200, { data: [] });
    if (String(url) === '/api/images/generate') return response(200, { images: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    await assert.rejects(generateImage({ baseUrl: 'https://api.example/v1', apiKey: 'test-key' }, {
      model: 'test-image-model', prompt: 'test',
    }));
    assert.deepEqual(calls, ['https://api.example/v1/images/generations']);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
    setTransportOverride('');
  }
});

test('reference image upload falls back with multipart payload intact', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.localStorage = storage();
  setTransportOverride('');
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === 'https://api.example/v1/images/edits') throw new TypeError('Failed to fetch');
    if (String(url) === '/api/images/edit') return response(200, { images: [], usage: null });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const file = new File(['sample'], 'reference.png', { type: 'image/png' });
    const result = await editImage({ baseUrl: 'https://api.example/v1', apiKey: 'test-key' }, {
      model: 'test-image-model', prompt: 'edit',
    }, [file]);
    assert.equal(result.images.length, 0);
    assert.deepEqual(calls.map(({ url }) => url), [
      'https://api.example/v1/images/edits', '/api/images/edit',
    ]);
    const form = calls[1].options.body;
    assert.equal(form instanceof FormData, true);
    assert.equal(form.get('images').name, 'reference.png');
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.localStorage;
    setTransportOverride('');
  }
});

test('fake-indexeddb can persist and read a browser setting', async () => {
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  globalThis.BroadcastChannel = undefined;
  try {
    await import('fake-indexeddb/auto');
    const db = await import('../js/db.js');
    await db.setSetting('transport-smoke-test', { value: 'persisted' });
    assert.deepEqual(await db.getSetting('transport-smoke-test'), { value: 'persisted' });
  } finally {
    if (originalBroadcastChannel === undefined) delete globalThis.BroadcastChannel;
    else globalThis.BroadcastChannel = originalBroadcastChannel;
  }
});
