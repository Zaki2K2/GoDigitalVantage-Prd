import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import { INSTANT_REWARD_STATUSES, INSTANT_REWARD_TYPES } from './instant-reward.domain';

const operation = new Schema(
  {
    requestId: String,
    nonce: String,
    tokenExpiresAt: Date,
    providerMessageId: String,
    state: { type: String, enum: ['PENDING', 'ACCEPTED', 'FAILED'] },
    startedAt: Date,
    errorCode: String,
  },
  { _id: false },
);
export interface RewardEvent {
  id: string;
  rewardId: Types.ObjectId | null;
  action: string;
  actorId: Types.ObjectId | null;
  actorType: 'ADMIN' | 'USER' | 'PROVIDER' | 'SYSTEM';
  timestamp: Date;
  metadata: Record<string, unknown>;
}
const eventSchema = new Schema<RewardEvent>(
  {
    id: { type: String, required: true },
    rewardId: { type: Schema.Types.ObjectId, default: null },
    action: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId, default: null },
    actorType: { type: String, enum: ['ADMIN', 'USER', 'PROVIDER', 'SYSTEM'], required: true },
    timestamp: { type: Date, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);
const schema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, default: null },
    recipientUserId: { type: Schema.Types.ObjectId, default: null },
    recipientEmail: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: null },
    rewardType: { type: String, enum: INSTANT_REWARD_TYPES, required: true },
    rewardValue: { type: Number, default: null },
    currency: { type: String, default: null },
    promoCode: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: INSTANT_REWARD_STATUSES, default: 'DRAFT', required: true },
    resumeStatus: { type: String, enum: INSTANT_REWARD_STATUSES, default: null },
    verificationRequired: { type: Boolean, default: true },
    revision: { type: Number, default: 1 },
    createRequestId: { type: String, required: true },
    createFingerprint: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
    expiresAt: { type: Date, required: true },
    sentAt: { type: Date, default: null },
    lastSentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    verifiedAt: { type: Date, default: null },
    claimedAt: { type: Date, default: null },
    disabledAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    verifiedBy: { type: Schema.Types.ObjectId, default: null },
    verifiedEmail: { type: String, default: null },
    claimedBy: { type: Schema.Types.ObjectId, default: null },
    claimRequestId: { type: String, default: null },
    claimReceiptId: { type: String, default: null },
    revokedBy: { type: Schema.Types.ObjectId, default: null },
    revokeReason: { type: String, default: null },
    claimTokenHash: { type: String },
    consumedClaimTokenHash: { type: String },
    claimTokenExpiresAt: { type: Date, default: null },
    verificationTokenHash: { type: String },
    verificationTokenExpiresAt: { type: Date, default: null },
    delivery: { type: operation, default: null },
    verificationDelivery: { type: operation, default: null },
    pendingEvents: { type: [eventSchema], default: [] },
  },
  { timestamps: true, collection: 'instant_rewards' },
);
schema.index({ createdBy: 1, createRequestId: 1 }, { unique: true });
schema.index({ recipientEmail: 1, createdAt: -1 });
schema.index({ recipientUserId: 1, createdAt: -1 });
schema.index({ status: 1, expiresAt: 1 });
schema.index({ createdAt: -1, _id: -1 });
schema.index({ claimTokenHash: 1 }, { unique: true, sparse: true });
schema.index({ consumedClaimTokenHash: 1 }, { unique: true, sparse: true });
schema.index({ verificationTokenHash: 1 }, { unique: true, sparse: true });
schema.index({ 'delivery.providerMessageId': 1 }, { sparse: true });
export type InstantRewardDoc = InferSchemaType<typeof schema> & { _id: Types.ObjectId };
export const InstantReward = model('InstantReward', schema);
const historySchema = new Schema<RewardEvent>(
  { ...eventSchema.obj },
  { collection: 'instant_reward_events' },
);
historySchema.index({ id: 1 }, { unique: true });
historySchema.index({ rewardId: 1, timestamp: -1, _id: -1 });
historySchema.index({ timestamp: -1 });
historySchema.index({ 'metadata.providerMessageId': 1 }, { sparse: true });
export const InstantRewardEvent = model<RewardEvent>('InstantRewardEvent', historySchema);
