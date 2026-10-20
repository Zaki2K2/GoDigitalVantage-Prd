import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { apiErrorMessage, AuthService } from '../core/auth/auth.service';
import { Avatar } from './avatar';
import { ACCEPTED_IMAGE_TYPES, ImageError, prepareImage } from './image-resize';
import { Icon } from './icon';

/** Upload / replace / remove control for an optional avatar or logo. */
@Component({
  selector: 'app-image-upload',
  imports: [Avatar, Icon],
  template: `
    <div class="flex flex-wrap items-center gap-4">
      <app-avatar
        [src]="url()"
        [name]="name()"
        [size]="72"
        [shape]="kind() === 'avatar' ? 'circle' : 'square'"
      />
      <div class="min-w-0">
        @if (canEdit()) {
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn secondary sm" [disabled]="busy()" (click)="pick()">
              <app-icon name="plus" [size]="14" />
              {{ busy() ? 'Working…' : url() ? 'Replace ' + noun() : 'Upload ' + noun() }}
            </button>
            @if (url()) {
              <button type="button" class="btn secondary sm" [disabled]="busy()" (click)="remove()">
                Remove
              </button>
            }
          </div>
          <input
            #file
            type="file"
            class="hidden"
            [accept]="accept"
            [attr.aria-label]="'Choose ' + noun() + ' file'"
            (change)="chosen($event)"
          />
          <p class="muted mt-2 mb-0 text-theme-xs">
            Optional. PNG, JPG or WebP up to 5 MB; resized automatically.
          </p>
        } @else {
          <p class="muted m-0 text-theme-sm">
            {{ url() ? 'Only the owner can change the ' + noun() + '.' : 'No ' + noun() + ' set.' }}
          </p>
        }
        @if (error(); as message) {
          <p class="mt-2 mb-0 text-theme-sm text-error-600 dark:text-error-400" role="alert">
            {{ message }}
          </p>
        }
      </div>
    </div>
  `,
})
export class ImageUpload {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly kind = input.required<'avatar' | 'logo'>();
  readonly endpoint = input.required<string>();
  readonly url = input<string | null | undefined>(null);
  readonly name = input('');
  readonly canEdit = input(true);
  /** New versioned URL, or null after removal. */
  readonly changed = output<string | null>();

  protected readonly accept = ACCEPTED_IMAGE_TYPES.join(',');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('file');

  protected noun(): string {
    return this.kind() === 'avatar' ? 'photo' : 'logo';
  }

  protected pick(): void {
    this.fileInput()?.nativeElement.click();
  }

  protected async chosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set(null);
    this.busy.set(true);
    try {
      const blob = await prepareImage(file, this.kind());
      this.auth
        .withCsrf(() =>
          this.http.put<{ data: Record<string, string> }>(this.endpoint(), blob, {
            headers: { 'Content-Type': blob.type },
          }),
        )
        .subscribe({
          next: (res) => {
            this.busy.set(false);
            this.changed.emit(Object.values(res.data)[0] ?? null);
          },
          error: (err: unknown) => {
            this.busy.set(false);
            this.error.set(apiErrorMessage(err));
          },
        });
    } catch (err) {
      this.busy.set(false);
      this.error.set(err instanceof ImageError ? err.message : 'This image could not be used.');
    }
  }

  protected remove(): void {
    this.error.set(null);
    this.busy.set(true);
    this.auth
      .withCsrf(() => this.http.delete<void>(this.endpoint()))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.changed.emit(null);
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.error.set(apiErrorMessage(err));
        },
      });
  }
}
