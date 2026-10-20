import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { finalize } from 'rxjs';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { Pagination } from '../../core/feedback/feedback.service';
interface Monitoring {
  scheduler: {
    startedAt: string;
    completedAt: string | null;
    lastError: string | null;
    processed: number;
  } | null;
  configuration: {
    emailEnabled: boolean;
    unsubscribeConfigured: boolean;
    schedulerConfigured: boolean;
    indexesReady: boolean;
  };
  counts: { _id: string; count: number }[];
  locks: { _id: string; at: string }[];
  recentChecks: {
    _id: string;
    name: string;
    businessId: string;
    status: string;
    lastCheckedAt: string | null;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  }[];
  recipients: {
    _id: string;
    campaignId: string;
    businessId: string;
    status: string;
    attempts: number;
    nextAttemptAt: string | null;
    errorCode: string | null;
    error: string | null;
    startedAt: string;
  }[];
}
@Component({
  selector: 'app-campaign-monitoring',
  imports: [DatePipe],
  template: ` <section class="card">
    <div class="flex justify-between">
      <h2>Execution monitoring</h2>
      <button class="btn secondary sm" [disabled]="busy()" (click)="load()">
        Refresh monitoring
      </button>
    </div>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (data(); as d) {
      <p>
        Scheduler started: {{ (d.scheduler?.startedAt | date: 'medium') || 'Not recorded' }} ·
        Finished: {{ (d.scheduler?.completedAt | date: 'medium') || 'Not recorded' }} ·
        {{ d.scheduler?.lastError || 'No recorded scheduler error' }}
      </p>
      <p>
        Email sending: {{ d.configuration.emailEnabled ? 'enabled' : 'disabled' }} · Unsubscribe
        configuration: {{ d.configuration.unsubscribeConfigured ? 'ready' : 'missing' }} · Scheduler
        authentication: {{ d.configuration.schedulerConfigured ? 'ready' : 'missing' }} · Required
        database indexes: {{ d.configuration.indexesReady ? 'ready' : 'missing' }}
      </p>
      <div class="flex flex-wrap gap-2">
        @for (c of d.counts; track c._id) {
          <span class="badge">{{ c._id }}: {{ c.count }}</span>
        }
      </div>
      <h3 class="mt-4">Locks awaiting completion or investigation</h3>
      @for (lock of d.locks; track lock._id) {
        <p>
          {{ lock._id }} · {{ lock.at | date: 'medium' }}. Interrupted locks require operator
          reconciliation; they never auto-expire.
        </p>
      } @empty {
        <p class="muted">No outstanding locks.</p>
      }
      <h3>Campaign checks (oldest first)</h3>
      @for (c of d.recentChecks; track c._id) {
        <p>
          <button class="btn secondary sm" (click)="inspect.emit(c._id)">{{ c.name }}</button> ·
          {{ (c.lastCheckedAt | date: 'medium') || 'Never checked' }} · Last completed batch
          {{ (c.lastSuccessAt | date: 'medium') || 'none' }} · Last recorded failure
          {{ c.lastError || 'none' }}
        </p>
      }
      <h3>Pending, failed and uncertain deliveries</h3>
      <p class="muted">
        Automatic retries reuse the original message and provider key, at most three attempts within
        19 hours. Reconciliation requires operator review; refreshing does not resend.
      </p>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[800px] text-left text-theme-sm">
          <thead class="bg-gray-50 dark:bg-white/[0.02]">
            <tr>
              <th
                scope="col"
                class="border-b border-gray-200 px-5 py-3.5 whitespace-nowrap text-theme-xs font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400"
              >
                Campaign
              </th>
              <th
                scope="col"
                class="border-b border-gray-200 px-5 py-3.5 whitespace-nowrap text-theme-xs font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400"
              >
                Status
              </th>
              <th
                scope="col"
                class="border-b border-gray-200 px-5 py-3.5 whitespace-nowrap text-theme-xs font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400"
              >
                Attempts
              </th>
              <th
                scope="col"
                class="border-b border-gray-200 px-5 py-3.5 whitespace-nowrap text-theme-xs font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400"
              >
                Next retry
              </th>
              <th
                scope="col"
                class="border-b border-gray-200 px-5 py-3.5 whitespace-nowrap text-theme-xs font-medium text-gray-500 dark:border-gray-800 dark:text-gray-400"
              >
                Failure
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            @for (r of d.recipients; track r._id) {
              <tr>
                <td class="px-5 py-4 align-top">
                  <button class="btn secondary sm" (click)="inspect.emit(r.campaignId)">
                    Inspect campaign
                  </button>
                  <p class="muted">{{ r.businessId }}</p>
                </td>
                <td class="px-5 py-4 align-top">{{ r.status }}</td>
                <td class="px-5 py-4 align-top">{{ r.attempts }} / 3</td>
                <td class="px-5 py-4 align-top">
                  {{
                    (r.nextAttemptAt | date: 'medium') ||
                      (r.status === 'reconciliation' ? 'Operator review' : 'None queued')
                  }}
                </td>
                <td class="px-5 py-4 align-top">{{ r.errorCode }} {{ r.error }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5">No outstanding recipients.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (pagination(); as p) {
        <nav class="pager" aria-label="Execution monitoring pages">
          <button
            class="btn secondary sm"
            [disabled]="busy() || p.page <= 1"
            (click)="load(p.page - 1)"
          >
            Previous</button
          ><span>{{ p.total }} recipients</span
          ><button
            class="btn secondary sm"
            [disabled]="busy() || p.page >= p.totalPages"
            (click)="load(p.page + 1)"
          >
            Next
          </button>
        </nav>
      }
    } @else {
      <p class="muted">Refresh to inspect scheduler health, locks and delivery retries.</p>
    }
  </section>`,
})
export class CampaignMonitoring {
  private http = inject(HttpClient);
  protected busy = signal(false);
  protected error = signal('');
  protected data = signal<Monitoring | null>(null);
  protected pagination = signal<Pagination | null>(null);
  @Output() inspect = new EventEmitter<string>();
  protected load(page = 1) {
    this.busy.set(true);
    this.error.set('');
    this.http
      .get<{ data: Monitoring; pagination: Pagination }>('/api/v1/admin/campaigns/monitoring', {
        params: { page, pageSize: 20 },
      })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (r) => {
          this.data.set(r.data);
          this.pagination.set(r.pagination);
        },
        error: (e) => this.error.set(apiErrorMessage(e)),
      });
  }
}
