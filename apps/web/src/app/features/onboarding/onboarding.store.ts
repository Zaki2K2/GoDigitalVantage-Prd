import { requestId } from '../../shared/request-id';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, of, tap } from 'rxjs';
import {
  Business,
  BusinessApi,
  BusinessInput,
  ONBOARDING_STEPS,
  OnboardingStep,
} from '../../core/business/business.service';

/** Wizard state. Progress lives on the server, so a refresh restores it from there. */
@Injectable()
export class OnboardingStore {
  private readonly api = inject(BusinessApi);

  private readonly _business = signal<Business | null>(null);
  private loaded = false;
  private lastAttempt: { payload: string; requestId: string } | null = null;

  readonly business = this._business.asReadonly();
  readonly currentStep = computed<OnboardingStep>(
    () => this._business()?.onboarding.currentStep ?? 'business',
  );

  /** Loads the user's business once (the UI supports a single business per account). */
  ensureLoaded(): Observable<Business | null> {
    if (this.loaded) return of(this._business());
    return this.api.list().pipe(
      map((list) => list[0] ?? null),
      tap((b) => {
        this._business.set(b);
        this.loaded = true;
      }),
    );
  }

  /** Creates the business, or updates it when it already exists. */
  save(input: BusinessInput): Observable<Business> {
    const existing = this._business();
    const request$ = existing
      ? this.api.update(existing.id, input)
      : this.api.create(input, this.requestIdFor(input));
    return request$.pipe(
      tap((b) => {
        this._business.set(b);
        this.lastAttempt = null;
      }),
    );
  }

  setStep(step: OnboardingStep): Observable<void> {
    return this.change({ currentStep: step });
  }

  confirm(): Observable<void> {
    return this.change({ completeStep: 'confirm' });
  }

  readonly completed = computed(() => !!this._business()?.onboarding.completedAt);

  /** Server verifies the questionnaire is published and details are confirmed. */
  finish(): Observable<void> {
    const business = this._business();
    if (!business) return of(undefined);
    return this.api.finishOnboarding(business.id).pipe(
      tap((b) => this._business.set(b)),
      map(() => undefined),
    );
  }

  canView(step: OnboardingStep): boolean {
    if (step === 'business') return true;
    return (
      this._business() !== null &&
      ONBOARDING_STEPS.indexOf(step) <= ONBOARDING_STEPS.indexOf(this.currentStep())
    );
  }

  private change(change: { currentStep?: OnboardingStep; completeStep?: 'confirm' }) {
    const business = this._business();
    if (!business) return of(undefined);
    return this.api.updateOnboarding(business.id, change).pipe(
      tap((onboarding) => this._business.set({ ...business, onboarding })),
      map(() => undefined),
    );
  }

  /**
   * One id per distinct submission: retrying identical data reuses the id (server de-duplicates),
   * while edited data gets a fresh id so it is never swallowed by an earlier attempt.
   */
  private requestIdFor(input: BusinessInput): string {
    const payload = JSON.stringify(input);
    if (this.lastAttempt?.payload !== payload) {
      this.lastAttempt = { payload, requestId: requestId() };
    }
    return this.lastAttempt.requestId;
  }
}
