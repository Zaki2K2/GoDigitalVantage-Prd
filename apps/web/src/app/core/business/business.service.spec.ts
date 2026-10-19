import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { Business, BusinessApi } from './business.service';

const biz = (id: string, name = id): Business =>
  ({ id, name, onboarding: { completedAt: null } }) as unknown as Business;

describe('BusinessApi.list sharing', () => {
  let api: BusinessApi;
  let http: HttpTestingController;
  const user = signal<{ id: string } | null>({ id: 'u1' });

  beforeEach(() => {
    user.set({ id: 'u1' });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { user, withCsrf: <T>(f: () => T) => f() } },
      ],
    });
    api = TestBed.inject(BusinessApi);
    http = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });
  afterEach(() => http.verify());

  it('serves concurrent callers (guard, shell, page) from one request', async () => {
    const calls = [
      firstValueFrom(api.list()),
      firstValueFrom(api.list()),
      firstValueFrom(api.list()),
    ];
    http.expectOne('/api/v1/businesses').flush({ data: { businesses: [biz('b1')] } });
    const results = await Promise.all(calls);
    expect(results.map((r) => r[0]?.id)).toEqual(['b1', 'b1', 'b1']);
  });

  it('reuses a settled response briefly without another request', async () => {
    const first = firstValueFrom(api.list());
    http.expectOne('/api/v1/businesses').flush({ data: { businesses: [biz('b1')] } });
    await first;
    expect((await firstValueFrom(api.list()))[0]?.id).toBe('b1');
    http.expectNone('/api/v1/businesses');
  });

  it('gives every caller its own array so one cannot reorder another', async () => {
    const a = firstValueFrom(api.list());
    const b = firstValueFrom(api.list());
    http.expectOne('/api/v1/businesses').flush({ data: { businesses: [biz('b1'), biz('b2')] } });
    const [x, y] = await Promise.all([a, b]);
    expect(x).not.toBe(y);
    x.reverse();
    expect(y.map((r) => r.id)).toEqual(['b1', 'b2']);
  });

  it('applies the selected business on every read without refetching', async () => {
    const first = firstValueFrom(api.list());
    http.expectOne('/api/v1/businesses').flush({ data: { businesses: [biz('b1'), biz('b2')] } });
    expect((await first)[0]?.id).toBe('b1');
    api.select('b2');
    expect((await firstValueFrom(api.list()))[0]?.id).toBe('b2');
    http.expectNone('/api/v1/businesses');
  });

  it('never reuses a failed request', async () => {
    const failed = firstValueFrom(api.list()).catch(() => 'failed');
    http.expectOne('/api/v1/businesses').flush({}, { status: 503, statusText: 'x' });
    expect(await failed).toBe('failed');
    const retry = firstValueFrom(api.list());
    http.expectOne('/api/v1/businesses').flush({ data: { businesses: [biz('b1')] } });
    expect((await retry)[0]?.id).toBe('b1');
  });

  it('refetches after the signed-in user changes', async () => {
    const first = firstValueFrom(api.list());
    http.expectOne('/api/v1/businesses').flush({ data: { businesses: [biz('b1')] } });
    await first;
    user.set({ id: 'u2' });
    const second = firstValueFrom(api.list());
    http.expectOne('/api/v1/businesses').flush({ data: { businesses: [biz('b9')] } });
    expect((await second)[0]?.id).toBe('b9');
  });

  it('refetches after a business or onboarding mutation', async () => {
    const first = firstValueFrom(api.list());
    http.expectOne('/api/v1/businesses').flush({ data: { businesses: [biz('b1')] } });
    await first;

    const update = firstValueFrom(api.update('b1', { name: 'New' }));
    http.expectOne('/api/v1/businesses/b1').flush({ data: { business: biz('b1', 'New') } });
    await update;

    const second = firstValueFrom(api.list());
    http.expectOne('/api/v1/businesses').flush({ data: { businesses: [biz('b1', 'New')] } });
    expect((await second)[0]?.name).toBe('New');

    const step = firstValueFrom(api.updateOnboarding('b1', { currentStep: 'qr' }));
    http.expectOne('/api/v1/businesses/b1/onboarding').flush({
      data: { onboarding: { currentStep: 'qr', completedSteps: [], completedAt: null } },
    });
    await step;
    const third = firstValueFrom(api.list());
    http.expectOne('/api/v1/businesses').flush({ data: { businesses: [biz('b1')] } });
    await third;
  });
});
