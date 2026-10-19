import { PlatformLocation } from '@angular/common';
import { provideHttpClient, withXsrfConfiguration } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService, CSRF_COOKIE_NAME } from '../../core/auth/auth.service';
import { AdminApi } from './admin.api';

describe('AdminApi authenticated writes', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    document.cookie = `${CSRF_COOKIE_NAME}=admin-csrf; path=/`;
    TestBed.configureTestingModule({
      providers: [
        { provide: PlatformLocation, useValue: { href: 'http://localhost:4200/' } },
        provideHttpClient(
          withXsrfConfiguration({ cookieName: CSRF_COOKIE_NAME, headerName: 'X-CSRF-Token' }),
        ),
        provideHttpClientTesting(),
        AuthService,
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    document.cookie = `${CSRF_COOKIE_NAME}=; path=/; max-age=0`;
  });
  for (const method of ['post', 'patch', 'delete'] as const) {
    it(`sends CSRF protection for ${method.toUpperCase()} without bypassing authentication`, () => {
      TestBed.inject(AdminApi).write('users/target/action', { confirm: true }, method).subscribe();
      const req = http.expectOne('/api/v1/admin/users/target/action');
      expect(req.request.method).toBe(method.toUpperCase());
      expect(req.request.headers.get('X-CSRF-Token')).toBe('admin-csrf');
      req.flush({ data: {} });
    });
  }
});
