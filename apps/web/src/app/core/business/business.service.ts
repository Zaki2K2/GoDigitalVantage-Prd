import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export const ONBOARDING_STEPS = ['business', 'questionnaire', 'confirm', 'qr'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface Onboarding {
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  completedAt: string | null;
}

export interface Business {
  id: string;
  name: string;
  category: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  logoRef: string | null;
  timezone: string;
  googleReviewUrl: string | null;
  slug: string;
  status: 'onboarding' | 'active' | 'disabled';
  onboarding: Onboarding;
  role: 'owner' | 'member';
}

/** Editable profile fields. Empty strings are cleared to null by the API. */
export interface BusinessInput {
  name: string;
  category: string;
  email: string;
  phone: string;
  address: string;
  timezone: string;
  googleReviewUrl: string;
}

const API = '/api/v1/businesses';

@Injectable({ providedIn: 'root' })
export class BusinessApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  select(id: string): void {
    try {
      localStorage.setItem(`gdv-business-${this.auth.user()?.id}`, id);
    } catch {
      /* Storage is optional. */
    }
  }

  list(): Observable<Business[]> {
    return this.http.get<{ data: { businesses: Business[] } }>(API).pipe(
      map((r) => {
        const list = [...r.data.businesses];
        try {
          const selected = localStorage.getItem(`gdv-business-${this.auth.user()?.id}`);
          const index = list.findIndex((b) => b.id === selected);
          if (index > 0) list.unshift(...list.splice(index, 1));
        } catch {
          /* Storage is optional. */
        }
        return list;
      }),
    );
  }

  create(input: BusinessInput, createRequestId: string): Observable<Business> {
    return this.auth
      .withCsrf(() =>
        this.http.post<{ data: { business: Business } }>(API, { ...input, createRequestId }),
      )
      .pipe(map((r) => r.data.business));
  }

  update(id: string, input: Partial<BusinessInput>): Observable<Business> {
    return this.auth
      .withCsrf(() => this.http.patch<{ data: { business: Business } }>(`${API}/${id}`, input))
      .pipe(map((r) => r.data.business));
  }

  /** Server-verified completion: needs confirmed details and a published questionnaire. */
  finishOnboarding(id: string): Observable<Business> {
    return this.auth
      .withCsrf(() =>
        this.http.post<{ data: { business: Business } }>(`${API}/${id}/onboarding/finish`, {}),
      )
      .pipe(map((r) => r.data.business));
  }

  updateOnboarding(
    id: string,
    change: { currentStep?: OnboardingStep; completeStep?: 'confirm' },
  ): Observable<Onboarding> {
    return this.auth
      .withCsrf(() =>
        this.http.patch<{ data: { onboarding: Onboarding } }>(`${API}/${id}/onboarding`, change),
      )
      .pipe(map((r) => r.data.onboarding));
  }
}
