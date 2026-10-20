import { Schema, model, type Types } from 'mongoose';

export const DISCOUNT_TYPES = ['percent', 'fixed'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];
export const RULE_MODES = ['auto', 'approval'] as const;
export type RuleMode = (typeof RULE_MODES)[number];

/** A business-defined promo rule (also the "template" owners create rewards from). */
export interface RewardRuleDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  name: string;
  enabled: boolean;
  /** Triggers for survey ratings at or below this value (1-5). */
  maxRating: number;
  mode: RuleMode;
  discountType: DiscountType;
  discountValue: number;
  currency: string;
  minSpend: number | null;
  /** Percent rewards only: cap on the discount amount. */
  maxDiscount: number | null;
  validityDays: number;
  /** One reward per customer identity within this window (0 = no limit). */
  cooldownDays: number;
  maxIssuancesTotal: number | null;
  maxIssuancesPerDay: number | null;
  terms: string;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ruleSchema = new Schema<RewardRuleDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    name: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    maxRating: { type: Number, required: true },
    mode: { type: String, enum: RULE_MODES, required: true },
    discountType: { type: String, enum: DISCOUNT_TYPES, required: true },
    discountValue: { type: Number, required: true },
    currency: { type: String, required: true },
    minSpend: { type: Number, default: null },
    maxDiscount: { type: Number, default: null },
    validityDays: { type: Number, required: true },
    cooldownDays: { type: Number, required: true },
    maxIssuancesTotal: { type: Number, default: null },
    maxIssuancesPerDay: { type: Number, default: null },
    terms: { type: String, default: '' },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'reward_rules' },
);
ruleSchema.index({ businessId: 1, enabled: 1, maxRating: 1 });

export const RewardRule = model<RewardRuleDoc>('RewardRule', ruleSchema);

export const INCIDENT_STATUSES = [
  'open',
  'reward_pending',
  'reward_issued',
  'no_reward',
  'resolved',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** A low-rated response that matched an enabled rule. One per response. */
export interface IncidentDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  responseId: Types.ObjectId;
  contactId: Types.ObjectId | null;
  rating: number;
  ruleId: Types.ObjectId | null;
  status: IncidentStatus;
  /** Why no reward was created (cooldown, limit, ...). */
  reason: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const incidentSchema = new Schema<IncidentDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    responseId: { type: Schema.Types.ObjectId, ref: 'Response', required: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', default: null },
    rating: { type: Number, required: true },
    ruleId: { type: Schema.Types.ObjectId, ref: 'RewardRule', default: null },
    status: { type: String, enum: INCIDENT_STATUSES, required: true },
    reason: { type: String, default: null },
    note: { type: String, default: null },
  },
  { timestamps: true, collection: 'incidents' },
);
incidentSchema.index({ businessId: 1, responseId: 1 }, { unique: true });
incidentSchema.index({ businessId: 1, status: 1, createdAt: -1 });

export const Incident = model<IncidentDoc>('Incident', incidentSchema);

export const REWARD_STATUSES = [
  'pending_approval',
  'issued',
  'redeemed',
  'cancelled',
  'rejected',
] as const;
export type RewardStatus = (typeof REWARD_STATUSES)[number];

