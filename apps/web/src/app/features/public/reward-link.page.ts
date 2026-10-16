import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, input, signal } from '@angular/core';
import { CustomerReward, RewardsApi } from '../../core/rewards/rewards.service';
import { RewardCard } from '../../shared/reward-card';

/** Anonymous page behind the signed reward link a customer receives. */
@Component({
  selector: 'app-reward-link-page',
  imports: [RewardCard],
  template: `
    <div class="relative isolate min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      <div class="glow top-[-9rem] left-1/2 size-[34rem] -translate-x-1/2 bg-brand-500/20"></div>
      <main class="relative mx-auto max-w-md px-4 pt-10 pb-16">
        @switch (state()) {
          @case ('loading') {
            <div class="card" aria-busy="true">
              <div class="skeleton mb-4 h-24 w-full"></div>
              <div class="skeleton h-16 w-full"></div>
              <p role="status" class="sr-only">Loading…</p>
            </div>
          }
          @case ('missing') {
            <div class="card text-center" role="alert">
              <h1 class="mb-2 text-xl font-semibold">This reward link isn’t valid</h1>
              <p class="muted m-0">
                Check the link you were given, or ask the business to share it again.
              </p>
            </div>
          }
          @case ('error') {
            <div class="card text-center" role="alert">
              <h1 class="mb-2 text-xl font-semibold">Something went wrong</h1>
              <p class="muted mt-0 mb-4">We couldn’t load your reward. Try again.</p>
              <button type="button" class="btn" (click)="load()">Try again</button>
            </div>
          }
          @default {
            @if (reward(); as r) {
              <app-reward-card [reward]="r" [businessName]="business()" />
              <p class="muted mt-4 text-center text-theme-xs">
                Show this card, or read out the code, when you pay.
              </p>
            }
          }
        }
      </main>
    </div>
  `,
})
export class RewardLinkPage {
  private readonly api = inject(RewardsApi);
  readonly token = input.required<string>();

  protected readonly reward = signal<CustomerReward | null>(null);
  protected readonly business = signal('');
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');

  constructor() {
    queueMicrotask(() => this.load());
  }

  protected load(): void {
    this.state.set('loading');
    this.api.card(this.token()).subscribe({
      next: (r) => {
        this.reward.set(r.reward);
        this.business.set(r.business.name);
        this.state.set('ready');
      },
      error: (e: unknown) =>
        this.state.set(e instanceof HttpErrorResponse && e.status === 404 ? 'missing' : 'error'),
    });
  }
}
