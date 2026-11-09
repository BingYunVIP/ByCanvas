const SIGNATURES = [
  { mime: 'image/png', test: (bytes) => bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a },
  { mime: 'image/jpeg', test: (bytes) => bytes.length >= 3
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { mime: 'image/webp', test: (bytes) => bytes.length >= 12
    && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP' },
];

const UNSUPPORTED_EXTENSIONS = new Set(['heic', 'heif', 'avif', 'svg', 'svgz']);

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function extensionOf(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

function declaredMime(file) {
  return String(file?.type || '').trim().toLowerCase();
}

async function readHeader(file) {
  const blob = file?.slice?.(0, 128);
  if (!blob?.arrayBuffer) return new Uint8Array();
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Validate an image file without trusting the browser's MIME classification.
 * Chrome can return an empty type for a valid local image; the file signature
 * is the final authority, while extensions only help explain the intent.
 */
export async function inspectImageFile(file) {
  if (!file) return { ok: false, reason: 'not-image' };
  const ext = extensionOf(file.name);
  const declared = declaredMime(file);
  let bytes;
  try {
    bytes = await readHeader(file);
  } catch {
    return { ok: false, reason: 'read-failed' };
  }
  const detected = SIGNATURES.find(({ test }) => test(bytes))?.mime || '';
  // The actual bytes win over a missing, generic, or incorrect browser MIME.
  if (detected) return { ok: true, mime: detected };

  const ftyp = bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp' ? ascii(bytes, 8, 12).toLowerCase() : '';
  const svg = /^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(ascii(bytes, 0, bytes.length));
  if (UNSUPPORTED_EXTENSIONS.has(ext) || ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis'].includes(ftyp)
    || svg || declared.startsWith('image/')) return { ok: false, reason: 'unsupported-format' };
  return { ok: false, reason: 'not-image' };
}

export function imageInputMessageKey(result) {
  if (result?.reason === 'unsupported-format') return '不支持的图片格式，请转换为 PNG、JPEG 或 WebP';
  if (result?.reason === 'read-failed') return '图片文件读取失败，请重新选择';
  return '文件不是可识别的 PNG、JPEG 或 WebP 图片';
}

export function imageInputFailure(file, result) {
  return { name: String(file?.name || ''), messageKey: imageInputMessageKey(result) };
}

export function snapshotFileList(fileList) { return Array.from(fileList || []); }

if (typeof window !== 'undefined') {
  window.ByCanvasImageInput = { inspectImageFile, imageInputMessageKey, imageInputFailure, snapshotFileList };
}
