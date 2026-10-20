import { Routes } from '@angular/router';
import {
  authGuard,
  guestGuard,
  adminGuard,
  instantRewardAdminGuard,
  businessUserGuard,
} from './core/auth/auth.guard';
import { onboardedGuard } from './core/business/onboarded.guard';

export const routes: Routes = [
  {
    path: 'email-preferences',
    loadComponent: () =>
      import('./features/campaigns/email-preferences.page').then((m) => m.EmailPreferencesPage),
  },
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
    path: 'instant-reward',
    loadComponent: () =>
      import('./features/instant-rewards/instant-reward-landing.page').then(
        (m) => m.InstantRewardLandingPage,
      ),
  },
  {
    path: 'my-rewards',
    canActivate: [authGuard],
    data: { personal: true },
    loadComponent: () => import('./features/shell/app-shell').then((m) => m.AppShell),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/instant-rewards/my-rewards.page').then((m) => m.MyRewardsPage),
      },
    ],
  },
  {
    path: 'rewards-admin',
    canActivate: [authGuard, instantRewardAdminGuard],
    data: { personal: true, rewardAdmin: true },
    loadComponent: () => import('./features/shell/app-shell').then((m) => m.AppShell),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/instant-rewards/instant-rewards-admin.page').then(
            (m) => m.InstantRewardsAdminPage,
          ),
      },
    ],
  },
  {
    path: 'onboarding',
    canActivate: [authGuard, businessUserGuard],
    loadChildren: () =>
      import('./features/onboarding/onboarding.routes').then((m) => m.onboardingRoutes),
  },
  {
    path: 'admin',
    canActivate: [authGuard, adminGuard],
    data: { admin: true },
    loadComponent: () => import('./features/shell/app-shell').then((m) => m.AppShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'campaigns',
        canDeactivate: [
          (component: { canLeave: () => boolean | Promise<boolean> }) => component.canLeave(),
        ],
        data: { campaignAdmin: true },
        loadComponent: () =>
          import('./features/campaigns/campaigns.page').then((m) => m.CampaignsPage),
      },
      {
        path: 'instant-rewards',
        loadComponent: () =>
          import('./features/instant-rewards/instant-rewards-admin.page').then(
            (m) => m.InstantRewardsAdminPage,
          ),
      },
      {
        path: ':section/:id',
        loadComponent: () => import('./features/admin/admin.page').then((m) => m.AdminPage),
      },
      {
        path: ':section',
        loadComponent: () => import('./features/admin/admin.page').then((m) => m.AdminPage),
      },
    ],
  },
  {
    // Dashboard shell: only reachable once the server reports onboarding complete.
    path: '',
    canActivate: [authGuard, onboardedGuard],
    loadComponent: () => import('./features/shell/app-shell').then((m) => m.AppShell),
    children: [
      {
        path: 'campaigns',
        canDeactivate: [
          (component: { canLeave: () => boolean | Promise<boolean> }) => component.canLeave(),
        ],
        loadComponent: () =>
          import('./features/campaigns/campaigns.page').then((m) => m.CampaignsPage),
      },
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
