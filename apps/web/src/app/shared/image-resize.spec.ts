import { ImageError, MAX_UPLOAD_BYTES, prepareImage } from './image-resize';

async function pngFile(width: number, height: number, type = 'image/png'): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0ba5ec';
  ctx.fillRect(0, 0, width, height);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type));
  return new File([blob], 'x', { type });
}

async function dimensions(blob: Blob): Promise<[number, number]> {
  const bitmap = await createImageBitmap(blob);
  return [bitmap.width, bitmap.height];
}

describe('prepareImage', () => {
  it('crops avatars to a centred 256px square', async () => {
    const out = await prepareImage(await pngFile(1000, 600), 'avatar');
    expect(await dimensions(out)).toEqual([256, 256]);
    expect(out.size).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
  });

  it('keeps the logo aspect ratio and never upscales', async () => {
    expect(await dimensions(await prepareImage(await pngFile(1200, 600), 'logo'))).toEqual([
      512, 256,
    ]);
    expect(await dimensions(await prepareImage(await pngFile(100, 50), 'logo'))).toEqual([100, 50]);
  });

  it('rejects unsupported types and oversized files', async () => {
    await expectAsync(
      prepareImage(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }), 'logo'),
    ).toBeRejectedWithError(ImageError, /PNG, JPG or WebP/);
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await expectAsync(prepareImage(big, 'logo')).toBeRejectedWithError(ImageError, /5 MB/);
  });

  it('rejects files that are not decodable images', async () => {
    const fake = new File(['not an image'], 'a.png', { type: 'image/png' });
    await expectAsync(prepareImage(fake, 'avatar')).toBeRejectedWithError(ImageError, /read/);
  });
});
