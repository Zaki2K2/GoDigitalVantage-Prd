import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { AuthService, apiErrorMessage } from '../../core/auth/auth.service';
import { Business, BusinessApi } from '../../core/business/business.service';

interface Grant {
  id: string;
  ticketRef: string;
  reason: string;
  scopes: string[];
  mode: string;
  durationMinutes: number;
  status: string;
  emergency: boolean;
  expiresAt: string | null;
  createdAt: string;
}

/** Business-owner control over platform support access to this business's own data. */
@Component({
  selector: 'app-support-access-card',
  imports: [DatePipe, FormsModule],
  template: `
    <section id="support-access" class="card">
      <h2>Support access</h2>
      <p class="muted">
        Platform administrators cannot see your customers, answers or rewards. If you ask support
        for help, they may request time-limited access to specific areas. Nothing is visible until
        you approve it, and you can revoke it at any time.
      </p>
      @if (!business()) {
        <p class="muted">Only business owners can manage support access.</p>
      } @else {
        @if (message()) {
          <p role="status" class="muted">{{ message() }}</p>
        }
        @for (g of grants(); track g.id) {
          <article class="list-row" [attr.data-grant]="g.id">
            <div>
              <strong>{{ g.ticketRef }}</strong>
              <span class="badge" [class.success]="g.status === 'active'">{{ g.status }}</span>
              @if (g.emergency) {
                <span class="badge danger">Emergency access</span>
              }
              <p class="muted mb-1">{{ g.reason }}</p>
              <p class="muted mb-1">
                Areas: {{ g.scopes.join(', ') }} ·
                {{ g.mode === 'write' ? 'Can change data' : 'Read only' }} ·
                {{ g.durationMinutes }} min
                @if (g.expiresAt) {
                  · expires {{ g.expiresAt | date: 'medium' }}
                }
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              @if (g.status === 'pending') {
                @if (g.mode === 'write') {
                  <input
                    type="password"
                    class="input"
                    autocomplete="current-password"
                    [name]="'pw-' + g.id"
                    [(ngModel)]="password"
                    placeholder="Confirm your password"
                    aria-label="Confirm your password to approve write access"
                  />
                }
                <button class="btn secondary sm" (click)="act(g, 'approve')">Approve</button>
                <button class="btn secondary sm" (click)="act(g, 'deny')">Deny</button>
              }
              @if (g.status === 'active') {
                <button class="btn secondary sm" (click)="act(g, 'revoke')">Revoke now</button>
              }
            </div>
          </article>
        } @empty {
          <p class="muted">No support access has been requested.</p>
        }
      }
    </section>
  `,
})
export class SupportAccessCard {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly destroy = inject(DestroyRef);
  protected readonly business = signal<Business | null>(null);
  protected readonly grants = signal<Grant[]>([]);
  protected readonly message = signal('');
  protected password = '';

  constructor() {
    inject(BusinessApi)
      .list()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((rows) => {
        const owned = rows.find((b) => b.role === 'owner') ?? null;
        this.business.set(owned);
        if (owned) this.load();
      });
  }

  private url(path = '') {
    return `/api/v1/businesses/${this.business()!.id}/support-grants${path}`;
  }
  protected load() {
    this.http
      .get<{ data: Grant[] }>(this.url())
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (r) => this.grants.set(r.data),
        error: (e) => this.message.set(apiErrorMessage(e)),
      });
  }
  protected act(grant: Grant, action: 'approve' | 'deny' | 'revoke') {
    const body = action === 'approve' && grant.mode === 'write' ? { password: this.password } : {};
    const done = { approve: 'approved', deny: 'denied', revoke: 'revoked' }[action];
    this.auth
      .withCsrf(() => this.http.post(this.url(`/${grant.id}/${action}`), body))
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => {
          this.password = '';
          this.message.set(`Access ${done}.`);
          this.load();
        },
        error: (e) => this.message.set(apiErrorMessage(e)),
      });
  }
}
