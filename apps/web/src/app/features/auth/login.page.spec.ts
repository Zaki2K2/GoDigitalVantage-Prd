import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CSRF_COOKIE_NAME } from '../../core/auth/auth.service';
import { LoginPage } from './login.page';

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    document.cookie = `${CSRF_COOKIE_NAME}=tok; path=/`;
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(LoginPage);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });
  afterEach(() => {
    document.cookie = `${CSRF_COOKIE_NAME}=; path=/; max-age=0`;
    http.verify();
  });

  function fill(email: string, password: string) {
    const inputs = el().querySelectorAll('input');
    [email, password].forEach((v, i) => {
      inputs[i]!.value = v;
      inputs[i]!.dispatchEvent(new Event('input'));
    });
  }

  it('shows validation errors and sends nothing when invalid', () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(el().querySelectorAll('.error').length).toBe(2);
    http.expectNone('/api/v1/auth/login');
  });

  it('shows a loading state, then the server error message on failure', () => {
    fill('a@b.co', 'bad');
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(el().querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBeTrue();
    expect(el().querySelector<HTMLButtonElement>('button[type=submit]')!.textContent).toContain(
      'Signing in',
    );

    http
      .expectOne('/api/v1/auth/login')
      .flush(
        { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } },
        { status: 401, statusText: 'Unauthorized' },
      );
    fixture.detectChanges();
    expect(el().querySelector('.alert')!.textContent).toContain('Invalid email or password');
    expect(el().querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBeFalse();
  });
});
