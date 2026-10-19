import { Component, inject, signal, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthLayout } from '../../shared/auth-layout';
import { Icon } from '../../shared/icon';
import { AuthService, apiErrorMessage } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink, AuthLayout, Icon],
  templateUrl: './login.page.html',
})
export class LoginPage {
  readonly stayOnPage = input(false);
  readonly signedIn = output<void>();
  protected readonly showPassword = signal(false);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  protected invalid(name: 'email' | 'password'): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  protected submit(): void {
    if (this.loading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    const { email, password } = this.form.getRawValue();
    this.auth.login(email, password).subscribe({
      next: () => {
        this.loading.set(false);
        if (this.stayOnPage()) this.signedIn.emit();
        else void this.router.navigateByUrl(this.safeReturnUrl());
      },
      error: (err: unknown) => {
        this.error.set(apiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  /** Only allow same-app relative paths to prevent open redirects. */
  private safeReturnUrl(): string {
    const url = this.route.snapshot.queryParamMap.get('returnUrl');
    const safe = url && url.startsWith('/') && !url.startsWith('//');
    if (this.auth.user()?.platformRole === 'SUPER_ADMIN') {
      return safe && /^\/admin(?:[/?#]|$)/.test(url) ? url : '/admin';
    }
    return safe ? url : '/';
  }
}
