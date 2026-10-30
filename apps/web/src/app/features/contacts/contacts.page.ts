import { DatePipe } from '@angular/common';
import { ContactCampaignProfile } from '../campaigns/contact-campaign-profile';
import { ContactFollowUp } from './contact-followup';
import { Component, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { Icon } from '../../shared/icon';
import { DialogFocus } from '../../shared/dialog-focus';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { Business, BusinessApi } from '../../core/business/business.service';
import {
  ContactDetail,
  ContactItem,
  FeedbackApi,
  Pagination,
} from '../../core/feedback/feedback.service';

/** Customers who chose to share an email or phone. Anonymous responses never appear here. */
@Component({
  selector: 'app-contacts-page',
  imports: [DatePipe, Icon, DialogFocus, ContactCampaignProfile, ContactFollowUp],
  template: `
    <main class="page">
      <header class="page-header">
        <div>
          <p class="eyebrow">Customers</p>
          <h1>Contacts</h1>
          <p class="sub">
            Only customers who shared an email or phone number. Text-message permission is shown
            separately and is never assumed from a submission.
          </p>
        </div>
        <div class="flex items-center gap-3">
          @if (pagination(); as p) {
            <span class="badge brand">{{ p.total }} total</span>
          }
          @if (business?.role === 'owner') {
            <button type="button" class="btn" (click)="adding.set(!adding())">Add contact</button>
          }
        </div>
      </header>

      @if (adding()) {
        <form
          class="card toolbar"
          (submit)="$event.preventDefault(); create()"
          aria-label="Add contact"
        >
          <div class="field grow">
            <label for="nc-name">Name (optional)</label>
            <input
              id="nc-name"
              maxlength="120"
              [value]="newName()"
              (input)="newName.set(val($event))"
            />
          </div>
          <div class="field grow">
            <label for="nc-email">Email</label>
            <input
              id="nc-email"
              type="email"
              [value]="newEmail()"
              (input)="newEmail.set(val($event))"
            />
          </div>
          <div class="field grow">
            <label for="nc-phone">Phone (with country code)</label>
            <input
              id="nc-phone"
              type="tel"
              placeholder="+14155550123"
              [value]="newPhone()"
              (input)="newPhone.set(val($event))"
            />
          </div>
          <div class="field btns">
            <button
              type="submit"
              class="btn"
              [disabled]="saving() || (!newEmail().trim() && !newPhone().trim())"
            >
              Save contact
            </button>
          </div>
          <p class="muted w-full">
            Enter an email or a phone number. Added contacts have no text or promotional permission
            until the customer gives it.
          </p>
          @if (addError(); as message) {
            <div class="alert w-full" role="alert">{{ message }}</div>
          }
        </form>
      }

      @if (error(); as message) {
        <div class="alert" role="alert">
          <span class="flex-1">{{ message }}</span>
          <button type="button" class="btn secondary sm" (click)="load()">Try again</button>
        </div>
      }

      <form class="toolbar" (submit)="$event.preventDefault(); apply()">
        <div class="field grow">
          <label for="c-search">Search</label>
          <input
            id="c-search"
            type="search"
            placeholder="Name, email or phone"
            [value]="search()"
            (input)="search.set(val($event))"
          />
        </div>
        <div class="field btns">
          <button type="submit" class="btn" [disabled]="loading()">Search</button>
          <button type="button" class="btn secondary" (click)="clear()">Clear</button>
        </div>
      </form>

      @if (loading()) {
        <div class="flex flex-col gap-2" role="status" aria-label="Loading contacts">
          @for (i of [1, 2, 3]; track i) {
            <div class="skeleton h-16 !rounded-xl"></div>
          }
        </div>
      } @else if (items().length === 0 && !error()) {
        <div class="card empty">
          <p>
            @if (applied()) {
              No contacts match your search.
            } @else {
              No contacts yet. Customers appear here when they leave an email or phone number.
            }
          </p>
        </div>
      } @else if (!error()) {
        <ul class="rows" aria-label="Contacts">
          @for (c of items(); track c.id) {
            <li>
              <button
                type="button"
                class="list-row"
                [class.sel]="detail()?.contact?.id === c.id"
                (click)="open(c.id)"
              >
                <span class="score">{{ c.responseCount }}</span>
                <span class="main">
                  <strong>{{ c.fullName || c.email || c.phone }}</strong>
                  <span class="muted"
                    >{{ c.email }}{{ c.email && c.phone ? ' · ' : '' }}{{ c.phone }}</span
                  >
                </span>
                <time class="muted" [attr.datetime]="c.lastResponseAt">{{
                  c.lastResponseAt | date: 'mediumDate'
                }}</time>
              </button>
            </li>
          }
        </ul>
        @if (pagination(); as p) {
          <nav class="pager" aria-label="Pagination">
            <button
              type="button"
              class="btn secondary"
              [disabled]="p.page <= 1"
              (click)="go(p.page - 1)"
            >
              Previous
            </button>
            <span>Page {{ p.page }} of {{ p.totalPages }} · {{ p.total }} total</span>
            <button
              type="button"
              class="btn secondary"
              [disabled]="p.page >= p.totalPages"
              (click)="go(p.page + 1)"
            >
              Next
            </button>
          </nav>
        }
      }

      @if (detailLoading()) {
        <p role="status" class="muted mt-3">Loading contact details…</p>
      }
      @if (detailError(); as message) {
        <div class="alert" role="alert">{{ message }}</div>
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
          aria-labelledby="cd-h"
        >
          <div class="mb-1 flex items-start justify-between gap-3">
            <h2 id="cd-h" class="!mb-0">
              {{ d.contact.fullName || d.contact.email || d.contact.phone }}
            </h2>
            <button
              type="button"
              class="drawer-close icon-btn !size-9"
              aria-label="Close details"
              (click)="closeDetail()"
            >
              <app-icon name="close" [size]="18" />
            </button>
          </div>
          <p class="muted">
            {{ d.contact.email }}{{ d.contact.email && d.contact.phone ? ' · ' : ''
            }}{{ d.contact.phone }}
          </p>
          <p>
            <strong>Text permission:</strong>
            review request
            {{
              d.contact.consent.reviewRequestSms
                ? 'granted ' + (d.contact.consent.reviewRequestSms | date: 'mediumDate')
                : 'not granted'
            }}; WhatsApp follow-up
            {{
              d.contact.consent.whatsappFollowUp
                ? 'granted ' + (d.contact.consent.whatsappFollowUp | date: 'mediumDate')
                : 'not granted'
            }}; promotions
            {{
              d.contact.consent.marketingSms
                ? 'granted ' + (d.contact.consent.marketingSms | date: 'mediumDate')
                : 'not granted'
            }}.
          </p>
          @if (business?.role === 'owner') {
            <app-contact-campaign-profile
              [businessId]="business!.id"
              [contact]="d.contact"
              [marketingEmail]="d.marketingEmail ?? null"
            />
          }
          <app-contact-followup
            [businessId]="business!.id"
            [contact]="d.contact"
            [canSend]="business?.role === 'owner'"
          />
          <h3>Consent history</h3>
          @if (d.consentEvents.length === 0) {
            <p class="muted">No permission recorded.</p>
          } @else {
            <ul class="plain">
              @for (e of d.consentEvents; track e.id) {
                <li>
                  {{ e.capturedAt | date: 'medium' }} — {{ e.purpose }} {{ e.choice }} via
                  {{ e.source }} (wording {{ e.wordingVersion }})
                </li>
              }
            </ul>
          }
          <h3>Responses ({{ d.contact.responseCount }})</h3>
          <ul class="plain">
            @for (r of d.responses; track r.id) {
              <li>{{ r.submittedAt | date: 'medium' }} — rating {{ r.rating ?? 'none' }}</li>
            }
          </ul>
        </section>
      }
    </main>
  `,
})
export class ContactsPage {
  private readonly api = inject(FeedbackApi);
  private readonly destroyRef = inject(DestroyRef);
  private listRequest?: Subscription;
  private detailRequest?: Subscription;
  protected business: Business | null = null;
  private page = 1;

  protected readonly search = signal('');
  protected readonly applied = signal('');
  protected readonly items = signal<ContactItem[]>([]);
  protected readonly pagination = signal<Pagination | null>(null);
  protected readonly detail = signal<ContactDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly detailError = signal<string | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly adding = signal(false);
  protected readonly saving = signal(false);
  protected readonly addError = signal<string | null>(null);
  protected readonly newName = signal('');
  protected readonly newEmail = signal('');
  protected readonly newPhone = signal('');

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
    return (e.target as HTMLInputElement).value;
  }

  protected apply(): void {
    this.applied.set(this.search().trim());
    this.page = 1;
    this.load();
  }

  protected create(): void {
    if (!this.business) return;
    this.saving.set(true);
    this.addError.set(null);
    this.api
      .createContact(this.business.id, {
        fullName: this.newName().trim() || undefined,
        email: this.newEmail().trim() || undefined,
        phone: this.newPhone().trim() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (c) => {
          this.saving.set(false);
          this.adding.set(false);
          this.newName.set('');
          this.newEmail.set('');
          this.newPhone.set('');
          this.search.set('');
          this.applied.set('');
          this.page = 1;
          this.load();
          this.open(c.id);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          const details = (err as { error?: { error?: { details?: Record<string, string[]> } } })
            ?.error?.error?.details;
          const first = details ? Object.values(details).flat()[0] : undefined;
          this.addError.set(first ?? apiErrorMessage(err));
        },
      });
  }

  protected clear(): void {
    this.search.set('');
    this.apply();
  }

  protected go(page: number): void {
    this.page = page;
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
    this.listRequest = this.api
      .contacts(this.business.id, this.page, this.applied())
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
      .contact(this.business.id, id)
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
