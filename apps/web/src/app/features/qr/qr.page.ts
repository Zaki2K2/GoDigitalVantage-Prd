import { Component, inject, signal } from '@angular/core';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { Business, BusinessApi } from '../../core/business/business.service';
import { Icon } from '../../shared/icon';
import { QrPanel } from './qr-panel';

@Component({
  selector: 'app-qr-page',
  imports: [QrPanel, Icon],
  template: `
    <main class="page max-w-4xl">
      <div class="page-header">
        <div>
          <p class="eyebrow">Setup</p>
          <h1>QR code</h1>
          <p class="sub">
            Put it on tables, receipts or the front desk. Customers scan and answer.
          </p>
        </div>
      </div>
      @if (error(); as message) {
        <div class="alert" role="alert">
          <app-icon name="alert" [size]="18" /><span>{{ message }}</span>
        </div>
      } @else if (business(); as b) {
        <app-qr-panel [businessId]="b.id" [businessName]="b.name" />
      } @else {
        <div class="card"><div class="skeleton h-40 w-full"></div></div>
      }
    </main>
  `,
})
export class QrPage {
  protected readonly business = signal<Business | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    inject(BusinessApi)
      .list()
      .subscribe({
        next: (list) => this.business.set(list[0] ?? null),
        error: (err: unknown) => this.error.set(apiErrorMessage(err)),
      });
  }
}
