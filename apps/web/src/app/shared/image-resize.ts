export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
/** Largest file the user may pick. It is resized before upload, so the stored size stays small. */
export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
/** Must match the API limit. */
export const MAX_UPLOAD_BYTES = 512 * 1024;

export class ImageError extends Error {}

/**
 * Validates and downsizes a picked file in the browser. Avatars are cropped to a centred square;
 * logos keep their own aspect ratio (and transparency).
 */
export async function prepareImage(file: File, kind: 'avatar' | 'logo'): Promise<Blob> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type))
    throw new ImageError('Choose a PNG, JPG or WebP image.');
  if (file.size > MAX_SOURCE_BYTES) throw new ImageError('Image must be 5 MB or smaller.');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageError('This image could not be read. Try a different file.');
  }

  const max = kind === 'avatar' ? 256 : 512;
  const crop = kind === 'avatar' ? Math.min(bitmap.width, bitmap.height) : null;
  const sw = crop ?? bitmap.width;
  const sh = crop ?? bitmap.height;
  const scale = Math.min(1, max / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageError('This browser cannot process images.');
  ctx.drawImage(
    bitmap,
    crop ? (bitmap.width - sw) / 2 : 0,
    crop ? (bitmap.height - sh) / 2 : 0,
    sw,
    sh,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.9),
  );
  if (!blob || !ACCEPTED_IMAGE_TYPES.includes(blob.type))
    throw new ImageError('This image could not be processed. Try a different file.');
  if (blob.size > MAX_UPLOAD_BYTES) throw new ImageError('Image is too large even after resizing.');
  return blob;
}
