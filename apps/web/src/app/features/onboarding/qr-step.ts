import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { QrPanel } from '../qr/qr-panel';
import { OnboardingStore } from './onboarding.store';

/** Step 4: get the QR code, then finish. The server verifies everything before completing. */
@Component({
  selector: 'app-qr-step',
  imports: [QrPanel],
  template: `
    <h2>Your QR code</h2>
    <p>
      Print this code or share the link. It points to your feedback form and never changes, even
      when you edit your questionnaire.
    </p>
    @if (store.business(); as b) {
      <app-qr-panel [businessId]="b.id" [businessName]="b.name" (readyChange)="ready.set($event)" />
    }
    @if (error(); as message) {
      <div class="alert" role="alert">{{ message }}</div>
    }
    <div class="actions">
      <button type="button" class="btn secondary" [disabled]="busy()" (click)="back()">Back</button>
      <button type="button" class="btn" [disabled]="busy() || !ready()" (click)="finish()">
        {{ busy() ? 'Finishing…' : 'Finish setup' }}
      </button>
    </div>
  `,
})
export class QrStep {
  protected readonly store = inject(OnboardingStore);
  private readonly router = inject(Router);

  protected readonly ready = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected back(): void {
    this.run(this.store.setStep('confirm'), '/onboarding/confirm');
  }

  protected finish(): void {
    this.run(this.store.finish(), '/');
  }

  private run(op: ReturnType<OnboardingStore['finish']>, url: string): void {
    this.busy.set(true);
    this.error.set(null);
    op.subscribe({
      next: () => void this.router.navigateByUrl(url),
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err));
        this.busy.set(false);
      },
    });
  }
}
