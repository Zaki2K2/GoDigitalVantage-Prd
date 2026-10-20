import { ActionMenu } from '../../shared/action-menu';
import { AppSelect } from '../../shared/app-select';
import { QuestionnaireFormView } from '../questionnaire/questionnaire-form-view';
import { QuestionnaireContent } from '../../core/questionnaire/questionnaire.service';
import { DatePipe, Location } from '@angular/common';
import {
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import { apiErrorMessage, AuthService } from '../../core/auth/auth.service';
import { Business, BusinessInput } from '../../core/business/business.service';
import { BusinessForm } from '../business/business-form';
import { Avatar } from '../../shared/avatar';
import { DialogFocus } from '../../shared/dialog-focus';
import { Icon } from '../../shared/icon';
import { RecordDetails } from '../../shared/record-details';
import { AdminDashboard } from './admin-dashboard';
import { AdminApi, AdminRecord, AdminResult } from './admin.api';

const SECTIONS = [
  'dashboard',
  'businesses',
  'users',
  'forms',
  'responses',
  'contacts',
  'promotions',
  'activity',
  'system',
  'search',
];
const COLUMNS: Record<string, string[]> = {
  businesses: ['name', 'owner', 'status', 'memberCount', 'formCount', 'responseCount', 'createdAt'],
  users: ['fullName', 'emailLowercase', 'status', 'platformRole', 'businessCount', 'createdAt'],
  forms: ['draft.title', 'businessName', 'publishedVersion', 'responseCount', 'updatedAt'],
  responses: ['businessName', 'rating', 'questionnaireVersion', 'submittedAt'],
  contacts: ['fullName', 'emailLowercase', 'phoneE164', 'businessName', 'lastResponseAt'],
  promotions: ['code', 'businessName', 'status', 'discountValue', 'expiresAt'],
  activity: ['action', 'actorName', 'entity', 'outcome', 'at'],
  members: ['user', 'role', 'status', 'createdAt'],
  memberships: ['business', 'role', 'status', 'createdAt'],
  versions: ['title', 'version', 'publishedAt'],
};
interface PendingAction {
  description?: string;
  title: string;
  path: string;
  body: object;
  method?: 'post' | 'patch' | 'delete';
}
@Component({
  selector: 'app-admin-page',
  imports: [
    ActionMenu,
    Avatar,
    AppSelect,
    AdminDashboard,
    DatePipe,
    RouterLink,
    FormsModule,
    Icon,
    DialogFocus,
    RecordDetails,
    BusinessForm,
    QuestionnaireFormView,
  ],
  templateUrl: './admin.page.html',
})
export class AdminPage {
  private readonly api = inject(AdminApi);
  protected readonly currentUser = inject(AuthService).user;
  protected selectedPlatformRole = 'USER';
  protected readonly membershipRoles = new Map<string, string>();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  private request?: Subscription;
  private initialized = false;
  private loadQueued = false;
  private recordRequest?: Subscription;
  private readonly searchInput = new Subject<string>();
  protected readonly section = signal('dashboard');
  protected readonly id = signal('');
  protected readonly tab = signal('overview');
  protected readonly record = signal<AdminRecord | null>(null);
  private readonly actionMenus = viewChildren(ActionMenu);
  protected readonly rows = signal<AdminRecord[]>([]);
  protected readonly inspected = signal<AdminRecord | null>(null);
  protected readonly metrics = signal<{ label: string; value: number }[]>([]);
  protected readonly average = signal<number | null>(null);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly pages = signal(1);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly busy = signal(false);
  protected readonly pending = signal<PendingAction | null>(null);
  protected readonly editing = signal(false);
  protected readonly qrUrl = signal('');
  protected search = '';
  protected status = '';
  protected role = '';
  protected from = '';
  protected to = '';
  protected rating = '';
  protected businessId = '';
  protected action = '';
  protected actorUserId = '';
  protected entity = '';
  protected onboarding = '';
  protected questionnaireId = '';
  protected sort = 'createdAt';
  protected direction = 'desc';
  protected readonly activeResource = computed(() =>
    this.id() && this.tab() !== 'overview' ? this.tab() : this.section(),
  );
  protected readonly columns = computed(() => COLUMNS[this.activeResource()] ?? []);
  protected readonly tabs = computed(() =>
    this.section() === 'businesses'
      ? [
          'overview',
          'members',
          'forms',
          'responses',
          'contacts',
          'promotions',
          'qr',
          'activity',
          'settings',
        ]
      : this.section() === 'forms'
        ? ['overview', 'preview', 'versions']
        : this.section() === 'users'
          ? ['overview', 'memberships']
          : ['overview'],
  );
  protected readonly statuses = computed(
    () =>
      ({
        businesses: ['active', 'onboarding', 'disabled', 'suspended', 'archived'],
        users: ['active', 'disabled'],
        forms: ['draft', 'published', 'archived'],
        promotions: ['pending_approval', 'issued', 'redeemed', 'expired', 'cancelled', 'rejected'],
      })[this.activeResource()] ?? [],
  );
  protected readonly recordTitle = computed(() => {
    const item = this.record();
    const draft = item?.['draft'] as { title?: string } | undefined;
    return String(
      item?.['name'] ||
        item?.['fullName'] ||
        item?.['code'] ||
        draft?.title ||
        this.label(this.section()),
    );
  });
  protected readonly formPreview = computed(
    () => this.record()?.['draft'] as QuestionnaireContent | undefined,
  );
  protected readonly business = computed(() =>
    this.record()
      ? ({ ...this.record(), id: this.record()!._id, role: 'owner' } as unknown as Business)
      : null,
  );
  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.recordRequest?.unsubscribe();
      this.pending.set(null);
      const section = params.get('section') ?? 'dashboard';
      this.section.set(section);
      this.id.set(params.get('id') ?? '');
      this.record.set(null);
      this.inspected.set(null);
      this.editing.set(false);
      if (!SECTIONS.includes(section)) {
        this.error.set('This admin section does not exist.');
        this.loading.set(false);
        return;
      }
      if (this.id()) this.loadRecord();
      if (this.initialized) this.scheduleLoad();
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.search = params.get('search') ?? '';
      this.status = params.get('status') ?? '';
      this.role = params.get('role') ?? '';
      this.from = params.get('from') ?? '';
      this.to = params.get('to') ?? '';
      this.rating = params.get('rating') ?? '';
      this.businessId = params.get('businessId') ?? '';
      for (const key of [
        'action',
        'actorUserId',
        'entity',
        'onboarding',
        'questionnaireId',
      ] as const)
        this[key] = params.get(key) ?? '';
      this.sort = params.get('sort') ?? 'createdAt';
      this.direction = params.get('direction') ?? 'desc';
      this.page.set(Number(params.get('page')) || 1);
      this.tab.set(params.get('tab') ?? 'overview');
      this.scheduleLoad();
    });
    this.searchInput
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => {
        this.search = value;
        this.apply();
      });
    this.destroyRef.onDestroy(() => {
      this.request?.unsubscribe();
      this.recordRequest?.unsubscribe();
    });
  }
  protected heading(column: string): string {
    return (
      (
        {
          name: 'Business',
          memberCount: 'Members',
          formCount: 'Forms',
          responseCount: 'Responses',
          businessCount: 'Businesses',
          createdAt: 'Created',
          updatedAt: 'Updated',
          submittedAt: 'Submitted',
          publishedAt: 'Published',
          lastResponseAt: 'Last response',
          emailLowercase: 'Email',
          phoneE164: 'Phone',
          fullName: 'Name',
          platformRole: 'Role',
          businessName: 'Business',
          publishedVersion: 'Version',
          questionnaireVersion: 'Version',
        } as Record<string, string>
      )[column] ?? this.label(column)
    );
  }
  /** Optional photo/logo of a user or business record; null when none was uploaded. */
  protected imageSrc(row: AdminRecord | null): string | null {
    if (!row) return null;
    const resource = this.activeResource();
    const stamp = resource === 'users' ? row['avatarUpdatedAt'] : row['logoUpdatedAt'];
    if (!stamp || (resource !== 'users' && resource !== 'businesses')) return null;
    const path = resource === 'users' ? `users/${row._id}/avatar` : `businesses/${row._id}/logo`;
    return `/api/v1/admin/${path}?v=${new Date(String(stamp)).getTime()}`;
  }
  protected hasImageSlot(): boolean {
    return ['users', 'businesses'].includes(this.activeResource());
  }
  protected owner(row: AdminRecord, field: string): string {
    const value = row['owner'];
    return value && typeof value === 'object'
      ? String((value as Record<string, unknown>)[field] ?? '')
      : '';
  }
  protected rowStatus(row: AdminRecord, column: string): string {
    return String(
      column === 'status' &&
        this.activeResource() === 'businesses' &&
        ['suspended', 'archived'].includes(String(row['adminState']))
        ? row['adminState']
        : (row[column] ?? 'active'),
    );
  }
  protected statusTone(status: string): string {
    if (['active', 'issued', 'redeemed', 'completed', 'published'].includes(status))
      return 'success';
    if (['disabled', 'suspended', 'failed', 'cancelled', 'rejected'].includes(status))
      return 'error';
    if (['onboarding', 'pending', 'pending_approval'].includes(status)) return 'warn';
    return 'neutral';
  }
  protected closeRowMenu(restoreFocus = false): void {
    for (const menu of this.actionMenus()) menu.close(restoreFocus);
  }
  protected label(value: string): string {
    return value
      .replaceAll('_', ' ')
      .replaceAll('-', ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace('draft.title', 'Title')
      .replace(/^./, (c) => c.toUpperCase());
  }
  protected cell(row: AdminRecord, column: string): string {
    const value = column
      .split('.')
      .reduce<unknown>(
        (v, key) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined),
        row,
      );
    if (value === null || value === undefined) return '-';
    if (column === 'owner' && typeof value === 'object') {
      const u = value as Record<string, unknown>;
      return `${u['fullName']} (${u['emailLowercase']})`;
    }
    if (column === 'business' && Array.isArray(value))
      return value.map((b) => b.name).join(', ') || 'Deleted business';
    if (column === 'user' && Array.isArray(value))
      return value.map((u) => `${u.fullName} (${u.emailLowercase})`).join(', ') || 'Deleted user';
    if (typeof value === 'object') return 'View details';
    if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value))
      return new Date(value).toLocaleString();
    return String(value);
  }
  protected changeSearch(value: string): void {
    this.search = value;
    this.searchInput.next(value);
  }
  protected apply(page = 1): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        action: this.action || null,
        actorUserId: this.actorUserId || null,
        entity: this.entity || null,
        onboarding: this.onboarding || null,
        questionnaireId: this.questionnaireId || null,
        search: this.search || null,
        status: this.status || null,
        role: this.role || null,
        from: this.from || null,
        to: this.to || null,
        rating: this.rating || null,
        businessId: this.businessId || null,
        sort: this.sort,
        direction: this.direction,
        page,
        tab: this.id() ? this.tab() : null,
      },
    });
  }
  protected chooseTab(tab: string): void {
    this.search = '';
    this.status = '';
    this.role = '';
    this.from = '';
    this.to = '';
    this.rating = '';
    this.businessId = '';
    this.action = '';
    this.actorUserId = '';
    this.entity = '';
    this.onboarding = '';
    this.questionnaireId = '';
    this.tab.set(tab);
    this.apply();
  }
  protected back(): void {
    this.location.back();
  }
  private loadRecord(): void {
    this.recordRequest?.unsubscribe();
    this.recordRequest = this.api
      .get<{ data: AdminRecord }>(`${this.section()}/${this.id()}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.record.set(result.data);
          this.selectedPlatformRole = String(result.data['platformRole'] ?? 'USER');
        },
        error: (err) => {
          this.error.set(apiErrorMessage(err));
          this.loading.set(false);
        },
      });
  }
  private scheduleLoad(): void {
    this.request?.unsubscribe();
    if (!this.initialized) {
      this.initialized = true;
      this.load();
      return;
    }
    if (this.loadQueued) return;
    this.loadQueued = true;
    queueMicrotask(() => {
      this.loadQueued = false;
      if (!this.destroyRef.destroyed) this.load();
    });
  }
  protected load(): void {
    this.closeRowMenu();
    this.request?.unsubscribe();
    this.error.set('');
    this.rows.set([]);
    this.loading.set(true);
    const section = this.section();
    const tab = this.tab();
    const id = this.id();
    if (!SECTIONS.includes(section)) {
      this.error.set('This admin section does not exist.');
      this.loading.set(false);
      return;
    }
    if (id && !this.tabs().includes(tab)) {
      this.error.set('This tab does not exist.');
      this.loading.set(false);
      return;
    }
    if (id && (tab === 'overview' || tab === 'settings' || tab === 'preview')) {
      this.loading.set(false);
      return;
    }
    if (id && tab === 'qr') {
      this.request = this.api
        .get<{ data: { publicUrl: string } }>(`businesses/${id}/qr`)
        .subscribe({
          next: (r) => {
            this.qrUrl.set(r.data.publicUrl);
            this.loading.set(false);
          },
          error: (err) => this.failed(err),
        });
      return;
    }
    if (section === 'dashboard') {
      this.request = this.api
        .get<{
          data: { metrics: { label: string; value: number }[]; averageRating: number | null };
        }>('dashboard')
        .subscribe({
          next: (r) => {
            this.metrics.set(r.data.metrics);
            this.average.set(r.data.averageRating);
            this.loading.set(false);
          },
          error: (err) => this.failed(err),
        });
      return;
    }
    if (section === 'system') {
      this.request = this.api.get<{ data: AdminRecord }>('system').subscribe({
        next: (r) => {
          this.record.set(r.data);
          this.loading.set(false);
        },
        error: (err) => this.failed(err),
      });
      return;
    }
    if (section === 'search') {
      this.request = this.api
        .get<{ data: { resource: string; data: AdminRecord[] }[] }>('search', {
          search: this.search,
        })
        .subscribe({
          next: (r) => {
            this.rows.set(
              r.data.flatMap((group) =>
                group.data.map((item) => ({ ...item, resource: group.resource })),
              ),
            );
            this.loading.set(false);
          },
          error: (err) => this.failed(err),
        });
      return;
    }
    const path =
      id && (tab === 'members' || tab === 'versions' || tab === 'memberships')
        ? `${section}/${id}/${tab}`
        : id
          ? tab
          : section;
    if (
      [this.from, this.to].some(
        (value) =>
          value &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            !Number.isFinite(new Date(`${value}T00:00:00Z`).getTime())),
      )
    ) {
      this.error.set('Choose valid start and end dates.');
      this.loading.set(false);
      return;
    }
    const query = {
      action: this.action,
      actorUserId: this.actorUserId,
      entity: this.entity,
      onboarding: this.onboarding,
      questionnaireId: this.questionnaireId,
      page: String(this.page()),
      search: this.search,
      status: this.status,
      role: this.role,
      from: this.from ? new Date(`${this.from}T00:00:00Z`).toISOString() : '',
      to: this.to ? new Date(`${this.to}T23:59:59.999Z`).toISOString() : '',
      rating: this.rating,
      businessId: id && section === 'businesses' ? id : this.businessId,
      sort: this.sort,
      direction: this.direction,
    };
    this.request = this.api.get<AdminResult>(path, query).subscribe({
      next: (r) => {
        this.rows.set(r.data);
        this.total.set(r.pagination.total);
        this.pages.set(r.pagination.totalPages);
        this.loading.set(false);
      },
      error: (err) => this.failed(err),
    });
  }
  private failed(error: unknown): void {
    this.error.set(apiErrorMessage(error));
    this.loading.set(false);
  }
  protected open(row: AdminRecord): void {
    this.closeRowMenu(true);
    const resource = String(row['resource'] ?? this.activeResource());
    if (resource === 'members' && row['userId'])
      void this.router.navigate(['/admin/users', row['userId']]);
    else if (resource === 'memberships' && row['businessId'])
      void this.router.navigate(['/admin/businesses', row['businessId']]);
    else if (['members', 'versions', 'memberships'].includes(resource)) this.inspected.set(row);
    else void this.router.navigate(['/admin', resource, row._id]);
  }
  protected retry(): void {
    if (this.id()) this.loadRecord();
    this.load();
  }
  protected formAction(action: string): void {
    this.pending.set({
      title: `${this.label(action)} form`,
      description:
        'Publishing creates an immutable version using the current draft revision. Archiving hides public forms while keeping all versions and responses. Restoring makes the existing published version available again.',
      path: `forms/${this.id()}/${action}`,
      body: {
        confirm: true,
        ...(action === 'publish' ? { expectedRevision: this.record()?.['draftRevision'] } : {}),
      },
    });
  }
  protected promotionAction(action: string): void {
    this.pending.set({
      title: `${this.label(action)} promotion`,
      path: `promotions/${this.id()}/${action}`,
      body: { confirm: true },
    });
  }
  protected businessAction(state: string, target = this.id()): void {
    this.closeRowMenu(true);
    this.pending.set({
      title: `${({ active: 'Reactivate', suspended: 'Suspend', archived: 'Archive' } as Record<string, string>)[state]} business`,
      description:
        state === 'active'
          ? 'Restore member access and public feedback forms according to onboarding state. Stored records are preserved.'
          : 'Members will lose business access and public feedback forms will become unavailable. All records remain stored; you can restore access later.',
      path: `businesses/${target}/state`,
      body: { state, confirm: true },
    });
  }
  protected userAction(action: string, target = this.id()): void {
    this.closeRowMenu(true);
    this.pending.set({
      title: `${this.label(action)} user`,
      description: ['enable', 'unblock'].includes(action)
        ? 'Enable the account. The user must sign in again; revoked sessions remain invalid.'
        : "Immediately revoke this user's current sessions. Disabling also blocks new sign-ins. Stored business data is preserved.",
      path: `users/${target}/action`,
      body: { action, confirm: true },
    });
  }
  protected instantRewardAccess(): void {
    const permissions = this.record()?.['permissions'];
    const enabled = !(Array.isArray(permissions) && permissions.includes('instant_rewards:manage'));
    this.pending.set({
      title: enabled ? 'Grant Instant Rewards management' : 'Remove Instant Rewards management',
      description:
        'This changes only Instant Rewards management and revokes current sessions. The user must sign in again.',
      path: `users/${this.id()}/instant-reward-access`,
      body: { enabled, confirm: true },
    });
  }
  protected platformRoleAction(): void {
    this.pending.set({
      title: 'Change platform role',
      description: `Set this account to ${this.selectedPlatformRole}. Super Admin grants full platform access. Existing sessions will be revoked; you cannot change your own role.`,
      path: `users/${this.id()}/role`,
      method: 'patch',
      body: { platformRole: this.selectedPlatformRole, confirm: true },
    });
  }
  protected membershipRole(row: AdminRecord): void {
    const role = this.membershipRoles.get(row._id) ?? String(row['role']);
    this.pending.set({
      title: 'Change business role',
      description: `Set the membership to ${role}. An owner manages this business. Another active owner must remain before an owner can be demoted.`,
      path: `businesses/${row['businessId'] || this.id()}/members/${row._id}`,
      method: 'patch',
      body: { role, confirm: true },
    });
  }
  protected membershipState(row: AdminRecord, status: string): void {
    this.closeRowMenu(true);
    this.pending.set({
      title: `${status === 'active' ? 'Enable' : 'Disable'} membership`,
      path: `businesses/${row['businessId'] || this.id()}/members/${row._id}`,
      method: 'patch',
      body: { status, confirm: true },
    });
  }
  protected removeMember(row: AdminRecord): void {
    this.closeRowMenu(true);
    this.pending.set({
      title: 'Remove business access',
      path: `businesses/${row['businessId'] || this.id()}/members/${row._id}`,
      method: 'delete',
      body: { confirm: true },
    });
  }
  protected confirm(): void {
    const action = this.pending();
    if (!action || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.api
      .write(action.path, action.body, action.method)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.pending.set(null);
          this.notice.set(`${action.title} completed successfully.`);
          if (this.id()) this.loadRecord();
          this.load();
        },
        error: (err) => {
          this.busy.set(false);
          this.pending.set(null);
          this.failed(err);
        },
      });
  }
  protected saveBusiness(input: BusinessInput): void {
    this.busy.set(true);
    this.error.set('');
    this.api
      .write(`businesses/${this.id()}`, input, 'patch')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.record.set(r.data);
          this.busy.set(false);
          this.editing.set(false);
          this.notice.set('Business updated successfully.');
        },
        error: (err) => {
          this.busy.set(false);
          this.failed(err);
        },
      });
  }
  protected async copy(value: string): Promise<void> {
    this.closeRowMenu(true);
    try {
      await navigator.clipboard.writeText(value);
      this.notice.set('Copied to clipboard.');
    } catch {
      this.error.set('Copy failed. Select and copy the displayed value.');
    }
  }
  @HostListener('document:keydown.escape') protected dismiss(): void {
    this.closeRowMenu(true);
    if (!this.busy()) {
      this.pending.set(null);
      this.inspected.set(null);
    }
  }
}
