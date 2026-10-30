import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, Input, OnChanges, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { ContactItem } from '../../core/feedback/feedback.service';

interface FollowUpItem {
  id: string;
  direction: 'outbound' | 'inbound';
  channel: 'whatsapp_api' | 'click_to_chat';
  body: string;
  template: string | null;
  status: 'prepared' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
  errorCode: string | null;
  createdAt: string;
}

/** Manual WhatsApp follow-up for one customer. Nothing is sent until the owner clicks a button. */
@Component({
  selector: 'app-contact-followup',
  imports: [DatePipe, FormsModule],
  template: `
    <h3>WhatsApp follow-up</h3>
    @if (blocked(); as reason) {
      <p class="muted" role="status">{{ reason }}</p>
    } @else if (canSend) {
      <div class="field">
        <label for="fu-message">Message</label>
        <textarea
          id="fu-message"
          name="message"
          rows="3"
          maxlength="1000"
          [(ngModel)]="message"
        ></textarea>
      </div>
      <p class="muted">
        Sent only when you click. The official API can send free text only within 24 hours of the
        customer's reply; otherwise you will be asked to confirm sending the approved template.
      </p>
      <div class="flex flex-wrap gap-2">
        @if (apiEnabled()) {
          <button
            type="button"
            class="btn"
            [disabled]="busy() || !message.trim()"
            (click)="send('whatsapp_api')"
          >
            Send via WhatsApp
          </button>
        }
        <button
          type="button"
          class="btn secondary"
          [disabled]="busy() || !message.trim()"
          (click)="send('click_to_chat')"
        >
          Prepare click-to-chat
        </button>
      </div>
      @if (!apiEnabled()) {
        <p class="muted">WhatsApp Cloud API is not set up; use click-to-chat.</p>
      }
      @if (pendingTemplate(); as tpl) {
        <div class="alert" role="alertdialog" aria-label="Confirm template message">
          <div class="w-full">
            <p>
              This customer has not replied in the last 24 hours, so WhatsApp does not allow your
              typed message. <strong>Your message will NOT be sent.</strong> Instead the approved
              template <strong>"{{ tpl }}"</strong> would be sent. Its wording is fixed by WhatsApp
              and may not say what you typed.
            </p>
            <blockquote class="muted">Not sent: {{ message }}</blockquote>
            <div class="flex gap-2">
              <button
                type="button"
                class="btn"
                [disabled]="busy()"
                (click)="send('whatsapp_api', tpl)"
              >
                Send template "{{ tpl }}"
              </button>
              <button type="button" class="btn secondary" (click)="cancelTemplate()">Cancel</button>
            </div>
          </div>
        </div>
      }
      @if (link(); as href) {
        <p role="status">
          Message prepared.
          <a [href]="href" target="_blank" rel="noopener noreferrer">Open WhatsApp to send it</a>
        </p>
      }
    }
    @if (error(); as message) {
      <div class="alert" role="alert">{{ message }}</div>
    }
    <h4>History</h4>
    @if (items().length === 0) {
      <p class="muted">No follow-ups yet.</p>
    } @else {
      <ul class="plain" aria-label="Follow-up history">
        @for (f of items(); track f.id) {
          <li>
            {{ f.createdAt | date: 'medium' }} —
            {{ f.direction === 'inbound' ? 'Customer replied' : 'You' }}
            ({{ f.channel === 'click_to_chat' ? 'click-to-chat' : 'WhatsApp API' }}, {{ f.status
            }}{{ f.errorCode ? ': ' + errorHint(f.errorCode) : '' }}): {{ f.body }}
          </li>
        }
      </ul>
    }
  `,
})
export class ContactFollowUp implements OnChanges {
  private readonly http = inject(HttpClient);
  @Input({ required: true }) businessId!: string;
  @Input({ required: true }) contact!: ContactItem;
  @Input() canSend = false;

  protected message = '';
  protected readonly items = signal<FollowUpItem[]>([]);
  protected readonly apiEnabled = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly link = signal<string | null>(null);

  /** Plain-language reason for a stored provider error code (Meta codes are `meta_<code>`). */
  protected errorHint(code: string): string {
    switch (code) {
      case 'meta_190':
        return 'WhatsApp access token expired or invalid (meta_190). Generate a new token in Meta and restart the API';
      case 'meta_131030':
        return 'recipient is not on the Meta test allow-list (meta_131030)';
      case 'meta_131047':
        return 'more than 24h since the customer replied; a template is required (meta_131047)';
      case 'network_error':
        return 'could not reach WhatsApp (network_error)';
      default:
        return code;
    }
  }
  /** Set when WhatsApp only allows a template; the owner must confirm before anything is sent. */
  protected readonly pendingTemplate = signal<string | null>(null);

  private get base() {
    return `/api/v1/businesses/${this.businessId}`;
  }

  /** Mirrors the server rule so the owner sees why; the API enforces it regardless. */
  protected blocked(): string | null {
    if (!this.canSend) return null;
    const c = this.contact;
    if (!c.phone) return 'This customer did not share a phone number.';
    if (!c.consent.whatsappFollowUp)
      return 'This customer has not given WhatsApp follow-up permission, so follow-up is disabled. Review-request and promotional permissions do not cover it.';
    return null;
  }

  ngOnChanges(): void {
    this.link.set(null);
    this.error.set(null);
    this.http
      .get<{ data: FollowUpItem[] }>(`${this.base}/followups`, {
        params: { contactId: this.contact.id, pageSize: 20 },
      })
      .subscribe({
        next: (r) => this.items.set(r.data),
        error: (err: unknown) => this.error.set(apiErrorMessage(err)),
      });
    if (this.canSend)
      this.http
        .get<{ data: { whatsappApi: boolean } }>(`${this.base}/followups/config`)
        .subscribe({ next: (r) => this.apiEnabled.set(r.data.whatsappApi) });
  }

  protected cancelTemplate(): void {
    this.pendingTemplate.set(null);
  }

  protected send(channel: 'whatsapp_api' | 'click_to_chat', confirmTemplate?: string): void {
    this.busy.set(true);
    this.error.set(null);
    this.link.set(null);
    this.pendingTemplate.set(null);
    this.http
      .post<{ data: FollowUpItem; link: string | null }>(
        `${this.base}/contacts/${this.contact.id}/followups`,
        { channel, message: this.message.trim(), ...(confirmTemplate ? { confirmTemplate } : {}) },
      )
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (r) => {
          this.items.update((list) => [r.data, ...list]);
          this.link.set(r.link);
          this.message = '';
        },
        error: (err: unknown) => {
          const e = (
            err as { error?: { error?: { code?: string; details?: { template?: string } } } }
          )?.error?.error;
          if (e?.code === 'TEMPLATE_CONFIRMATION_REQUIRED' && e.details?.template)
            this.pendingTemplate.set(e.details.template);
          else this.error.set(apiErrorMessage(err));
        },
      });
  }
}
