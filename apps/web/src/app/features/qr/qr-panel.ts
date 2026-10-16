import { Component, inject, input, output, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { Icon } from '../../shared/icon';
import { QrInfo, QuestionnaireApi } from '../../core/questionnaire/questionnaire.service';

/** QR preview with copy-link, PNG/SVG download and print. The QR only encodes the public URL. */
@Component({
  selector: 'app-qr-panel',
  templateUrl: './qr-panel.html',
  imports: [Icon],
})
export class QrPanel {
  private readonly api = inject(QuestionnaireApi);
  private readonly document = inject(DOCUMENT);

  readonly businessId = input.required<string>();
  readonly businessName = input.required<string>();
  /** Emits whether the public form is live (the QR leads somewhere useful). */
  readonly readyChange = output<boolean>();

  protected readonly info = signal<QrInfo | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly copied = signal<'ok' | 'failed' | null>(null);

  protected isLoopback(url: string): boolean {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  }

  constructor() {
    queueMicrotask(() => this.load());
  }

  protected base(): string {
    return `/api/v1/businesses/${this.businessId()}/qr`;
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.qr(this.businessId()).subscribe({
      next: (info) => {
        this.info.set(info);
        this.loading.set(false);
        this.readyChange.emit(info.published);
      },
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  protected async copy(): Promise<void> {
    const url = this.info()?.publicUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set('ok');
    } catch {
      this.copied.set('failed');
    }
  }

  protected print(): void {
    this.document.defaultView?.print();
  }
}
