import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Page, Pagination } from '../../core/feedback/feedback.service';
export const CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'active',
  'paused',
  'completed',
  'cancelled',
] as const;
export const CAMPAIGN_TRIGGERS = [
  'once',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'birthday',
  'anniversary',
  'welcome',
  'inactive',
] as const;
export const CAMPAIGN_AUDIENCES = [
  'all',
  'selected',
  'tags',
  'segment',
  'birthday',
  'inactive',
  'new',
  'loyal',
  'filters',
] as const;
export interface CampaignConfig {
  name: string;
  description: string;
  campaignType: string;
  audience: {
    type: string;
    contactIds: string[];
    tags: string[];
    segment: string;
    loyaltyLevel: string;
    inactiveDays: number;
    newDays: number;
    minInteractions: number;
  };
  startDate: string;
  endDate: string;
  timezone: string;
  trigger: {
    type: string;
    weekdays: number[];
    dayOfMonth: number;
    month: number;
    sendTime: string;
    endTime: string;
    daysBefore: number;
  };
  channels: string[];
  offer: {
    discountType: string;
    discountValue: number;
    currency: string;
    minSpend: number | null;
    maxDiscount: number | null;
    validityDays: number;
    terms: string;
  };
  usageLimit: number;
  perCustomerLimit: number;
  priority: number;
  offerPolicy?: 'exclusive' | 'parallel';
}
export interface Campaign extends CampaignConfig {
  metrics?: { sent: number; redeemed: number; targeted: number; issued?: number };
  _id: string;
  businessId: string;
  ownerType: 'platform' | 'business';
  status: (typeof CAMPAIGN_STATUSES)[number];
  revision: number;
}
export interface CampaignDetail {
  campaign: Campaign;
  estimatedRecipients: number;
  pagination: Pagination;
  metrics: {
    targeted: number;
    sent: number;
    failed: number;
    skipped: number;
    reconciliation: number;
    delivered: number;
    deliveryFailures: number;
    issued: number;
    redeemed: number;
    redemptionRate: number | null;
  };
  executions: { _id: string; at: string; window: string; status: string; targeted: number }[];
  recipients: {
    deliveryEvents?: { type: string; occurredAt: string }[];
    _id: string;
    contactId: string;
    status: string;
    attempts: number;
    error: string | null;
    createdAt: string;
  }[];
}
export interface CampaignTemplate {
  id: string;
  name: string;
  trigger: Partial<CampaignConfig['trigger']>;
  campaignType: string;
  audience?: Partial<CampaignConfig['audience']>;
}
export interface GlobalTemplate {
  _id: string;
  name: string;
  input: CampaignConfig;
}
export function blankCampaign(timezone = 'UTC'): CampaignConfig {
  return {
    name: '',
    description: '',
    campaignType: 'promotion',
    audience: {
      type: 'all',
      contactIds: [],
      tags: [],
      segment: '',
      loyaltyLevel: '',
      inactiveDays: 90,
      newDays: 7,
      minInteractions: 0,
    },
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    timezone,
    trigger: {
      type: 'once',
      weekdays: [],
      dayOfMonth: 1,
      month: 1,
      sendTime: '09:00',
      endTime: '23:59',
      daysBefore: 0,
    },
    channels: ['email'],
    offer: {
      discountType: 'percent',
      discountValue: 20,
      currency: 'USD',
      minSpend: null,
      maxDiscount: null,
      validityDays: 7,
      terms: '',
    },
    usageLimit: 1000,
    perCustomerLimit: 1000,
    priority: 0,
    offerPolicy: 'exclusive',
  };
}
export function configOf(c: CampaignConfig): CampaignConfig {
  return structuredClone({
    name: c.name,
    description: c.description,
    campaignType: c.campaignType,
    audience: c.audience,
    startDate: c.startDate,
    endDate: c.endDate,
    timezone: c.timezone,
    trigger: c.trigger,
    channels: c.channels,
    offer: c.offer,
    usageLimit: c.usageLimit,
    perCustomerLimit: c.perCustomerLimit,
    priority: c.priority,
    offerPolicy: c.offerPolicy ?? 'exclusive',
  });
}
@Injectable({ providedIn: 'root' })
export class CampaignApi {
  private http = inject(HttpClient);
  root(businessId: string | null) {
    return businessId ? `/api/v1/businesses/${businessId}/campaigns` : '/api/v1/admin/campaigns';
  }
  list(root: string, page: number, status: string, businessId = '') {
    return this.http.get<Page<Campaign>>(root, {
      params: {
        page,
        pageSize: 20,
        ...(status ? { status } : {}),
        ...(businessId ? { businessId } : {}),
      },
    });
  }
  templates(root: string) {
    return this.http.get<{ data: CampaignTemplate[]; global: GlobalTemplate[] }>(
      `${root}/templates`,
    );
  }
  detail(root: string, id: string, page = 1) {
    return this.http.get<{ data: CampaignDetail }>(`${root}/${id}`, {
      params: { page, pageSize: 20 },
    });
  }
  save(root: string, input: CampaignConfig, businessId: string, id?: string, revision = 0) {
    return id
      ? this.http.patch<{ data: Campaign }>(`${root}/${id}`, { input, revision })
      : this.http.post<{ data: Campaign }>(root, { input, businessId });
  }
  action(root: string, c: Campaign, action: string, confirmedCount?: number) {
    return this.http.post<{ data: Campaign }>(
      `${root}/${c._id}/${action}`,
      action === 'duplicate'
        ? {}
        : {
            confirm: true,
            revision: c.revision,
            ...(confirmedCount !== undefined ? { confirmedCount } : {}),
          },
    );
  }
  saveTemplate(root: string, input: CampaignConfig) {
    return this.http.post(`${root}/templates`, input);
  }
  assign(root: string, id: string, businessIds: string[]) {
    return this.http.post(`${root}/templates/${id}/assign`, { businessIds });
  }
  assignAll(root: string, id: string, cursor?: string) {
    return this.http.post<{ nextCursor: string | null }>(`${root}/templates/${id}/assign`, {
      all: true,
      ...(cursor ? { cursor } : {}),
    });
  }
}
