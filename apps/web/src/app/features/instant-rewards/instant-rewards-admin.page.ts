import { AppSelect } from '../../shared/app-select';
import { Component, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, catchError } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { apiErrorMessage } from '../../core/auth/auth.service';
import { DialogFocus } from '../../shared/dialog-focus';
import { Icon } from '../../shared/icon';
import { InstantRewardsApi, InstantReward, RewardHistory } from './instant-rewards.api';
import { InstantRewardDetails } from './instant-reward-details';
interface RewardForm {
  recipientEmail: string;
  recipientUserId: string;
  businessId: string;
  title: string;
  description: string;
  rewardType: string;
  rewardValue: number | null;
  currency: string;
  promoCode: string;
  expiresAt: string;
  verificationRequired: boolean;
  sendImmediately: boolean;
}
const emptyForm = (): RewardForm => ({
  recipientEmail: '',
  recipientUserId: '',
  businessId: '',
  title: '',
  description: '',
  rewardType: 'PERCENT_DISCOUNT',
  rewardValue: null,
  currency: '',
  promoCode: '',
  expiresAt: '',
  verificationRequired: true,
  sendImmediately: true,
});
@Component({
  selector: 'app-instant-rewards-admin',
  imports: [AppSelect, DatePipe, FormsModule, DialogFocus, Icon, InstantRewardDetails],
  templateUrl: './instant-rewards-admin.page.html',
})
export class InstantRewardsAdminPage implements OnInit {
  private readonly api = inject(InstantRewardsApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly userSearch = new Subject<string>();
  protected readonly rewards = signal<InstantReward[]>([]);
  protected readonly selected = signal<InstantReward | null>(null);
  protected readonly summary = signal<Record<string, number>>({});
  protected readonly history = signal<RewardHistory | null>(null);
  protected readonly users = signal<{ id: string; name: string; email: string }[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly page = signal(1);
  protected readonly pages = signal(1);
  protected readonly total = signal(0);
  protected readonly formOpen = signal(false);
  protected readonly editing = signal(false);
  protected readonly pending = signal<{ action: string; reward: InstantReward } | null>(null);
  protected readonly statuses = [
    'DRAFT',
    'SENT',
    'DELIVERED',
    'VERIFIED',
    'CLAIMED',
    'EXPIRED',
    'DISABLED',
    'REVOKED',
    'FAILED',
  ];
  protected readonly types = ['PERCENT_DISCOUNT', 'FIXED_DISCOUNT', 'GIFT', 'CUSTOM'];
  protected filters = {
    search: '',
    status: '',
    rewardType: '',
    enabled: '',
    from: '',
    to: '',
    recipientUserId: '',
  };
  protected form = emptyForm();
  protected lookup = '';
  protected revokeReason = '';
  private createId = crypto.randomUUID();
  private readonly operationIds = new Map<string, string>();
  constructor() {
    this.userSearch
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((search) =>
          search.length >= 2
            ? this.api.users(search).pipe(catchError(() => of({ data: [] })))
            : of({ data: [] }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => this.users.set(r.data));
  }
  ngOnInit() {
    this.load();
  }
  protected searchUsers(value: string) {
    this.lookup = value;
    this.userSearch.next(value);
  }
  protected chooseUser(user: { id: string; email: string }) {
    this.form.recipientUserId = user.id;
    this.form.recipientEmail = user.email;
    this.lookup = user.email;
    this.users.set([]);
  }
  protected recipientChanged() {
    this.form.recipientUserId = '';
  }
  protected load(reset = false) {
    if (reset) this.page.set(1);
    this.loading.set(true);
    this.error.set('');
    const q = {
      ...this.filters,
      page: String(this.page()),
      from: this.filters.from ? new Date(this.filters.from).toISOString() : '',
      to: this.filters.to ? new Date(this.filters.to).toISOString() : '',
    };
    this.api.list(q, true).subscribe({
      next: (r) => {
        this.rewards.set(r.data);
        this.pages.set(r.pagination.totalPages);
        this.total.set(r.pagination.total);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiErrorMessage(e));
        this.loading.set(false);
      },
    });
    this.api.summary().subscribe({
      next: (r) => this.summary.set(r.data),
      error: (e) => this.error.set(apiErrorMessage(e)),
    });
  }
  protected view(reward: InstantReward) {
    this.error.set('');
    this.api.get(reward.id).subscribe({
      next: (r) => {
        this.selected.set(r.data);
        this.loadHistory();
      },
      error: (e) => this.error.set(apiErrorMessage(e)),
    });
  }
  protected loadHistory(page = 1) {
    const r = this.selected();
    if (r)
      this.api.history(r.id, page).subscribe({
        next: (h) => this.history.set(h),
        error: (e) => this.error.set(apiErrorMessage(e)),
      });
  }
  protected newReward() {
    this.form = emptyForm();
    this.lookup = '';
    this.users.set([]);
    this.createId = crypto.randomUUID();
    this.editing.set(false);
    this.formOpen.set(true);
    this.error.set('');
  }
  protected editReward() {
    const r = this.selected();
    if (!r) return;
    const d = new Date(r.expiresAt);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    this.form = {
      recipientEmail: r.recipientEmail ?? '',
      recipientUserId: r.recipientUserId ?? '',
      businessId: r.businessId ?? '',
      title: r.title,
      description: r.description ?? '',
      rewardType: r.rewardType,
      rewardValue: r.rewardValue,
      currency: r.currency ?? '',
      promoCode: r.promoCode ?? '',
      expiresAt: local,
      verificationRequired: r.verificationRequired,
      sendImmediately: false,
    };
    this.editing.set(true);
    this.formOpen.set(true);
  }
  protected save() {
    if (this.busy()) return;
    if (
      !this.form.title.trim() ||
      !this.form.recipientEmail ||
      !this.form.expiresAt ||
      !Number.isFinite(new Date(this.form.expiresAt).getTime())
    ) {
      this.error.set('Enter a recipient email, title and expiration.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const f = this.form;
    const body = {
      recipientEmail: f.recipientEmail,
      recipientUserId: f.recipientUserId || null,
      businessId: f.businessId || null,
      title: f.title,
      description: f.description || null,
      rewardType: f.rewardType,
      rewardValue: f.rewardValue,
      currency: f.currency || null,
      promoCode: f.promoCode || null,
      expiresAt: new Date(f.expiresAt).toISOString(),
      verificationRequired: f.verificationRequired,
      ...(this.editing()
        ? { metadata: this.selected()!.metadata ?? {}, expectedRevision: this.selected()!.revision }
        : { createRequestId: this.createId, sendImmediately: f.sendImmediately }),
    };
    this.api
      .write(
        this.editing() ? `admin/${this.selected()!.id}` : 'admin',
        body,
        this.editing() ? 'patch' : 'post',
      )
      .subscribe({
        next: (r) => {
          this.busy.set(false);
          this.formOpen.set(false);
          this.selected.set(r.data);
          this.notice.set(
            r.sendError
              ? `Reward saved. Email not confirmed: ${r.sendError}. Retry the delivery from reward details.`
              : 'Reward saved.',
          );
          this.load();
          this.loadHistory();
        },
        error: (e) => {
          this.error.set(apiErrorMessage(e));
          this.busy.set(false);
        },
      });
  }
  protected ask(action: string, reward: InstantReward) {
    if (action === 'edit') {
      this.editReward();
      return;
    }
    this.revokeReason = '';
    this.pending.set({ action, reward });
  }
  protected confirm() {
    const p = this.pending();
    if (!p || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const key = `${p.reward.id}/${p.action}`;
    if (!this.operationIds.has(key)) this.operationIds.set(key, crypto.randomUUID());
    const requestId =
      p.reward.delivery?.state === 'PENDING' && p.action === 'send'
        ? p.reward.delivery.requestId
        : this.operationIds.get(key);
    this.api
      .write(`admin/${p.reward.id}/${p.action}`, {
        confirm: true,
        ...(['send', 'resend'].includes(p.action)
          ? { requestId }
          : {
              ...(p.action === 'revoke' && this.revokeReason ? { reason: this.revokeReason } : {}),
            }),
      })
      .subscribe({
        next: (r) => {
          this.busy.set(false);
          this.pending.set(null);
          this.operationIds.delete(key);
          this.selected.set(r.data);
          this.notice.set(`Reward ${p.action} completed.`);
          this.load();
          this.loadHistory();
        },
        error: (e) => {
          this.error.set(apiErrorMessage(e));
          this.busy.set(false);
          this.pending.set(null);
          this.api.get(p.reward.id).subscribe({
            next: (r) => {
              this.selected.set(r.data);
              this.loadHistory();
            },
            error: () => undefined,
          });
        },
      });
  }
  protected retryPending(reward: InstantReward) {
    this.ask('send', reward);
  }
  protected close() {
    if (!this.busy()) {
      this.formOpen.set(false);
      this.pending.set(null);
    }
  }
}
