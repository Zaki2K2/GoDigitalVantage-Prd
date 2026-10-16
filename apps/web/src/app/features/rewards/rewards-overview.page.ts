import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { RewardSummary, RewardsApi } from '../../core/rewards/rewards.service';
import { Icon, IconName } from '../../shared/icon';

const W = 720;
const H = 200;
const PAD = { l: 30, r: 20, t: 10, b: 24 };

/** Reward KPIs and trend. Costs come only from order totals staff typed at redemption. */
@Component({
  selector: 'app-rewards-overview-page',
  imports: [RouterLink, Icon],
  template: `
    <div class="mb-4 flex justify-end">
      <div class="segmented" role="group" aria-label="Date range">
        @for (d of ranges; track d) {
          <button type="button" [attr.aria-pressed]="range() === d" (click)="setRange(d)">
            {{ d }} days
          </button>
        }
      </div>
    </div>

    @if (error(); as message) {
      <div class="alert" role="alert">
        <app-icon name="alert" [size]="18" /><span class="flex-1">{{ message }}</span>
        <button type="button" class="btn secondary sm" (click)="load()">Try again</button>
      </div>
    } @else if (!data()) {
      <div class="grid grid-cols-2 gap-4 xl:grid-cols-3" role="status" aria-label="Loading">
        @for (i of [1, 2, 3, 4, 5, 6]; track i) {
          <div class="skeleton h-28 !rounded-2xl"></div>
        }
      </div>
    } @else if (data(); as s) {
      @if (s.totals.incidents === 0 && s.totals.issued === 0) {
        <div class="card empty">
          <app-icon name="gift" [size]="32" />
          <strong class="text-gray-800 dark:text-white/90">No rewards yet</strong>
          <p class="m-0 max-w-md">
            Create a rule and, when a customer leaves a low rating, a recovery reward is created
            automatically or queued for your approval.
          </p>
          <a class="btn mt-2" routerLink="/rewards/rules">Create a reward rule</a>
        </div>
      }
      <dl class="stats mb-5 grid grid-cols-2 gap-4 xl:grid-cols-3">
        @for (c of cards(s); track c.label) {
          <div class="stat card !mb-0">
            <span class="mb-3 flex size-10 items-center justify-center rounded-xl" [class]="c.tone"
              ><app-icon [name]="c.icon" [size]="20"
            /></span>
            <dt class="text-theme-sm text-gray-500 dark:text-gray-400">{{ c.label }}</dt>
            <dd class="m-0 mt-1 text-title-sm font-semibold text-gray-900 dark:text-white/90">
              {{ c.value }}
              <small
                class="mt-1 block text-theme-xs font-normal text-gray-500 dark:text-gray-400"
                >{{ c.note }}</small
              >
            </dd>
          </div>
        }
      </dl>

      <div class="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section class="card !mb-0" aria-labelledby="rt-h">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="rt-h" class="!mb-0">Recovery trend</h2>
            <div class="flex gap-4 text-theme-xs text-gray-500 dark:text-gray-400">
              <span class="inline-flex items-center gap-1.5"
                ><i class="size-2.5 rounded-full bg-warning-400"></i>Complaints</span
              >
              <span class="inline-flex items-center gap-1.5"
                ><i class="size-2.5 rounded-full bg-blue-light-400"></i>Issued</span
              >
              <span class="inline-flex items-center gap-1.5"
                ><i class="size-2.5 rounded-full bg-brand-500"></i>Redeemed</span
              >
            </div>
          </div>
          <svg
            class="chart block h-auto w-full"
            [attr.viewBox]="'0 0 ' + w + ' ' + h"
            role="img"
            [attr.aria-label]="
              'Complaints, rewards issued and redeemed over the last ' + s.days + ' days'
            "
          >
            @for (g of grid(); track g.v) {
              <line
                class="stroke-gray-200 dark:stroke-gray-800"
                [attr.x1]="30"
                [attr.x2]="w - 20"
                [attr.y1]="g.y"
                [attr.y2]="g.y"
                stroke-dasharray="3 4"
              />
              <text class="fill-gray-400 text-[12px]" x="24" [attr.y]="g.y + 3" text-anchor="end">
                {{ g.v }}
              </text>
            }
            <path
              class="fill-none stroke-warning-400"
              stroke-width="2"
              [attr.d]="line('incidents')"
            />
            <path
              class="fill-none stroke-blue-light-400"
              stroke-width="2"
              [attr.d]="line('issued')"
            />
            <path
              class="fill-none stroke-brand-500"
              stroke-width="2.5"
              [attr.d]="line('redeemed')"
            />
            @for (l of labels(); track l.date) {
              <text
                class="fill-gray-400 text-[12px]"
                [attr.x]="l.x"
                [attr.y]="h - 6"
                text-anchor="middle"
              >
                {{ l.date.slice(5) }}
              </text>
            }
          </svg>
          <details class="mt-3 text-theme-sm">
            <summary class="cursor-pointer text-gray-500 dark:text-gray-400">
              View as a table
            </summary>
            <div
              class="mt-2 max-h-56 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800"
            >
              <table class="w-full text-left text-theme-sm">
                <thead
                  class="sticky top-0 bg-gray-50 text-theme-xs text-gray-500 uppercase dark:bg-gray-900"
                >
                  <tr>
                    <th class="px-3 py-2">Date</th>
                    <th class="px-3 py-2">Complaints</th>
                    <th class="px-3 py-2">Issued</th>
                    <th class="px-3 py-2">Redeemed</th>
                  </tr>
                </thead>
                <tbody>
                  @for (d of s.trend; track d.date) {
                    <tr class="border-t border-gray-100 dark:border-gray-800">
                      <td class="px-3 py-1.5">{{ d.date }}</td>
                      <td class="px-3 py-1.5">{{ d.incidents }}</td>
                      <td class="px-3 py-1.5">{{ d.issued }}</td>
                      <td class="px-3 py-1.5">{{ d.redeemed }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <section class="card !mb-0" aria-labelledby="cost-h">
          <h2 id="cost-h">Discount cost</h2>
          @if (s.cost.byCurrency.length) {
            <ul class="m-0 list-none p-0">
              @for (c of s.cost.byCurrency; track c.currency) {
                <li
                  class="flex items-baseline justify-between border-t border-gray-100 py-2 first:border-t-0 dark:border-gray-800"
                >
                  <span class="text-theme-sm text-gray-600 dark:text-gray-300"
                    >{{ c.redemptions }}
                    {{ c.redemptions === 1 ? 'redemption' : 'redemptions' }}</span
                  >
                  <strong class="text-lg text-gray-900 dark:text-white/90"
                    >{{ c.currency }} {{ c.amount }}</strong
                  >
                </li>
              }
            </ul>
          } @else {
            <p class="muted mt-0">No cost recorded yet.</p>
          }
          @if (s.cost.redemptionsWithoutTotal > 0) {
            <p class="notice mt-3 mb-0">
              {{ s.cost.redemptionsWithoutTotal }} redeemed without an order total, so their cost is
              unknown.
            </p>
          }
          <p class="muted mt-3 mb-0 text-theme-xs">
            Cost is the discount applied to order totals staff entered when redeeming. We do not
            estimate or claim recovered revenue: that needs verified purchase data.
          </p>
        </section>
      </div>
    }
  `,
})
export class RewardsOverviewPage {
  private readonly api = inject(RewardsApi);
  protected readonly ranges = [7, 30, 90];
  protected readonly range = signal(30);
  protected readonly data = signal<RewardSummary | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly w = W;
  protected readonly h = H;
  private bid = '';

