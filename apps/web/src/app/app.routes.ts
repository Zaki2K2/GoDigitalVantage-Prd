import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { onboardedGuard } from './core/business/onboarded.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/register.page').then((m) => m.RegisterPage),
  },
  {
    // Public, anonymous: opened from the QR code.
    path: 'r/:slug',
    loadComponent: () => import('./features/public/public-form.page').then((m) => m.PublicFormPage),
  },
  {
    // Public alias; existing printed /r/:slug links remain canonical.
    path: 'q/:slug',
    loadComponent: () => import('./features/public/public-form.page').then((m) => m.PublicFormPage),
  },
  {
    // Public, anonymous: the customer's signed reward link.
    path: 'reward/:token',
    loadComponent: () => import('./features/public/reward-link.page').then((m) => m.RewardLinkPage),
  },
  {
    path: 'onboarding',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./features/onboarding/onboarding.routes').then((m) => m.onboardingRoutes),
  },
  {
    // Dashboard shell: only reachable once the server reports onboarding complete.
    path: '',
    canActivate: [authGuard, onboardedGuard],
    loadComponent: () => import('./features/shell/app-shell').then((m) => m.AppShell),
    children: [
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings.page').then((m) => m.SettingsPage),
      },
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'responses',
        loadComponent: () =>
          import('./features/responses/responses.page').then((m) => m.ResponsesPage),
      },
      {
        path: 'contacts',
        loadComponent: () =>
          import('./features/contacts/contacts.page').then((m) => m.ContactsPage),
      },
      {
        path: 'rewards',
        loadComponent: () => import('./features/rewards/rewards.page').then((m) => m.RewardsPage),
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./features/rewards/rewards-overview.page').then((m) => m.RewardsOverviewPage),
          },
          {
            path: 'issued',
            loadComponent: () =>
              import('./features/rewards/rewards-issued.page').then((m) => m.RewardsIssuedPage),
          },
          {
            path: 'incidents',
            loadComponent: () =>
              import('./features/rewards/rewards-incidents.page').then(
                (m) => m.RewardsIncidentsPage,
              ),
          },
          {
            path: 'redeem',
            loadComponent: () =>
              import('./features/rewards/rewards-redeem.page').then((m) => m.RewardsRedeemPage),
          },
          {
            path: 'rules',
            loadComponent: () =>
              import('./features/rewards/rewards-rules.page').then((m) => m.RewardsRulesPage),
          },
        ],
      },
      {
        path: 'questionnaire',
        loadComponent: () =>
          import('./features/questionnaire/questionnaire.page').then((m) => m.QuestionnairePage),
      },
      {
        path: 'qr',
        loadComponent: () => import('./features/qr/qr.page').then((m) => m.QrPage),
      },
      {
        path: 'business',
        loadComponent: () => import('./features/business/profile.page').then((m) => m.ProfilePage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
