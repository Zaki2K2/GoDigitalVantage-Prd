import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { businessUserGuard, guestGuard } from './auth.guard';
import { onboardedGuard } from '../business/onboarded.guard';
import { BusinessApi } from '../business/business.service';

describe('Super Admin landing routes', () => {
  let superAdmin: boolean;
  let signedIn: boolean;
  let list: jasmine.Spy;
  beforeEach(() => {
    superAdmin = true;
    signedIn = true;
    list = jasmine.createSpy('list').and.throwError('Admin must not request business onboarding');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', pathMatch: 'full', canActivate: [onboardedGuard], children: [] },
          { path: 'login', canActivate: [guestGuard], children: [] },
          { path: 'register', canActivate: [guestGuard], children: [] },
          {
            path: 'onboarding',
            canActivate: [businessUserGuard],
            children: [{ path: 'business', children: [] }],
          },
          { path: 'admin', children: [] },
        ]),
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: () => signedIn,
            user: () => (signedIn ? { platformRole: superAdmin ? 'SUPER_ADMIN' : 'USER' } : null),
          },
        },
        { provide: BusinessApi, useValue: { list } },
      ],
    });
  });
  for (const path of ['/', '/login', '/register', '/onboarding', '/onboarding/business']) {
    it(`redirects a signed-in Super Admin from ${path} to /admin without loading a business`, async () => {
      const router = TestBed.inject(Router);
      await router.navigateByUrl(path);
      expect(router.url).toBe('/admin');
      expect(list).not.toHaveBeenCalled();
    });
  }
  it('allows normal business users into onboarding', async () => {
    superAdmin = false;
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/onboarding/business');
    expect(router.url).toBe('/onboarding/business');
  });
  it('allows unauthenticated visitors to use login', async () => {
    signedIn = false;
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/login');
    expect(router.url).toBe('/login');
  });
});