  protected readonly yMax = computed(() => {
    const peak = Math.max(
      1,
      ...(this.data()?.trend ?? []).map((d) => Math.max(d.incidents, d.issued, d.redeemed)),
    );
    for (let k = 1; ; k *= 10) for (const m of [1, 2, 5]) if (m * k * 4 >= peak) return m * k * 4;
  });
  protected readonly grid = computed(() =>
    [0, 1, 2, 3, 4].map((i) => ({ v: (this.yMax() / 4) * i, y: this.y((this.yMax() / 4) * i) })),
  );
  protected readonly labels = computed(() => {
    const t = this.data()?.trend ?? [];
    const every = Math.max(1, Math.ceil(t.length / 6));
    return t
      .map((d, i) => ({ date: d.date, x: this.x(i), show: i % every === 0 || i === t.length - 1 }))
      .filter((l) => l.show);
  });

  constructor() {
    this.api.business().subscribe({
      next: (b) => {
        this.bid = b?.id ?? '';
        this.load();
      },
      error: (e: unknown) => this.error.set(apiErrorMessage(e)),
    });
  }

  protected setRange(d: number): void {
    this.range.set(d);
    this.load();
  }

  protected load(): void {
    if (!this.bid) return;
    this.error.set(null);
    this.api.summary(this.bid, this.range()).subscribe({
      next: (s) => this.data.set(s),
      error: (e: unknown) => this.error.set(apiErrorMessage(e)),
    });
  }

  protected cards(
    s: RewardSummary,
  ): { label: string; value: string; note: string; icon: IconName; tone: string }[] {
    const t = s.totals;
    return [
      {
        label: 'Complaints',
        value: String(t.incidents),
        note: 'ratings that matched a rule',
        icon: 'responses',
        tone: 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400',
      },
      {
        label: 'Rewards issued',
        value: String(t.issued),
        note: `${t.active} still active`,
        icon: 'gift',
        tone: 'bg-blue-light-50 text-blue-light-600 dark:bg-blue-light-500/15 dark:text-blue-light-400',
      },
      {
        label: 'Redeemed',
        value: String(t.redeemed),
        note:
          t.redemptionRate === null ? 'no rewards issued yet' : `${t.redemptionRate}% of issued`,
        icon: 'ticket',
        tone: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400',
      },
      {
        label: 'Awaiting approval',
        value: String(t.pendingApproval),
        note: 'need an owner decision',
        icon: 'info',
        tone: 'bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-gray-300',
      },
      {
        label: 'Expired',
        value: String(t.expired),
        note: 'issued but never used',
        icon: 'calendar',
        tone: 'bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-400',
      },
      {
        label: 'Cancelled / rejected',
        value: String(t.cancelled + t.rejected),
        note: 'withdrawn by the business',
        icon: 'close',
        tone: 'bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-gray-300',
      },
    ];
  }

  protected x(i: number): number {
    const n = Math.max(1, (this.data()?.trend.length ?? 1) - 1);
    return PAD.l + (i / n) * (W - PAD.l - PAD.r);
  }
  protected y(v: number): number {
    return PAD.t + (1 - v / this.yMax()) * (H - PAD.t - PAD.b);
  }
  protected line(f: 'incidents' | 'issued' | 'redeemed'): string {
    return (this.data()?.trend ?? [])
      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${this.x(i)} ${this.y(d[f])}`)
      .join(' ');
  }
}