export interface RewardDoc {
  campaignRecipientId?: Types.ObjectId | null;
  campaignId?: Types.ObjectId | null;
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  ruleId: Types.ObjectId | null;
  ruleName: string;
  incidentId: Types.ObjectId | null;
  responseId: Types.ObjectId | null;
  contactId: Types.ObjectId | null;
  /** Secret-ish coupon code, unique per business. */
  code: string;
  /** Stored status. "expired" is derived at read time from `expiresAt`. */
  status: RewardStatus;
  /** Snapshot of the rule at issuance: later rule edits never change issued rewards. */
  discountType: DiscountType;
  discountValue: number;
  currency: string;
  minSpend: number | null;
  maxDiscount: number | null;
  validityDays: number;
  terms: string;
  /** HMAC of the customer identity (phone/email, or ip+UA for anonymous). Never the raw value. */
  identityHash: string;
  issuedAt: Date | null;
  expiresAt: Date | null;
  decidedByUserId: Types.ObjectId | null;
  decisionNote: string | null;
  deliveries: { method: string; at: Date; byUserId: Types.ObjectId }[];
  redemption: {
    orderId?: string | null;
    at: Date;
    byUserId: Types.ObjectId;
    requestId: string;
    orderTotal: number | null;
    discountApplied: number | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const rewardSchema = new Schema<RewardDoc>(
  {
    campaignRecipientId: { type: Schema.Types.ObjectId, default: null },
    campaignId: { type: Schema.Types.ObjectId, default: null },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    ruleId: { type: Schema.Types.ObjectId, ref: 'RewardRule', default: null },
    ruleName: { type: String, required: true },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', default: null },
    responseId: { type: Schema.Types.ObjectId, ref: 'Response', default: null },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', default: null },
    code: { type: String, required: true },
    status: { type: String, enum: REWARD_STATUSES, required: true },
    discountType: { type: String, enum: DISCOUNT_TYPES, required: true },
    discountValue: { type: Number, required: true },
    currency: { type: String, required: true },
    minSpend: { type: Number, default: null },
    maxDiscount: { type: Number, default: null },
    validityDays: { type: Number, required: true },
    terms: { type: String, default: '' },
    identityHash: { type: String, required: true },
    issuedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decisionNote: { type: String, default: null },
    deliveries: {
      type: [
        new Schema(
          {
            method: String,
            at: Date,
            byUserId: { type: Schema.Types.ObjectId, ref: 'User' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    redemption: {
      type: new Schema(
        {
          at: Date,
          byUserId: { type: Schema.Types.ObjectId, ref: 'User' },
          requestId: String,
          orderId: { type: String, default: null },
          orderTotal: { type: Number, default: null },
          discountApplied: { type: Number, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true, collection: 'rewards' },
);
// One reward per response: this is what stops repeated submissions of one response from stacking.
rewardSchema.index(
  { businessId: 1, responseId: 1 },
  {
    name: 'business_response_unique',
    unique: true,
    partialFilterExpression: { responseId: { $type: 'objectId' } },
  },
);
rewardSchema.index(
  { businessId: 1, campaignRecipientId: 1 },
  { unique: true, partialFilterExpression: { campaignRecipientId: { $type: 'objectId' } } },
);
rewardSchema.index({ businessId: 1, code: 1 }, { unique: true });
rewardSchema.index({ businessId: 1, status: 1, createdAt: -1 });
rewardSchema.index({ businessId: 1, identityHash: 1, createdAt: -1 });

rewardSchema.index({ createdAt: -1, _id: -1 });
export const Reward = model<RewardDoc>('Reward', rewardSchema);
const orderSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, required: true },
    orderId: { type: String, required: true },
    rewardId: { type: Schema.Types.ObjectId, required: true },
    requestId: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { collection: 'reward_order_claims' },
);
orderSchema.index({ businessId: 1, orderId: 1 }, { unique: true });
orderSchema.index({ businessId: 1, rewardId: 1 }, { unique: true });
export const RewardOrderClaim = model('RewardOrderClaim', orderSchema);

/** Atomic counters for caps and cooldown windows (unique key + conditional upsert). */
const quotaSchema = new Schema<{ key: string; count: number }>(
  { key: { type: String, required: true, unique: true }, count: { type: Number, default: 0 } },
  { collection: 'reward_quotas' },
);
export const RewardQuota = model('RewardQuota', quotaSchema);

/** Insert-only history of every rule and reward decision. */
export interface RewardAuditDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  ruleId: Types.ObjectId | null;
  rewardId: Types.ObjectId | null;
  incidentId: Types.ObjectId | null;
  actorUserId: Types.ObjectId | null;
  action: string;
  details: Record<string, unknown>;
  at: Date;
}
const auditSchema = new Schema<RewardAuditDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, required: true },
    ruleId: { type: Schema.Types.ObjectId, default: null },
    rewardId: { type: Schema.Types.ObjectId, default: null },
    incidentId: { type: Schema.Types.ObjectId, default: null },
    actorUserId: { type: Schema.Types.ObjectId, default: null },
    action: { type: String, required: true },
    details: { type: Schema.Types.Mixed, default: {} },
    at: { type: Date, required: true },
  },
  { collection: 'reward_audit' },
);
auditSchema.index({ businessId: 1, at: -1 });
auditSchema.index({ businessId: 1, rewardId: 1, at: 1 });
export const RewardAudit = model<RewardAuditDoc>('RewardAudit', auditSchema);
