import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Business, BusinessInput } from '../../core/business/business.service';
import { CSRF_COOKIE_NAME } from '../../core/auth/auth.service';
import { OnboardingStore } from './onboarding.store';

const INPUT: BusinessInput = {
  name: 'Joes',
  category: 'Cafe',
  email: '',
  phone: '',
  address: '',
  timezone: 'UTC',
  googleReviewUrl: '',
};

const biz = (over: Partial<Business> = {}): Business => ({
  id: 'b1',
  name: 'Joes',
  category: 'Cafe',
  email: null,
  phone: null,
  address: null,
  logoRef: null,
  timezone: 'UTC',
  googleReviewUrl: null,
  slug: 'joes',
  status: 'onboarding',
  role: 'owner',
  onboarding: { currentStep: 'questionnaire', completedSteps: ['business'], completedAt: null },
  ...over,
});

describe('OnboardingStore', () => {
  let http: HttpTestingController;
  const newStore = () => TestBed.inject(OnboardingStore);

  beforeEach(() => {
    document.cookie = `${CSRF_COOKIE_NAME}=tok; path=/`;
    TestBed.configureTestingModule({
      providers: [OnboardingStore, provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    document.cookie = `${CSRF_COOKIE_NAME}=; path=/; max-age=0`;
    http.verify();
  });

  it('restores saved progress from the server and loads only once', () => {
    const store = newStore();
    store.ensureLoaded().subscribe();
    http.expectOne('/api/v1/businesses').flush({
      data: {
        businesses: [
          biz({
            onboarding: {
              currentStep: 'confirm',
              completedSteps: ['business'],
              completedAt: null,
            },
          }),
        ],
      },
    });
    expect(store.currentStep()).toBe('confirm');
    store.ensureLoaded().subscribe();
    http.expectNone('/api/v1/businesses');
  });

  it('starts at the business step when nothing exists yet', () => {
    const store = newStore();
    store.ensureLoaded().subscribe();
    http.expectOne('/api/v1/businesses').flush({ data: { businesses: [] } });
    expect(store.currentStep()).toBe('business');
    expect(store.canView('business')).toBeTrue();
    expect(store.canView('confirm')).toBeFalse();
  });

  it('gates steps beyond saved progress', () => {
    const store = newStore();
    store.ensureLoaded().subscribe();
    http.expectOne('/api/v1/businesses').flush({ data: { businesses: [biz()] } });
    expect(store.canView('questionnaire')).toBeTrue();
    expect(store.canView('confirm')).toBeFalse();
    expect(store.canView('qr')).toBeFalse();
  });

  it('reuses the create request id for identical retries and renews it for edited data', () => {
    const store = newStore();
    const ids: string[] = [];
    const attempt = (input: BusinessInput) => {
      store.save(input).subscribe({ error: () => undefined });
      const req = http.expectOne('/api/v1/businesses');
      expect(req.request.method).toBe('POST');
      ids.push(req.request.body.createRequestId);
      req.flush({ error: { code: 'X', message: 'fail' } }, { status: 500, statusText: 'err' });
    };
    attempt(INPUT);
    attempt(INPUT);
    attempt({ ...INPUT, name: 'Joes 2' });
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('PATCHes instead of creating once a business exists', () => {
    const store = newStore();
    store.save(INPUT).subscribe();
    http.expectOne('/api/v1/businesses').flush({ data: { business: biz() } });
    store.save({ ...INPUT, name: 'Renamed' }).subscribe();
    const req = http.expectOne('/api/v1/businesses/b1');
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: { business: biz({ name: 'Renamed' }) } });
    expect(store.business()?.name).toBe('Renamed');
  });

  it('persists step changes through the API', () => {
    const store = newStore();
    store.save(INPUT).subscribe();
    http.expectOne('/api/v1/businesses').flush({ data: { business: biz() } });
    store.setStep('confirm').subscribe();
    const req = http.expectOne('/api/v1/businesses/b1/onboarding');
    expect(req.request.body).toEqual({ currentStep: 'confirm' });
    req.flush({
      data: {
        onboarding: { currentStep: 'confirm', completedSteps: ['business'], completedAt: null },
      },
    });
    expect(store.currentStep()).toBe('confirm');
  });
});
