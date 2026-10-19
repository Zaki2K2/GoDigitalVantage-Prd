import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
export interface InstantReward {
  id: string;
  title: string;
  description: string | null;
  rewardType: string;
  rewardValue: number | null;
  currency: string | null;
  promoCode: string | null;
  status: string;
  enabled: boolean;
  verificationRequired: boolean;
  recipientEmail?: string;
  recipientUserId?: string | null;
  businessId?: string | null;
  metadata?: Record<string, unknown>;
  revision?: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  verifiedAt: string | null;
  claimedAt: string | null;
  disabledAt: string | null;
  revokedAt: string | null;
  revokeReason?: string | null;
  claimReceiptId: string | null;
  delivery: {
    state: string;
    errorCode: string | null;
    requestId?: string;
    startedAt?: string;
  } | null;
  verificationDelivery: { state: string; errorCode: string | null } | null;
  allowedActions: string[];
}
export interface RewardPage {
  data: InstantReward[];
  pagination: { page: number; total: number; totalPages: number };
}
export interface RewardHistory {
  data: {
    id: string;
    action: string;
    actorId: string | null;
    actorType: string;
    timestamp: string;
    metadata: Record<string, unknown>;
  }[];
  pagination: { page: number; total: number; totalPages: number };
}
@Injectable({ providedIn: 'root' })
export class InstantRewardsApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly base = '/api/v1/instant-rewards';
  list(query: Record<string, string>, admin = false) {
    return this.http.get<RewardPage>(`${this.base}/${admin ? 'admin' : 'mine'}`, {
      params: new HttpParams({
        fromObject: Object.fromEntries(Object.entries(query).filter(([, v]) => v !== '')),
      }),
    });
  }
  get(id: string) {
    return this.http.get<{ data: InstantReward }>(`${this.base}/admin/${id}`);
  }
  summary() {
    return this.http.get<{ data: Record<string, number> }>(`${this.base}/admin/summary`);
  }
  users(search: string) {
    return this.http.get<{ data: { id: string; name: string; email: string }[] }>(
      `${this.base}/admin/users`,
      { params: { search } },
    );
  }
  history(id: string, page = 1) {
    return this.http.get<RewardHistory>(`${this.base}/admin/${id}/audit`, { params: { page } });
  }
  write(path: string, body: object, method: 'post' | 'patch' = 'post') {
    return this.auth.withCsrf(() =>
      this.http.request<{ data: InstantReward; sendError?: string | null; replayed?: boolean }>(
        method,
        `${this.base}/${path}`,
        { body },
      ),
    );
  }
}
