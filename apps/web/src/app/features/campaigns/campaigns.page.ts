import { ActionMenu } from '../../shared/action-menu';
import { AppSelect } from '../../shared/app-select';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, HostListener, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { Business, BusinessApi } from '../../core/business/business.service';
import { Pagination } from '../../core/feedback/feedback.service';
import { DialogFocus } from '../../shared/dialog-focus';
import { Icon, IconName } from '../../shared/icon';
import { CampaignPicker } from './campaign-picker';
import { CampaignMonitoring } from './campaign-monitoring';
import {
  CampaignApi,
  Campaign,
  CampaignConfig,
  CampaignDetail,
  CampaignTemplate,
  GlobalTemplate,
  CAMPAIGN_STATUSES,
  CAMPAIGN_TRIGGERS,
  CAMPAIGN_AUDIENCES,
  blankCampaign,
  configOf,
} from './campaign.api';

@Component({
  selector: 'app-campaigns-page',
  imports: [
    ActionMenu,
    AppSelect,
    FormsModule,
    DatePipe,
    DecimalPipe,
    DialogFocus,
    Icon,
    CampaignPicker,
    CampaignMonitoring,
  ],
  templateUrl: './campaigns.page.html',
  styleUrl: './campaigns.page.css',
})
export class CampaignsPage {
  protected monitor = signal(false);
  protected assignmentTemplate = signal<GlobalTemplate | null>(null);
  protected preview = signal<CampaignTemplate | GlobalTemplate | null>(null);
  protected discard = signal(false);
  protected fieldError = signal('');
  protected assignmentConfirmed = false;
  private afterDiscard?: () => void;
  private baseline = '';
  private leaveResolver?: (leave: boolean) => void;
  protected modalOpen() {
    return (
      this.detailLoading() ||
      this.editing() ||
      !!this.detail() ||
      !!this.pendingAction() ||
      this.monitor() ||
      !!this.preview()
    );
  }
  private snapshot() {
    return JSON.stringify([
      this.config,
      this.start,
      this.end,
      this.tags,
      this.selectedIds,
      this.targetBusiness,
    ]);
  }
  private dirty() {
    return this.editing() && this.snapshot() !== this.baseline;
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent) {
    if (this.dirty() || this.busy()) event.preventDefault();
  }
  canLeave(): boolean | Promise<boolean> {
    if (this.busy()) return false;
    if (!this.dirty()) return true;
    this.discard.set(true);
    return new Promise((resolve) => {
      this.leaveResolver = resolve;
    });
  }
  protected resolveLeave(leave: boolean) {
    if (!leave) this.afterDiscard = undefined;
    this.leaveResolver?.(leave);
    this.leaveResolver = undefined;
  }
  protected close(force = false) {
    if (this.busy()) return;
    if (this.assignmentTemplate() && !force) {
      this.assignmentTemplate.set(null);
      return;
    }
    if (this.preview() && !force) {
      this.preview.set(null);
      return;
    }
    if (force && this.afterDiscard) {
      const next = this.afterDiscard;
      this.afterDiscard = undefined;
      this.discard.set(false);
      this.editing.set(false);
      next();
      return;
    }
    if (!force && this.dirty()) {
      this.discard.set(true);
      return;
    }
    this.afterDiscard = undefined;
    this.resolveLeave(force);
    this.editing.set(false);
    this.detail.set(null);
    this.pendingAction.set(null);
    this.preview.set(null);
    this.monitor.set(false);
    this.assignmentTemplate.set(null);
    this.discard.set(false);
    this.error.set('');
  }
  protected goStep(step: number) {
    this.step.set(step);
    queueMicrotask(() => {
      document.getElementById('campaign-modal-title')?.focus();
      document.querySelector('.campaign-dialog-body')?.scrollTo(0, 0);
    });
  }
  protected get reviewAction() {
    return +new Date(this.start + 'Z') > Date.now() ? 'Review & schedule' : 'Review & activate';
  }
  protected previewTemplate(t: CampaignTemplate | GlobalTemplate) {
    this.preview.set(t);
  }
  protected templateIcon(t: CampaignTemplate): IconName {
    if (t.id === 'birthday') return 'gift';
    if (t.id === 'welcome') return 'user';
    if (t.id === 'loyalty') return 'star';
    if (t.id === 'winback') return 'refresh';
    return 'calendar';
  }
  protected scheduleLabel(c: Campaign) {
    return c.trigger.type === 'weekly'
      ? c.trigger.weekdays.map((d) => this.weekdays[d]?.slice(0, 3)).join(', ')
      : this.label(c.trigger.type);
  }
  protected label(value: string) {
    return (
      (
        {
          once: 'One time',
          all: 'All customers',
          selected: 'Selected customers',
          new: 'New customers',
          loyal: 'Loyal customers',
          filters: 'Custom filters',
          inactive: 'Inactive customers',
          deliveryFailures: 'Delivery failures',
          issued: 'Offers issued',
          reconciliation: 'Needs review',
        } as Record<string, string>
      )[value] ?? value.charAt(0).toUpperCase() + value.slice(1)
    );
  }
  protected templateTrigger(t: CampaignTemplate | GlobalTemplate) {
    return 'input' in t ? t.input.trigger.type : t.trigger.type;
  }
  protected duplicate(c: Campaign) {
    this.startNew(undefined, c);
    this.editId = undefined;
    this.revision = 0;
    this.config.name = c.name.slice(0, 113) + ' (copy)';
    this.baseline = this.snapshot();
  }
  protected metric(d: CampaignDetail, key: string): number {
    return d.metrics[key as keyof CampaignDetail['metrics']] ?? 0;
  }
  protected api = inject(CampaignApi);
  private destroy = inject(DestroyRef);
  protected admin = inject(ActivatedRoute).snapshot.data['campaignAdmin'] === true;
  protected business = signal<Business | null>(null);
  protected root = '';
  protected rows = signal<Campaign[]>([]);
  protected pagination = signal<Pagination | null>(null);
  protected loading = signal(false);
  protected busy = signal(false);
  protected error = signal('');
  protected success = signal('');
  protected detail = signal<CampaignDetail | null>(null);
  protected detailLoading = signal(false);
  protected editing = signal(false);
  protected step = signal(1);
  protected editId: string | undefined;
  protected revision = 0;
  protected config: CampaignConfig = blankCampaign();
  protected templates = signal<CampaignTemplate[]>([]);
  protected globalTemplates = signal<GlobalTemplate[]>([]);
  protected status = '';
  protected businessFilter = '';
  protected targetBusiness = '';
  protected page = 1;
  protected start = '';
  protected end = '';
  protected tags = '';
  protected selectedIds = '';
  protected assignmentIds = '';
  protected get chosenContacts() {
    return this.selectedIds
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  protected get chosenBusinesses() {
    return this.assignmentIds
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  protected selectTarget(ids: string[]) {
    const next = ids[0] ?? '';
    if (next !== this.targetBusiness) this.selectedIds = '';
    this.targetBusiness = next;
  }
  protected confirmation = false;
  protected pendingAction = signal<{ campaign: Campaign; action: string; count?: number } | null>(
    null,
  );
  protected readonly statuses = CAMPAIGN_STATUSES;
  protected readonly triggers = CAMPAIGN_TRIGGERS;
  protected readonly audiences = CAMPAIGN_AUDIENCES;
  protected readonly steps = ['Choose template', 'Offer', 'Customers', 'Schedule', 'Review'];
  protected readonly weekdays = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  protected get canManage() {
    return this.admin || this.business()?.role === 'owner';
  }
  constructor() {
    if (this.admin) {
      this.root = this.api.root(null);
      this.load();
      this.loadTemplates();
    } else
      inject(BusinessApi)
        .list()
        .pipe(takeUntilDestroyed(this.destroy))
        .subscribe({
          next: (rows) => {
            const b = rows[0];
            if (b) {
              this.business.set(b);
              this.root = this.api.root(b.id);
              this.targetBusiness = b.id;
              this.load();
              this.loadTemplates();
            }
          },
          error: (e) => this.error.set(apiErrorMessage(e)),
        });
  }
  protected loadTemplates() {
    this.api
      .templates(this.root)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (r) => {
          this.templates.set(r.data);
          this.globalTemplates.set(r.global);
        },
        error: (e) => this.error.set(apiErrorMessage(e)),
      });
  }
  protected load(page = 1) {
    if (!this.root) return;
    this.page = page;
    this.loading.set(true);
    this.error.set('');
    this.api
      .list(this.root, page, this.status, this.businessFilter)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (r) => {
          this.rows.set(r.data);
          this.pagination.set(r.pagination);
        },
        error: (e) => this.error.set(apiErrorMessage(e)),
      });
  }
  protected open(c: Pick<Campaign, '_id'>, page = 1) {
    this.detailLoading.set(true);
    this.busy.set(true);
    this.error.set('');
    this.api
      .detail(this.root, c._id, page)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => {
          this.busy.set(false);
          this.detailLoading.set(false);
        }),
      )
      .subscribe({
        next: (r) => this.detail.set(r.data),
        error: (e) => this.error.set(apiErrorMessage(e)),
      });
  }
  protected startNew(template?: CampaignTemplate | GlobalTemplate, c?: Campaign) {
    if (this.dirty()) {
      this.afterDiscard = () => this.startNew(template, c);
      this.discard.set(true);
      return;
    }
    this.config = c ? configOf(c) : blankCampaign(this.business()?.timezone ?? 'UTC');
    if (template) {
      if ('input' in template) this.config = configOf(template.input);
      else {
        this.config.name = template.name;
        this.config.trigger = { ...this.config.trigger, ...template.trigger };
        this.config.campaignType = template.campaignType;
        if (template.audience)
          this.config.audience = { ...this.config.audience, ...template.audience };
      }
    }
    this.editId = c?._id;
    this.revision = c?.revision ?? 0;
    this.targetBusiness = c?.businessId ?? this.business()?.id ?? '';
    this.start = this.config.startDate.slice(0, 16);
    this.end = this.config.endDate.slice(0, 16);
    this.tags = this.config.audience.tags.join(', ');
    this.selectedIds = this.config.audience.contactIds.join(', ');
    this.confirmation = false;
    this.detail.set(null);
    this.step.set(template || c ? 2 : 1);
    this.preview.set(null);
    this.assignmentTemplate.set(null);
    this.pendingAction.set(null);
    this.fieldError.set('');
    this.errors.set({});
    this.validationShown.set(false);
    this.editing.set(true);
    this.baseline = this.snapshot();
    this.error.set('');
    this.success.set('');
  }
  protected toggleDay(day: number) {
    const days = this.config.trigger.weekdays;
    this.config.trigger.weekdays = days.includes(day)
      ? days.filter((d) => d !== day)
      : [...days, day];
  }
  protected errors = signal<Record<string, string>>({});
  protected validationShown = signal(false);
  private validate(onlyStep?: number) {
    const errors: Record<string, string> = {};
    const check = (step: number, id: string, valid: boolean, message: string) => {
      if ((!onlyStep || step === onlyStep) && !valid) errors['camp-' + id] = message;
    };
    const number = (value: number | null, min: number, max: number, integer = false) =>
      value !== null &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max &&
      (!integer || Number.isInteger(value));
    const c = this.config,
      a = c.audience,
      o = c.offer,
      t = c.trigger;
    check(
      2,
      'name',
      !!c.name.trim() && c.name.length <= 120,
      'Enter a name (up to 120 characters).',
    );
    check(2, 'business', !this.admin || !!this.targetBusiness, 'Select a target business.');
    check(
      2,
      'value',
      number(o.discountValue, 0.01, o.discountType === 'percent' ? 100 : 1000000),
      'Enter a valid discount.',
    );
    check(2, 'currency', /^[A-Z]{3}$/.test(o.currency), 'Use a three-letter currency code.');
    check(2, 'validity', number(o.validityDays, 1, 365, true), 'Enter 1?365 whole days.');
    check(
      2,
      'min',
      o.minSpend === null || number(o.minSpend, 0, Number.MAX_SAFE_INTEGER),
      'Enter a positive amount or leave empty.',
    );
    check(
      2,
      'max',
      o.maxDiscount === null || number(o.maxDiscount, 0.01, Number.MAX_SAFE_INTEGER),
      'Enter an amount above zero or leave empty.',
    );
    check(
      2,
      'limit',
      number(c.usageLimit, 1, 1000000, true),
      'Enter a whole number from 1 to 1,000,000.',
    );
    check(
      2,
      'customer-limit',
      number(c.perCustomerLimit, 1, 1000, true),
      'Enter a whole number from 1 to 1,000.',
    );
    check(2, 'priority', number(c.priority, 0, 100, true), 'Enter a whole number from 0 to 100.');
    check(
      3,
      'audience',
      a.type !== 'selected' || this.chosenContacts.length > 0,
      'Select at least one customer.',
    );
    check(3, 'tags', a.type !== 'tags' || !!this.tags.trim(), 'Enter at least one tag.');
    check(3, 'segment', a.type !== 'segment' || !!a.segment.trim(), 'Enter a segment.');
    check(
      3,
      'loyalty',
      a.type !== 'loyal' || !!a.loyaltyLevel.trim() || a.minInteractions > 0,
      'Enter a loyalty level or minimum interactions.',
    );
    check(3, 'inactive', number(a.inactiveDays, 1, 3650, true), 'Enter 1?3650 whole days.');
    check(3, 'new', number(a.newDays, 1, 365, true), 'Enter 1?365 whole days.');
    check(
      3,
      'interactions',
      number(a.minInteractions, 0, 100000, true),
      'Enter a whole number from 0 to 100,000.',
    );
    check(
      4,
      'start',
      !!this.start && Number.isFinite(+new Date(this.start + 'Z')),
      'Enter a valid start date (UTC).',
    );
    check(
      4,
      'end',
      !!this.end && +new Date(this.end + 'Z') > +new Date(this.start + 'Z'),
      'End date must follow start date.',
    );
    let timezone = true;
    try {
      new Intl.DateTimeFormat('en', { timeZone: c.timezone }).format();
    } catch {
      timezone = false;
    }
    check(4, 'timezone', !!c.timezone && timezone, 'Enter a valid timezone, e.g. Asia/Karachi.');
    check(
      4,
      'trigger',
      t.type !== 'weekly' || t.weekdays.length > 0,
      'Select at least one weekday.',
    );
    check(
      4,
      'time',
      /^([01]\d|2[0-3]):[0-5]\d$/.test(t.sendTime),
      'Enter a valid local send time.',
    );
    check(
      4,
      'time-end',
      /^([01]\d|2[0-3]):[0-5]\d$/.test(t.endTime) && t.endTime >= t.sendTime,
      'End time must follow send time.',
    );
    check(4, 'day', number(t.dayOfMonth, 1, 31, true), 'Enter a day from 1 to 31.');
    check(4, 'month', number(t.month, 1, 12, true), 'Enter a month from 1 to 12.');
    check(4, 'before', number(t.daysBefore, 0, 30, true), 'Enter 0?30 whole days.');
    this.errors.set(errors);
    this.validationShown.set(Object.keys(errors).length > 0);
    if (Object.keys(errors).length) {
      if (!onlyStep) {
        const key = Object.keys(errors)[0]!;
        this.step.set(
          [
            'name',
            'business',
            'value',
            'currency',
            'validity',
            'min',
            'max',
            'limit',
            'customer-limit',
            'priority',
          ].some((v) => key === 'camp-' + v)
            ? 2
            : ['audience', 'tags', 'segment', 'loyalty', 'inactive', 'new', 'interactions'].some(
                  (v) => key === 'camp-' + v,
                )
              ? 3
              : 4,
        );
      }
      queueMicrotask(() => document.getElementById(Object.keys(errors)[0]!)?.focus());
      return false;
    }
    return true;
  }
  protected next() {
    this.fieldError.set('');
    if (!this.validate(this.step())) return;
    if (this.step() < 5) this.goStep(this.step() + 1);
    else this.save(true);
  }
  protected prepare(): boolean {
    if (
      !this.start ||
      !this.end ||
      !Number.isFinite(+new Date(this.start + 'Z')) ||
      !Number.isFinite(+new Date(this.end + 'Z'))
    ) {
      this.error.set('Enter valid start and end dates.');
      return false;
    }
    if (new Date(this.start + 'Z') >= new Date(this.end + 'Z')) {
      this.error.set('End date must follow start date.');
      this.step.set(4);
      return false;
    }
    this.config.startDate = new Date(this.start + 'Z').toISOString();
    this.config.endDate = new Date(this.end + 'Z').toISOString();
    this.config.audience.tags = this.tags
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    this.config.audience.contactIds = this.selectedIds
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    return true;
  }
  protected save(review = false) {
    if (!this.validate()) return;
    if (!this.prepare() || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.api
      .save(this.root, this.config, this.targetBusiness, this.editId, this.revision)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: (r) => {
          this.editId = r.data._id;
          this.revision = r.data.revision;
          this.editing.set(false);
          this.success.set('Draft saved.');
          this.load();
          if (review) {
            this.detailLoading.set(true);
            queueMicrotask(() =>
              this.requestAction(
                r.data,
                new Date(r.data.startDate) > new Date() ? 'schedule' : 'activate',
              ),
            );
          }
        },
        error: (e) => this.error.set(apiErrorMessage(e)),
      });
  }
  protected requestAction(c: Campaign, action: string) {
    this.error.set('');
    if (action === 'duplicate') {
      this.duplicate(c);
      return;
    }
    this.confirmation = false;
    this.pendingAction.set(null);
    this.detailLoading.set(true);
    if (['activate', 'schedule', 'resume'].includes(action)) {
      this.busy.set(true);
      this.api
        .detail(this.root, c._id)
        .pipe(
          takeUntilDestroyed(this.destroy),
          finalize(() => {
            this.busy.set(false);
            this.detailLoading.set(false);
          }),
        )
        .subscribe({
          next: (r) => {
            this.detail.set(r.data);
            this.confirmation = false;
            this.pendingAction.set({
              campaign: r.data.campaign,
              action,
              count: r.data.estimatedRecipients,
            });
          },
          error: (e) => this.error.set(apiErrorMessage(e)),
        });
    } else {
      this.detailLoading.set(false);
      this.confirmation = false;
      this.pendingAction.set({ campaign: c, action });
    }
  }
  protected executeAction() {
    const p = this.pendingAction();
    if (!p || !this.confirmation || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.api
      .action(this.root, p.campaign, p.action, p.count)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: () => {
          this.pendingAction.set(null);
          this.detail.set(null);
          this.success.set('Campaign updated.');
          this.load(this.page);
        },
        error: (e) => {
          this.error.set(apiErrorMessage(e));
        },
      });
  }
  protected saveTemplate() {
    if (this.busy() || !this.validate() || !this.prepare()) return;
    this.busy.set(true);
    this.api
      .saveTemplate(this.root, this.config)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: () => {
          this.success.set('Global template saved.');
          this.loadTemplates();
        },
        error: (e) => this.error.set(apiErrorMessage(e)),
      });
  }
  protected assign(t: GlobalTemplate) {
    const ids = this.assignmentIds
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (!ids.length) {
      this.error.set('Enter target business IDs.');
      return;
    }
    this.busy.set(true);
    this.api
      .assign(this.root, t._id, ids)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: () => {
          this.success.set('Platform drafts assigned. Review each before activation.');
          this.load();
        },
        error: (e) => this.error.set(apiErrorMessage(e)),
      });
  }
  protected async assignAll(t: GlobalTemplate) {
    this.busy.set(true);
    this.error.set('');
    try {
      let cursor: string | undefined;
      do {
        const r = await firstValueFrom(
          this.api.assignAll(this.root, t._id, cursor).pipe(takeUntilDestroyed(this.destroy)),
        );
        cursor = r.nextCursor ?? undefined;
      } while (cursor);
      this.success.set('Template assigned as drafts to all active businesses.');
      this.load();
    } catch (e) {
      this.error.set(apiErrorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
