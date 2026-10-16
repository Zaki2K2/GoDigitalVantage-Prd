import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { QuestionnaireBuilder } from '../questionnaire/questionnaire-builder';
import { OnboardingStore } from './onboarding.store';

/** Step 2: build and publish the questionnaire. Continuing requires a published version. */
@Component({
  selector: 'app-questionnaire-step',
  imports: [QuestionnaireBuilder],
  template: `
    <h2>Feedback questionnaire</h2>
    <p>
      We started you with a few questions. Edit them, then publish so customers can see your form.
    </p>
    @if (store.business(); as b) {
      <app-questionnaire-builder
        [businessId]="b.id"
        [canEdit]="b.role === 'owner'"
        (publishedChange)="published.set($event)"
      />
    }
    @if (error(); as message) {
      <div class="alert" role="alert">{{ message }}</div>
    }
    @if (!published()) {
      <p class="notice">Publish your questionnaire to continue.</p>
    }
    <div class="actions">
      <button type="button" class="btn secondary" [disabled]="busy()" (click)="go('business')">
        Back
      </button>
      <button type="button" class="btn" [disabled]="busy() || !published()" (click)="go('confirm')">
        {{ busy() ? 'Saving…' : 'Continue to review' }}
      </button>
    </div>
  `,
})
export class QuestionnaireStep {
  protected readonly store = inject(OnboardingStore);
  private readonly router = inject(Router);

  protected readonly published = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected go(step: 'business' | 'confirm'): void {
    this.busy.set(true);
    this.error.set(null);
    this.store.setStep(step).subscribe({
      next: () => void this.router.navigate(['/onboarding', step]),
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err));
        this.busy.set(false);
      },
    });
  }
}
