import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { AdminApi } from './admin.api';

interface Grant {
  id: string;
  businessId: string;
  ticketRef: string;
  scopes: string[];
  mode: string;
  status: string;
  emergency: boolean;
  review: { status?: string } | null;
  expiresAt: string | null;
}
const SCOPES = ['business_profile', 'forms', 'responses', 'contacts', 'rewards', 'campaigns'];

/** Platform-side request and tracking of business-approved, time-boxed support access. */
@Component({
  selector: 'app-support-access',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="card mb-4">
      <h2>Privacy-preserving support access</h2>
      <p class="sub">
        Customer contacts, answers, rewards and message content belong to each business. They stay
        hidden from platform administration unless the business owner approves a scoped,
        time-limited request tied to a support ticket. Every use is recorded and cannot be edited.
      </p>
    </div>
    <form class="card mb-4 grid gap-3" (submit)="$event.preventDefault(); request()">
      <h3>Request access</h3>
      <div class="field">
        <label for="sa-business">Business ID</label
        ><input id="sa-business" name="businessId" [(ngModel)]="businessId" required />
      </div>
      <div class="field">
        <label for="sa-ticket">Support ticket</label
        ><input id="sa-ticket" name="ticketRef" [(ngModel)]="ticketRef" required />
      </div>
      <div class="field">
        <label for="sa-reason">Reason shown to the owner</label
        ><textarea
          id="sa-reason"
          name="reason"
          [(ngModel)]="reason"
          required
          minlength="10"
        ></textarea>
      </div>
      <fieldset class="field">
        <legend>Areas</legend>
        @for (s of scopes; track s) {
          <label class="mr-3 inline-flex items-center gap-1"
            ><input type="checkbox" [checked]="chosen().includes(s)" (change)="toggle(s)" />
            {{ s }}</label
          >
        }
      </fieldset>
      <div class="field">
        <label for="sa-mode">Access level</label
        ><select id="sa-mode" name="mode" [(ngModel)]="mode">
          <option value="read">Read only</option>
          <option value="write">Read and change (needs owner password)</option>
        </select>
      </div>
      <div class="field">
        <label for="sa-duration">Duration (minutes, 15-1440)</label
        ><input
          id="sa-duration"
          type="number"
          name="duration"
          [(ngModel)]="duration"
          min="15"
          max="1440"
        />
      </div>
      <div><button class="btn sm" type="submit">Send request to owner</button></div>
    </form>
    <form
      class="card mb-4 flex flex-wrap items-end gap-2"
      (submit)="$event.preventDefault(); confirmIdentity()"
    >
      <div class="field">
        <label for="sa-pw">Confirm your password for sensitive actions</label
        ><input
          id="sa-pw"
          type="password"
          name="pw"
          autocomplete="current-password"
          [(ngModel)]="password"
        />
      </div>
      <button class="btn secondary sm" type="submit">Re-authenticate (5 min)</button>
    </form>
    @if (message()) {
      <p role="status" class="sub">{{ message() }}</p>
    }
    <div class="card">
      <h3>Requests and grants</h3>
      @for (g of grants(); track g.id) {
        <article class="list-row">
          <div>
            <strong>{{ g.ticketRef }}</strong>
            <span class="badge">{{ g.status }}</span>
            @if (g.emergency) {
              <span class="badge danger">Emergency · review {{ g.review?.status }}</span>
            }
            <p class="sub mb-0">
              {{ g.scopes.join(', ') }} · {{ g.mode }}
              @if (g.expiresAt) {
                · until {{ g.expiresAt | date: 'medium' }}
              }
            </p>
          </div>
          @if (g.status === 'pending' || g.status === 'active') {
            <button class="btn secondary sm" (click)="cancel(g)">Cancel</button>
          }
        </article>
      } @empty {
        <p class="sub">No requests yet.</p>
      }
    </div>
  `,
})
export class SupportAccess {
  private readonly api = inject(AdminApi);
  private readonly destroy = inject(DestroyRef);
  protected readonly scopes = SCOPES;
  protected readonly grants = signal<Grant[]>([]);
  protected readonly chosen = signal<string[]>([]);
  protected readonly message = signal('');
  protected businessId = '';
  protected ticketRef = '';
  protected reason = '';
  protected mode = 'read';
  protected duration = 60;
  protected password = '';

  constructor() {
    this.load();
  }
  protected toggle(scope: string) {
    this.chosen.update((v) => (v.includes(scope) ? v.filter((s) => s !== scope) : [...v, scope]));
  }
  protected load() {
    this.api
      .get<{ data: Grant[] }>('support-grants')
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (r) => this.grants.set(r.data),
        error: (e) => this.message.set(apiErrorMessage(e)),
      });
  }
  protected request() {
    this.api
      .write('support-grants', {
        businessId: this.businessId.trim(),
        ticketRef: this.ticketRef.trim(),
        reason: this.reason.trim(),
        scopes: this.chosen(),
        mode: this.mode,
        durationMinutes: Number(this.duration),
      })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => {
          this.message.set('Request sent. The business owner must approve it before any access.');
          this.load();
        },
        error: (e) => this.message.set(apiErrorMessage(e)),
      });
  }
  protected cancel(g: Grant) {
    this.api
      .write(`support-grants/${g.id}/cancel`, {})
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({ next: () => this.load(), error: (e) => this.message.set(apiErrorMessage(e)) });
  }
  protected confirmIdentity() {
    this.api
      .write('reauth', { password: this.password })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => {
          this.password = '';
          this.message.set('Identity confirmed for five minutes.');
        },
        error: (e) => this.message.set(apiErrorMessage(e)),
      });
  }
}
