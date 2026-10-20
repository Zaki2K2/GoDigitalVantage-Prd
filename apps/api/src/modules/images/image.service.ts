import { Types } from 'mongoose';
import { AppError, notFound } from '../../shared/errors';
import { User } from '../auth/user.model';
import { Business } from '../businesses/business.model';
import { ProfileImage, type ImageOwnerType } from './image.model';

/** The web app resizes to <=512px first, so real uploads are a few tens of KB. */
export const MAX_IMAGE_BYTES = 512 * 1024;
export const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Never trust the declared type: the bytes must match a supported raster format (no SVG). */
function sniff(buf: Buffer): ImageContentType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

export function validateImage(body: unknown): { data: Buffer; contentType: ImageContentType } {
  if (!Buffer.isBuffer(body) || body.length === 0)
    throw new AppError(
      415,
      'UNSUPPORTED_IMAGE',
      'Upload a PNG, JPEG or WebP image as the request body',
    );
  if (body.length > MAX_IMAGE_BYTES)
    throw new AppError(413, 'IMAGE_TOO_LARGE', 'Image must be 512 KB or smaller');
  const contentType = sniff(body);
  if (!contentType)
    throw new AppError(415, 'UNSUPPORTED_IMAGE', 'Only PNG, JPEG or WebP images are supported');
  return { data: body, contentType };
}

async function stamp(ownerType: ImageOwnerType, ownerId: string, at: Date | null) {
  const res =
    ownerType === 'user'
      ? await User.updateOne({ _id: ownerId }, { $set: { avatarUpdatedAt: at } })
      : await Business.updateOne({ _id: ownerId }, { $set: { logoUpdatedAt: at } });
  if (res.matchedCount === 0) throw notFound('Not found');
}

export async function saveImage(ownerType: ImageOwnerType, ownerId: string, body: unknown) {
  const { data, contentType } = validateImage(body);
  await ProfileImage.updateOne(
    { ownerType, ownerId: new Types.ObjectId(ownerId) },
    { $set: { contentType, data, size: data.length } },
    { upsert: true },
  );
  const at = new Date();
  await stamp(ownerType, ownerId, at);
  return at;
}

export async function removeImage(ownerType: ImageOwnerType, ownerId: string) {
  await stamp(ownerType, ownerId, null);
  await ProfileImage.deleteOne({ ownerType, ownerId: new Types.ObjectId(ownerId) });
}

export async function loadImage(ownerType: ImageOwnerType, ownerId: string) {
  const image = await ProfileImage.findOne(
    { ownerType, ownerId: new Types.ObjectId(ownerId) },
    { contentType: 1, data: 1 },
  );
  if (!image) throw notFound('No image');
  return { contentType: image.contentType, data: Buffer.from(image.data) };
}
