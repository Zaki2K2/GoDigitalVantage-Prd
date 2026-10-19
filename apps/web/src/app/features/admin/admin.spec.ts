import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { adminGuard } from '../../core/auth/auth.guard';
import { AdminPage } from './admin.page';
import { AppShell } from '../shell/app-shell';
import { BusinessApi } from '../../core/business/business.service';

const B = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const response = (data: unknown[], page = 1, total = data.length, totalPages = 1) => ({
  data,
  pagination: { page, pageSize: 20, total, totalPages },
});
describe('platform admin UI', () => {
  let http: HttpTestingController;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let role: string;
  beforeEach(() => {
    role = 'SUPER_ADMIN';
    params = new BehaviorSubject(convertToParamMap({ section: 'businesses' }));
    query = new BehaviorSubject(convertToParamMap({}));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params, queryParamMap: query, snapshot: { data: { admin: true } } },
        },
        {
          provide: AuthService,
          useValue: {
            user: () => ({ id: 'admin-id', fullName: 'Admin', platformRole: role }),
            withCsrf: <T>(fn: () => T) => fn(),
          },
        },
        { provide: BusinessApi, useValue: { list: () => of([]) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify({ ignoreCancelled: true }));
  const create = () => {
    const f = TestBed.createComponent(AdminPage);
    f.detectChanges();
    return f;
  };
  const listRequest = () => http.expectOne((r) => r.url === '/api/v1/admin/businesses');
  const text = (f: ComponentFixture<unknown>) => (f.nativeElement as HTMLElement).textContent ?? '';
  const button = (f: ComponentFixture<unknown>, label: string) =>
    Array.from((f.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === label,
    )!;
  it('allows super admins and denies normal business users at the route guard', () => {
    expect(TestBed.runInInjectionContext(() => adminGuard({} as never, {} as never))).toBeTrue();
    role = 'USER';
    const result = TestBed.runInInjectionContext(() => adminGuard({} as never, {} as never));
    expect(result).not.toBeTrue();
  });
  it('uses the shared shell and only renders supported admin navigation', () => {
    const f = TestBed.createComponent(AppShell);
    f.detectChanges();
    expect(text(f)).toContain('Platform administration');
    expect(
      (f.nativeElement as HTMLElement).querySelector('a[href="/admin/businesses"]'),
    ).not.toBeNull();
    expect((f.nativeElement as HTMLElement).querySelector('a[href="/admin/projects"]')).toBeNull();
    http.expectNone('/api/v1/businesses');
  });
  it('does not show the admin entry to ordinary users', () => {
    role = 'USER';
    TestBed.inject(ActivatedRoute).snapshot.data['admin'] = false;
    const f = TestBed.createComponent(AppShell);
    f.detectChanges();
    const menu = (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-user-menu] button',
    )!;
    menu.click();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('a[href="/admin"]')).toBeNull();
  });
  it('renders loading and then a real empty state', () => {
    const f = create();
    expect(text(f)).toContain('Loading');
    listRequest().flush(response([]));
    f.detectChanges();
    expect(text(f)).toContain('No results');
  });
  it('renders server errors and retries', () => {
    const f = create();
    listRequest().flush(
      { error: { message: 'Access denied' } },
      { status: 403, statusText: 'Forbidden' },
    );
    f.detectChanges();
    expect(text(f)).toContain('Access denied');
    button(f, 'Retry').click();
    listRequest().flush(response([]));
    f.detectChanges();
    expect(text(f)).toContain('No results');
  });
  it('restores filters and page from URL and sends them to the API', () => {
    query.next(convertToParamMap({ search: 'Alpha', status: 'suspended', page: '2' }));
    const f = create();
    const r = listRequest();
    expect(r.request.params.get('search')).toBe('Alpha');
    expect(r.request.params.get('status')).toBe('suspended');
    expect(r.request.params.get('page')).toBe('2');
    r.flush(response([{ _id: B, name: 'Alpha' }], 2, 40, 2));
    f.detectChanges();
    expect(text(f)).toContain('Alpha');
    expect(button(f, 'Next').disabled).toBeTrue();
  });
  it('debounces search, stores it in URL and resets pagination', fakeAsync(() => {
    const f = create();
    listRequest().flush(response([]));
    f.detectChanges();
    tick();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const input = (f.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '#admin-search',
    )!;
    input.value = 'Alpha';
    input.dispatchEvent(new Event('input'));
    tick(299);
    expect(navigate).not.toHaveBeenCalled();
    tick(1);
    expect(navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({ search: 'Alpha', page: 1 }),
      }),
    );
  }));
  it('cancels an obsolete list request when filters change', async () => {
    create();
    const old = listRequest();
    query.next(convertToParamMap({ search: 'new' }));
    expect(old.cancelled).toBeTrue();
    await Promise.resolve();
    listRequest().flush(response([]));
  });
  it('requires confirmation before suspension and shows success feedback', () => {
    params.next(convertToParamMap({ section: 'businesses', id: B }));
    const f = create();
    http
      .expectOne(`/api/v1/admin/businesses/${B}`)
      .flush({ data: { _id: B, name: 'Alpha', adminState: 'active' } });
    f.detectChanges();
    button(f, 'Suspend').click();
    f.detectChanges();
    http.expectNone(`/api/v1/admin/businesses/${B}/state`);
    expect((f.nativeElement as HTMLElement).querySelector('[role="dialog"]')).not.toBeNull();
    button(f, 'Confirm').click();
    const r = http.expectOne(`/api/v1/admin/businesses/${B}/state`);
    expect(r.request.body).toEqual({ state: 'suspended', confirm: true });
    r.flush({ data: { _id: B } });
    http
      .expectOne(`/api/v1/admin/businesses/${B}`)
      .flush({ data: { _id: B, name: 'Alpha', adminState: 'suspended' } });
    f.detectChanges();
    expect(text(f)).toContain('completed successfully');
  });
  it('cancels the confirmation without writing', () => {
    params.next(convertToParamMap({ section: 'businesses', id: B }));
    const f = create();
    http.expectOne(`/api/v1/admin/businesses/${B}`).flush({ data: { _id: B, name: 'Alpha' } });
    f.detectChanges();
    button(f, 'Suspend').click();
    f.detectChanges();
    button(f, 'Cancel').click();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[role="dialog"]')).toBeNull();
  });
  it('loads a business detail tab in the selected tenant scope', () => {
    params.next(convertToParamMap({ section: 'businesses', id: B }));
    query.next(convertToParamMap({ tab: 'responses' }));
    const f = create();
    http.expectOne(`/api/v1/admin/businesses/${B}`).flush({ data: { _id: B, name: 'Alpha' } });
    const r = http.expectOne((r) => r.url === '/api/v1/admin/responses');
    expect(r.request.params.get('businessId')).toBe(B);
    r.flush(response([]));
    f.detectChanges();
    expect(text(f)).toContain('No results');
  });
  it('updates the URL when changing detail tabs', () => {
    params.next(convertToParamMap({ section: 'businesses', id: B }));
    const f = create();
    http.expectOne(`/api/v1/admin/businesses/${B}`).flush({ data: { _id: B, name: 'Alpha' } });
    f.detectChanges();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    button(f, 'Members').click();
    expect(navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({ tab: 'members', page: 1 }),
      }),
    );
  });
  it('reloads when the section changes with unchanged query parameters', async () => {
    create();
    listRequest().flush(response([]));
    params.next(convertToParamMap({ section: 'users' }));
    await Promise.resolve();
    http.expectOne((r) => r.url === '/api/v1/admin/users').flush(response([]));
  });
  it('handles malformed date filters without throwing or making a request', () => {
    query.next(convertToParamMap({ from: 'invalid' }));
    const f = create();
    http.expectNone((r) => r.url === '/api/v1/admin/businesses');
    expect(text(f)).toContain('Choose valid start and end dates');
  });
  it('opens row actions without increasing row height and restores focus on Escape', fakeAsync(() => {
    const f = create();
    listRequest().flush(
      response([{ _id: B, name: 'Alpha', adminState: 'active', status: 'active' }]),
    );
    f.detectChanges();
    tick();
    const el = f.nativeElement as HTMLElement;
    const row = el.querySelector('tbody tr')!;
    const height = row.getBoundingClientRect().height;
    const trigger = el.querySelector<HTMLButtonElement>('[data-admin-row-trigger]')!;
    trigger.click();
    f.detectChanges();
    tick();
    expect(el.querySelector('[role="menu"]')).not.toBeNull();
    expect(row.getBoundingClientRect().height).toBe(height);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  }));
  it('keeps business suspension behind confirmation when selected from a row menu', fakeAsync(() => {
    const f = create();
    listRequest().flush(response([{ _id: B, name: 'Alpha', adminState: 'active' }]));
    f.detectChanges();
    tick();
    (f.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-admin-row-trigger]')!
      .click();
    f.detectChanges();
    tick();
    button(f, 'Suspend business').click();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[role="menu"]')).toBeNull();
    expect((f.nativeElement as HTMLElement).querySelector('[role="dialog"]')).not.toBeNull();
    http.expectNone(`/api/v1/admin/businesses/${B}/state`);
  }));
  it('blocks a user through the real action endpoint only after confirmation', () => {
    params.next(convertToParamMap({ section: 'users', id: B }));
    const f = create();
    http
      .expectOne(`/api/v1/admin/users/${B}`)
      .flush({ data: { _id: B, fullName: 'Customer', status: 'active', platformRole: 'USER' } });
    f.detectChanges();
    button(f, 'Block user').click();
    f.detectChanges();
    http.expectNone(`/api/v1/admin/users/${B}/action`);
    button(f, 'Confirm').click();
    const action = http.expectOne(`/api/v1/admin/users/${B}/action`);
    expect(action.request.body).toEqual({ action: 'block', confirm: true });
    action.flush({ data: { _id: B } });
    http
      .expectOne(`/api/v1/admin/users/${B}`)
      .flush({ data: { _id: B, status: 'disabled', platformRole: 'USER' } });
    f.detectChanges();
    expect(button(f, 'Unblock user')).toBeDefined();
  });
  it('offers revocation for another Super Admin and displays server permission errors', () => {
    params.next(convertToParamMap({ section: 'users', id: B }));
    const f = create();
    http
      .expectOne(`/api/v1/admin/users/${B}`)
      .flush({ data: { _id: B, status: 'active', platformRole: 'SUPER_ADMIN' } });
    f.detectChanges();
    button(f, 'Revoke Sessions').click();
    f.detectChanges();
    button(f, 'Confirm').click();
    const action = http.expectOne(`/api/v1/admin/users/${B}/action`);
    expect(action.request.body.action).toBe('revoke-sessions');
    action.flush(
      { error: { message: 'Super Admin access required' } },
      { status: 403, statusText: 'Forbidden' },
    );
    f.detectChanges();
    expect(text(f)).toContain('Super Admin access required');
    expect(text(f)).not.toContain('completed successfully');
  });
  it('changes a platform role using the selected value and explicit confirmation', fakeAsync(() => {
    params.next(convertToParamMap({ section: 'users', id: B }));
    const f = create();
    http
      .expectOne(`/api/v1/admin/users/${B}`)
      .flush({ data: { _id: B, status: 'active', platformRole: 'USER' } });
    f.detectChanges();
    tick();
    const select = (f.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      '#platform-role',
    )!;
    select.value = 'SUPER_ADMIN';
    select.dispatchEvent(new Event('change'));
    button(f, 'Change Roles').click();
    f.detectChanges();
    button(f, 'Confirm').click();
    const action = http.expectOne(`/api/v1/admin/users/${B}/role`);
    expect(action.request.method).toBe('PATCH');
    expect(action.request.body).toEqual({ platformRole: 'SUPER_ADMIN', confirm: true });
    action.flush({ data: { _id: B } });
    http
      .expectOne(`/api/v1/admin/users/${B}`)
      .flush({ data: { _id: B, status: 'active', platformRole: 'SUPER_ADMIN' } });
  }));
  it('removes access from the user membership tab using that membership business ID', () => {
    const userId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    const membershipId = 'cccccccccccccccccccccccc';
    params.next(convertToParamMap({ section: 'users', id: userId }));
    query.next(convertToParamMap({ tab: 'memberships' }));
    const f = create();
    http
      .expectOne(`/api/v1/admin/users/${userId}`)
      .flush({ data: { _id: userId, status: 'active' } });
    http
      .expectOne((r) => r.url === `/api/v1/admin/users/${userId}/memberships`)
      .flush(
        response([{ _id: membershipId, userId, businessId: B, role: 'member', status: 'active' }]),
      );
    f.detectChanges();
    button(f, 'Remove Business Access').click();
    f.detectChanges();
    button(f, 'Confirm').click();
    const action = http.expectOne(`/api/v1/admin/businesses/${B}/members/${membershipId}`);
    expect(action.request.method).toBe('DELETE');
    expect(action.request.body).toEqual({ confirm: true });
    action.flush({ data: { success: true } });
    http
      .expectOne(`/api/v1/admin/users/${userId}`)
      .flush({ data: { _id: userId, status: 'active' } });
    http
      .expectOne((r) => r.url === `/api/v1/admin/users/${userId}/memberships`)
      .flush(response([]));
  });
  it('changes the business role from a membership row without granting a platform role', fakeAsync(() => {
    const membershipId = 'cccccccccccccccccccccccc';
    params.next(convertToParamMap({ section: 'businesses', id: B }));
    query.next(convertToParamMap({ tab: 'members' }));
    const f = create();
    http.expectOne(`/api/v1/admin/businesses/${B}`).flush({ data: { _id: B } });
    http
      .expectOne((r) => r.url === `/api/v1/admin/businesses/${B}/members`)
      .flush(response([{ _id: membershipId, businessId: B, role: 'member', status: 'active' }]));
    f.detectChanges();
    tick();
    const select = (f.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      'select[aria-label^="Business role"]',
    )!;
    select.value = 'owner';
    select.dispatchEvent(new Event('change'));
    button(f, 'Change Roles').click();
    f.detectChanges();
    button(f, 'Confirm').click();
    const action = http.expectOne(`/api/v1/admin/businesses/${B}/members/${membershipId}`);
    expect(action.request.body).toEqual({ role: 'owner', confirm: true });
    action.flush({ data: { success: true } });
    http.expectOne(`/api/v1/admin/businesses/${B}`).flush({ data: { _id: B } });
    http.expectOne((r) => r.url === `/api/v1/admin/businesses/${B}/members`).flush(response([]));
  }));
  it('hides self-lockout controls for the current administrator', () => {
    params.next(convertToParamMap({ section: 'users', id: 'admin-id' }));
    const f = create();
    http
      .expectOne('/api/v1/admin/users/admin-id')
      .flush({ data: { _id: 'admin-id', status: 'active', platformRole: 'SUPER_ADMIN' } });
    f.detectChanges();
    expect(text(f)).toContain('Your own account is protected');
    expect(button(f, 'Block user')).toBeUndefined();
    expect(button(f, 'Change Roles')).toBeUndefined();
  });
});
