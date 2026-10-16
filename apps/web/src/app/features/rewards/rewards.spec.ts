import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CSRF_COOKIE_NAME } from '../../core/auth/auth.service';
import { CustomerReward, StaffReward, discountLabel } from '../../core/rewards/rewards.service';
import { RewardCard } from '../../shared/reward-card';
import { RewardLinkPage } from '../public/reward-link.page';
import { RewardsIssuedPage } from './rewards-issued.page';
import { RewardsOverviewPage } from './rewards-overview.page';
import { RewardsRedeemPage } from './rewards-redeem.page';
import { RewardsRulesPage } from './rewards-rules.page';

const BIZ = (role: 'owner' | 'member' = 'owner') => ({
  id: 'b1',
  name: 'Joes',
  role,
  slug: 'joes',
  category: 'Cafe',
  timezone: 'UTC',
  googleReviewUrl: null,
  onboarding: {},
});
const DISCOUNT = {
  type: 'percent',
  value: 15,
  currency: 'USD',
  minSpend: null,
  maxDiscount: null,
} as const;
const card = (over: Partial<CustomerReward> = {}): CustomerReward => ({
  token: 't.1',
  status: 'issued',
  code: 'GDV-AAAA-BBBB',
  discount: DISCOUNT,
  issuedAt: null,
  expiresAt: '2026-12-01T00:00:00Z',
  redeemedAt: null,
  terms: 'One per table.',
  ...over,
});
const staff = (over: Partial<StaffReward> = {}): StaffReward => ({
  id: 'r1',
  code: 'GDV-AAAA-BBBB',
  status: 'issued',
  ruleName: 'Apology',
  ruleId: 'rule1',
  incidentId: null,
  responseId: 'resp1',
  contact: { id: 'c1', fullName: 'Ana Lee', email: 'a@b.co', phone: '+14155550123' },
  discount: DISCOUNT,
  terms: '',
  createdAt: '2026-10-01T10:00:00Z',
  issuedAt: '2026-10-01T10:00:00Z',
  expiresAt: '2026-12-01T00:00:00Z',
  decisionNote: null,
  deliveries: [],
  redemption: null,
  shareUrl: 'http://localhost/reward/t.1',
  ...over,
});

