import { tr } from './i18n-text.js';

/** 在浏览器内转换图片，保留原始像素尺寸；不上传图片。 */
const FORMATS = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp' };

export async function imageMime(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const header = String.fromCharCode(...bytes);
  if (header.startsWith('RIFF') && header.slice(8) === 'WEBP') return 'image/webp';
  return blob.type;
}

async function decode(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(tr("无法读取图片内容")));
      img.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

export async function convertImage(blob, format) {
  const mime = FORMATS[String(format).toLowerCase()];
  if (!mime) throw new Error(tr("请选择 PNG、JPEG 或 WebP 格式"));
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
  if (await imageMime(blob) === mime) return { blob, extension, converted: false };
  const img = await decode(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) throw new Error(tr("浏览器无法转换此图片"));
    // JPEG 不支持透明度，以白色填充，避免透明区域变黑。
    if (mime === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(img, 0, 0);
    const result = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.95));
    if (!result || await imageMime(result) !== mime) throw new Error(tr("当前浏览器不支持导出该格式"));
    return { blob: result, extension, converted: true };
  } finally { img.close?.(); }
}

if (typeof window !== 'undefined') window.ByChatImageExport = { convertImage };
