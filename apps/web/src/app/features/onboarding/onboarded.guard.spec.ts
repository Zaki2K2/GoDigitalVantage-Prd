import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom, isObservable, Observable } from 'rxjs';
import { onboardedGuard } from '../../core/business/onboarded.guard';

describe('onboardedGuard', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  async function run(flush: () => void): Promise<boolean | UrlTree> {
    const result = TestBed.runInInjectionContext(() => onboardedGuard({} as never, {} as never));
    const pending = firstValueFrom(result as Observable<boolean | UrlTree>);
    expect(isObservable(result)).toBeTrue();
    flush();
    return pending;
  }
  const respond = (completedAt: string | null, status = 200) =>
    http
      .expectOne('/api/v1/businesses')
      .flush(
        status === 200 ? { data: { businesses: [{ id: 'b1', onboarding: { completedAt } }] } } : {},
        { status, statusText: 'x' },
      );

  it('lets completed businesses reach the dashboard', async () => {
    expect(await run(() => respond('2026-01-01T00:00:00Z'))).toBeTrue();
  });

  it('sends incomplete onboarding back to the wizard', async () => {
    const res = (await run(() => respond(null))) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(res)).toBe('/onboarding');
  });

  it('sends users with no business to the wizard', async () => {
    const res = (await run(() =>
      http.expectOne('/api/v1/businesses').flush({ data: { businesses: [] } }),
    )) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(res)).toBe('/onboarding');
  });

  it('fails closed when the check errors', async () => {
    const res = (await run(() => respond(null, 500))) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(res)).toBe('/onboarding');
  });
});
