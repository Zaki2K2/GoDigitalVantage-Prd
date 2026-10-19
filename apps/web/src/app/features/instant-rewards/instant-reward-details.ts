import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { InstantReward } from './instant-rewards.api';
@Component({
  selector: 'app-instant-reward-details',
  imports: [DatePipe],
  template: ` <div class="card mb-4">
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2>{{ reward().title }}</h2>
        <p class="muted">{{ reward().rewardType.replaceAll('_', ' ') }}</p>
      </div>
      <span class="badge brand">{{ reward().status }}</span>
    </div>
    @if (reward().description) {
      <p class="mb-4 whitespace-pre-wrap">{{ reward().description }}</p>
    }
    <dl class="grid gap-4 sm:grid-cols-2">
      <div>
        <dt class="muted">Value</dt>
        <dd>
          {{ reward().rewardValue ?? 'See reward terms' }}
          {{ reward().rewardType === 'PERCENT_DISCOUNT' ? '%' : reward().currency }}
        </dd>
      </div>
      <div>
        <dt class="muted">Expires</dt>
        <dd>{{ reward().expiresAt | date: 'medium' }}</dd>
      </div>
      @if (reward().recipientEmail) {
        <div>
          <dt class="muted">Recipient</dt>
          <dd class="break-all">{{ reward().recipientEmail }}</dd>
        </div>
      }
      <div>
        <dt class="muted">Verification</dt>
        <dd>
          {{
            reward().verifiedAt
              ? 'Verified'
              : reward().verificationRequired
                ? 'Required'
                : 'Email link required'
          }}
        </dd>
      </div>
      @if (reward().promoCode) {
        <div>
          <dt class="muted">Reward code</dt>
          <dd>{{ reward().promoCode }}</dd>
        </div>
      }
      @if (reward().claimReceiptId) {
        <div>
          <dt class="muted">Claim receipt</dt>
          <dd class="break-all">{{ reward().claimReceiptId }}</dd>
        </div>
      }
      @if (reward().delivery) {
        <div>
          <dt class="muted">Email delivery</dt>
          <dd>{{ reward().delivery!.state }} {{ reward().delivery!.errorCode }}</dd>
        </div>
      }
      @if (reward().verificationDelivery) {
        <div>
          <dt class="muted">Verification email</dt>
          <dd>
            {{ reward().verificationDelivery!.state }}
            {{ reward().verificationDelivery!.errorCode }}
          </dd>
        </div>
      }
    </dl>
    <h3 class="mt-6 mb-3">Lifecycle history</h3>
    <ol class="grid gap-2 text-sm" aria-label="Reward timeline">
      @for (step of timeline(); track step.label) {
        @if (step.at) {
          <li
            class="flex flex-wrap justify-between gap-2 border-b border-gray-100 py-2 dark:border-gray-800"
          >
            <span>{{ step.label }}</span
            ><time>{{ step.at | date: 'medium' }}</time>
          </li>
        }
      }
    </ol>
  </div>`,
})
export class InstantRewardDetails {
  readonly reward = input.required<InstantReward>();
  protected timeline() {
    const r = this.reward();
    return [
      { label: 'Created', at: r.createdAt },
      { label: 'Sent', at: r.sentAt },
      { label: 'Delivered', at: r.deliveredAt },
      { label: 'Verified', at: r.verifiedAt },
      { label: 'Claimed', at: r.claimedAt },
      { label: 'Disabled', at: r.disabledAt },
      { label: 'Revoked', at: r.revokedAt },
      { label: 'Expiration', at: r.expiresAt },
    ];
  }
}
