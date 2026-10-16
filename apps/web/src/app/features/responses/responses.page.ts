import { DatePipe } from '@angular/common';
import { Component, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { Icon } from '../../shared/icon';
import { DialogFocus } from '../../shared/dialog-focus';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { Business, BusinessApi } from '../../core/business/business.service';
import {
  FeedbackApi,
  Pagination,
  ResponseDetail,
  ResponseFilters,
  ResponseItem,
} from '../../core/feedback/feedback.service';

const EMPTY: ResponseFilters = { page: 1, search: '', rating: '', contact: '', from: '', to: '' };

/** Read-only list of customer feedback. Responses are immutable snapshots. */
@Component({
  selector: 'app-responses-page',
  imports: [DatePipe, Icon, DialogFocus],
  template: `
    <main class="page">
      <header class="page-header">
        <div>
          <p class="eyebrow">Customers</p>
          <h1>Responses</h1>
          <p class="sub">
            Answers are saved exactly as customers saw them, even after you change the
            questionnaire.
          </p>
        </div>
        @if (pagination(); as p) {
          <span class="badge brand">{{ p.total }} total</span>
        }
      </header>

      @if (error(); as message) {
        <div class="alert" role="alert">
          <app-icon name="alert" [size]="18" /><span class="flex-1">{{ message }}</span>
          <button type="button" class="btn secondary sm" (click)="load()">Try again</button>
        </div>
      }

      <form class="toolbar" (submit)="$event.preventDefault(); apply()">
        <div class="field grow">
          <label for="f-search">Search</label>
          <div class="relative">
            <span
              class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-400"
              ><app-icon name="search" [size]="16"
            /></span>
            <input
              id="f-search"
              type="search"
              class="!pl-10"
              placeholder="Comment, name, email or phone"
              [value]="draft().search"
              (input)="set('search', val($event))"
            />
          </div>
        </div>
        <div class="field">
          <label for="f-rating">Rating</label>
          <select id="f-rating" [value]="draft().rating" (change)="set('rating', val($event))">
            <option value="">Any</option>
            @for (r of [5, 4, 3, 2, 1]; track r) {
              <option [value]="r">{{ r }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="f-contact">Customer</label>
          <select id="f-contact" [value]="draft().contact" (change)="set('contact', val($event))">
            <option value="">All</option>
            <option value="identified">With contact details</option>
            <option value="anonymous">Anonymous</option>
          </select>
        </div>
        <div class="field">
          <label for="f-from">From</label>
          <input
            id="f-from"
            type="date"
            [value]="draft().from"
            (change)="set('from', val($event))"
          />
        </div>
        <div class="field">
          <label for="f-to">To</label>
          <input id="f-to" type="date" [value]="draft().to" (change)="set('to', val($event))" />
        </div>
        <div class="field btns">
          <button type="submit" class="btn" [disabled]="loading()">
            <app-icon name="filter" [size]="16" /> Apply
          </button>
          <button type="button" class="btn secondary" (click)="reset()">Clear</button>
        </div>
      </form>

      @if (loading()) {
        <div class="flex flex-col gap-2" role="status" aria-label="Loading responses">
          @for (i of [1, 2, 3]; track i) {
            <div class="skeleton h-16 !rounded-xl"></div>
          }
        </div>
      } @else if (items().length === 0 && !error()) {
        <div class="card empty">
          <app-icon name="responses" [size]="30" />
          @if (filtered()) {
            <strong class="text-gray-800 dark:text-white/90">Nothing matches</strong>
            <p class="m-0">No responses match these filters.</p>
            <button type="button" class="btn secondary mt-2" (click)="reset()">
              Clear filters
            </button>
          } @else {
            <strong class="text-gray-800 dark:text-white/90">No responses yet</strong>
            <p class="m-0">They appear here as soon as customers submit your form.</p>
          }
        </div>
      } @else if (!error()) {
        <ul class="rows" aria-label="Responses">
          @for (r of items(); track r.id) {
            <li>
              <button
                type="button"
                class="list-row"
                [class.sel]="detail()?.id === r.id"
                (click)="open(r.id)"
              >
                <span class="score" [class.low]="r.rating !== null && r.rating <= 2">{{
                  r.rating ?? '–'
                }}</span>
                <span class="main">
                  <strong>{{
                    r.contact
                      ? r.contact.fullName || r.contact.email || r.contact.phone
                      : 'Anonymous'
                  }}</strong>
                  <span class="muted">{{ r.preview ?? 'No written comment' }}</span>
                </span>
                <time [attr.datetime]="r.submittedAt">{{ r.submittedAt | date: 'medium' }}</time>
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

      @if (detailLoading()) {
        <p role="status" class="muted mt-3">Loading response details…</p>
      }
      @if (detailError(); as message) {
        <div class="alert" role="alert">
          <app-icon name="alert" [size]="18" /><span>{{ message }}</span>
        </div>
      }
      @if (detail(); as d) {
        <div
          class="fixed inset-0 z-[99998] animate-fade-in bg-gray-950/60 backdrop-blur-sm"
          (click)="closeDetail()"
          aria-hidden="true"
        ></div>
        <section
          class="detail drawer fixed inset-y-0 right-0 z-[99999] flex w-full max-w-md animate-fade-in flex-col overflow-y-auto border-l border-gray-200 bg-white p-6 shadow-theme-xl dark:border-gray-800 dark:bg-gray-900"
          role="dialog"
          appDialogFocus
          aria-modal="true"
          aria-labelledby="d-h"
        >
          <div class="mb-1 flex items-start justify-between gap-3">
            <h2 id="d-h" class="!mb-0">Response details</h2>
            <button
              type="button"
              class="drawer-close icon-btn !size-9"
              aria-label="Close details"
              (click)="closeDetail()"
            >
              <app-icon name="close" [size]="18" />
            </button>
          </div>
          <p class="muted mt-0 mb-4">
            {{ d.submittedAt | date: 'medium' }} · questionnaire version
            {{ d.questionnaireVersion }}
          </p>
          <div
            class="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.03]"
          >
            <p class="m-0 text-theme-sm">
              <strong class="text-gray-900 dark:text-white/90">Customer:</strong>
              @if (d.contact; as c) {
                {{ c.fullName || 'No name' }}
                @if (c.email) {
                  · {{ c.email }}
                }
                @if (c.phone) {
                  · {{ c.phone }}
                }
              } @else {
                Anonymous
              }
            </p>
            @if (d.consent; as c) {
              <p class="muted mt-2 mb-0">
                Text permission at submission: review request
                {{ c.reviewRequestSms ? 'yes' : 'no' }}, promotions
                {{ c.marketingSms ? 'yes' : 'no' }}.
              </p>
            }
          </div>
          <dl class="m-0">
            @for (a of d.answers; track a.questionId) {
              <dt>{{ a.label }}</dt>
              <dd>
                @switch (a.type) {
                  @case ('rating') {
                    <span class="badge brand">{{ a.rating }} / 5</span>
                  }
                  @case ('single_choice') {
                    {{ a.choices[0]?.label }}
                  }
                  @case ('multiple_choice') {
                    @for (c of a.choices; track c.id; let last = $last) {
                      {{ c.label }}{{ last ? '' : ', ' }}
                    }
                  }
                  @default {
                    <span class="pre">{{ a.text }}</span>
                  }
                }
              </dd>
            }
          </dl>
        </section>
      }
    </main>
  `,
})
export class ResponsesPage {
  private readonly api = inject(FeedbackApi);
  private readonly destroyRef = inject(DestroyRef);
  private listRequest?: Subscription;
  private detailRequest?: Subscription;
  private business: Business | null = null;

  protected readonly draft = signal<ResponseFilters>({ ...EMPTY });
  private applied: ResponseFilters = { ...EMPTY };
  protected readonly items = signal<ResponseItem[]>([]);
  protected readonly pagination = signal<Pagination | null>(null);
  protected readonly detail = signal<ResponseDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly detailError = signal<string | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly filtered = signal(false);

  constructor() {
    inject(BusinessApi)
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.business = list[0] ?? null;
          this.load();
        },
        error: (err: unknown) => {
          this.error.set(apiErrorMessage(err));
          this.loading.set(false);
        },
      });
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected set(key: keyof ResponseFilters, value: string): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  protected apply(): void {
    const draft = this.draft();
    if (draft.from && draft.to && draft.from > draft.to) {
      this.error.set('The start date must be on or before the end date.');
      return;
    }
    this.applied = { ...this.draft(), page: 1 };
    this.load();
  }

  protected reset(): void {
    this.draft.set({ ...EMPTY });
    this.applied = { ...EMPTY };
    this.load();
  }

  protected go(page: number): void {
    this.applied = { ...this.applied, page };
    this.load();
  }

  protected load(): void {
    if (!this.business) {
      this.loading.set(false);
      return;
    }
    this.listRequest?.unsubscribe();
    this.closeDetail();
    this.loading.set(true);
    this.error.set(null);
    const f = this.applied;
    this.filtered.set(!!(f.search || f.rating || f.contact || f.from || f.to));
    this.listRequest = this.api
      .responses(this.business.id, f)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (p) => {
          this.items.set(p.data);
          this.pagination.set(p.pagination);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(apiErrorMessage(err));
          this.loading.set(false);
        },
      });
  }

  protected open(id: string): void {
    if (!this.business) return;
    this.detailRequest?.unsubscribe();
    this.detail.set(null);
    this.detailLoading.set(true);
    this.detailError.set(null);
    this.detailRequest = this.api
      .response(this.business.id, id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (d) => {
          this.detail.set(d);
          this.detailLoading.set(false);
        },
        error: (err: unknown) => {
          this.detailError.set(apiErrorMessage(err));
          this.detailLoading.set(false);
        },
      });
  }

  @HostListener('document:keydown.escape')
  protected closeDetail(): void {
    this.detailRequest?.unsubscribe();
    this.detailLoading.set(false);
    this.detailError.set(null);
    this.detail.set(null);
  }
}
