import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { Business, BusinessApi } from '../../core/business/business.service';
import { Icon } from '../../shared/icon';
import { QuestionnaireBuilder } from './questionnaire-builder';

@Component({
  selector: 'app-questionnaire-page',
  imports: [QuestionnaireBuilder, RouterLink, Icon],
  template: `
    <main class="page max-w-6xl">
      <div class="page-header">
        <div>
          <p class="eyebrow">Setup</p>
          <h1>Questionnaire</h1>
          <p class="sub">
            Customers see the published version. Your QR code and link
            <a routerLink="/qr">stay the same</a> when you publish changes.
          </p>
        </div>
      </div>
      @if (error(); as message) {
        <div class="alert" role="alert">
          <app-icon name="alert" [size]="18" /><span>{{ message }}</span>
        </div>
      } @else if (business(); as b) {
        <app-questionnaire-builder [businessId]="b.id" [canEdit]="b.role === 'owner'" />
      } @else {
        <div class="card"><div class="skeleton h-40 w-full"></div></div>
      }
    </main>
  `,
})
export class QuestionnairePage {
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