describe('Rewards UI', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    document.cookie = `${CSRF_COOKIE_NAME}=tok; path=/`;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    document.cookie = `${CSRF_COOKIE_NAME}=; path=/; max-age=0`;
    http.verify();
  });
  const business = (role: 'owner' | 'member' = 'owner') =>
    http.expectOne('/api/v1/businesses').flush({ data: { businesses: [BIZ(role)] } });
  const settle = async (f: { detectChanges: () => void; whenStable: () => Promise<unknown> }) => {
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
  };
  const type = (el: HTMLElement, sel: string, v: string) => {
    const i = el.querySelector<HTMLInputElement>(sel)!;
    i.value = v;
    i.dispatchEvent(new Event('input'));
  };

  it('labels discounts', () => {
    expect(discountLabel(DISCOUNT)).toBe('15% off');
    expect(discountLabel({ ...DISCOUNT, type: 'fixed', value: 5 })).toContain('5');
  });

  describe('RewardCard', () => {
    it('shows code, discount, expiry and terms, and says no review is needed', () => {
      const f = TestBed.createComponent(RewardCard);
      f.componentRef.setInput('reward', card());
      f.componentRef.setInput('businessName', 'Joes');
      f.detectChanges();
      const t = (f.nativeElement as HTMLElement).textContent!;
      for (const s of [
        'GDV-AAAA-BBBB',
        '15% off',
        'Active',
        'One per table.',
        'No review is required',
        'Joes',
      ]) {
        expect(t).toContain(s);
      }
    });

    it('hides the code until a pending reward is approved', () => {
      const f = TestBed.createComponent(RewardCard);
      f.componentRef.setInput(
        'reward',
        card({ status: 'pending_approval', code: null, expiresAt: null }),
      );
      f.detectChanges();
      const t = (f.nativeElement as HTMLElement).textContent!;
      expect(t).not.toContain('GDV-');
      expect(t).toContain('Awaiting approval');
    });

    it('copies the code and falls back with a message when the browser blocks it', async () => {
      const f = TestBed.createComponent(RewardCard);
      f.componentRef.setInput('reward', card());
      f.detectChanges();
      const el = f.nativeElement as HTMLElement;
      const spy = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      const flush = async () => {
        await Promise.resolve();
        await Promise.resolve();
        f.detectChanges();
      };
      el.querySelector<HTMLButtonElement>('button')!.click();
      await flush();
      expect(spy).toHaveBeenCalledWith('GDV-AAAA-BBBB');
      expect(el.textContent).toContain('Copied');
      spy.and.rejectWith(new Error('denied'));
      el.querySelector<HTMLButtonElement>('button')!.click();
      await flush();
      expect(el.textContent).toContain('Copy was blocked');
    });
  });

  describe('RewardLinkPage', () => {
    it('loads the card from the signed link anonymously', async () => {
      const f = TestBed.createComponent(RewardLinkPage);
      f.componentRef.setInput('token', 't.1');
      await settle(f);
      http
        .expectOne('/api/v1/public/rewards/t.1')
        .flush({ data: { business: { name: 'Joes' }, reward: card() } });
      await settle(f);
      expect((f.nativeElement as HTMLElement).textContent).toContain('GDV-AAAA-BBBB');
    });

    it('shows a friendly page for invalid links', async () => {
      const f = TestBed.createComponent(RewardLinkPage);
      f.componentRef.setInput('token', 'bad');
      await settle(f);
      http
        .expectOne('/api/v1/public/rewards/bad')
        .flush(
          { error: { code: 'REWARD_NOT_FOUND', message: 'x' } },
          { status: 404, statusText: 'NF' },
        );
      await settle(f);
      expect((f.nativeElement as HTMLElement).textContent).toContain('isn’t valid');
    });
  });

  describe('RewardsRedeemPage', () => {
    const verified = (over: Partial<StaffReward> = {}, redeemable = true) => ({
      data: { redeemable, reason: redeemable ? null : 'Expired', reward: staff(over) },
    });

    it('verifies then redeems with the order total and one request id', async () => {
      const f = TestBed.createComponent(RewardsRedeemPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      business();
      type(el, '#code', 'gdv-aaaa-bbbb');
      el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      const v = http.expectOne('/api/v1/businesses/b1/rewards/verify');
      expect(v.request.body).toEqual({ code: 'gdv-aaaa-bbbb' });
      v.flush(verified());
      await settle(f);
      expect(el.textContent).toContain('Valid');
      type(el, '#total', '40');
      el.querySelectorAll<HTMLFormElement>('form')[1]!.dispatchEvent(new Event('submit'));
      const r = http.expectOne('/api/v1/businesses/b1/rewards/redeem');
      expect(r.request.body.orderTotal).toBe(40);
      expect(r.request.body.requestId.length).toBeGreaterThanOrEqual(8);
      r.flush({
        data: {
          duplicate: false,
          reward: staff({
            status: 'redeemed',
            redemption: { at: '2026-10-02T10:00:00Z', orderTotal: 40, discountApplied: 6 },
          }),
        },
      });
      await settle(f);
      expect(el.textContent).toContain('Redeemed');
      expect(el.textContent).toContain('USD 6');
    });

    it('blocks redemption below the minimum spend before calling the server', async () => {
      const f = TestBed.createComponent(RewardsRedeemPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      business();
      type(el, '#code', 'GDV-AAAA-BBBB');
      el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      http
        .expectOne('/api/v1/businesses/b1/rewards/verify')
        .flush(verified({ discount: { ...DISCOUNT, minSpend: 20 } }));
      await settle(f);
      type(el, '#total', '10');
      el.querySelectorAll<HTMLFormElement>('form')[1]!.dispatchEvent(new Event('submit'));
      await settle(f);
      expect(el.textContent).toContain('at least USD 20');
      http.expectNone('/api/v1/businesses/b1/rewards/redeem');
    });

    it('shows why an expired code cannot be redeemed and offers no redeem form', async () => {
      const f = TestBed.createComponent(RewardsRedeemPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      business();
      type(el, '#code', 'GDV-AAAA-BBBB');
      el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      http
        .expectOne('/api/v1/businesses/b1/rewards/verify')
        .flush(verified({ status: 'expired' }, false));
      await settle(f);
      expect(el.textContent).toContain('Expired');
      expect(el.querySelectorAll('form').length).toBe(1);
    });

    it('shows the server message for an unknown code', async () => {
      const f = TestBed.createComponent(RewardsRedeemPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      business();
      type(el, '#code', 'nope');
      el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      http
        .expectOne('/api/v1/businesses/b1/rewards/verify')
        .flush(
          { error: { code: 'REWARD_NOT_FOUND', message: 'No reward found for that code' } },
          { status: 404, statusText: 'NF' },
        );
      await settle(f);
      expect(el.querySelector('.alert')!.textContent).toContain('No reward found');
    });
  });

  describe('RewardsRulesPage', () => {
    const flushRules = () => {
      http.expectOne('/api/v1/businesses/b1/reward-rules').flush({ data: [] });
      http.expectOne('/api/v1/businesses/b1/rewards/templates').flush({
        data: [
          {
            id: 't',
            name: 'Apology 15%',
            description: 'desc',
            rule: {
              name: 'Apology: 15% off',
              discountType: 'percent',
              discountValue: 15,
              mode: 'approval',
              maxRating: 2,
            },
          },
        ],
      });
    };

    it('creates a rule from a template with validated, typed values', async () => {
      const f = TestBed.createComponent(RewardsRulesPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      business();
      flushRules();
      await settle(f);
      el.querySelector<HTMLButtonElement>('button.row')!.click();
      await settle(f);
      expect(el.querySelector<HTMLInputElement>('#r-name')!.value).toBe('Apology: 15% off');
      type(el, '#r-min', '25');
      type(el, '#r-tot', '100');
      el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      const req = http.expectOne('/api/v1/businesses/b1/reward-rules');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(
        jasmine.objectContaining({
          name: 'Apology: 15% off',
          discountType: 'percent',
          discountValue: 15,
          minSpend: 25,
          maxIssuancesTotal: 100,
          maxDiscount: null,
          currency: 'USD',
          maxRating: 2,
        }),
      );
      req.flush({ data: { id: 'x' } });
      http.expectOne('/api/v1/businesses/b1/reward-rules').flush({ data: [] });
    });

    it('rejects an invalid percentage on the client', async () => {
      const f = TestBed.createComponent(RewardsRulesPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      business();
      flushRules();
      await settle(f);
      el.querySelector<HTMLButtonElement>('button.row')!.click();
      await settle(f);
      type(el, '#r-value', '150');
      el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle(f);
      http.expectNone('/api/v1/businesses/b1/reward-rules');
      expect(el.textContent).toContain('Enter 1 to 100');
    });

    it('is read-only for staff', async () => {
      const f = TestBed.createComponent(RewardsRulesPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      business('member');
      http.expectOne('/api/v1/businesses/b1/reward-rules').flush({ data: [] });
      http.expectOne('/api/v1/businesses/b1/rewards/templates').flush({ data: [] });
      await settle(f);
      expect(el.textContent).toContain('Only the business owner');
      expect(el.querySelector('button.row')).toBeNull();
    });
  });

  describe('RewardsIssuedPage', () => {
    const list = (data: StaffReward[]) => ({
      data,
      pagination: { page: 1, pageSize: 15, total: data.length, totalPages: 1 },
    });

    it('filters by status and lets the owner approve a pending reward', async () => {
      const f = TestBed.createComponent(RewardsIssuedPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      business();
      http
        .expectOne((r) => r.url.endsWith('/rewards'))
        .flush(list([staff({ status: 'pending_approval' })]));
      await settle(f);
      expect(el.textContent).toContain('Awaiting approval');
      el.querySelectorAll<HTMLButtonElement>('[role=tab]')[2]!.click(); // Active
      const filtered = http.expectOne((r) => r.url.endsWith('/rewards'));
      expect(filtered.request.params.get('status')).toBe('issued');
      filtered.flush(list([staff({ status: 'pending_approval' })]));
      await settle(f);
      el.querySelector<HTMLButtonElement>('.row')!.click();
      http
        .expectOne('/api/v1/businesses/b1/rewards/r1')
        .flush({ data: { reward: staff({ status: 'pending_approval' }), history: [] } });
      await settle(f);
      el.querySelector<HTMLButtonElement>('.drawer .btn')!.click();
      const approve = http.expectOne('/api/v1/businesses/b1/rewards/r1/approve');
      expect(approve.request.method).toBe('POST');
      approve.flush({ data: staff() });
      http
        .expectOne('/api/v1/businesses/b1/rewards/r1')
        .flush({ data: { reward: staff(), history: [] } });
      http.expectOne((r) => r.url.endsWith('/rewards')).flush(list([staff()]));
    });

    it('does not offer approve/cancel to staff, and records a manual share', async () => {
      const f = TestBed.createComponent(RewardsIssuedPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      business('member');
      http.expectOne((r) => r.url.endsWith('/rewards')).flush(list([staff()]));
      await settle(f);
      el.querySelector<HTMLButtonElement>('.row')!.click();
      http
        .expectOne('/api/v1/businesses/b1/rewards/r1')
        .flush({ data: { reward: staff(), history: [] } });
      await settle(f);
      expect(el.textContent).not.toContain('Cancel reward');
      const spy = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      const copy = [...el.querySelectorAll<HTMLButtonElement>('.drawer button')].find((b) =>
        b.textContent!.includes('Copy link'),
      )!;
      copy.click();
      await settle(f);
      expect(spy).toHaveBeenCalledWith('http://localhost/reward/t.1');
      const share = http.expectOne('/api/v1/businesses/b1/rewards/r1/shared');
      expect(share.request.body).toEqual({ method: 'copy' });
      share.flush({
        data: staff({ deliveries: [{ method: 'copy', at: '2026-10-02T10:00:00Z' }] }),
      });
      http
        .expectOne('/api/v1/businesses/b1/rewards/r1')
        .flush({ data: { reward: staff(), history: [] } });
    });
  });

  describe('RewardsOverviewPage', () => {
    it('renders real counts, cost by currency and the no-revenue note', async () => {
      const f = TestBed.createComponent(RewardsOverviewPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      business();
      http
        .expectOne((r) => r.url.endsWith('/rewards/summary'))
        .flush({
          data: {
            days: 2,
            timezone: 'UTC',
            totals: {
              incidents: 5,
              issued: 4,
              active: 1,
              redeemed: 3,
              expired: 1,
              pendingApproval: 2,
              rejected: 1,
              cancelled: 0,
              redemptionRate: 75,
            },
            cost: {
              byCurrency: [{ currency: 'USD', amount: 8, redemptions: 2 }],
              redemptionsWithoutTotal: 1,
            },
            trend: [
              { date: '2026-10-01', incidents: 1, issued: 1, redeemed: 0 },
              { date: '2026-10-02', incidents: 4, issued: 3, redeemed: 3 },
            ],
          },
        });
      await settle(f);
      const t = el.textContent!;
      for (const s of [
        '75% of issued',
        'USD 8',
        '1 redeemed without an order total',
        'do not estimate or claim recovered revenue',
      ]) {
        expect(t).toContain(s);
      }
      expect(el.querySelector('.stats')!.textContent).toContain('5');
    });

    it('shows an empty state with a call to action when nothing exists', async () => {
      const f = TestBed.createComponent(RewardsOverviewPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      business();
      http
        .expectOne((r) => r.url.endsWith('/rewards/summary'))
        .flush({
          data: {
            days: 1,
            timezone: 'UTC',
            totals: {
              incidents: 0,
              issued: 0,
              active: 0,
              redeemed: 0,
              expired: 0,
              pendingApproval: 0,
              rejected: 0,
              cancelled: 0,
              redemptionRate: null,
            },
            cost: { byCurrency: [], redemptionsWithoutTotal: 0 },
            trend: [{ date: '2026-10-01', incidents: 0, issued: 0, redeemed: 0 }],
          },
        });
      await settle(f);
      expect(el.textContent).toContain('No rewards yet');
      expect(el.textContent).toContain('Create a reward rule');
    });
  });
});
