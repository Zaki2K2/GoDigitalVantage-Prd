import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../shared/icon';
import { ImageUpload } from '../../shared/image-upload';
import { ThemeService } from '../../shared/theme.service';

@Component({
  selector: 'app-settings-page',
  imports: [RouterLink, Icon, ImageUpload],
  template: `
    <main class="page">
      <header class="page-header">
        <div>
          <p class="eyebrow">Your workspace</p>
          <h1>Settings</h1>
          <p class="sub">Make your workspace feel like yours.</p>
        </div>
      </header>
      <div class="settings-grid">
        <nav class="card settings-nav" aria-label="Settings sections">
          <a href="#appearance"><app-icon name="palette" /> Appearance</a>
          <a href="#account"><app-icon name="user" /> Your account</a>
          <a routerLink="/business"><app-icon name="business" /> Business profile</a>
          <a href="#modules"><app-icon name="dashboard" /> Modules</a>
        </nav>
        <div>
          <section id="appearance" class="card">
            <span class="eyebrow">Personalize</span>
            <h2 class="mt-2">Appearance</h2>
            <p class="muted">Saved on this browser. System follows your device automatically.</p>
            <div class="theme-options" role="group" aria-label="Color theme">
              @for (option of options; track option.value) {
                <button
                  type="button"
                  class="theme-option"
                  [class.selected]="theme.preference() === option.value"
                  [attr.aria-pressed]="theme.preference() === option.value"
                  (click)="theme.set(option.value)"
                >
                  <span
                    class="theme-swatch"
                    [class.night]="option.value === 'dark'"
                    [class.auto]="option.value === 'system'"
                    ><span></span><span></span><span></span
                  ></span>
                  <span><app-icon [name]="option.icon" /> {{ option.label }}</span>
                </button>
              }
            </div>
            <p class="muted mt-4 mb-0" role="status">
              Current preference: {{ theme.preference() }}.
            </p>
          </section>
          <section id="account" class="card">
            <h2>Your account</h2>
            <div class="mb-5">
              <app-image-upload
                kind="avatar"
                endpoint="/api/v1/users/me/avatar"
                [url]="auth.user()?.avatarUrl"
                [name]="auth.user()?.fullName ?? ''"
                (changed)="auth.setAvatar($event)"
              />
            </div>
            <dl class="detail">
              <dt>Name</dt>
              <dd>{{ auth.user()?.fullName }}</dd>
              <dt>Email</dt>
              <dd>{{ auth.user()?.email }}</dd>
            </dl>
            <p class="muted mt-4 mb-0">Account editing and password reset are planned.</p>
          </section>
          <section id="modules" class="card">
            <h2>Workspace capabilities</h2>
            <p class="muted">Available today and what comes next.</p>
            <ul class="module-list">
              <li>
                <span>Questionnaires, QR codes & feedback</span
                ><span class="badge success">Available</span>
              </li>
              <li>
                <span>Contacts & feedback analytics</span
                ><span class="badge success">Available</span>
              </li>
              <li><span>SMS & notification preferences</span><span class="badge">Planned</span></li>
              <li>
                <span>AI prompts, incidents & benchmarks</span><span class="badge">Planned</span>
              </li>
              <li>
                <span>Multi-location reports & billing</span><span class="badge">Planned</span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  `,
})
export class SettingsPage {
  protected readonly theme = inject(ThemeService);
  protected readonly auth = inject(AuthService);
  protected readonly options = [
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
    { value: 'system', label: 'System', icon: 'display' },
  ] as const;
}
