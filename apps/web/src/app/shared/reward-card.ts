import { DatePipe } from '@angular/common';
import { Component, input, signal } from '@angular/core';
import { CustomerReward, discountLabel } from '../core/rewards/rewards.service';
import { Icon } from './icon';

const STATUS: Record<string, { label: string; tone: string }> = {
  issued: { label: 'Active', tone: 'success' },
  pending_approval: { label: 'Awaiting approval', tone: 'warn' },
  redeemed: { label: 'Redeemed', tone: '' },
  expired: { label: 'Expired', tone: 'error' },
  cancelled: { label: 'Cancelled', tone: 'error' },
  rejected: { label: 'Not available', tone: 'error' },
};

/**
 * Mobile-first coupon card shown on the thank-you page and the reward link. Works fully offline
 * of third parties: no remote images or fonts are needed to read or copy the code.
 */
@Component({
  selector: 'app-reward-card',
  imports: [DatePipe, Icon],
  template: `
    <article
      class="reward-card overflow-hidden rounded-3xl border border-brand-200 bg-white text-left shadow-theme-lg dark:border-brand-500/30 dark:bg-gray-900"
      aria-label="Your reward"
    >
      <div class="relative bg-gradient-to-br from-brand-600 to-blue-light-600 px-6 py-5 text-white">
        <div class="mb-1 flex items-center justify-between gap-2">
          <span
            class="inline-flex items-center gap-1.5 text-theme-xs font-semibold tracking-wider uppercase opacity-90"
          >
            <app-icon name="gift" [size]="16" /> {{ businessName() }}
          </span>
          <span class="badge" [class]="meta().tone">{{ meta().label }}</span>
        </div>
        <p class="m-0 text-title-sm font-semibold !text-white max-sm:text-2xl">{{ label() }}</p>
        @if (reward().discount.minSpend) {
          <p class="m-0 mt-1 text-theme-sm opacity-90">
            On orders over {{ reward().discount.currency }} {{ reward().discount.minSpend }}
          </p>
        }
      </div>
      <div class="border-b border-dashed border-gray-300 dark:border-gray-700"></div>
      <div class="px-6 py-5">
        @if (reward().code; as code) {
          <p
            class="mb-1.5 text-theme-xs font-medium tracking-wider text-gray-500 uppercase dark:text-gray-400"
          >
            Your code
          </p>
          <div class="flex items-center gap-2">
            <code
              class="code flex-1 rounded-xl bg-gray-100 px-4 py-3 text-center font-mono text-lg font-semibold tracking-wider whitespace-nowrap sm:text-xl sm:tracking-widest text-gray-900 dark:bg-gray-800 dark:text-white"
              >{{ code }}</code
            >
            <button type="button" class="btn secondary" (click)="copy(code)">
              <app-icon [name]="copied() ? 'check' : 'copy'" [size]="16" />
              {{ copied() ? 'Copied' : 'Copy' }}
            </button>
          </div>
          @if (copyFailed()) {
            <p class="mt-2 mb-0 text-theme-sm text-error-600" role="status">
              Copy was blocked. Select the code and copy it by hand.
            </p>
          }
        } @else if (reward().status === 'pending_approval') {
          <p class="m-0 text-theme-sm text-gray-600 dark:text-gray-300">
            Thank you for telling us. The team is reviewing this and your code will appear here once
            it is approved. Keep this page.
          </p>
        } @else {
          <p class="m-0 text-theme-sm text-gray-600 dark:text-gray-300">
            This reward can no longer be used.
          </p>
        }

        <dl class="m-0 mt-4 grid gap-2 text-theme-sm">
          @if (reward().expiresAt; as exp) {
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">
                {{ reward().status === 'expired' ? 'Expired' : 'Valid until' }}
              </dt>
              <dd class="m-0 font-medium text-gray-900 dark:text-white">
                {{ exp | date: 'mediumDate' }}
              </dd>
            </div>
          }
          @if (reward().redeemedAt; as at) {
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Redeemed</dt>
              <dd class="m-0 font-medium text-gray-900 dark:text-white">
                {{ at | date: 'medium' }}
              </dd>
            </div>
          }
          @if (reward().discount.maxDiscount) {
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Maximum discount</dt>
              <dd class="m-0 font-medium text-gray-900 dark:text-white">
                {{ reward().discount.currency }} {{ reward().discount.maxDiscount }}
              </dd>
            </div>
          }
        </dl>

        <p class="terms mt-4 mb-0 text-theme-xs text-gray-500 dark:text-gray-400">
          @if (reward().terms) {
            {{ reward().terms }}
          }
          One use only. No review is required, and this offer does not depend on any review.
        </p>
      </div>
    </article>
  `,
})
export class RewardCard {
  readonly reward = input.required<CustomerReward>();
  readonly businessName = input('');

  protected readonly copied = signal(false);
  protected readonly copyFailed = signal(false);

  protected label(): string {
    return discountLabel(this.reward().discount);
  }

  protected meta(): { label: string; tone: string } {
    return STATUS[this.reward().status] ?? { label: this.reward().status, tone: '' };
  }

  protected async copy(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      this.copyFailed.set(false);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      this.copied.set(false);
      this.copyFailed.set(true);
    }
  }
}
