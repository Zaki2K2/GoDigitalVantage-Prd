import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { InstantRewardsApi, InstantReward } from './instant-rewards.api';
import { InstantRewardDetails } from './instant-reward-details';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { Icon } from '../../shared/icon';
@Component({
  selector: 'app-my-rewards-page',
  imports: [DatePipe, RouterLink, InstantRewardDetails, Icon],
  template: ` <main class="page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Account</p>
        <h1>My Rewards</h1>
        <p class="sub">Rewards issued directly to your account email.</p>
      </div>
      <button class="btn secondary sm" (click)="load()" [disabled]="busy()">Refresh</button>
    </header>
    @if (error()) {
      <div class="alert mb-4" role="alert">{{ error() }}</div>
    }
    @if (notice()) {
      <div class="alert mb-4" role="status">{{ notice() }}</div>
    }
    <nav class="mb-5 flex flex-wrap gap-2" aria-label="Reward filters">
      @for (item of ['available', 'claimed', 'expired', 'all']; track item) {
        <button
          class="btn sm"
          [class.secondary]="group() !== item"
          [attr.aria-current]="group() === item ? 'page' : null"
          (click)="choose(item)"
        >
          {{ item === 'all' ? 'All rewards' : item }}
        </button>
      }
    </nav>
    @if (selected(); as r) {
      <button class="btn secondary sm mb-4" (click)="selected.set(null)">Back to rewards</button
      ><app-instant-reward-details [reward]="r" />
      <div class="flex flex-wrap gap-2">
        @if (r.allowedActions.includes('claim')) {
          <button class="btn" [disabled]="busy()" (click)="claim(r)">Claim Reward</button>
        }
        @if (r.allowedActions.includes('request-link')) {
          <button class="btn secondary" [disabled]="busy()" (click)="requestLink(r)">
            Email me a secure reward link
          </button>
        }
      </div>
      <p class="muted mt-3">
        Open the emailed link while signed in with your recipient email. Verification, when
        required, uses a separate one-time email.
      </p>
    } @else {
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        @for (r of rewards(); track r.id) {
          <article class="card">
            <div class="mb-3 flex justify-between gap-2">
              <app-icon name="gift" /><span class="badge brand">{{ r.status }}</span>
            </div>
            <h2>{{ r.title }}</h2>
            <p class="muted mt-2">
              {{ r.rewardValue }} {{ r.rewardType === 'PERCENT_DISCOUNT' ? '%' : r.currency }}
            </p>
            <p class="muted my-3">Expires {{ r.expiresAt | date: 'medium' }}</p>
            <button class="btn secondary sm" (click)="selected.set(r)">View reward</button>
          </article>
        } @empty {
          <p class="card muted">
            {{ busy() ? 'Loading rewards...' : 'No rewards in this category.' }}
          </p>
        }
      </div>
      <footer class="mt-5 flex items-center justify-between">
        <button
          class="btn secondary sm"
          [disabled]="page() <= 1 || busy()"
          (click)="page.set(page() - 1); load()"
        >
          Previous</button
        ><span>Page {{ page() }} of {{ pages() }}</span
        ><button
          class="btn secondary sm"
          [disabled]="page() >= pages() || busy()"
          (click)="page.set(page() + 1); load()"
        >
          Next
        </button>
      </footer>
    }
    <a routerLink="/" class="mt-5 inline-block text-sm">Back to workspace</a>
  </main>`,
})
export class MyRewardsPage implements OnInit {
  private readonly api = inject(InstantRewardsApi);
  protected readonly rewards = signal<InstantReward[]>([]);
  protected readonly selected = signal<InstantReward | null>(null);
  protected readonly group = signal('available');
  protected readonly page = signal(1);
  protected readonly pages = signal(1);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly busy = signal(false);
  private readonly keys = new Map<string, string>();
  ngOnInit() {
    this.load();
  }
  protected choose(group: string) {
    this.group.set(group);
    this.page.set(1);
    this.selected.set(null);
    this.load();
  }
  protected load() {
    this.busy.set(true);
    this.error.set('');
    this.api
      .list({ group: this.group() === 'all' ? '' : this.group(), page: String(this.page()) })
      .subscribe({
        next: (r) => {
          this.rewards.set(r.data);
          this.pages.set(r.pagination.totalPages);
          this.busy.set(false);
        },
        error: (e) => {
          this.error.set(apiErrorMessage(e));
          this.busy.set(false);
        },
      });
  }
  protected claim(r: InstantReward) {
    this.write(r, 'claim', { rewardId: r.id, requestId: this.key(`claim/${r.id}`) });
  }
  protected requestLink(r: InstantReward) {
    this.write(r, `${r.id}/request-link`, { requestId: this.key(`link/${r.id}`), confirm: true });
  }
  private key(name: string) {
    if (!this.keys.has(name)) this.keys.set(name, crypto.randomUUID());
    return this.keys.get(name)!;
  }
  private write(r: InstantReward, path: string, body: object) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.api.write(path, body).subscribe({
      next: (response) => {
        this.selected.set(response.data);
        this.busy.set(false);
        this.notice.set(
          path === 'claim'
            ? 'Reward claimed. Your receipt is shown below.'
            : 'Check your recipient email for the secure reward link.',
        );
        if (path !== 'claim') this.keys.delete(`link/${r.id}`);
      },
      error: (e) => {
        this.error.set(apiErrorMessage(e));
        this.busy.set(false);
      },
    });
  }
}
