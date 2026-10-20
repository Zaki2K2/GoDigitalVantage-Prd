import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { CustomerReward } from '../rewards/rewards.service';
import { QuestionType } from '../questionnaire/questionnaire.service';

// ---- Public submission -------------------------------------------------------------------------

export interface SubmissionAnswer {
  questionId: string;
  text?: string;
  rating?: number;
  choiceIds?: string[];
}

export interface Submission {
  idempotencyKey: string;
  version: number;
  answers: SubmissionAnswer[];
  contact?: { fullName?: string; email?: string; phone?: string };
  consent?: { reviewRequestSms?: boolean; marketingSms?: boolean };
  /** Honeypot: always left empty by real visitors. */
  website?: string;
}

export interface SubmissionResult {
  responseId: string;
  duplicate: boolean;
  googleReviewUrl: string | null;
  /** Complaint-recovery reward, when one was created for this response. */
  reward: CustomerReward | null;
}

export interface SubmissionIssue {
  questionId: string | null;
  field: string;
  message: string;
}

// ---- Portal views ------------------------------------------------------------------------------

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface Page<T> {
  data: T[];
  pagination: Pagination;
}

export interface ContactBrief {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
}

export interface ResponseItem {
  id: string;
  submittedAt: string;
  rating: number | null;
  questionnaireVersion: number;
  preview: string | null;
  contact: ContactBrief | null;
}

export interface AnswerView {
  questionId: string;
  type: QuestionType;
  label: string;
  required: boolean;
  text: string | null;
  rating: number | null;
  choices: { id: string; label: string }[];
}

export interface ResponseDetail extends ResponseItem {
  answers: AnswerView[];
  consent: { reviewRequestSms: boolean; marketingSms: boolean; wordingVersion: string } | null;
}

export interface ResponseFilters {
  page: number;
  search: string;
  rating: string;
  contact: string;
  from: string;
  to: string;
}

export interface ContactItem extends ContactBrief {
  birthday?: string | null;
  anniversary?: string | null;
  tags?: string[];
  segment?: string | null;
  loyaltyLevel?: string | null;
  responseCount: number;
  firstResponseAt: string;
  lastResponseAt: string;
  consent: { reviewRequestSms: string | null; marketingSms: string | null };
}

export interface ContactDetail {
  marketingEmail?: { state: 'granted' | 'revoked'; at: string } | null;
  contact: ContactItem;
  responses: {
    id: string;
    submittedAt: string;
    rating: number | null;
    questionnaireVersion: number;
  }[];
  consentEvents: {
    id: string;
    purpose: string;
    choice: string;
    wordingVersion: string;
    wordingText: string;
    source: string;
    capturedAt: string;
  }[];
}

export interface Dashboard {
  days: number;
  timezone: string;
  totals: {
    scans: number;
    responses: number;
    contacts: number;
    averageRating: number | null;
    ratedResponses: number;
  };
  /** Rated responses per star; index 0 = 1 star ... index 4 = 5 stars. */
  ratingDistribution: number[];
  trend: { date: string; scans: number; responses: number }[];
  recent: ResponseItem[];
}

const BUSINESSES = '/api/v1/businesses';

@Injectable({ providedIn: 'root' })
export class FeedbackApi {
  private readonly http = inject(HttpClient);

  /** Anonymous: no cookies or CSRF needed. */
  submit(slug: string, body: Submission): Observable<SubmissionResult> {
    return this.http
      .post<{ data: SubmissionResult }>(
        `/api/v1/public/${encodeURIComponent(slug)}/responses`,
        body,
      )
      .pipe(map((r) => r.data));
  }

  /** Anonymous: counts one page visit; failures are ignored by callers. */
  scan(slug: string): Observable<void> {
    return this.http
      .post<void>(`/api/v1/public/${encodeURIComponent(slug)}/scan`, {})
      .pipe(map(() => undefined));
  }

  responses(businessId: string, f: ResponseFilters): Observable<Page<ResponseItem>> {
    let params = new HttpParams().set('page', f.page).set('pageSize', 15);
    if (f.search.trim()) params = params.set('search', f.search.trim());
    if (f.rating) params = params.set('rating', f.rating);
    if (f.contact) params = params.set('contact', f.contact);
    if (f.from) params = params.set('from', new Date(`${f.from}T00:00:00`).toISOString());
    if (f.to) params = params.set('to', new Date(`${f.to}T23:59:59.999`).toISOString());
    return this.http.get<Page<ResponseItem>>(`${BUSINESSES}/${businessId}/responses`, { params });
  }

  response(businessId: string, id: string): Observable<ResponseDetail> {
    return this.http
      .get<{ data: ResponseDetail }>(`${BUSINESSES}/${businessId}/responses/${id}`)
      .pipe(map((r) => r.data));
  }

  contacts(businessId: string, page: number, search: string): Observable<Page<ContactItem>> {
    let params = new HttpParams().set('page', page).set('pageSize', 15);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<Page<ContactItem>>(`${BUSINESSES}/${businessId}/contacts`, { params });
  }

  contact(businessId: string, id: string): Observable<ContactDetail> {
    return this.http
      .get<{ data: ContactDetail }>(`${BUSINESSES}/${businessId}/contacts/${id}`)
      .pipe(map((r) => r.data));
  }

  dashboard(businessId: string, days = 30): Observable<Dashboard> {
    return this.http
      .get<{ data: Dashboard }>(`${BUSINESSES}/${businessId}/dashboard`, {
        params: new HttpParams().set('days', days),
      })
      .pipe(map((r) => r.data));
  }
}
