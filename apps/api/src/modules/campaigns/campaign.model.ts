import { Schema, model, type Types } from 'mongoose';
import { CAMPAIGN_STATUSES, type CampaignInput } from './campaign.domain';
export interface CampaignDoc extends CampaignInput {
  assignmentKey?: string;
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  ownerType: 'platform' | 'business';
  createdBy: Types.ObjectId;
  status: (typeof CAMPAIGN_STATUSES)[number];
  revision: number;
  allocated: number;
  createdAt: Date;
  updatedAt: Date;
  lastCheckedAt?: Date | null;
  lastAttemptAt?: Date | null;
  lastSuccessAt?: Date | null;
  lastError?: string | null;
}
const schema = new Schema<CampaignDoc>(
  {
    assignmentKey: { type: String },
    businessId: { type: Schema.Types.ObjectId, required: true },
    ownerType: { type: String, enum: ['platform', 'business'], required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: 'draft' },
    revision: { type: Number, default: 0 },
    allocated: { type: Number, default: 0 },
    name: { type: String, required: true },
    description: String,
    campaignType: String,
    audience: { type: Schema.Types.Mixed, required: true },
    trigger: { type: Schema.Types.Mixed, required: true },
    offer: { type: Schema.Types.Mixed, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    timezone: { type: String, required: true },
    channels: [String],
    usageLimit: Number,
    perCustomerLimit: Number,
    priority: Number,
    offerPolicy: { type: String, enum: ['exclusive', 'parallel'], default: 'exclusive' },
    lastCheckedAt: { type: Date, default: null },
    lastAttemptAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true, collection: 'campaigns' },
);
schema.index({ businessId: 1, status: 1, createdAt: -1 });
schema.index({ status: 1, endDate: 1, priority: -1 });
schema.index({ status: 1, startDate: 1, lastCheckedAt: 1 });
schema.index(
  { assignmentKey: 1 },
  { unique: true, partialFilterExpression: { assignmentKey: { $type: 'string' } } },
);
export const Campaign = model<CampaignDoc>('Campaign', schema);
const executionSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, required: true },
    businessId: { type: Schema.Types.ObjectId, required: true },
    window: { type: String, required: true },
    at: { type: Date, required: true },
    cursor: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: ['running', 'completed'], default: 'running' },
    targeted: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'campaign_executions' },
);
executionSchema.index({ campaignId: 1, window: 1 }, { unique: true });
executionSchema.index({ businessId: 1, campaignId: 1, at: -1 });
export const CampaignExecution = model('CampaignExecution', executionSchema);
const recipientSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, required: true },
    businessId: { type: Schema.Types.ObjectId, required: true },
    executionId: { type: Schema.Types.ObjectId, required: true },
    contactId: { type: Schema.Types.ObjectId, required: true },
    window: { type: String, required: true },
    dedupeKey: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'failed', 'skipped', 'reconciliation'],
      default: 'pending',
    },
    rewardId: { type: Schema.Types.ObjectId, default: null },
    providerMessageId: { type: String, default: null },
    startedAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: null },
    errorCode: { type: String, default: null },
    nextAttemptAt: { type: Date, default: null },
    unsubscribeUrl: { type: String, default: null },
    email: { type: String, default: null },
    subject: { type: String, default: null },
    text: { type: String, default: null },
  },
  { timestamps: true, collection: 'campaign_recipients' },
);
recipientSchema.index({ campaignId: 1, dedupeKey: 1 }, { unique: true });
recipientSchema.index({ businessId: 1, campaignId: 1, status: 1 });
recipientSchema.index({ executionId: 1, status: 1 });
recipientSchema.index({ businessId: 1, email: 1, providerMessageId: 1 });
recipientSchema.index({ providerMessageId: 1 });
recipientSchema.index({ status: 1, nextAttemptAt: 1 });
export const CampaignRecipient = model('CampaignRecipient', recipientSchema);
// One worker per campaign. An unknown interrupted operation fails closed until reconciled.
const lockSchema = new Schema(
  { _id: String, token: String, at: Date },
  { collection: 'campaign_locks' },
);
export const CampaignLock = model('CampaignLock', lockSchema);
const templateSchema = new Schema(
  {
    name: { type: String, required: true },
    input: { type: Schema.Types.Mixed, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true, collection: 'campaign_templates' },
);
export const CampaignTemplate = model('CampaignTemplate', templateSchema);
export const CampaignSchedulerState = model(
  'CampaignSchedulerState',
  new Schema(
    { _id: String, startedAt: Date, completedAt: Date, lastError: String, processed: Number },
    { collection: 'campaign_scheduler_state' },
  ),
);
