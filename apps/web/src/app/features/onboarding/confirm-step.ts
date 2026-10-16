import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { Business } from '../../core/business/business.service';
import { OnboardingStore } from './onboarding.store';

@Component({
  selector: 'app-confirm-step',
  template: `
    <h2>Confirm your business</h2>
    <p>Check these details. Your feedback page address is permanent.</p>
    @if (store.business(); as b) {
      <dl
        class="m-0 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800"
      >
        @for (row of rows(b); track row[0]) {
          <div class="grid gap-1 px-4 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
            <dt class="text-theme-sm font-medium text-gray-500 dark:text-gray-400">{{ row[0] }}</dt>
            <dd class="m-0 text-theme-sm break-words text-gray-900 dark:text-white/90">
              {{ row[1] }}
            </dd>
          </div>
        }
      </dl>
    }
    @if (error(); as message) {
      <div class="alert" role="alert">{{ message }}</div>
    }
    <div class="actions">
      <button type="button" class="btn secondary" [disabled]="busy()" (click)="edit()">
        Edit details
      </button>
      <button type="button" class="btn" [disabled]="busy()" (click)="confirm()">
        {{ busy() ? 'Saving…' : 'Confirm details' }}
      </button>
    </div>
  `,
})
export class ConfirmStep {
  protected readonly store = inject(OnboardingStore);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected rows(b: Business): [string, string][] {
    return [
      ['Name', b.name],
      ['Category', b.category],
      ['Email', b.email || '—'],
      ['Phone', b.phone || '—'],
      ['Address', b.address || '—'],
      ['Time zone', b.timezone],
      ['Google review link', b.googleReviewUrl || '—'],
      ['Feedback page', `/r/${b.slug}`],
    ];
  }

  protected edit(): void {
    this.run(this.store.setStep('business'), '/onboarding/business');
  }

  protected confirm(): void {
    this.busy.set(true);
    this.error.set(null);
    this.store.confirm().subscribe({
      next: () => this.run(this.store.setStep('qr'), '/onboarding/qr'),
      error: (err: unknown) => this.fail(err),
    });
  }

  private run(op: ReturnType<OnboardingStore['setStep']>, url: string): void {
    this.busy.set(true);
    this.error.set(null);
    op.subscribe({
      next: () => void this.router.navigateByUrl(url),
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.error.set(apiErrorMessage(err));
    this.busy.set(false);
  }
}
