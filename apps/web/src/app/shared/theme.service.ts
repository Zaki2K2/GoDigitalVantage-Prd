import { Injectable, signal } from '@angular/core';
export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');
  readonly preference = signal<ThemePreference>(this.saved());
  readonly theme = signal<Theme>('light');
  constructor() {
    this.apply();
    this.media.addEventListener('change', () => this.apply());
  }
  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }
  set(preference: ThemePreference): void {
    this.preference.set(preference);
    this.apply();
    try {
      localStorage.setItem('gdv-theme', preference);
    } catch {
      /* Storage is optional. */
    }
  }
  private apply(): void {
    const dark =
      this.preference() === 'dark' || (this.preference() === 'system' && this.media.matches);
    this.theme.set(dark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
  }
  private saved(): ThemePreference {
    try {
      const saved = localStorage.getItem('gdv-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      /* Default to system. */
    }
    return 'system';
  }
}
