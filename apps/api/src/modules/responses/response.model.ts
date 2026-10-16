import { Schema, model, type Types } from 'mongoose';
import { QUESTION_TYPES, type QuestionType } from '../questionnaires/questionnaire.model';

/** Everything needed to display an answer forever, independent of later questionnaire edits. */
export interface AnswerSnapshot {
  questionId: string;
  type: QuestionType;
  label: string;
  required: boolean;
  text: string | null;
  rating: number | null;
  choices: { id: string; label: string }[];
}

export interface ResponseDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  questionnaireId: Types.ObjectId;
  questionnaireVersion: number;
  /** null = anonymous response. */
  contactId: Types.ObjectId | null;
  answers: AnswerSnapshot[];
  /** Value of the first answered rating question (1-5); not a Google review rating. */
  rating: number | null;
  consentSnapshot: {
    reviewRequestSms: boolean;
    marketingSms: boolean;
    wordingVersion: string;
  } | null;
  idempotencyKey: string;
  submittedAt: Date;
}

const answerSchema = new Schema<AnswerSnapshot>(
  {
    questionId: { type: String, required: true },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    label: { type: String, required: true },
    required: { type: Boolean, required: true },
    text: { type: String, default: null },
    rating: { type: Number, default: null },
    choices: {
      type: [new Schema({ id: String, label: String }, { _id: false })],
      default: [],
    },
  },
  { _id: false },
);

/** Insert-only: no module updates or deletes responses. */
const responseSchema = new Schema<ResponseDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    questionnaireId: { type: Schema.Types.ObjectId, ref: 'Questionnaire', required: true },
    questionnaireVersion: { type: Number, required: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', default: null },
    answers: { type: [answerSchema], required: true },
    rating: { type: Number, default: null },
    consentSnapshot: {
      type: new Schema(
        { reviewRequestSms: Boolean, marketingSms: Boolean, wordingVersion: String },
        { _id: false },
      ),
      default: null,
    },
    idempotencyKey: { type: String, required: true },
    submittedAt: { type: Date, required: true },
  },
  { collection: 'responses' },
);
responseSchema.index({ businessId: 1, idempotencyKey: 1 }, { unique: true });
responseSchema.index({ businessId: 1, submittedAt: -1 });
responseSchema.index({ businessId: 1, contactId: 1, submittedAt: -1 });

export const Response = model<ResponseDoc>('Response', responseSchema);
