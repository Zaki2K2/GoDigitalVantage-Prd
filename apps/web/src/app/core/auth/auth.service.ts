import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, switchMap, tap } from 'rxjs';

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  status: string;
  platformRole?: 'USER' | 'SUPER_ADMIN';
  permissions?: string[];
}

interface UserResponse {
  data: { user: AuthUser };
}

export interface RegisterPayload {
  fullName: string;
  email: string;
  password: string;
}

export const CSRF_COOKIE_NAME = 'gdv_csrf';
const API = '/api/v1';

/** Turns an API error envelope (or a network failure) into a user-facing message. */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const message = (err.error as { error?: { message?: string } } | null)?.error?.message;
    if (message) return message;
    if (err.status === 0) return 'Cannot reach the server. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Session state lives in memory only. Tokens are httpOnly cookies the browser manages;
 * nothing auth-related is written to localStorage/sessionStorage.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  private readonly _user = signal<AuthUser | null>(null);
  private readonly _ready = signal(false);
  private refresh$: Observable<AuthUser | null> | null = null;

  readonly user = this._user.asReadonly();
  readonly ready = this._ready.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  /** Session restoration on app start: /me, falling back to a refresh (interceptor-driven). */
  restore(): Observable<void> {
    // Public feedback pages are anonymous: don't probe the session (or log 401s) for visitors.
    if (/^\/(r|q)\//.test(this.document.location.pathname)) {
      this._ready.set(true);
      return of(undefined);
    }
    return this.http.get<UserResponse>(`${API}/me`).pipe(
      tap((res) => this._user.set(res.data.user)),
      map(() => undefined),
      catchError(() => of(undefined)),
      finalize(() => this._ready.set(true)),
    );
  }

  login(email: string, password: string): Observable<AuthUser> {
    return this.withCsrf(() =>
      this.http.post<UserResponse>(`${API}/auth/login`, { email, password }),
    ).pipe(map((res) => this.setUser(res)));
  }

  register(payload: RegisterPayload): Observable<AuthUser> {
    return this.withCsrf(() => this.http.post<UserResponse>(`${API}/auth/register`, payload)).pipe(
      map((res) => this.setUser(res)),
    );
  }

  logout(): Observable<void> {
    return this.withCsrf(() => this.http.post<void>(`${API}/auth/logout`, {})).pipe(
      tap(() => this.clear()),
      map(() => undefined),
    );
  }

  /** Single in-flight refresh shared by concurrent 401s. Emits null when the session is gone. */
  refresh(): Observable<AuthUser | null> {
    this.refresh$ ??= this.withCsrf(() =>
      this.http.post<UserResponse>(`${API}/auth/refresh`, {}),
    ).pipe(
      map((res) => this.setUser(res)),
      catchError(() => {
        this.clear();
        return of(null);
      }),
      finalize(() => (this.refresh$ = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.refresh$;
  }

  clear(): void {
    this._user.set(null);
  }

  private setUser(res: UserResponse): AuthUser {
    this._user.set(res.data.user);
    return res.data.user;
  }

  /** Ensures the CSRF cookie exists (the XSRF interceptor then echoes it as a header). */
  withCsrf<T>(request: () => Observable<T>): Observable<T> {
    if (this.hasCsrfCookie()) return request();
    return this.http.get(`${API}/auth/csrf`).pipe(switchMap(() => request()));
  }

  private hasCsrfCookie(): boolean {
    return this.document.cookie.split('; ').some((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`));
  }
}
