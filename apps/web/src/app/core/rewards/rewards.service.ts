import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { Business, BusinessApi } from '../business/business.service';
import { Page } from '../feedback/feedback.service';

export type DiscountType = 'percent' | 'fixed';
export type RewardStatus =
  'pending_approval' | 'issued' | 'redeemed' | 'expired' | 'cancelled' | 'rejected';

export interface Discount {
  type: DiscountType;
  value: number;
  currency: string;
  minSpend: number | null;
  maxDiscount: number | null;
}

/** What the customer sees: the code is null until the business has approved the reward. */
export interface CustomerReward {
  token: string;
  status: RewardStatus;
  code: string | null;
  discount: Discount;
  issuedAt: string | null;
  expiresAt: string | null;
  redeemedAt: string | null;
  terms: string;
}

export interface ContactBrief {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
}

export interface StaffReward {
  campaignId?: string | null;
  id: string;
  code: string;
  status: RewardStatus;
  ruleName: string;
  ruleId: string | null;
  incidentId: string | null;
  responseId: string | null;
  contact: ContactBrief | null;
  discount: Discount;
  terms: string;
  createdAt: string;
  issuedAt: string | null;
  expiresAt: string | null;
  decisionNote: string | null;
  deliveries: { method: string; at: string }[];
  redemption: { at: string; orderTotal: number | null; discountApplied: number | null } | null;
  shareUrl: string;
}

export interface RewardRule {
  id: string;
  name: string;
  enabled: boolean;
  maxRating: number;
  mode: 'auto' | 'approval';
  discountType: DiscountType;
  discountValue: number;
  currency: string;
  minSpend: number | null;
  maxDiscount: number | null;
  validityDays: number;
  cooldownDays: number;
  maxIssuancesTotal: number | null;
  maxIssuancesPerDay: number | null;
  terms: string;
}
export type RuleInput = Omit<RewardRule, 'id'>;

export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  rule: Partial<RuleInput>;
}

export type IncidentStatus = 'open' | 'reward_pending' | 'reward_issued' | 'no_reward' | 'resolved';
export interface Incident {
  id: string;
  responseId: string;
  rating: number;
  status: IncidentStatus;
  reason: string | null;
  note: string | null;
  ruleId: string | null;
  contact: ContactBrief | null;
  rewardId: string | null;
  createdAt: string;
}

export interface RewardSummary {
  days: number;
  timezone: string;
  totals: {
    incidents: number;
    issued: number;
    active: number;
    redeemed: number;
    expired: number;
    pendingApproval: number;
    rejected: number;
    cancelled: number;
    redemptionRate: number | null;
  };
  cost: {
    byCurrency: { currency: string; amount: number; redemptions: number }[];
    redemptionsWithoutTotal: number;
  };
  trend: { date: string; incidents: number; issued: number; redeemed: number }[];
}

export interface RewardDetail {
  reward: StaffReward;
  history: { action: string; at: string; details: Record<string, unknown>; byUser: boolean }[];
}

export interface VerifyResult {
  redeemable: boolean;
  reason: string | null;
  reward: StaffReward;
}

/** "15% off" / "USD 5.00 off" */
export function discountLabel(d: Discount): string {
  if (d.type === 'percent') return `${d.value}% off`;
  try {
    return `${new Intl.NumberFormat(undefined, { style: 'currency', currency: d.currency }).format(d.value)} off`;
  } catch {
    return `${d.currency} ${d.value} off`;
  }
}

const B = '/api/v1/businesses';

