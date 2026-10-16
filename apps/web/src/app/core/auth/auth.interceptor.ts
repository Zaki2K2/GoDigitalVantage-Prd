import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

const AUTH_ENDPOINTS = '/api/v1/auth/';

/**
 * On a 401 from a private endpoint, try one token refresh and replay the request.
 * If the session cannot be recovered, drop local state and send the user to /login.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: unknown) => {
      const unauthorized = err instanceof HttpErrorResponse && err.status === 401;
      if (!unauthorized || req.url.includes(AUTH_ENDPOINTS)) return throwError(() => err);

      return auth.refresh().pipe(
        switchMap((user) => {
          if (user) return next(req.clone());
          if (auth.ready()) {
            void router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
          }
          return throwError(() => err);
        }),
      );
    }),
  );
};
