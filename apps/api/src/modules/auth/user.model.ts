import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { imageUrl } from '../images/image-url';

export const USER_STATUSES = ['active', 'disabled'] as const;

const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    emailLowercase: { type: String, required: true, unique: true, lowercase: true, trim: true },
    permissions: { type: [{ type: String, enum: ['instant_rewards:manage'] }], default: [] },
    platformRole: { type: String, enum: ['USER', 'SUPER_ADMIN'], default: 'USER' },
    sessionVersion: { type: Number, default: 0, min: 0 },
    sessionsRevokedAt: { type: Date, default: null },
    avatarUpdatedAt: { type: Date, default: null },
    passwordHash: { type: String, required: true },
    status: { type: String, enum: USER_STATUSES, default: 'active', required: true },
  },
  { timestamps: true, collection: 'users' },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
userSchema.index({ createdAt: -1, _id: -1 });
export const User = model('User', userSchema);

export function toUserDto(u: UserDoc) {
  return {
    id: u._id.toString(),
    fullName: u.fullName,
    email: u.emailLowercase,
    status: u.status,
    permissions: u.permissions ?? [],
    platformRole: u.platformRole ?? 'USER',
    avatarUrl: imageUrl('/api/v1/users/me/avatar', u.avatarUpdatedAt),
  };
}
