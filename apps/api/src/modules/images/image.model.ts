import { Schema, model } from 'mongoose';

export const IMAGE_OWNER_TYPES = ['user', 'business'] as const;
export type ImageOwnerType = (typeof IMAGE_OWNER_TYPES)[number];

/** One small, client-resized image per user avatar / business logo. Kept out of the owner documents. */
const imageSchema = new Schema(
  {
    ownerType: { type: String, enum: IMAGE_OWNER_TYPES, required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    contentType: { type: String, required: true },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true, collection: 'profile_images' },
);
imageSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });

export const ProfileImage = model('ProfileImage', imageSchema);
