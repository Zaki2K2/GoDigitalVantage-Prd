import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

export const BUSINESS_STATUSES = ['onboarding', 'active', 'disabled'] as const;
export const ONBOARDING_STEPS = ['business', 'questionnaire', 'confirm', 'qr'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const businessSchema = new Schema(
  {
    adminState: { type: String, enum: ['active', 'suspended', 'archived'], default: 'active' },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createRequestId: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, default: null, lowercase: true, trim: true },
    phone: { type: String, default: null, trim: true },
    address: { type: String, default: null, trim: true },
    logoRef: { type: String, default: null },
    timezone: { type: String, required: true },
    googleReviewUrl: { type: String, default: null },
    slug: { type: String, required: true, unique: true },
    status: { type: String, enum: BUSINESS_STATUSES, default: 'onboarding', required: true },
    onboarding: {
      currentStep: { type: String, enum: ONBOARDING_STEPS, default: 'questionnaire' },
      completedSteps: { type: [{ type: String, enum: ONBOARDING_STEPS }], default: ['business'] },
      completedAt: { type: Date, default: null },
    },
  },
  { timestamps: true, collection: 'businesses' },
);
businessSchema.index({ adminState: 1, createdAt: -1 });
// Repeated submissions of the same create request resolve to one business.
businessSchema.index({ ownerUserId: 1, createRequestId: 1 }, { unique: true });

export type BusinessDoc = InferSchemaType<typeof businessSchema> & { _id: Types.ObjectId };
businessSchema.index({ createdAt: -1, _id: -1 });
export const Business = model('Business', businessSchema);
