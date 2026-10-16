import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { BusinessInput } from '../../core/business/business.service';
import { BusinessForm } from '../business/business-form';
import { OnboardingStore } from './onboarding.store';

@Component({
  selector: 'app-business-step',
  imports: [BusinessForm],
  template: `
    <h2>Business details</h2>
    <p>Tell us about your business. You can edit these later.</p>
    <app-business-form
      [business]="store.business()"
      [saving]="saving()"
      [error]="error()"
      [submitLabel]="store.business() ? 'Save and continue' : 'Create business'"
      (submitted)="save($event)"
    />
  `,
})
export class BusinessStep {
  protected readonly store = inject(OnboardingStore);
  private readonly router = inject(Router);

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected save(input: BusinessInput): void {
    this.saving.set(true);
    this.error.set(null);
    this.store.save(input).subscribe({
      next: () => void this.router.navigate(['/onboarding/questionnaire']),
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err));
        this.saving.set(false);
      },
    });
  }
}
