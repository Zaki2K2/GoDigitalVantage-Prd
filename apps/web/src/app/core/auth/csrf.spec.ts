import { PlatformLocation } from '@angular/common';
import { HttpClient, provideHttpClient, withXsrfConfiguration } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CSRF_COOKIE_NAME } from './auth.service';

describe('CSRF header', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    document.cookie = `${CSRF_COOKIE_NAME}=tok123; path=/`;
    TestBed.configureTestingModule({
      providers: [
        // TestBed's mock location has an opaque origin, so pin it to a real one.
        { provide: PlatformLocation, useValue: { href: 'http://localhost:4200/' } },
        provideHttpClient(
          withXsrfConfiguration({ cookieName: CSRF_COOKIE_NAME, headerName: 'X-CSRF-Token' }),
        ),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    document.cookie = `${CSRF_COOKIE_NAME}=; path=/; max-age=0`;
    ctrl.verify();
  });

  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

  for (const method of mutating) {
    it(`sends X-CSRF-Token on ${method}`, () => {
      http.request(method, '/api/v1/thing', { body: {} }).subscribe();
      const req = ctrl.expectOne('/api/v1/thing');
      expect(req.request.headers.get('X-CSRF-Token')).toBe('tok123');
      req.flush({});
    });
  }

  it('does not send the header on GET', () => {
    http.get('/api/v1/thing').subscribe();
    const req = ctrl.expectOne('/api/v1/thing');
    expect(req.request.headers.has('X-CSRF-Token')).toBeFalse();
    req.flush({});
  });

  it('never leaks the token to another origin', () => {
    http.post('https://evil.example/api', {}).subscribe();
    const req = ctrl.expectOne('https://evil.example/api');
    expect(req.request.headers.has('X-CSRF-Token')).toBeFalse();
    req.flush({});
  });
});
