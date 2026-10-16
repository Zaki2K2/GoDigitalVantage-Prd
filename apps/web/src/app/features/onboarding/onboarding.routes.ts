import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { map } from 'rxjs';
import { OnboardingStep } from '../../core/business/business.service';
import { OnboardingStore } from './onboarding.store';

/** Steps are viewable only up to the saved progress; deep links beyond it bounce back. */
const stepGuard =
  (step: OnboardingStep): CanActivateFn =>
  () => {
    const store = inject(OnboardingStore);
    const router = inject(Router);
    return store.ensureLoaded().pipe(
      map(() => {
        if (store.completed()) return router.createUrlTree(['/']);
        return store.canView(step) ? true : router.createUrlTree(['/onboarding']);
      }),
    );
  };

/** `/onboarding` resumes at the saved step. */
const resumeGuard: CanActivateFn = () => {
  const store = inject(OnboardingStore);
  const router = inject(Router);
  return store
    .ensureLoaded()
    .pipe(
      map(() =>
        store.completed()
          ? router.createUrlTree(['/'])
          : router.createUrlTree(['/onboarding', store.currentStep()]),
      ),
    );
};

export const onboardingRoutes: Routes = [
  {
    path: '',
    providers: [OnboardingStore],
    loadComponent: () => import('./onboarding.page').then((m) => m.OnboardingPage),
    children: [
      { path: '', pathMatch: 'full', canActivate: [resumeGuard], children: [] },
      {
        path: 'business',
        canActivate: [stepGuard('business')],
        loadComponent: () => import('./business-step').then((m) => m.BusinessStep),
      },
      {
        path: 'questionnaire',
        canActivate: [stepGuard('questionnaire')],
        loadComponent: () => import('./questionnaire-step').then((m) => m.QuestionnaireStep),
      },
      {
        path: 'confirm',
        canActivate: [stepGuard('confirm')],
        loadComponent: () => import('./confirm-step').then((m) => m.ConfirmStep),
      },
      {
        path: 'qr',
        canActivate: [stepGuard('qr')],
        loadComponent: () => import('./qr-step').then((m) => m.QrStep),
      },
    ],
  },
];
