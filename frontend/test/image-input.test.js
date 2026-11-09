import test from 'node:test';
import assert from 'node:assert/strict';

import { imageInputFailure, inspectImageFile, snapshotFileList } from '../js/image-input.js';

const PNG_HEADER = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_HEADER = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70]);
const WEBP_HEADER = Uint8Array.from([
  82, 73, 70, 70, 20, 0, 0, 0, 87, 69, 66, 80,
]);

test('accepts a PNG when Chrome leaves File.type empty', async () => {
  const file = new File([PNG_HEADER], 'reference.png', { type: '' });
  assert.deepEqual(await inspectImageFile(file), { ok: true, mime: 'image/png' });
});

test('accepts WebP using its file signature', async () => {
  const file = new File([WEBP_HEADER], 'reference.webp', { type: 'image/webp' });
  assert.deepEqual(await inspectImageFile(file), { ok: true, mime: 'image/webp' });
});

test('uses bytes to correct a mismatched browser MIME and filename extension', async () => {
  const file = new File([PNG_HEADER], 'reference.jpg', { type: 'image/jpeg' });
  assert.deepEqual(await inspectImageFile(file), { ok: true, mime: 'image/png' });
});

test('snapshots a live FileList before the input is cleared', () => {
  const file = new File([PNG_HEADER], 'reference.png', { type: '' });
  const liveList = { 0: file, length: 1, [Symbol.iterator]: function* () { yield this[0]; } };
  const snapshot = snapshotFileList(liveList);
  liveList[0] = undefined;
  liveList.length = 0;
  assert.deepEqual(snapshot, [file]);
});

test('rejects a text file renamed with an image extension', async () => {
  const file = new File(['not an image'], 'reference.png', { type: '' });
  assert.deepEqual(await inspectImageFile(file), { ok: false, reason: 'not-image' });
});

test('rejects HEIC with a format-specific reason', async () => {
  const file = new File(['heic'], 'reference.heic', { type: 'image/heic' });
  assert.deepEqual(await inspectImageFile(file), { ok: false, reason: 'unsupported-format' });
});

test('reports the rejected filename and a clear reason', async () => {
  const file = new File(['<svg></svg>'], 'vector.svg', { type: 'image/svg+xml' });
  const result = await inspectImageFile(file);
  assert.deepEqual(imageInputFailure(file, result), {
    name: 'vector.svg',
    messageKey: '不支持的图片格式，请转换为 PNG、JPEG 或 WebP',
  });
});
