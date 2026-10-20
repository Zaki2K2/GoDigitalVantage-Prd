import { AppSelect } from '../../shared/app-select';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { Business } from '../../core/business/business.service';
import {
  RewardRule,
  RewardsApi,
  RuleInput,
  RuleTemplate,
  discountLabel,
} from '../../core/rewards/rewards.service';
import { Icon } from '../../shared/icon';

const opt = (v: string | number | null): number | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : Number(s);
};

/** Reward rules: create from a template or from scratch, edit, enable/disable. Owners only. */
@Component({
  selector: 'app-rewards-rules-page',
  imports: [AppSelect, ReactiveFormsModule, Icon],
  template: `
    @if (error(); as m) {
      <div class="alert" role="alert">
        <app-icon name="alert" [size]="18" /><span>{{ m }}</span>
      </div>
    }
    @if (!isOwner() && business()) {
      <p class="notice">Only the business owner can create or change reward rules.</p>
    }

    @if (isOwner() && !editing()) {
      <section class="card">
        <h2>Start from a template</h2>
        <div class="grid gap-3 md:grid-cols-2">
          @for (t of templates(); track t.id) {
            <button type="button" class="row !items-start text-left" (click)="useTemplate(t)">
              <span class="score"><app-icon name="gift" [size]="18" /></span>
              <span class="main"
                ><strong class="!whitespace-normal">{{ t.name }}</strong
                ><span class="muted !whitespace-normal">{{ t.description }}</span></span
              >
            </button>
          }
          <button type="button" class="row" (click)="startNew()">
            <span class="score"><app-icon name="plus" [size]="18" /></span>
            <span class="main"
              ><strong>Blank rule</strong
              ><span class="muted">Define everything yourself</span></span
            >
          </button>
        </div>
      </section>
    }

    @if (editing()) {
      <section class="card" aria-labelledby="rule-h">
        <h2 id="rule-h">{{ editId() ? 'Edit rule' : 'New rule' }}</h2>
        <form [formGroup]="form" (ngSubmit)="save()" novalidate>
          <div class="grid gap-x-5 sm:grid-cols-2">
            <div class="field sm:col-span-2">
              <label for="r-name">Name</label>
              <input id="r-name" type="text" formControlName="name" [class.invalid]="bad('name')" />
              @if (bad('name')) {
                <span class="error">Give the rule a name.</span>
              }
            </div>
            <div class="field">
              <label for="r-rating">Trigger: rating at or below</label>
              <select appSelect id="r-rating" formControlName="maxRating">
                @for (n of [1, 2, 3, 4, 5]; track n) {
                  <option [ngValue]="n">{{ n }} / 5</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="r-mode">Issuing</label>
              <select appSelect id="r-mode" formControlName="mode">
                <option value="approval">I approve each reward</option>
                <option value="auto">Issue automatically</option>
              </select>
            </div>
            <div class="field">
              <label for="r-type">Discount type</label>
              <select appSelect id="r-type" formControlName="discountType">
                <option value="percent">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </div>
            <div class="field">
              <label for="r-value">{{
                form.controls.discountType.value === 'percent' ? 'Percent off' : 'Amount off'
              }}</label>
              <input
                id="r-value"
                type="number"
                min="0"
                step="0.01"
                formControlName="discountValue"
                [class.invalid]="bad('discountValue')"
              />
              @if (bad('discountValue')) {
                <span class="error">{{
                  form.controls.discountType.value === 'percent'
                    ? 'Enter 1 to 100.'
                    : 'Enter an amount above 0.'
                }}</span>
              }
            </div>
            <div class="field">
              <label for="r-cur">Currency</label>
              <input
                id="r-cur"
                type="text"
                maxlength="3"
                formControlName="currency"
                class="uppercase"
              />
              @if (bad('currency')) {
                <span class="error">Use a 3-letter code, e.g. USD.</span>
              }
            </div>
            <div class="field">
              <label for="r-min">Minimum spend (optional)</label>
              <input id="r-min" type="number" min="0" step="0.01" formControlName="minSpend" />
            </div>
            @if (form.controls.discountType.value === 'percent') {
              <div class="field">
                <label for="r-max">Maximum discount (optional)</label>
                <input id="r-max" type="number" min="0" step="0.01" formControlName="maxDiscount" />
              </div>
            }
            <div class="field">
              <label for="r-valid">Valid for (days)</label>
              <input
                id="r-valid"
                type="number"
                min="1"
                max="365"
                formControlName="validityDays"
                [class.invalid]="bad('validityDays')"
              />
            </div>
            <div class="field">
              <label for="r-cool">One per customer every (days)</label>
              <input
                id="r-cool"
                type="number"
                min="0"
                max="365"
                formControlName="cooldownDays"
                [class.invalid]="bad('cooldownDays')"
              />
              <span class="hint">0 turns the per-customer limit off.</span>
            </div>
            <div class="field">
              <label for="r-tot">Total limit (optional)</label>
              <input id="r-tot" type="number" min="1" formControlName="maxIssuancesTotal" />
            </div>
            <div class="field">
              <label for="r-day">Daily limit (optional)</label>
              <input id="r-day" type="number" min="1" formControlName="maxIssuancesPerDay" />
            </div>
            <div class="field sm:col-span-2">
              <label for="r-terms">Terms shown to the customer</label>
              <textarea id="r-terms" rows="2" maxlength="500" formControlName="terms"></textarea>
              <span class="hint">Rewards never require or depend on a review.</span>
            </div>
          </div>
          <div class="actions">
            <button type="button" class="btn secondary" [disabled]="busy()" (click)="cancel()">
              Cancel
            </button>
            <button type="submit" class="btn" [disabled]="busy()">
              {{ busy() ? 'Saving…' : 'Save rule' }}
            </button>
          </div>
        </form>
      </section>
    }

    @if (loading()) {
      <div class="skeleton h-24 !rounded-2xl"></div>
    } @else if (rules().length === 0 && !editing()) {
      <div class="card empty">
        <app-icon name="gift" [size]="30" />
        <p class="m-0">No rules yet. Pick a template above to start.</p>
      </div>
    } @else {
      <ul class="m-0 list-none p-0" aria-label="Reward rules">
        @for (r of rules(); track r.id) {
          <li class="card !mb-3 !p-4">
            <div class="flex flex-wrap items-center gap-3">
              <div class="min-w-0 flex-1">
                <strong class="text-theme-sm text-gray-900 dark:text-white/90">{{ r.name }}</strong>
                <p class="muted m-0">
                  Rating ≤ {{ r.maxRating }} · {{ label(r) }} ·
                  {{ r.mode === 'auto' ? 'automatic' : 'needs approval' }} · valid
                  {{ r.validityDays }} days
                  @if (r.cooldownDays) {
                    · 1 per customer / {{ r.cooldownDays }}d
                  }
                  @if (r.maxIssuancesTotal) {
                    · max {{ r.maxIssuancesTotal }}
                  }
                  @if (r.maxIssuancesPerDay) {
                    · {{ r.maxIssuancesPerDay }}/day
                  }
                </p>
              </div>
              <span class="badge" [class]="r.enabled ? 'success' : ''">{{
                r.enabled ? 'Enabled' : 'Disabled'
              }}</span>
              @if (isOwner()) {
                <button
                  type="button"
                  class="btn secondary sm"
                  [disabled]="busy()"
                  (click)="toggle(r)"
                >
                  {{ r.enabled ? 'Disable' : 'Enable' }}
                </button>
                <button type="button" class="btn ghost sm" (click)="edit(r)">
                  <app-icon name="edit" [size]="14" /> Edit
                </button>
              }
            </div>
          </li>
        }
      </ul>
    }
  `,
})
export class RewardsRulesPage {
  private readonly api = inject(RewardsApi);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly business = signal<Business | null>(null);
  protected readonly rules = signal<RewardRule[]>([]);
  protected readonly templates = signal<RuleTemplate[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal(false);
  protected readonly editId = signal<string | null>(null);

  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(80)]],
    maxRating: [2],
    mode: ['approval' as 'auto' | 'approval'],
    discountType: ['percent' as 'percent' | 'fixed'],
    discountValue: [10, [Validators.required, Validators.min(0.01)]],
    currency: ['USD', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
    minSpend: [''],
    maxDiscount: [''],
    validityDays: [30, [Validators.required, Validators.min(1), Validators.max(365)]],
    cooldownDays: [30, [Validators.required, Validators.min(0), Validators.max(365)]],
    maxIssuancesTotal: [''],
    maxIssuancesPerDay: [''],
    terms: [''],
  });

  constructor() {
    this.api.business().subscribe({
      next: (b) => {
        this.business.set(b);
        if (!b) return this.loading.set(false);
        this.reload(b.id);
        this.api.templates(b.id).subscribe({ next: (t) => this.templates.set(t) });
      },
      error: (e: unknown) => {
        this.error.set(apiErrorMessage(e));
        this.loading.set(false);
      },
    });
  }

  protected isOwner(): boolean {
    return this.business()?.role === 'owner';
  }
  protected label(r: RewardRule): string {
    return discountLabel({
      type: r.discountType,
      value: r.discountValue,
      currency: r.currency,
      minSpend: r.minSpend,
      maxDiscount: r.maxDiscount,
    });
  }
  protected bad(name: keyof typeof this.form.controls): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  private reload(id: string): void {
    this.api.rules(id).subscribe({
      next: (r) => {
        this.rules.set(r);
        this.loading.set(false);
      },
      error: (e: unknown) => {
        this.error.set(apiErrorMessage(e));
        this.loading.set(false);
      },
    });
  }

  private fill(v: Partial<RuleInput>): void {
    this.form.reset({
      name: v.name ?? '',
      maxRating: v.maxRating ?? 2,
      mode: v.mode ?? 'approval',
      discountType: v.discountType ?? 'percent',
      discountValue: v.discountValue ?? 10,
      currency: v.currency ?? 'USD',
      minSpend: v.minSpend != null ? String(v.minSpend) : '',
      maxDiscount: v.maxDiscount != null ? String(v.maxDiscount) : '',
      validityDays: v.validityDays ?? 30,
      cooldownDays: v.cooldownDays ?? 30,
      maxIssuancesTotal: v.maxIssuancesTotal != null ? String(v.maxIssuancesTotal) : '',
      maxIssuancesPerDay: v.maxIssuancesPerDay != null ? String(v.maxIssuancesPerDay) : '',
      terms: v.terms ?? '',
    });
    this.error.set(null);
    this.editing.set(true);
  }

  protected startNew(): void {
    this.editId.set(null);
    this.fill({});
  }
  protected useTemplate(t: RuleTemplate): void {
    this.editId.set(null);
    this.fill(t.rule);
  }
  protected edit(r: RewardRule): void {
    this.editId.set(r.id);
    this.fill(r);
  }
  protected cancel(): void {
    this.editing.set(false);
  }

  protected save(): void {
    const b = this.business();
    const v = this.form.getRawValue();
    if (!b || this.busy()) return;
    if (v.discountType === 'percent' && v.discountValue > 100)
      this.form.controls.discountValue.setErrors({ max: true });
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const body: Partial<RuleInput> = {
      name: v.name.trim(),
      maxRating: Number(v.maxRating),
      mode: v.mode,
      discountType: v.discountType,
      discountValue: Number(v.discountValue),
      currency: v.currency.toUpperCase(),
      minSpend: opt(v.minSpend),
      maxDiscount: v.discountType === 'percent' ? opt(v.maxDiscount) : null,
      validityDays: Number(v.validityDays),
      cooldownDays: Number(v.cooldownDays),
      maxIssuancesTotal: opt(v.maxIssuancesTotal),
      maxIssuancesPerDay: opt(v.maxIssuancesPerDay),
      terms: v.terms.trim(),
    };
    this.busy.set(true);
    this.error.set(null);
    const id = this.editId();
    (id ? this.api.updateRule(b.id, id, body) : this.api.createRule(b.id, body)).subscribe({
      next: () => {
        this.busy.set(false);
        this.editing.set(false);
        this.reload(b.id);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(e));
      },
    });
  }

  protected toggle(r: RewardRule): void {
    const b = this.business();
    if (!b) return;
    this.busy.set(true);
    this.api.updateRule(b.id, r.id, { enabled: !r.enabled }).subscribe({
      next: () => {
        this.busy.set(false);
        this.reload(b.id);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(e));
      },
    });
  }
}
