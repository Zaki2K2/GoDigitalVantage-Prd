import { Component, HostListener, computed, inject, signal } from '@angular/core';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter, finalize } from 'rxjs';
import { apiErrorMessage, AuthService } from '../../core/auth/auth.service';
import { Business, BusinessApi } from '../../core/business/business.service';
import { BrandLogo } from '../../shared/brand-logo';
import { Icon, IconName } from '../../shared/icon';
import { ThemeService } from '../../shared/theme.service';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  exact?: boolean;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  { title: 'Overview', items: [{ path: '/', label: 'Dashboard', icon: 'dashboard', exact: true }] },
  {
    title: 'Customers',
    items: [
      { path: '/responses', label: 'Responses', icon: 'responses' },
      { path: '/contacts', label: 'Contacts', icon: 'contacts' },
      { path: '/rewards', label: 'Rewards', icon: 'gift' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { path: '/questionnaire', label: 'Questionnaire', icon: 'form' },
      { path: '/qr', label: 'QR code', icon: 'qr' },
      { path: '/business', label: 'Business profile', icon: 'business' },
      { path: '/settings', label: 'Settings', icon: 'shield' },
    ],
  },
];

/** App shell (TailAdmin layout): collapsible sidebar, mobile drawer, sticky header. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, BrandLogo],
  templateUrl: './app-shell.html',
})
export class AppShell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly businesses = inject(BusinessApi);
  protected readonly businessList = signal<Business[]>([]);
  protected readonly theme = inject(ThemeService);

  protected readonly adminMode = inject(ActivatedRoute).snapshot.data['admin'] === true;
  protected readonly groups: NavGroup[] = this.adminMode
    ? [
        {
          title: 'Platform administration',
          items: [
            { path: '/admin/dashboard', label: 'Dashboard', icon: 'dashboard' },
            { path: '/admin/businesses', label: 'Businesses', icon: 'business' },
            { path: '/admin/users', label: 'Users', icon: 'user' },
            { path: '/admin/forms', label: 'Forms', icon: 'form' },
            { path: '/admin/responses', label: 'Responses', icon: 'responses' },
            { path: '/admin/contacts', label: 'Contacts', icon: 'contacts' },
            { path: '/admin/promotions', label: 'Promotions', icon: 'gift' },
            { path: '/admin/activity', label: 'Activity', icon: 'calendar' },
            { path: '/admin/system', label: 'System', icon: 'shield' },
          ],
        },
      ]
    : GROUPS;
  protected readonly user = this.auth.user;
  protected readonly business = signal<Business | null>(null);
  /** Desktop: full sidebar vs icon rail. */
  protected readonly expanded = signal(true);
  /** Mobile: drawer open. */
  protected readonly drawer = signal(false);
  protected readonly menu = signal(false);
  protected readonly signingOut = signal(false);
  protected readonly signOutError = signal('');

  protected readonly initials = computed(() =>
    (this.user()?.fullName ?? '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join(''),
  );

  constructor() {
    if (!this.adminMode)
      this.businesses.list().subscribe({
        next: (list) => {
          this.businessList.set(list);
          this.business.set(list[0] ?? null);
        },
      });
    // Close transient UI after every navigation.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.drawer.set(false);
      this.menu.set(false);
      document.getElementById('content')?.focus({ preventScroll: true });
    });
  }

  protected toggleSidebar(): void {
    if (window.matchMedia('(min-width: 1280px)').matches) this.expanded.update((v) => !v);
    else this.drawer.update((v) => !v);
  }

  protected selectBusiness(event: Event): void {
    this.businesses.select((event.target as HTMLSelectElement).value);
    window.location.assign('/');
  }

  @HostListener('document:keydown.escape')
  protected closeOverlays(): void {
    this.drawer.set(false);
    this.menu.set(false);
  }

  @HostListener('document:click', ['$event'])
  protected outside(e: MouseEvent): void {
    if (this.menu() && !(e.target as HTMLElement).closest('[data-user-menu]')) this.menu.set(false);
  }

  protected signOut(): void {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    this.signOutError.set('');
    this.auth
      .logout()
      .pipe(finalize(() => this.signingOut.set(false)))
      .subscribe({
        next: () => void this.router.navigate(['/login']),
        error: (err: unknown) =>
          this.signOutError.set(`Sign-out could not be confirmed. ${apiErrorMessage(err)}`),
      });
  }
}
