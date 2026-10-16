import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { Business } from '../../core/business/business.service';
import {
  RewardsApi,
  StaffReward,
  VerifyResult,
  discountLabel,
} from '../../core/rewards/rewards.service';
import { Icon } from '../../shared/icon';
import { requestId as newRequestId } from '../../shared/request-id';

/**
 * Staff verification and redemption. Verify never changes anything; redeem is single-use on the
 * server and safe to retry (the same request id returns the same result).
 */
@Component({
  selector: 'app-rewards-redeem-page',
  imports: [DatePipe, Icon],
  template: `
    <div class="mx-auto max-w-xl">
      <section class="card">
        <h2>Verify a code</h2>
        <p class="muted mt-0 mb-4">
          Ask the customer for their code (or open their reward card) and enter it here.
        </p>
        <form (submit)="$event.preventDefault(); verify()">
          <div class="field">
            <label for="code">Reward code</label>
            <input
              id="code"
              type="text"
              class="font-mono tracking-widest uppercase"
              placeholder="GDV-XXXX-XXXX"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              [value]="code()"
              (input)="onCode(val($event))"
            />
          </div>
          <button type="submit" class="btn" [disabled]="busy() || !code().trim()">
            <app-icon name="search" [size]="16" />
            {{ busy() && !result() ? 'Checking…' : 'Verify' }}
          </button>
        </form>
      </section>

      @if (error(); as m) {
        <div class="alert" role="alert">
          <app-icon name="alert" [size]="18" /><span>{{ m }}</span>
        </div>
      }

      @if (done(); as d) {
        <section class="card text-center" role="status">
          <span
            class="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
            ><app-icon name="check" [size]="28" [stroke]="2.4"
          /></span>
          <h2>Redeemed</h2>
          <p class="muted mt-0 mb-1">{{ label(d) }} · {{ d.code }}</p>
          @if (d.redemption?.discountApplied !== null && d.redemption) {
            <p class="m-0 text-lg font-semibold text-gray-900 dark:text-white">
              Discount to apply: {{ d.discount.currency }} {{ d.redemption.discountApplied }}
            </p>
          } @else {
            <p class="muted m-0">
              No order total entered, so the discount amount was not calculated.
            </p>
          }
          @if (wasDuplicate()) {
            <p class="notice mt-3 mb-0">This request had already been recorded; nothing changed.</p>
          }
          <button type="button" class="btn mt-4" (click)="reset()">Redeem another</button>
        </section>
      } @else if (result(); as r) {
        <section class="card" aria-live="polite">
          <div class="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 class="!mb-1">{{ label(r.reward) }}</h2>
              <p class="muted m-0 font-mono">{{ r.reward.code }}</p>
            </div>
            <span class="badge" [class]="r.redeemable ? 'success' : 'error'">{{
              r.redeemable ? 'Valid' : r.reason
            }}</span>
          </div>
          <dl class="m-0 grid gap-2 text-theme-sm">
            @if (r.reward.expiresAt) {
              <div class="flex justify-between">
                <dt class="text-gray-500 dark:text-gray-400">Valid until</dt>
                <dd class="m-0">{{ r.reward.expiresAt | date: 'mediumDate' }}</dd>
              </div>
            }
            @if (r.reward.discount.minSpend) {
              <div class="flex justify-between">
                <dt class="text-gray-500 dark:text-gray-400">Minimum spend</dt>
                <dd class="m-0">
                  {{ r.reward.discount.currency }} {{ r.reward.discount.minSpend }}
                </dd>
              </div>
            }
            @if (r.reward.discount.maxDiscount) {
              <div class="flex justify-between">
                <dt class="text-gray-500 dark:text-gray-400">Maximum discount</dt>
                <dd class="m-0">
                  {{ r.reward.discount.currency }} {{ r.reward.discount.maxDiscount }}
                </dd>
              </div>
            }
            <div class="flex justify-between">
              <dt class="text-gray-500 dark:text-gray-400">Customer</dt>
              <dd class="m-0">
                {{
                  r.reward.contact
                    ? r.reward.contact.fullName || r.reward.contact.email || r.reward.contact.phone
                    : 'Anonymous'
                }}
              </dd>
            </div>
            @if (r.reward.redemption; as red) {
              <div class="flex justify-between">
                <dt class="text-gray-500 dark:text-gray-400">Redeemed</dt>
                <dd class="m-0">{{ red.at | date: 'medium' }}</dd>
              </div>
            }
          </dl>
          @if (r.redeemable) {
            <form
              class="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800"
              (submit)="$event.preventDefault(); redeem()"
            >
              <div class="field">
                <label for="total"
                  >Order total ({{ r.reward.discount.currency }}){{
                    r.reward.discount.minSpend ? '' : ' (optional)'
                  }}</label
                >
                <input
                  id="total"
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.01"
                  [value]="total()"
                  (input)="total.set(val($event))"
                />
                <span class="hint"
                  >Used to calculate the discount and your cost. Leave blank if unknown.</span
                >
              </div>
              <button type="submit" class="btn block" [disabled]="busy()">
                {{ busy() ? 'Redeeming…' : 'Redeem reward' }}
              </button>
            </form>
          }
        </section>
      }
    </div>
  `,
})
export class RewardsRedeemPage {
  private readonly api = inject(RewardsApi);
  private business: Business | null = null;
  protected readonly code = signal('');
  protected readonly total = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<VerifyResult | null>(null);
  protected readonly done = signal<StaffReward | null>(null);
  protected readonly wasDuplicate = signal(false);
  /** One id per verified reward: a retried redeem can never apply twice. */
  private requestId = newRequestId();

