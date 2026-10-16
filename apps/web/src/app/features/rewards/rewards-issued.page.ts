import { DatePipe } from '@angular/common';
import { Component, HostListener, inject, signal } from '@angular/core';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { Business } from '../../core/business/business.service';
import { Pagination } from '../../core/feedback/feedback.service';
import {
  RewardDetail,
  RewardsApi,
  StaffReward,
  discountLabel,
} from '../../core/rewards/rewards.service';
import { Icon } from '../../shared/icon';

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'pending_approval', label: 'Awaiting approval' },
  { value: 'issued', label: 'Active' },
  { value: 'redeemed', label: 'Redeemed' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'rejected', label: 'Rejected' },
];

const TONE: Record<string, string> = {
  issued: 'success',
  pending_approval: 'warn',
  redeemed: 'brand',
  expired: 'error',
  cancelled: 'error',
  rejected: 'error',
};
const LABEL: Record<string, string> = {
  issued: 'Active',
  pending_approval: 'Awaiting approval',
  redeemed: 'Redeemed',
  expired: 'Expired',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
};

/** Issued rewards: filter, review and approve; share by hand; cancel. Owners decide, staff share. */
@Component({
  selector: 'app-rewards-issued-page',
  imports: [DatePipe, Icon],
  template: `
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="segmented flex-wrap" role="tablist" aria-label="Reward status">
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
      <form class="ml-auto flex gap-2" (submit)="$event.preventDefault(); applySearch()">
        <input
          class="input !h-10 w-56"
          type="search"
          placeholder="Code or customer"
          aria-label="Search rewards"
          [value]="search()"
          (input)="search.set(val($event))"
        />
        <button type="submit" class="btn secondary sm">
          <app-icon name="search" [size]="16" /> Search
        </button>
      </form>
    </div>

    @if (error(); as message) {
      <div class="alert" role="alert">
        <app-icon name="alert" [size]="18" /><span>{{ message }}</span>
      </div>
    }

    @if (loading()) {
      <div class="flex flex-col gap-2" role="status" aria-label="Loading rewards">
        @for (i of [1, 2, 3]; track i) {
          <div class="skeleton h-16 !rounded-xl"></div>
        }
      </div>
    } @else if (items().length === 0 && !error()) {
      <div class="card empty">
        <app-icon name="gift" [size]="30" />
        <strong class="text-gray-800 dark:text-white/90">No rewards here</strong>
        <p class="m-0">Rewards appear when a low rating matches one of your rules.</p>
      </div>
    } @else {
      <ul class="rows" aria-label="Rewards">
        @for (r of items(); track r.id) {
          <li>
            <button
              type="button"
              class="row"
              [class.sel]="detail()?.reward?.id === r.id"
              (click)="open(r.id)"
            >
              <span class="score !w-auto px-2.5 font-mono text-theme-xs">{{
                r.code.slice(4)
              }}</span>
              <span class="main">
                <strong>{{ label(r) }} · {{ r.ruleName }}</strong>
                <span class="muted">{{
                  r.contact
                    ? r.contact.fullName || r.contact.email || r.contact.phone
                    : 'Anonymous customer'
                }}</span>
              </span>
              <span class="badge" [class]="tone(r.status)">{{ statusLabel(r.status) }}</span>
              <time [attr.datetime]="r.createdAt">{{ r.createdAt | date: 'mediumDate' }}</time>
            </button>
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

    @if (detail(); as d) {
      <div
        class="fixed inset-0 z-[99998] animate-fade-in bg-gray-950/60 backdrop-blur-sm"
        (click)="close()"
        aria-hidden="true"
      ></div>
      <section
        class="detail drawer fixed inset-y-0 right-0 z-[99999] flex w-full max-w-md animate-fade-in flex-col overflow-y-auto border-l border-gray-200 bg-white p-6 shadow-theme-xl dark:border-gray-800 dark:bg-gray-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rw-h"
      >
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="rw-h" class="!mb-1">{{ label(d.reward) }}</h2>
            <span class="badge" [class]="tone(d.reward.status)">{{
              statusLabel(d.reward.status)
            }}</span>
          </div>
          <button
            type="button"
            class="drawer-close icon-btn !size-9"
            aria-label="Close details"
            (click)="close()"
          >
            <app-icon name="close" [size]="18" />
          </button>
        </div>

        <div
          class="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <p class="m-0 text-theme-xs text-gray-500 dark:text-gray-400">Code</p>
          <p
            class="m-0 font-mono text-xl font-semibold tracking-widest text-gray-900 dark:text-white"
          >
            {{ d.reward.code }}
          </p>
          <p class="muted mt-2 mb-0">
            {{
              d.reward.contact
                ? (d.reward.contact.fullName || 'No name') +
                  (d.reward.contact.email ? ' · ' + d.reward.contact.email : '') +
                  (d.reward.contact.phone ? ' · ' + d.reward.contact.phone : '')
                : 'Anonymous customer'
            }}
          </p>
          <p class="muted mt-1 mb-0">
            Rule: {{ d.reward.ruleName }}
            @if (d.reward.expiresAt) {
              · expires {{ d.reward.expiresAt | date: 'mediumDate' }}
            }
          </p>
          @if (d.reward.redemption; as r) {
            <p class="mt-2 mb-0 text-theme-sm text-gray-700 dark:text-gray-300">
              Redeemed {{ r.at | date: 'medium' }}
              @if (r.orderTotal !== null) {
                on an order of {{ r.orderTotal }}, discount {{ r.discountApplied }}
              } @else {
                (no order total entered)
              }
            </p>
          }
        </div>

        @if (actionError(); as m) {
          <div class="alert" role="alert">
            <app-icon name="alert" [size]="18" /><span>{{ m }}</span>
          </div>
        }

        @if (
          isOwner() && (d.reward.status === 'pending_approval' || d.reward.status === 'issued')
        ) {
          <div class="mb-4">
            <label
              for="note"
              class="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300"
              >Note (optional)</label
            >
            <input
              id="note"
              class="input mb-3"
              type="text"
              maxlength="300"
              [value]="note()"
              (input)="note.set(val($event))"
            />
            <div class="flex flex-wrap gap-2">
              @if (d.reward.status === 'pending_approval') {
                <button type="button" class="btn" [disabled]="busy()" (click)="decide('approve')">
                  <app-icon name="check" [size]="16" /> Approve
                </button>
                <button
                  type="button"
                  class="btn secondary"
                  [disabled]="busy()"
                  (click)="decide('reject')"
                >
                  Reject
                </button>
              } @else {
                <button
                  type="button"
                  class="btn danger"
                  [disabled]="busy()"
                  (click)="decide('cancel')"
                >
                  Cancel reward
                </button>
              }
            </div>
          </div>
        }

        @if (d.reward.status === 'issued') {
          <h3 class="!mt-0">Share with the customer</h3>
          <p class="muted mt-0 mb-3 text-theme-xs">
            These open your own apps; nothing is sent automatically and delivery is not tracked.
          </p>
          <div class="mb-4 flex flex-wrap gap-2">
            <button type="button" class="btn secondary sm" (click)="share('copy')">
              <app-icon name="copy" [size]="14" /> {{ copied() ? 'Link copied' : 'Copy link' }}
            </button>
            @if (d.reward.contact?.phone) {
              <button type="button" class="btn secondary sm" (click)="share('whatsapp_link')">
                <app-icon name="send" [size]="14" /> WhatsApp
              </button>
            }
            @if (d.reward.contact?.email) {
              <button type="button" class="btn secondary sm" (click)="share('email_link')">
                <app-icon name="mail" [size]="14" /> Email
              </button>
            }
            <button type="button" class="btn secondary sm" (click)="share('in_person')">
              Told in person
            </button>
          </div>
          @if (d.reward.deliveries.length) {
            <p class="muted mt-0">
              Shared by hand {{ d.reward.deliveries.length }} time(s); last
              {{ d.reward.deliveries[d.reward.deliveries.length - 1].at | date: 'short' }}.
            </p>
          }
        }

        <h3>History</h3>
        <ul class="plain">
          @for (h of d.history; track $index) {
            <li>{{ h.at | date: 'medium' }}: {{ h.action.replace('_', ' ') }}</li>
          }
        </ul>
      </section>
    }
  `,
})
export class RewardsIssuedPage {
  private readonly api = inject(RewardsApi);
  private business: Business | null = null;
  protected readonly filters = FILTERS;
  protected readonly status = signal('');
  protected readonly search = signal('');
  private applied = '';
  private page = 1;

