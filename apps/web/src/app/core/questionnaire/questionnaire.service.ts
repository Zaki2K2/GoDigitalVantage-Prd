import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export const QUESTION_TYPES = [
  'short_text',
  'long_text',
  'single_choice',
  'multiple_choice',
  'rating',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  single_choice: 'Single choice',
  multiple_choice: 'Multiple choice',
  rating: 'Rating (1–5)',
};

export const isChoiceType = (t: QuestionType): boolean =>
  t === 'single_choice' || t === 'multiple_choice';

export interface Choice {
  id?: string;
  label: string;
}

export interface Question {
  id?: string;
  type: QuestionType;
  label: string;
  helpText: string | null;
  required: boolean;
  choices: Choice[];
}

export interface QuestionnaireContent {
  title: string;
  description: string | null;
  questions: Question[];
}

export interface PublishIssue {
  questionId: string | null;
  field: 'title' | 'questions' | 'label' | 'choices';
  message: string;
}

export interface QuestionnaireView {
  draft: QuestionnaireContent;
  draftRevision: number;
  publishedRevision: number;
  publishedVersion: number;
  hasUnpublishedChanges: boolean;
  issues: PublishIssue[];
  versions: { version: number; publishedAt: string; questionCount: number }[];
}

export interface PublicForm {
  business: {
    name: string;
    slug: string;
    category: string;
    googleReviewUrl: string | null;
    logoUrl?: string | null;
  };
  questionnaire: QuestionnaireContent & { version: number; publishedAt: string };
  consent: {
    wordingVersion: string;
    reviewRequestSms: string;
    marketingSms: string;
    whatsappFollowUp?: string;
  };
}

export interface QrInfo {
  slug: string;
  publicUrl: string;
  published: boolean;
}

const BUSINESSES = '/api/v1/businesses';

@Injectable({ providedIn: 'root' })
export class QuestionnaireApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  get(businessId: string): Observable<QuestionnaireView> {
    return this.http
      .get<{ data: { questionnaire: QuestionnaireView } }>(
        `${BUSINESSES}/${businessId}/questionnaire`,
      )
      .pipe(map((r) => r.data.questionnaire));
  }

  saveDraft(
    businessId: string,
    baseRevision: number,
    content: QuestionnaireContent,
  ): Observable<QuestionnaireView> {
    return this.auth
      .withCsrf(() =>
        this.http.put<{ data: { questionnaire: QuestionnaireView } }>(
          `${BUSINESSES}/${businessId}/questionnaire/draft`,
          { baseRevision, ...content },
        ),
      )
      .pipe(map((r) => r.data.questionnaire));
  }

  publish(businessId: string, expectedRevision: number): Observable<QuestionnaireView> {
    return this.auth
      .withCsrf(() =>
        this.http.post<{ data: { questionnaire: QuestionnaireView } }>(
          `${BUSINESSES}/${businessId}/questionnaire/publish`,
          { expectedRevision },
        ),
      )
      .pipe(map((r) => r.data.questionnaire));
  }

  qr(businessId: string): Observable<QrInfo> {
    return this.http
      .get<{ data: QrInfo }>(`${BUSINESSES}/${businessId}/qr`)
      .pipe(map((r) => r.data));
  }

  /** Anonymous: the currently published form for a public slug. */
  publicForm(slug: string): Observable<PublicForm> {
    return this.http
      .get<{ data: PublicForm }>(`/api/v1/public/${encodeURIComponent(slug)}`)
      .pipe(map((r) => r.data));
  }
}
