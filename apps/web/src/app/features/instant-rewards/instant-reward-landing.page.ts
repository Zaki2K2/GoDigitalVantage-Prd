import { DOCUMENT } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '../../core/auth/auth.service';
import { LoginPage } from '../auth/login.page';
import { InstantRewardsApi, InstantReward } from './instant-rewards.api';
import { InstantRewardDetails } from './instant-reward-details';
@Component({
  selector: 'app-instant-reward-landing',
  imports: [RouterLink, LoginPage, InstantRewardDetails],
  template: ` @if (!auth.isAuthenticated()) {
      <app-login-page [stayOnPage]="true" (signedIn)="open()" />
      <p class="mx-auto my-4 max-w-xl px-6 text-center text-sm">
        Sign in with the email that received this reward. If you need an account,
        <a routerLink="/register">register</a>, then reopen your email link.
      </p>
    } @else {
      <main class="page mx-auto max-w-3xl">
        <header class="page-header">
          <div>
            <p class="eyebrow">Instant Rewards</p>
            <h1>Your reward</h1>
            <p class="sub">Signed in as {{ auth.user()?.email }}</p>
          </div>
          <a routerLink="/my-rewards" class="btn secondary sm">My Rewards</a>
        </header>
        @if (error()) {
          <div class="alert mb-4" role="alert">{{ error() }}</div>
        }
        @if (notice()) {
          <div class="alert mb-4" role="status">{{ notice() }}</div>
        }
        @if (reward(); as r) {
          <app-instant-reward-details [reward]="r" />
          <div class="flex flex-wrap gap-2">
            @if (r.allowedActions.includes('request-verification')) {
              <button class="btn" [disabled]="busy()" (click)="requestVerification()">
                Verify recipient email
              </button>
            }
            @if (r.allowedActions.includes('claim')) {
              <button class="btn" [disabled]="busy()" (click)="claim()">Claim Reward</button>
            }
          </div>
        }
        @if (!reward() && !busy()) {
          <p class="muted">
            Open a valid link from your reward email. You can request a replacement from My Rewards.
          </p>
        }
      </main>
    }`,
})
export class InstantRewardLandingPage {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(InstantRewardsApi);
  private readonly document = inject(DOCUMENT);
  protected readonly reward = signal<InstantReward | null>(null);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly busy = signal(false);
  private token: string | null = null;
  private verification: string | null = null;
  private readonly claimId = crypto.randomUUID();
  private verifyRequestId = crypto.randomUUID();
  constructor() {
    const fragment = new URLSearchParams(this.document.location.hash.slice(1));
    this.token = fragment.get('token');
    this.verification = fragment.get('verify');
    this.document.defaultView?.history.replaceState(null, '', this.document.location.pathname);
    if (this.auth.isAuthenticated()) this.open();
  }
  protected open() {
    if (this.busy()) return;
    this.error.set('');
    if (!this.token && !this.verification) {
      this.error.set('This reward link is missing. Open the link from your email again.');
      return;
    }
    this.busy.set(true);
    this.api
      .write(this.verification ? 'verify' : 'view', { token: this.verification ?? this.token })
      .subscribe({
        next: (r) => {
          this.reward.set(r.data);
          this.busy.set(false);
          if (this.verification) {
            this.verification = null;
            this.notice.set('Email ownership verified. You can now claim your reward.');
          }
        },
        error: (e) => {
          this.error.set(apiErrorMessage(e));
          this.busy.set(false);
        },
      });
  }
  protected requestVerification() {
    if (this.busy() || !this.token) return;
    this.busy.set(true);
    this.error.set('');
    this.api
      .write('request-verification', { token: this.token, requestId: this.verifyRequestId })
      .subscribe({
        next: (r) => {
          this.reward.set(r.data);
          this.busy.set(false);
          this.verifyRequestId = crypto.randomUUID();
          this.notice.set('Verification sent. Open the new email link within 15 minutes.');
        },
        error: (e) => {
          this.error.set(apiErrorMessage(e));
          this.busy.set(false);
        },
      });
  }
  protected claim() {
    if (this.busy() || !this.reward()) return;
    this.busy.set(true);
    this.error.set('');
    this.api
      .write('claim', {
        ...(this.token ? { token: this.token } : { rewardId: this.reward()!.id }),
        requestId: this.claimId,
      })
      .subscribe({
        next: (r) => {
          this.reward.set(r.data);
          this.token = null;
          this.busy.set(false);
          this.notice.set('Reward claimed. Keep your receipt for reference.');
        },
        error: (e) => {
          this.error.set(apiErrorMessage(e));
          this.busy.set(false);
        },
      });
  }
}
