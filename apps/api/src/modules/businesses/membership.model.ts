import { Schema, model } from 'mongoose';

export const MEMBERSHIP_ROLES = ['owner', 'member'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

const membershipSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: MEMBERSHIP_ROLES, required: true },
  },
  { timestamps: true, collection: 'business_memberships' },
);
membershipSchema.index({ businessId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1 });

export const BusinessMembership = model('BusinessMembership', membershipSchema);
