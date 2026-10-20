import { provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { authGuard, guestGuard } from './auth.guard';
import { authInterceptor } from './auth.interceptor';
import { AuthService, CSRF_COOKIE_NAME } from './auth.service';

const USER = { id: '1', fullName: 'Ada', email: 'ada@example.com', status: 'active' };
const ok = { data: { user: USER } };

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'login', children: [] }]),
      provideHttpClient(
        withXsrfConfiguration({ cookieName: CSRF_COOKIE_NAME, headerName: 'X-CSRF-Token' }),
        withInterceptors([authInterceptor]),
      ),
      provideHttpClientTesting(),
    ],
  });
  return {
    auth: TestBed.inject(AuthService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('auth', () => {
  beforeEach(() => {
    document.cookie = `${CSRF_COOKIE_NAME}=tok123; path=/`;
  });
  afterEach(() => {
    document.cookie = `${CSRF_COOKIE_NAME}=; path=/; max-age=0`;
    TestBed.inject(HttpTestingController).verify();
  });

  it('restore() loads the user from /me and marks ready', () => {
    const { auth, http } = setup();
    auth.restore().subscribe();
    http.expectOne('/api/v1/me').flush(ok);
    expect(auth.user()).toEqual(USER);
    expect(auth.ready()).toBeTrue();
  });

  it('restore() with no session stays anonymous (refresh fails, no redirect)', () => {
    const { auth, http } = setup();
    auth.restore().subscribe();
    http.expectOne('/api/v1/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/v1/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.user()).toBeNull();
    expect(auth.ready()).toBeTrue();
  });

  it('login() stores the user in memory only (CSRF header is verified end-to-end against the API)', () => {
    const { auth, http } = setup();
    const storageBefore = Object.entries(localStorage);
    auth.login('ada@example.com', 'pw').subscribe();
    const req = http.expectOne('/api/v1/auth/login');
    expect(req.request.method).toBe('POST');
    req.flush(ok);
    expect(auth.isAuthenticated()).toBeTrue();
    expect(Object.entries(localStorage)).toEqual(storageBefore);
  });

  it('login() fetches a CSRF cookie first when missing', () => {
    document.cookie = `${CSRF_COOKIE_NAME}=; path=/; max-age=0`;
    const { auth, http } = setup();
    auth.login('a@b.co', 'pw').subscribe();
    http.expectOne('/api/v1/auth/csrf').flush({ data: { csrfToken: 'x' } });
    http.expectOne('/api/v1/auth/login').flush(ok);
    expect(auth.user()).toEqual(USER);
  });

  it('refreshes once on 401 and replays the request', async () => {
    const { auth, http } = setup();
    const result = firstValueFrom(TestBed.inject(AuthService)['http'].get('/api/v1/private'));
    http.expectOne('/api/v1/private').flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/v1/auth/refresh').flush(ok);
    http.expectOne('/api/v1/private').flush({ data: 1 });
    expect(await result).toEqual({ data: 1 });
    expect(auth.isAuthenticated()).toBeTrue();
  });

  it('shares one refresh between concurrent 401s', () => {
    const { auth, http } = setup();
    const client = auth['http'];
    client.get('/api/v1/a').subscribe();
    client.get('/api/v1/b').subscribe();
    const reqs = http.match((r) => r.url === '/api/v1/a' || r.url === '/api/v1/b');
    reqs.forEach((r) => r.flush({}, { status: 401, statusText: 'Unauthorized' }));
    http.expectOne('/api/v1/auth/refresh').flush(ok);
    const replays = http.match((r) => r.url === '/api/v1/a' || r.url === '/api/v1/b');
    expect(replays.length).toBe(2);
    replays.forEach((r) => r.flush({}));
  });

  it('does not loop when refresh fails: clears user and surfaces the 401', async () => {
    const { auth, http } = setup();
    auth.restore().subscribe();
    http.expectOne('/api/v1/me').flush(ok);
    const result = firstValueFrom(auth['http'].get('/api/v1/private')).catch((e) => e);
    http.expectOne('/api/v1/private').flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/v1/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect((await result).status).toBe(401);
    expect(auth.user()).toBeNull();
  });

  it('logout() clears the session', () => {
    const { auth, http } = setup();
    auth.login('a@b.co', 'pw').subscribe();
    http.expectOne('/api/v1/auth/login').flush(ok);
    auth.logout().subscribe();
    http.expectOne('/api/v1/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    expect(auth.user()).toBeNull();
  });

  it('guards redirect anonymous users to /login with returnUrl, and signed-in users away from guest pages', () => {
    const { auth, http } = setup();
    const router = TestBed.inject(Router);
    const run = (guard: typeof authGuard, url: string) =>
      TestBed.runInInjectionContext(() => guard({} as never, { url } as never));

    expect(router.serializeUrl(run(authGuard, '/secret') as never)).toBe(
      '/login?returnUrl=%2Fsecret',
    );
    expect(run(guestGuard, '/login')).toBeTrue();

    auth.login('a@b.co', 'pw').subscribe();
    http.expectOne('/api/v1/auth/login').flush(ok);
    expect(run(authGuard, '/secret')).toBeTrue();
    expect(router.serializeUrl(run(guestGuard, '/login') as never)).toBe('/');
  });
});
