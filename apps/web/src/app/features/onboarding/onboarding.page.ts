import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { finalize } from 'rxjs';
import { apiErrorMessage, AuthService } from '../../core/auth/auth.service';
import { ONBOARDING_STEPS, OnboardingStep } from '../../core/business/business.service';
import { BrandLogo } from '../../shared/brand-logo';
import { Icon, IconName } from '../../shared/icon';
import { ThemeService } from '../../shared/theme.service';
import { OnboardingStore } from './onboarding.store';

const STEP_INFO: Record<OnboardingStep, { label: string; icon: IconName; tip: string }> = {
  business: {
    label: 'Business',
    icon: 'business',
    tip: 'Your name and Google review link appear on the page customers see. You can change everything later, except the page address.',
  },
  questionnaire: {
    label: 'Questionnaire',
    icon: 'form',
    tip: 'Short forms get more answers. Keep one rating question and one open comment, then publish so customers can see it.',
  },
  confirm: {
    label: 'Confirm',
    icon: 'check-circle',
    tip: 'Check the details one last time. Your page address is permanent once your QR code is printed.',
  },
  qr: {
    label: 'QR code',
    icon: 'qr',
    tip: 'Print it or share the link. The code never changes, even when you edit or republish your questionnaire.',
  },
};

/** Guided wizard shell: brand bar, stepper with progress, the active step and a contextual tip. */
@Component({
  selector: 'app-onboarding-page',
  imports: [RouterOutlet, RouterLink, BrandLogo, Icon],
  template: `
    <div class="relative isolate min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      <div class="glow top-[-8rem] right-[-6rem] size-[30rem] bg-brand-500/15"></div>
      <div class="glow bottom-[-10rem] left-[-8rem] size-[28rem] bg-blue-light-500/10"></div>

      <header class="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 md:px-6">
        <a routerLink="/" class="no-underline" aria-label="GoDigitalVantage"><app-brand-logo /></a>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="icon-btn"
            (click)="theme.toggle()"
            [attr.aria-label]="
              theme.theme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
            "
          >
            <app-icon [name]="theme.theme() === 'dark' ? 'sun' : 'moon'" />
          </button>
          <button
            type="button"
            class="btn secondary sm"
            (click)="signOut()"
            [disabled]="signingOut()"
          >
            <app-icon name="logout" [size]="16" /> {{ signingOut() ? 'Signing out…' : 'Sign out' }}
          </button>
        </div>
      </header>

      <main class="relative mx-auto max-w-6xl px-4 pb-16 md:px-6">
        @if (signOutError()) {
          <div class="error mb-4" role="alert">{{ signOutError() }}</div>
        }
        <p class="eyebrow mb-1">Guided setup · step {{ stepIndex() + 1 }} of {{ steps.length }}</p>
        <h1 class="mb-6 text-title-sm font-semibold max-sm:text-2xl">Set up your business</h1>

        <div
          class="mb-8 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
          role="progressbar"
          aria-label="Setup progress"
          [attr.aria-valuenow]="progress()"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="h-full rounded-full bg-gradient-to-r from-brand-500 to-blue-light-500 transition-all duration-500 ease-out"
            [style.width.%]="progress()"
          ></div>
        </div>

        <ol class="mb-8 grid grid-cols-4 gap-2 p-0" aria-label="Onboarding progress">
          @for (step of steps; track step; let i = $index) {
            <li
              class="flex list-none flex-col items-center gap-2 text-center"
              [attr.aria-current]="store.currentStep() === step ? 'step' : null"
            >
              <span
                class="flex size-10 items-center justify-center rounded-full border text-theme-sm font-semibold transition-all duration-300"
                [class]="
                  store.currentStep() === step
                    ? 'border-brand-600 bg-brand-600 text-white shadow-glow'
                    : isDone(step)
                      ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-400'
                      : 'border-gray-200 bg-white text-gray-400 dark:border-gray-800 dark:bg-gray-900'
                "
              >
                @if (isDone(step) && store.currentStep() !== step) {
                  <app-icon name="check" [size]="18" [stroke]="2.4" />
                } @else {
                  {{ i + 1 }}
                }
              </span>
              <span
                class="text-theme-xs font-medium sm:text-theme-sm"
                [class]="
                  store.currentStep() === step
                    ? 'text-gray-900 dark:text-white'
                    : 'text-gray-500 dark:text-gray-400'
                "
              >
                {{ info[step].label }}
              </span>
            </li>
          }
        </ol>

        <div class="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
          <section class="card step-body !mb-0 animate-fade-up"><router-outlet /></section>
          <aside class="card glass !mb-0 hidden lg:block" aria-label="Tip">
            <img
              src="/assets/feedback-orbit.svg"
              width="280"
              height="180"
              alt="A feedback message connected to a customer rating"
              class="mb-5 w-full"
              loading="lazy"
            />
            <span
              class="mb-3 flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400"
            >
              <app-icon [name]="info[store.currentStep()].icon" />
            </span>
            <h2 class="!text-base">{{ info[store.currentStep()].label }}</h2>
            <p class="muted m-0">{{ info[store.currentStep()].tip }}</p>
          </aside>
        </div>
      </main>
    </div>
  `,
})
export class OnboardingPage {
  protected readonly store = inject(OnboardingStore);
  protected readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly steps = ONBOARDING_STEPS;
  protected readonly info = STEP_INFO;
  protected readonly signingOut = signal(false);
  protected readonly signOutError = signal('');

  protected stepIndex(): number {
    return Math.max(0, this.steps.indexOf(this.store.currentStep()));
  }

  protected progress(): number {
    const done = this.steps.filter((s) => this.isDone(s)).length;
    return Math.round((Math.max(done, this.stepIndex()) / this.steps.length) * 100);
  }

  protected isDone(step: OnboardingStep): boolean {
    return this.store.business()?.onboarding.completedSteps.includes(step) ?? false;
  }

  protected signOut(): void {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    this.signOutError.set('');
    this.auth
      .logout()
      .pipe(finalize(() => this.signingOut.set(false)))
      .subscribe({
        next: () => void this.router.navigate(['/login']),
        error: (err: unknown) =>
          this.signOutError.set(`Sign-out could not be confirmed. ${apiErrorMessage(err)}`),
      });
  }
}
