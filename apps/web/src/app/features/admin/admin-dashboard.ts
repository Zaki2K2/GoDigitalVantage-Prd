import { DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon, IconName } from '../../shared/icon';

export interface PlatformMetric {
  label: string;
  value: number;
}
interface MetricLink {
  metric: string;
  label: string;
  route: string;
  query?: Record<string, string>;
}
@Component({
  selector: 'app-admin-dashboard',
  imports: [DecimalPipe, RouterLink, Icon],
  templateUrl: './admin-dashboard.html',
})
export class AdminDashboard {
  readonly metrics = input.required<PlatformMetric[]>();
  readonly averageRating = input<number | null>(null);
  private readonly values = computed(
    () => new Map(this.metrics().map((item) => [item.label, item.value])),
  );
  protected readonly primary: (MetricLink & { icon: IconName; description: string })[] = [
    {
      metric: 'Businesses',
      label: 'Total businesses',
      route: '/admin/businesses',
      icon: 'business',
      description: 'Registered workspaces',
    },
    {
      metric: 'Users',
      label: 'Platform users',
      route: '/admin/users',
      icon: 'user',
      description: 'Accounts across the platform',
    },
    {
      metric: 'Responses',
      label: 'Feedback responses',
      route: '/admin/responses',
      icon: 'responses',
      description: 'Customer submissions',
    },
    {
      metric: 'Promotions',
      label: 'Total promotions',
      route: '/admin/promotions',
      icon: 'gift',
      description: 'Rewards created by businesses',
    },
  ];
  protected readonly businessMetrics: MetricLink[] = [
    { metric: 'New businesses this month', label: 'New this month', route: '/admin/businesses' },
    {
      metric: 'Onboarding complete',
      label: 'Onboarding complete',
      route: '/admin/businesses',
      query: { onboarding: 'complete' },
    },
    {
      metric: 'Owner memberships',
      label: 'Owner memberships',
      route: '/admin/users',
      query: { role: 'owner' },
    },
  ];
  protected readonly groups: {
    title: string;
    icon: IconName;
    route: string;
    items: MetricLink[];
  }[] = [
    {
      title: 'Forms & publishing',
      icon: 'form',
      route: '/admin/forms',
      items: [
        { metric: 'Forms', label: 'Total forms', route: '/admin/forms' },
        {
          metric: 'Published forms',
          label: 'Published forms',
          route: '/admin/forms',
          query: { status: 'published' },
        },
        {
          metric: 'Draft forms',
          label: 'Unpublished forms',
          route: '/admin/forms',
          query: { status: 'draft' },
        },
      ],
    },
    {
      title: 'Customer activity',
      icon: 'contacts',
      route: '/admin/responses',
      items: [
        {
          metric: 'Responses today (UTC)',
          label: 'Responses today (UTC)',
          route: '/admin/responses',
        },
        {
          metric: 'Responses this month (UTC)',
          label: 'Responses this month (UTC)',
          route: '/admin/responses',
        },
        { metric: 'Contacts', label: 'Contacts collected', route: '/admin/contacts' },
        { metric: 'QR scans', label: 'QR scans recorded', route: '/admin/businesses' },
      ],
    },
    {
      title: 'Promotions',
      icon: 'gift',
      route: '/admin/promotions',
      items: [
        {
          metric: 'Redeemed promotions',
          label: 'Redeemed promotions',
          route: '/admin/promotions',
          query: { status: 'redeemed' },
        },
        {
          metric: 'Expired promotions',
          label: 'Expired promotions',
          route: '/admin/promotions',
          query: { status: 'expired' },
        },
      ],
    },
  ];
  protected value(label: string): number | null {
    return this.values().get(label) ?? null;
  }
  protected readonly activeShare = computed(() => {
    const total = this.value('Businesses');
    const active = this.value('Active businesses');
    return total !== null && active !== null && total > 0
      ? Math.min(100, Math.max(0, (active / total) * 100))
      : 0;
  });
  protected readonly ratingShare = computed(() =>
    Math.min(100, Math.max(0, ((this.averageRating() ?? 0) / 5) * 100)),
  );
}
