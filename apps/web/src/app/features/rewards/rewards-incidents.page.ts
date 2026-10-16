import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { Business } from '../../core/business/business.service';
import { Pagination } from '../../core/feedback/feedback.service';
import { Incident, RewardRule, RewardsApi } from '../../core/rewards/rewards.service';
import { Icon } from '../../shared/icon';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'reward_pending', label: 'Awaiting approval' },
  { value: 'reward_issued', label: 'Reward issued' },
  { value: 'no_reward', label: 'No reward' },
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
];
const TEXT: Record<string, string> = {
  open: 'Open',
  reward_pending: 'Awaiting approval',
  reward_issued: 'Reward issued',
  no_reward: 'No reward',
  resolved: 'Resolved',
};
const TONE: Record<string, string> = {
  open: 'warn',
  reward_pending: 'warn',
  reward_issued: 'success',
  no_reward: 'error',
  resolved: 'brand',
};
const REASON: Record<string, string> = {
  cooldown: 'This customer already received a reward recently.',
  limit: 'The rule’s issuance limit was reached.',
  rejected: 'The reward was rejected.',
};

/** Complaint log: every low rating that matched a rule, with its outcome. */
@Component({
  selector: 'app-rewards-incidents-page',
  imports: [DatePipe, RouterLink, Icon],
  template: `
    <div class="segmented mb-4 flex-wrap" role="tablist" aria-label="Complaint status">
      @for (f of filters; track f.value) {
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="status() === f.value"
          (click)="setStatus(f.value)"
        >
          {{ f.label }}
        </button>
      }
    </div>
    @if (error(); as m) {
      <div class="alert" role="alert">
        <app-icon name="alert" [size]="18" /><span>{{ m }}</span>
      </div>
    }
    @if (loading()) {
      <div class="flex flex-col gap-2" role="status" aria-label="Loading complaints">
        @for (i of [1, 2, 3]; track i) {
          <div class="skeleton h-20 !rounded-xl"></div>
        }
      </div>
    } @else if (items().length === 0 && !error()) {
      <div class="card empty">
        <app-icon name="responses" [size]="30" />
        <strong class="text-gray-800 dark:text-white/90">No complaints</strong>
        <p class="m-0">Low ratings that match a reward rule are listed here.</p>
        <a class="btn secondary mt-2" routerLink="/rewards/rules">Review rules</a>
      </div>
    } @else {
      <ul class="rows" aria-label="Complaints">
        @for (i of items(); track i.id) {
          <li class="card !mb-2 !p-4">
            <div class="flex flex-wrap items-center gap-3">
              <span
                class="score inline-flex size-9 items-center justify-center rounded-lg bg-warning-50 text-sm font-semibold text-warning-700 dark:bg-warning-500/15 dark:text-warning-400"
                >{{ i.rating }}</span
              >
              <div class="min-w-0 flex-1">
                <strong class="text-theme-sm text-gray-900 dark:text-white/90">{{
                  i.contact
                    ? i.contact.fullName || i.contact.email || i.contact.phone
                    : 'Anonymous customer'
                }}</strong>
                <p class="muted m-0">
                  {{ i.createdAt | date: 'medium' }}
                  @if (i.reason) {
                    · {{ reason(i.reason) }}
                  }
                </p>
              </div>
              <span class="badge" [class]="tone(i.status)">{{ text(i.status) }}</span>
              <a class="btn ghost sm" routerLink="/responses">See answers</a>
              @if (isOwner()) {
                @if (i.status === 'no_reward' || i.status === 'open') {
                  <button type="button" class="btn secondary sm" (click)="startIssue(i)">
                    <app-icon name="gift" [size]="14" /> Issue reward
                  </button>
                }
                @if (i.status !== 'resolved') {
                  <button
                    type="button"
                    class="btn ghost sm"
                    [disabled]="busy()"
                    (click)="resolve(i)"
                  >
                    Mark resolved
                  </button>
                }
              }
            </div>
            @if (issuing()?.id === i.id) {
              <div
                class="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3 dark:border-gray-800"
              >
                <div class="field !mb-0 min-w-56 flex-1">
                  <label [for]="'rule-' + i.id">Reward rule</label>
                  <select
                    [id]="'rule-' + i.id"
                    [value]="ruleId()"
                    (change)="ruleId.set(val($event))"
                  >
                    @for (r of rules(); track r.id) {
                      <option [value]="r.id">{{ r.name }}</option>
                    }
                  </select>
                </div>
                <button
                  type="button"
                  class="btn"
                  [disabled]="busy() || !ruleId()"
                  (click)="issue(i)"
                >
                  Issue now
                </button>
                <button type="button" class="btn secondary" (click)="issuing.set(null)">
                  Cancel
                </button>
              </div>
              @if (rules().length === 0) {
                <p class="notice mt-3 mb-0">Create a reward rule first on the Rules tab.</p>
              }
            }
          </li>
        }
      </ul>
      @if (pagination(); as p) {
        <nav class="pager" aria-label="Pagination">
          <button
            type="button"
            class="btn secondary sm"
            [disabled]="p.page <= 1"
            (click)="go(p.page - 1)"
          >
            <app-icon name="chevron-left" [size]="16" /> Previous
          </button>
          <span>Page {{ p.page }} of {{ p.totalPages }} · {{ p.total }} total</span>
          <button
            type="button"
            class="btn secondary sm"
            [disabled]="p.page >= p.totalPages"
            (click)="go(p.page + 1)"
          >
            Next <app-icon name="chevron-right" [size]="16" />
          </button>
        </nav>
      }
    }
  `,
})
export class RewardsIncidentsPage {
  private readonly api = inject(RewardsApi);
  private business: Business | null = null;
  protected readonly filters = FILTERS;
  protected readonly status = signal('');
  private page = 1;
  protected readonly items = signal<Incident[]>([]);
  protected readonly pagination = signal<Pagination | null>(null);
  protected readonly rules = signal<RewardRule[]>([]);
  protected readonly issuing = signal<Incident | null>(null);
  protected readonly ruleId = signal('');
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.api.business().subscribe({
      next: (b) => {
        this.business = b;
        if (b)
          this.api
            .rules(b.id)
            .subscribe({ next: (r) => this.rules.set(r.filter((x) => x.enabled)) });
        this.load();
      },
      error: (e: unknown) => {
        this.error.set(apiErrorMessage(e));
        this.loading.set(false);
      },
    });
  }

  protected val(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }
  protected isOwner(): boolean {
    return this.business?.role === 'owner';
  }
  protected text(s: string): string {
    return TEXT[s] ?? s;
  }
  protected tone(s: string): string {
    return TONE[s] ?? '';
  }
  protected reason(r: string): string {
    return REASON[r] ?? r;
  }
  protected setStatus(v: string): void {
    this.status.set(v);
    this.page = 1;
    this.load();
  }
  protected go(p: number): void {
    this.page = p;
    this.load();
  }

  private load(): void {
    if (!this.business) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.api.incidents(this.business.id, this.page, this.status()).subscribe({
      next: (p) => {
        this.items.set(p.data);
        this.pagination.set(p.pagination);
        this.loading.set(false);
      },
      error: (e: unknown) => {
        this.error.set(apiErrorMessage(e));
        this.loading.set(false);
      },
    });
  }

  protected startIssue(i: Incident): void {
    this.issuing.set(i);
    this.ruleId.set(
      i.ruleId && this.rules().some((r) => r.id === i.ruleId)
        ? i.ruleId
        : (this.rules()[0]?.id ?? ''),
    );
  }

  private run(op: ReturnType<RewardsApi['resolve']> | ReturnType<RewardsApi['issue']>): void {
    this.busy.set(true);
    this.error.set(null);
    (op as ReturnType<RewardsApi['resolve']>).subscribe({
      next: () => {
        this.busy.set(false);
        this.issuing.set(null);
        this.load();
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(e));
      },
    });
  }

  protected issue(i: Incident): void {
    if (this.business) this.run(this.api.issue(this.business.id, i.id, this.ruleId()));
  }
  protected resolve(i: Incident): void {
    if (this.business) this.run(this.api.resolve(this.business.id, i.id));
  }
}
