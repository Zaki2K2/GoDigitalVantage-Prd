import { Component, input } from '@angular/core';

/** GoDigitalVantage mark + wordmark. The mark is an upward trend line on a navy tile. */
@Component({
  selector: 'app-brand-logo',
  host: { class: 'inline-flex items-center gap-2.5' },
  template: `
    <svg width="36" height="36" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient [attr.id]="gid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#34d399" />
          <stop offset="1" stop-color="#0ba5ec" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="#0f1a30" />
      <path
        d="M9 21.5 14.2 16l3.3 3.2L23 11.5"
        fill="none"
        [attr.stroke]="'url(#' + gid + ')'"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="23" cy="11.5" r="2.4" [attr.fill]="'url(#' + gid + ')'" />
    </svg>
    @if (!compact()) {
      <span class="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">
        GoDigital<span class="text-brand-600 dark:text-brand-400">Vantage</span>
      </span>
    }
  `,
})
export class BrandLogo {
  readonly compact = input(false);
  private static n = 0;
  protected readonly gid = `gdv-g-${BrandLogo.n++}`;
}
