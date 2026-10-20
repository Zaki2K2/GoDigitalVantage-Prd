import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, defer, finalize, map, shareReplay, tap } from 'rxjs';
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
  /** Versioned URL of the optional logo; null/absent when none is set. */
  logoUrl?: string | null;
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

/** How long a settled list response is reused. Concurrent callers always share one request. */
const LIST_TTL_MS = 3000;

interface ListEntry {
  userId: string | undefined;
  /** `null` while the request is still in flight. */
  settledAt: number | null;
  data$: Observable<Business[]>;
}

@Injectable({ providedIn: 'root' })
export class BusinessApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private listEntry: ListEntry | null = null;
  /** Logo changes made this session, so the shell updates without refetching the list. */
  readonly logoOverrides = signal<Record<string, string | null>>({});

  select(id: string): void {
    try {
      localStorage.setItem(`gdv-business-${this.auth.user()?.id}`, id);
    } catch {
      /* Storage is optional. */
    }
  }

  setLogo(businessId: string, logoUrl: string | null): void {
    this.logoOverrides.update((all) => ({ ...all, [businessId]: logoUrl }));
    this.invalidate();
  }

  /** Drops the shared list so the next `list()` reads fresh data from the server. */
  invalidate(): void {
    this.listEntry = null;
  }

  /**
   * One request serves the route guard, shell and page that all ask on the same navigation. The
   * cache is per signed-in user, short-lived, cleared after any business mutation, and a failed
   * request is never reused. The caller-specific selected-business order is applied on read.
   */
  list(): Observable<Business[]> {
    return defer(() => this.shared()).pipe(map((raw) => this.selectedFirst(raw)));
  }

  private shared(): Observable<Business[]> {
    const userId = this.auth.user()?.id;
    const entry = this.listEntry;
    if (
      entry &&
      entry.userId === userId &&
      (entry.settledAt === null || Date.now() - entry.settledAt < LIST_TTL_MS)
    ) {
      return entry.data$;
    }
    const fresh: ListEntry = {
      userId,
      settledAt: null,
      data$: this.http.get<{ data: { businesses: Business[] } }>(API).pipe(
        map((r) => r.data.businesses),
        tap({
          next: () => (fresh.settledAt = Date.now()),
          error: () => {
            if (this.listEntry === fresh) this.listEntry = null;
          },
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      ),
    };
    this.listEntry = fresh;
    return fresh.data$;
  }

  private selectedFirst(raw: Business[]): Business[] {
    const list = [...raw];
    try {
      const selected = localStorage.getItem(`gdv-business-${this.auth.user()?.id}`);
      const index = list.findIndex((b) => b.id === selected);
      if (index > 0) list.unshift(...list.splice(index, 1));
    } catch {
      /* Storage is optional. */
    }
    return list;
  }

  create(input: BusinessInput, createRequestId: string): Observable<Business> {
    return this.auth
      .withCsrf(() =>
        this.http.post<{ data: { business: Business } }>(API, { ...input, createRequestId }),
      )
      .pipe(
        map((r) => r.data.business),
        finalize(() => this.invalidate()),
      );
  }

  update(id: string, input: Partial<BusinessInput>): Observable<Business> {
    return this.auth
      .withCsrf(() => this.http.patch<{ data: { business: Business } }>(`${API}/${id}`, input))
      .pipe(
        map((r) => r.data.business),
        finalize(() => this.invalidate()),
      );
  }

  /** Server-verified completion: needs confirmed details and a published questionnaire. */
  finishOnboarding(id: string): Observable<Business> {
    return this.auth
      .withCsrf(() =>
        this.http.post<{ data: { business: Business } }>(`${API}/${id}/onboarding/finish`, {}),
      )
      .pipe(
        map((r) => r.data.business),
        finalize(() => this.invalidate()),
      );
  }

  updateOnboarding(
    id: string,
    change: { currentStep?: OnboardingStep; completeStep?: 'confirm' },
  ): Observable<Onboarding> {
    return this.auth
      .withCsrf(() =>
        this.http.patch<{ data: { onboarding: Onboarding } }>(`${API}/${id}/onboarding`, change),
      )
      .pipe(
        map((r) => r.data.onboarding),
        finalize(() => this.invalidate()),
      );
  }
}