  protected readonly items = signal<StaffReward[]>([]);
  protected readonly pagination = signal<Pagination | null>(null);
  protected readonly detail = signal<RewardDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly note = signal('');
  protected readonly copied = signal(false);

  constructor() {
    this.api.business().subscribe({
      next: (b) => {
        this.business = b;
        this.load();
      },
      error: (e: unknown) => {
        this.error.set(apiErrorMessage(e));
        this.loading.set(false);
      },
    });
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
  protected isOwner(): boolean {
    return this.business?.role === 'owner';
  }
  protected label(r: StaffReward): string {
    return discountLabel(r.discount);
  }
  protected tone(s: string): string {
    return TONE[s] ?? '';
  }
  protected statusLabel(s: string): string {
    return LABEL[s] ?? s;
  }

  protected setStatus(v: string): void {
    this.status.set(v);
    this.page = 1;
    this.load();
  }
  protected applySearch(): void {
    this.applied = this.search();
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
    this.api.rewards(this.business.id, this.page, this.status(), this.applied).subscribe({
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

  protected open(id: string, keep = false): void {
    if (!this.business) return;
    if (!keep) {
      this.actionError.set(null);
      this.note.set('');
      this.copied.set(false);
    }
    this.api.reward(this.business.id, id).subscribe({
      next: (d) => {
        this.detail.set(d);
        queueMicrotask(() => document.querySelector<HTMLElement>('.drawer-close')?.focus());
      },
      error: (e: unknown) => this.error.set(apiErrorMessage(e)),
    });
  }

  @HostListener('document:keydown.escape')
  protected close(): void {
    this.detail.set(null);
  }

  private refresh(id: string): void {
    this.open(id);
    this.load();
  }

  protected decide(action: 'approve' | 'reject' | 'cancel'): void {
    const d = this.detail();
    if (!d || !this.business || this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api
      .decide(this.business.id, d.reward.id, action, this.note().trim() || undefined)
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.refresh(d.reward.id);
        },
        error: (e: unknown) => {
          this.busy.set(false);
          this.actionError.set(apiErrorMessage(e));
        },
      });
  }

  protected async share(
    method: 'copy' | 'whatsapp_link' | 'email_link' | 'in_person',
  ): Promise<void> {
    const d = this.detail();
    if (!d || !this.business) return;
    const r = d.reward;
    const text = `Hi${r.contact?.fullName ? ' ' + r.contact.fullName : ''}, we are sorry about your visit to ${this.business.name}. Here is ${discountLabel(r.discount)} for next time: ${r.shareUrl}`;
    if (method === 'copy') {
      try {
        await navigator.clipboard.writeText(r.shareUrl);
        this.copied.set(true);
      } catch {
        this.actionError.set(
          'Copy was blocked by the browser. Select the link and copy it by hand.',
        );
        return;
      }
    } else if (method === 'whatsapp_link' && r.contact?.phone) {
      window.open(
        `https://wa.me/${r.contact.phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`,
        '_blank',
        'noopener',
      );
    } else if (method === 'email_link' && r.contact?.email) {
      window.open(
        `mailto:${r.contact.email}?subject=${encodeURIComponent('A little something from ' + this.business.name)}&body=${encodeURIComponent(text)}`,
        '_self',
      );
    }
    this.api.shared(this.business.id, r.id, method).subscribe({
      next: () => this.open(r.id, true),
      error: (e: unknown) => this.actionError.set(apiErrorMessage(e)),
    });
  }
}
