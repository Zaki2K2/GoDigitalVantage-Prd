import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '../../core/auth/auth.service';
import { Business, BusinessApi } from '../../core/business/business.service';
import { Dashboard, FeedbackApi } from '../../core/feedback/feedback.service';
import { QrInfo, QuestionnaireApi } from '../../core/questionnaire/questionnaire.service';
import { Icon, IconName } from '../../shared/icon';

const W = 720;
const H = 220;
const PAD = { l: 34, r: 24, t: 12, b: 26 };

/** Dashboard home. Every number comes from the server's database aggregations. */
@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, DatePipe, Icon],
  templateUrl: './dashboard.page.html',
})
export class DashboardPage {
  protected readonly auth = inject(AuthService);
  private readonly businesses = inject(BusinessApi);
  private readonly questionnaires = inject(QuestionnaireApi);
  private readonly feedback = inject(FeedbackApi);
  private readonly destroyRef = inject(DestroyRef);
  private statsRequest?: Subscription;

  protected readonly business = signal<Business | null>(null);
  protected readonly qr = signal<QrInfo | null>(null);
  protected readonly stats = signal<Dashboard | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly statsError = signal<string | null>(null);
  protected readonly refreshing = signal(false);
  protected readonly copied = signal(false);
  protected readonly copyFailed = signal(false);
  protected readonly range = signal(30);
  protected readonly hover = signal<number | null>(null);
  protected readonly ranges = [7, 30, 90];
  protected readonly stars = [5, 4, 3, 2, 1];
  protected readonly view = { w: W, h: H };

  /** Round the y-axis up so gridlines land on whole numbers. */
  protected readonly yMax = computed(() => {
    const peak = Math.max(
      1,
      ...(this.stats()?.trend ?? []).map((d) => Math.max(d.scans, d.responses)),
    );
    for (let k = 1; ; k *= 10) {
      for (const m of [1, 2, 5]) if (m * k * 4 >= peak) return m * k * 4;
    }
  });
  protected readonly grid = computed(() =>
    [0, 1, 2, 3, 4].map((i) => ({
      value: (this.yMax() / 4) * i,
      y: this.y((this.yMax() / 4) * i),
    })),
  );
  protected readonly scansPath = computed(() => this.line('scans'));
  protected readonly responsesPath = computed(() => this.line('responses'));
  protected readonly responsesArea = computed(() => {
    const t = this.stats()?.trend ?? [];
    if (t.length === 0) return '';
    return `${this.line('responses')} L ${this.x(t.length - 1)} ${this.y(0)} L ${this.x(0)} ${this.y(0)} Z`;
  });
  protected readonly labels = computed(() => {
    const t = this.stats()?.trend ?? [];
    const every = Math.max(1, Math.ceil(t.length / 6));
    return t
      .map((d, i) => ({ date: d.date, x: this.x(i), show: i % every === 0 || i === t.length - 1 }))
      .filter((l) => l.show);
  });
  protected readonly inRange = computed(() => {
    const t = this.stats()?.trend ?? [];
    return {
      scans: t.reduce((n, d) => n + d.scans, 0),
      responses: t.reduce((n, d) => n + d.responses, 0),
    };
  });
  protected readonly distribution = computed(() => {
    const counts = this.stats()?.ratingDistribution ?? [];
    const total = counts.reduce((n, c) => n + c, 0);
    return this.stars.map((star) => ({
      star,
      count: counts[star - 1] ?? 0,
      pct: total ? Math.round(((counts[star - 1] ?? 0) / total) * 100) : 0,
    }));
  });
  protected readonly hasRatings = computed(() => this.distribution().some((d) => d.count > 0));
  protected readonly smileScore = computed(() => {
    const distribution = this.stats()?.ratingDistribution ?? [];
    const rated = distribution.reduce((sum, count) => sum + count, 0);
    const positive = (distribution[3] ?? 0) + (distribution[4] ?? 0);
    return { rated, positive, percent: rated ? Math.round((positive / rated) * 100) : null };
  });
  protected readonly hovered = computed(() => {
    const i = this.hover();
    const d = i === null ? null : (this.stats()?.trend[i] ?? null);
    return d && i !== null ? { ...d, x: this.x(i) } : null;
  });

  constructor() {
    this.businesses
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          const b = list[0] ?? null;
          this.business.set(b);
          this.loading.set(false);
          if (b) {
            this.questionnaires
              .qr(b.id)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: (q) => this.qr.set(q),
                error: () => this.qr.set(null),
              });
            this.loadStats();
          }
        },
        error: (err: unknown) => {
          this.error.set(apiErrorMessage(err));
          this.loading.set(false);
        },
      });
  }

  protected setRange(days: number): void {
    if (days === this.range()) return;
    this.range.set(days);
    this.loadStats();
  }

  protected loadStats(): void {
    const b = this.business();
    if (!b) return;
    this.statsRequest?.unsubscribe();
    this.refreshing.set(true);
    this.hover.set(null);
    this.statsError.set(null);
    this.statsRequest = this.feedback
      .dashboard(b.id, this.range())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (d) => {
          this.stats.set(d);
          this.refreshing.set(false);
        },
        error: (err: unknown) => {
          this.statsError.set(apiErrorMessage(err));
          this.refreshing.set(false);
        },
      });
  }

  protected cards(
    s: Dashboard,
  ): { label: string; value: string; note: string; icon: IconName; tone: string }[] {
    const r = this.inRange();
    return [
      {
        label: 'QR scans',
        value: String(s.totals.scans),
        note: `${r.scans} in the last ${s.days} days`,
        icon: 'eye',
        tone: 'bg-blue-light-50 text-blue-light-600 dark:bg-blue-light-500/15 dark:text-blue-light-400',
      },
      {
        label: 'Responses',
        value: String(s.totals.responses),
        note: `${r.responses} in the last ${s.days} days`,
        icon: 'responses',
        tone: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400',
      },
      {
        label: 'Contacts',
        value: String(s.totals.contacts),
        note: 'shared an email or phone',
        icon: 'contacts',
        tone: 'bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-gray-300',
      },
      {
        label: 'Average rating',
        value: s.totals.averageRating === null ? '–' : String(s.totals.averageRating),
        note: `from ${s.totals.ratedResponses} rated responses (1–5)`,
        icon: 'star',
        tone: 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400',
      },
    ];
  }

  protected x(i: number): number {
    const n = Math.max(1, (this.stats()?.trend.length ?? 1) - 1);
    return PAD.l + (i / n) * (W - PAD.l - PAD.r);
  }

  protected y(value: number): number {
    return PAD.t + (1 - value / this.yMax()) * (H - PAD.t - PAD.b);
  }

  protected colWidth(): number {
    return (W - PAD.l - PAD.r) / Math.max(1, this.stats()?.trend.length ?? 1);
  }

  private line(field: 'scans' | 'responses'): string {
    return (this.stats()?.trend ?? [])
      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${this.x(i)} ${this.y(d[field])}`)
      .join(' ');
  }

  protected async copy(): Promise<void> {
    const url = this.qr()?.publicUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.copyFailed.set(false);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      this.copied.set(false);
      this.copyFailed.set(true);
    }
  }
}
