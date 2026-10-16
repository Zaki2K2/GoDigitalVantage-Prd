import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Icon, IconName } from '../../shared/icon';

const TABS: { path: string; label: string; icon: IconName; exact?: boolean }[] = [
  { path: '/rewards', label: 'Overview', icon: 'dashboard', exact: true },
  { path: '/rewards/issued', label: 'Rewards', icon: 'gift' },
  { path: '/rewards/incidents', label: 'Complaints', icon: 'responses' },
  { path: '/rewards/redeem', label: 'Redeem', icon: 'ticket' },
  { path: '/rewards/rules', label: 'Rules', icon: 'settings' },
];

/** Customer recovery & promo rewards: tabbed workspace. Each tab is its own routed page. */
@Component({
  selector: 'app-rewards-page',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  template: `
    <main class="page">
      <header class="page-header">
        <div>
          <p class="eyebrow">Customer recovery</p>
          <h1>Rewards</h1>
          <p class="sub">
            Turn a bad experience into a second chance. Rewards are never tied to reviews, and no
            review is ever required.
          </p>
        </div>
      </header>
      <nav
        class="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-white/[0.03]"
        aria-label="Rewards sections"
      >
        @for (t of tabs; track t.path) {
          <a
            [routerLink]="t.path"
            routerLinkActive="!bg-brand-50 !text-brand-700 dark:!bg-brand-500/15 dark:!text-brand-400"
            [routerLinkActiveOptions]="{ exact: !!t.exact }"
            class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-theme-sm font-medium whitespace-nowrap text-gray-600 no-underline transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
          >
            <app-icon [name]="t.icon" [size]="16" /> {{ t.label }}
          </a>
        }
      </nav>
      <router-outlet />
    </main>
  `,
})
export class RewardsPage {
  protected readonly tabs = TABS;
}
