import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { finalize } from 'rxjs';
import { apiErrorMessage } from '../../core/auth/auth.service';
@Component({
  selector: 'app-email-preferences-page',
  template: `<main class="page">
    <section class="card mx-auto max-w-xl">
      <p class="eyebrow">Email preferences</p>
      <h1>Promotional emails</h1>
      @if (done()) {
        <p role="status">You are unsubscribed from promotional emails from this business.</p>
      } @else {
        <p>Stop promotional emails from the business that sent this message.</p>
        <button class="btn" [disabled]="!token || busy()" (click)="unsubscribe()">
          Unsubscribe
        </button>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
    </section>
  </main>`,
})
export class EmailPreferencesPage {
  private http = inject(HttpClient);
  protected busy = signal(false);
  protected done = signal(false);
  protected error = signal('');
  protected token = '';
  constructor() {
    this.token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
    history.replaceState(null, '', location.pathname);
    if (!this.token || this.token.length > 1000) {
      this.token = '';
      this.error.set('Open the unsubscribe link from your email.');
    }
  }
  protected unsubscribe() {
    if (!this.token || this.busy()) return;
    this.busy.set(true);
    this.http
      .post(`/api/v1/public/campaign-unsubscribe/${encodeURIComponent(this.token)}`, {})
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          this.done.set(true);
          this.token = '';
        },
        error: (e) => this.error.set(apiErrorMessage(e)),
      });
  }
}
