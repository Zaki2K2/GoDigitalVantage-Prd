import { Schema, model, type Types } from 'mongoose';

export const QUESTION_TYPES = [
  'short_text',
  'long_text',
  'single_choice',
  'multiple_choice',
  'rating',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const CHOICE_TYPES: readonly QuestionType[] = ['single_choice', 'multiple_choice'];

export interface ChoiceData {
  id: string;
  label: string;
}
export interface QuestionData {
  id: string;
  type: QuestionType;
  label: string;
  helpText: string | null;
  required: boolean;
  choices: ChoiceData[];
}
export interface ContentData {
  title: string;
  description: string | null;
  questions: QuestionData[];
}
export interface QuestionnaireDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  draft: ContentData;
  draftRevision: number;
  publishedRevision: number;
  publishedVersion: number;
  versionCounter: number;
}
export interface VersionDoc extends ContentData {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  questionnaireId: Types.ObjectId;
  version: number;
  publishedAt: Date;
  publishedByUserId: Types.ObjectId;
}

const choiceSchema = new Schema<ChoiceData>(
  { id: { type: String, required: true }, label: { type: String, default: '' } },
  { _id: false },
);

const questionSchema = new Schema<QuestionData>(
  {
    id: { type: String, required: true },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    label: { type: String, default: '' },
    helpText: { type: String, default: null },
    required: { type: Boolean, default: false },
    choices: { type: [choiceSchema], default: [] },
  },
  { _id: false },
);

const contentFields = {
  title: { type: String, default: '' },
  description: { type: String, default: null },
  questions: { type: [questionSchema], default: [] },
};

const questionnaireSchema = new Schema<QuestionnaireDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, unique: true },
    draft: { type: new Schema<ContentData>(contentFields, { _id: false }), required: true },
    /** Bumped on every draft save; used for optimistic concurrency. */
    draftRevision: { type: Number, default: 1 },
    /** The draftRevision that was last published (0 = never). */
    publishedRevision: { type: Number, default: 0 },
    /** Latest published version number (0 = none). Public pages serve this version. */
    publishedVersion: { type: Number, default: 0 },
    /** Monotonic allocator for version numbers. */
    versionCounter: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'questionnaires' },
);

/** Published versions are immutable snapshots: never updated, only inserted. */
const versionSchema = new Schema<VersionDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    questionnaireId: { type: Schema.Types.ObjectId, ref: 'Questionnaire', required: true },
    version: { type: Number, required: true },
    ...contentFields,
    publishedAt: { type: Date, required: true },
    publishedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'questionnaire_versions' },
);
versionSchema.index({ questionnaireId: 1, version: 1 }, { unique: true });

export const Questionnaire = model<QuestionnaireDoc>('Questionnaire', questionnaireSchema);
export const QuestionnaireVersion = model<VersionDoc>('QuestionnaireVersion', versionSchema);