  constructor() {
    this.api.business().subscribe({
      next: (b) => (this.business = b),
      error: (e: unknown) => this.error.set(apiErrorMessage(e)),
    });
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
  protected label(r: StaffReward): string {
    return discountLabel(r.discount);
  }
  protected onCode(v: string): void {
    this.code.set(v);
    this.result.set(null);
    this.error.set(null);
  }

  protected verify(keepError = false): void {
    if (!this.business || this.busy()) return;
    this.busy.set(true);
    if (!keepError) this.error.set(null);
    this.result.set(null);
    this.requestId = newRequestId();
    this.api.verify(this.business.id, this.code()).subscribe({
      next: (r) => {
        this.result.set(r);
        this.busy.set(false);
      },
      error: (e: unknown) => {
        this.error.set(apiErrorMessage(e));
        this.busy.set(false);
      },
    });
  }

  protected redeem(): void {
    const r = this.result();
    if (!this.business || !r || this.busy()) return;
    const raw = this.total().trim();
    const orderTotal = raw === '' ? undefined : Number(raw);
    if (orderTotal !== undefined && !(orderTotal > 0)) {
      this.error.set('Enter a positive order total, or leave it blank.');
      return;
    }
    if (
      r.reward.discount.minSpend !== null &&
      (orderTotal === undefined || orderTotal < r.reward.discount.minSpend)
    ) {
      this.error.set(
        `This reward needs an order of at least ${r.reward.discount.currency} ${r.reward.discount.minSpend}.`,
      );
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.api.redeem(this.business.id, r.reward.code, this.requestId, orderTotal).subscribe({
      next: (res) => {
        this.done.set(res.reward);
        this.wasDuplicate.set(res.duplicate);
        this.busy.set(false);
      },
      error: (e: unknown) => {
        const message = apiErrorMessage(e);
        this.busy.set(false);
        this.verify(true); // refresh the card (e.g. already redeemed), keeping the message
        this.error.set(message);
      },
    });
  }

  protected reset(): void {
    this.code.set('');
    this.total.set('');
    this.result.set(null);
    this.done.set(null);
    this.error.set(null);
    this.wasDuplicate.set(false);
    this.requestId = newRequestId();
    queueMicrotask(() => document.getElementById('code')?.focus());
  }
}
