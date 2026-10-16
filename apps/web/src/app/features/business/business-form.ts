import { Component, effect, inject, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Business, BusinessInput } from '../../core/business/business.service';

type Field = keyof BusinessInput;

const CATEGORIES = [
  'Restaurant',
  'Cafe',
  'Retail',
  'Salon & Spa',
  'Health & Wellness',
  'Home Services',
  'Automotive',
  'Other',
];

function timezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
}

/** Business profile form shared by onboarding step 1 and the profile edit screen. */
@Component({
  selector: 'app-business-form',
  imports: [ReactiveFormsModule],
  templateUrl: './business-form.html',
})
export class BusinessForm {
  private readonly fb = inject(FormBuilder).nonNullable;

  readonly business = input<Business | null>(null);
  readonly submitLabel = input('Save');
  readonly saving = input(false);
  readonly error = input<string | null>(null);
  readonly submitted = output<BusinessInput>();

  protected readonly categories = CATEGORIES;
  protected readonly zones = timezones();

  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    category: ['', [Validators.required, Validators.maxLength(80)]],
    email: ['', [Validators.email, Validators.maxLength(254)]],
    phone: ['', [Validators.pattern(/^\+?[0-9 ()\-.]{6,24}$/)]],
    address: ['', [Validators.maxLength(300)]],
    timezone: [Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', [Validators.required]],
    googleReviewUrl: ['', [Validators.pattern(/^https:\/\/\S+$/), Validators.maxLength(500)]],
  });

  constructor() {
    effect(() => {
      const b = this.business();
      if (!b) return;
      this.form.reset({
        name: b.name,
        category: b.category,
        email: b.email ?? '',
        phone: b.phone ?? '',
        address: b.address ?? '',
        timezone: b.timezone,
        googleReviewUrl: b.googleReviewUrl ?? '',
      });
    });
  }

  protected invalid(name: Field): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  protected submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitted.emit(this.form.getRawValue());
  }
}
