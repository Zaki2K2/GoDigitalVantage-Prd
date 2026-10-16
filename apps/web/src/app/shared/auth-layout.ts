import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BrandLogo } from './brand-logo';
import { Icon } from './icon';
import { ThemeService } from './theme.service';

/**
 * Two-column auth shell (TailAdmin "auth page layout"): form on the left via content projection,
 * brand panel on the right. The panel is illustrative only: no fake customers or numbers.
 */
@Component({
  selector: 'app-auth-layout',
  imports: [RouterLink, BrandLogo, Icon],
  template: `
    <div class="relative min-h-screen bg-white lg:grid lg:grid-cols-2 dark:bg-gray-950">
      <main class="relative flex min-h-screen flex-col justify-center px-5 py-10 sm:px-10">
        <a
          routerLink="/login"
          class="absolute top-6 left-5 no-underline sm:left-10"
          aria-label="GoDigitalVantage"
        >
          <app-brand-logo />
        </a>
        <div class="mx-auto w-full max-w-md animate-fade-up">
          <ng-content />
        </div>
        <button
          type="button"
          class="icon-btn absolute top-6 right-5 sm:right-10"
          (click)="theme.toggle()"
          [attr.aria-label]="
            theme.theme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
          "
        >
          <app-icon [name]="theme.theme() === 'dark' ? 'sun' : 'moon'" />
        </button>
      </main>

      <aside
        class="auth-story relative isolate hidden overflow-hidden bg-gray-950 lg:flex lg:flex-col lg:justify-center lg:px-14 xl:px-20"
        aria-hidden="true"
      >
        <img
          class="auth-photo"
          src="/assets/coffee-experience.webp"
          alt=""
          width="1400"
          height="933"
          loading="lazy"
        />
        <div class="glow top-[-6rem] right-[-4rem] size-[28rem] bg-brand-500/30"></div>
        <div class="glow bottom-[-8rem] left-[-6rem] size-[26rem] bg-blue-light-500/25"></div>
        <svg class="absolute inset-0 -z-1 size-full opacity-[0.12]" aria-hidden="true">
          <defs>
            <pattern id="auth-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0V48" fill="none" stroke="white" stroke-width="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#auth-grid)" />
        </svg>

        <div class="relative max-w-lg">
          <p class="eyebrow mb-4 !text-brand-300">Customer feedback, simplified</p>
          <h2 class="mb-8 text-title-sm leading-tight font-semibold text-white xl:text-title-md">
            Every experience.<br />A chance to grow.
          </h2>

          <ol class="m-0 flex flex-col gap-4 p-0">
            @for (s of steps; track s.title) {
              <li
                class="flex list-none items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm"
              >
                <span
                  class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/25 to-blue-light-500/25 text-brand-300"
                >
                  <app-icon [name]="s.icon" [size]="22" />
                </span>
                <div>
                  <p class="m-0 text-theme-sm font-semibold text-white">{{ s.title }}</p>
                  <p class="m-0 mt-0.5 text-theme-sm text-gray-400">{{ s.text }}</p>
                </div>
              </li>
            }
          </ol>
        </div>
      </aside>
    </div>
  `,
})
export class AuthLayout {
  protected readonly theme = inject(ThemeService);
  protected readonly steps = [
    {
      icon: 'qr',
      title: 'Scan',
      text: 'Customers open your form from a QR code. No app or login.',
    } as const,
    {
      icon: 'responses',
      title: 'Listen',
      text: 'Every answer lands in one clean inbox, exactly as it was given.',
    } as const,
    {
      icon: 'shield',
      title: 'Respect consent',
      text: 'Contact permission is separate, optional and always recorded.',
    } as const,
  ];
}
