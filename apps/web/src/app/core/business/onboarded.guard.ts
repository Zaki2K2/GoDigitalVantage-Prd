import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { BusinessApi } from './business.service';

/** The dashboard is only for businesses whose onboarding the server has marked complete. */
export const onboardedGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (inject(AuthService).user()?.platformRole === 'SUPER_ADMIN')
    return router.createUrlTree(['/admin']);
  return inject(BusinessApi)
    .list()
    .pipe(
      map((list) =>
        list[0]?.onboarding.completedAt ? true : router.createUrlTree(['/onboarding']),
      ),
      catchError(() => of(router.createUrlTree(['/onboarding']))),
    );
};
