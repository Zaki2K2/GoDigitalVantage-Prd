import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Session restoration runs as an app initializer, so `isAuthenticated` is settled by now. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.isAuthenticated()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** Keeps signed-in users off the login/register pages. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAuthenticated()
    ? inject(Router).createUrlTree([auth.user()?.platformRole === 'SUPER_ADMIN' ? '/admin' : '/'])
    : true;
};

/** UI convenience only: the API independently checks current platform privileges. */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.user()?.platformRole === 'SUPER_ADMIN' || inject(Router).createUrlTree(['/']);
};

/** Platform administrators do not create a tenant through the business onboarding wizard. */
export const businessUserGuard: CanActivateFn = () => {
  return inject(AuthService).user()?.platformRole === 'SUPER_ADMIN'
    ? inject(Router).createUrlTree(['/admin'])
    : true;
};
