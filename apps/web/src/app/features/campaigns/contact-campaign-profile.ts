import { AppSelect } from '../../shared/app-select';
import { HttpClient } from '@angular/common/http';
import { Component, Input, OnChanges, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { ContactItem } from '../../core/feedback/feedback.service';
import { apiErrorMessage } from '../../core/auth/auth.service';
@Component({
  selector: 'app-contact-campaign-profile',
  imports: [AppSelect, FormsModule],
  template: `
    <h3>Campaign profile</h3>
    <form (ngSubmit)="save()">
      <div class="field">
        <label for="profile-birthday">Birthday (MM-DD)</label
        ><input
          id="profile-birthday"
          name="birthday"
          [(ngModel)]="birthday"
          placeholder="12-25"
          pattern="[0-9]{2}-[0-9]{2}"
        />
      </div>
      <div class="field">
        <label for="profile-anniversary">Anniversary (MM-DD)</label
        ><input
          id="profile-anniversary"
          name="anniversary"
          [(ngModel)]="anniversary"
          placeholder="06-15"
          pattern="[0-9]{2}-[0-9]{2}"
        />
      </div>
      <div class="field">
        <label for="profile-tags">Tags (comma separated)</label
        ><input id="profile-tags" name="tags" [(ngModel)]="tags" />
      </div>
      <div class="field">
        <label for="profile-segment">Segment</label
        ><input id="profile-segment" name="segment" [(ngModel)]="segment" maxlength="80" />
      </div>
      <div class="field">
        <label for="profile-loyalty">Loyalty level</label
        ><input id="profile-loyalty" name="loyalty" [(ngModel)]="loyalty" maxlength="80" />
      </div>
      @if (message()) {
        <p role="status">{{ message() }}</p>
      }
      <button class="btn secondary" type="submit" [disabled]="busy()">Save campaign profile</button>
    </form>
    <h3>Promotional email consent</h3>
    <p>Recorded consent: {{ marketingEmail?.state ?? 'not recorded' }}</p>
    <p class="muted">
      Record only explicit email permission with its evidence. SMS consent does not qualify.
      Customer unsubscribe and provider suppressions cannot be overridden.
    </p>
    <form (ngSubmit)="saveConsent()">
      <div class="field">
        <label for="marketing-state">Consent decision</label
        ><select
          appSelect
          id="marketing-state"
          name="marketingState"
          [(ngModel)]="marketingState"
          required
        >
          <option value="">Choose a decision</option>
          <option value="granted">Record explicit consent</option>
          <option value="revoked">Revoke consent</option>
        </select>
      </div>
      <div class="field">
        <label for="marketing-evidence">Evidence / reason</label
        ><textarea
          id="marketing-evidence"
          name="evidence"
          [(ngModel)]="evidence"
          minlength="10"
          maxlength="1000"
          required
        ></textarea>
      </div>
      <button
        class="btn secondary"
        type="submit"
        [disabled]="busy() || !marketingState || evidence.trim().length < 10"
      >
        Record email consent
      </button>
    </form>
  `,
})
export class ContactCampaignProfile implements OnChanges {
  @Input({ required: true }) businessId = '';
  @Input({ required: true }) contact!: ContactItem;
  @Input() marketingEmail: { state: string; at: string } | null = null;
  private http = inject(HttpClient);
  protected birthday = '';
  protected anniversary = '';
  protected tags = '';
  protected segment = '';
  protected loyalty = '';
  protected busy = signal(false);
  protected message = signal('');
  protected marketingState = '';
  protected evidence = '';
  protected saveConsent() {
    this.busy.set(true);
    this.message.set('');
    this.http
      .patch(`/api/v1/businesses/${this.businessId}/contacts/${this.contact.id}/marketing-email`, {
        state: this.marketingState,
        evidence: this.evidence,
      })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          this.marketingEmail = { state: this.marketingState, at: new Date().toISOString() };
          this.message.set('Promotional email consent recorded.');
        },
        error: (e) => this.message.set(apiErrorMessage(e)),
      });
  }
  ngOnChanges() {
    this.birthday = this.contact.birthday ?? '';
    this.anniversary = this.contact.anniversary ?? '';
    this.tags = (this.contact.tags ?? []).join(', ');
    this.segment = this.contact.segment ?? '';
    this.loyalty = this.contact.loyaltyLevel ?? '';
  }
  protected save() {
    const input = {
      birthday: this.birthday || null,
      anniversary: this.anniversary || null,
      tags: this.tags
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
      segment: this.segment || null,
      loyaltyLevel: this.loyalty || null,
    };
    this.busy.set(true);
    this.message.set('');
    this.http
      .patch(
        `/api/v1/businesses/${this.businessId}/contacts/${this.contact.id}/campaign-profile`,
        input,
      )
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          Object.assign(this.contact, input);
          this.message.set('Campaign profile saved.');
        },
        error: (e) => this.message.set(apiErrorMessage(e)),
      });
  }
}