@Injectable({ providedIn: 'root' })
export class RewardsApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly businesses = inject(BusinessApi);
  private current$: Observable<Business | null> | null = null;

  /** The signed-in user's business (first membership), fetched once. */
  business(): Observable<Business | null> {
    this.current$ ??= this.businesses.list().pipe(
      map((l) => l[0] ?? null),
      shareReplay(1),
    );
    return this.current$;
  }

  summary(id: string, days: number): Observable<RewardSummary> {
    return this.http
      .get<{ data: RewardSummary }>(`${B}/${id}/rewards/summary`, {
        params: new HttpParams().set('days', days),
      })
      .pipe(map((r) => r.data));
  }

  templates(id: string): Observable<RuleTemplate[]> {
    return this.http
      .get<{ data: RuleTemplate[] }>(`${B}/${id}/rewards/templates`)
      .pipe(map((r) => r.data));
  }

  rules(id: string): Observable<RewardRule[]> {
    return this.http
      .get<{ data: RewardRule[] }>(`${B}/${id}/reward-rules`)
      .pipe(map((r) => r.data));
  }

  createRule(id: string, body: Partial<RuleInput>): Observable<RewardRule> {
    return this.auth
      .withCsrf(() => this.http.post<{ data: RewardRule }>(`${B}/${id}/reward-rules`, body))
      .pipe(map((r) => r.data));
  }

  updateRule(id: string, ruleId: string, body: Partial<RuleInput>): Observable<RewardRule> {
    return this.auth
      .withCsrf(() =>
        this.http.patch<{ data: RewardRule }>(`${B}/${id}/reward-rules/${ruleId}`, body),
      )
      .pipe(map((r) => r.data));
  }

  rewards(id: string, page: number, status: string, search: string): Observable<Page<StaffReward>> {
    let params = new HttpParams().set('page', page).set('pageSize', 15);
    if (status) params = params.set('status', status);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<Page<StaffReward>>(`${B}/${id}/rewards`, { params });
  }

  reward(id: string, rewardId: string): Observable<RewardDetail> {
    return this.http
      .get<{ data: RewardDetail }>(`${B}/${id}/rewards/${rewardId}`)
      .pipe(map((r) => r.data));
  }

  decide(
    id: string,
    rewardId: string,
    action: 'approve' | 'reject' | 'cancel',
    note?: string,
  ): Observable<StaffReward> {
    return this.auth
      .withCsrf(() =>
        this.http.post<{ data: StaffReward }>(
          `${B}/${id}/rewards/${rewardId}/${action}`,
          note ? { note } : {},
        ),
      )
      .pipe(map((r) => r.data));
  }

  shared(id: string, rewardId: string, method: string): Observable<StaffReward> {
    return this.auth
      .withCsrf(() =>
        this.http.post<{ data: StaffReward }>(`${B}/${id}/rewards/${rewardId}/shared`, { method }),
      )
      .pipe(map((r) => r.data));
  }

  incidents(id: string, page: number, status: string): Observable<Page<Incident>> {
    let params = new HttpParams().set('page', page).set('pageSize', 15);
    if (status) params = params.set('status', status);
    return this.http.get<Page<Incident>>(`${B}/${id}/incidents`, { params });
  }

  issue(id: string, incidentId: string, ruleId?: string): Observable<StaffReward> {
    return this.auth
      .withCsrf(() =>
        this.http.post<{ data: StaffReward }>(
          `${B}/${id}/incidents/${incidentId}/issue`,
          ruleId ? { ruleId } : {},
        ),
      )
      .pipe(map((r) => r.data));
  }

  resolve(id: string, incidentId: string, note?: string): Observable<Incident> {
    return this.auth
      .withCsrf(() =>
        this.http.post<{ data: Incident }>(
          `${B}/${id}/incidents/${incidentId}/resolve`,
          note ? { note } : {},
        ),
      )
      .pipe(map((r) => r.data));
  }

  verify(id: string, code: string): Observable<VerifyResult> {
    return this.auth
      .withCsrf(() => this.http.post<{ data: VerifyResult }>(`${B}/${id}/rewards/verify`, { code }))
      .pipe(map((r) => r.data));
  }

  redeem(
    id: string,
    code: string,
    requestId: string,
    orderTotal?: number,
    orderId?: string,
  ): Observable<{ duplicate: boolean; reward: StaffReward }> {
    return this.auth
      .withCsrf(() =>
        this.http.post<{ data: { duplicate: boolean; reward: StaffReward } }>(
          `${B}/${id}/rewards/redeem`,
          {
            code,
            requestId,
            ...(orderTotal === undefined ? {} : { orderTotal }),
            ...(orderId ? { orderId } : {}),
          },
        ),
      )
      .pipe(map((r) => r.data));
  }

  /** Anonymous: the customer's reward card from the signed link. */
  card(token: string): Observable<{ business: { name: string }; reward: CustomerReward }> {
    return this.http
      .get<{ data: { business: { name: string }; reward: CustomerReward } }>(
        `/api/v1/public/rewards/${encodeURIComponent(token)}`,
      )
      .pipe(map((r) => r.data));
  }
}
