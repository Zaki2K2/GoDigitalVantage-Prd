import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { Business, BusinessApi, BusinessInput } from '../../core/business/business.service';
import { Avatar } from '../../shared/avatar';
import { Icon } from '../../shared/icon';
import { ImageUpload } from '../../shared/image-upload';
import { BusinessForm } from './business-form';

@Component({
  selector: 'app-profile-page',
  imports: [Avatar, BusinessForm, ImageUpload, RouterLink, Icon],
  templateUrl: './profile.page.html',
})
export class ProfilePage {
  private readonly api = inject(BusinessApi);

  protected readonly business = signal<Business | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly saved = signal(false);

  constructor() {
    this.api.list().subscribe({
      next: (list) => {
        this.business.set(list[0] ?? null);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loadError.set(apiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  protected logoChanged(b: Business, url: string | null): void {
    this.api.setLogo(b.id, url);
    this.business.set({ ...b, logoUrl: url });
  }

  protected rows(b: Business): [string, string][] {
    return [
      ['Name', b.name],
      ['Category', b.category],
      ['Email', b.email || '—'],
      ['Phone', b.phone || '—'],
      ['Address', b.address || '—'],
      ['Time zone', b.timezone],
      ['Google review link', b.googleReviewUrl || '—'],
    ];
  }

  protected startEdit(): void {
    this.saved.set(false);
    this.saveError.set(null);
    this.editing.set(true);
  }

  protected save(input: BusinessInput): void {
    const current = this.business();
    if (!current) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.api.update(current.id, input).subscribe({
      next: (b) => {
        this.business.set(b);
        this.saving.set(false);
        this.editing.set(false);
        this.saved.set(true);
      },
      error: (err: unknown) => {
        this.saveError.set(apiErrorMessage(err));
        this.saving.set(false);
      },
    });
  }
}
