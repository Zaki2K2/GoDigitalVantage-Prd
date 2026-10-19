import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService, CSRF_COOKIE_NAME } from '../../core/auth/auth.service';
import { InstantRewardLandingPage } from './instant-reward-landing.page';
import { InstantRewardsAdminPage } from './instant-rewards-admin.page';
import { MyRewardsPage } from './my-rewards.page';
import { InstantReward } from './instant-rewards.api';
const base = '/api/v1/instant-rewards';
const reward: InstantReward = {
  id: '0123456789abcdef01234567',
  title: 'A special thank you',
  description: 'Your reward',
  rewardType: 'PERCENT_DISCOUNT',
  rewardValue: 20,
  currency: null,
  promoCode: null,
  status: 'SENT',
  enabled: true,
  verificationRequired: false,
  recipientEmail: 'recipient@example.com',
  revision: 1,
  createdAt: '2026-10-19T10:00:00Z',
  updatedAt: '2026-10-19T10:00:00Z',
  expiresAt: '2026-11-19T10:00:00Z',
  sentAt: '2026-10-19T10:00:00Z',
  deliveredAt: null,
  verifiedAt: null,
  claimedAt: null,
  disabledAt: null,
  revokedAt: null,
  claimReceiptId: null,
  delivery: { state: 'ACCEPTED', errorCode: null },
  verificationDelivery: null,
  allowedActions: ['request-link', 'claim'],
};
const list = { data: [reward], pagination: { page: 1, total: 1, totalPages: 1 } };
describe('Instant Rewards screens', () => {
  let http: HttpTestingController;
  const originalUrl = location.pathname + location.search + location.hash;
  beforeEach(() => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf; path=/`;
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    history.replaceState(null, '', originalUrl);
    document.cookie = `${CSRF_COOKIE_NAME}=; path=/; max-age=0`;
  });
  function login() {
    TestBed.inject(AuthService).login('recipient@example.com', 'test-password').subscribe();
    http.expectOne('/api/v1/auth/login').flush({
      data: {
        user: {
          id: 'recipient',
          email: 'recipient@example.com',
          fullName: 'Recipient',
          status: 'active',
        },
      },
    });
  }
  function click<T>(f: ComponentFixture<T>, text: string) {
    const b = Array.from((f.nativeElement as HTMLElement).querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === text,
    );
    expect(b).withContext(text).toBeDefined();
    b!.click();
    f.detectChanges();
  }
  it('scrubs claim tokens from the address bar and sends them only in authenticated POST bodies', () => {
    login();
    history.replaceState(null, '', `/instant-reward#token=${'a'.repeat(43)}`);
    const f = TestBed.createComponent(InstantRewardLandingPage);
    f.detectChanges();
    expect(location.hash).toBe('');
    const req = http.expectOne(`${base}/view`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.token).toBe('a'.repeat(43));
    req.flush({ data: reward });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain(reward.title);
  });
  it('keeps the token in memory through inline login without navigating away', () => {
    history.replaceState(null, '', `/instant-reward#token=${'b'.repeat(43)}`);
    const nav = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    const f = TestBed.createComponent(InstantRewardLandingPage);
    f.detectChanges();
    const inputs = (f.nativeElement as HTMLElement).querySelectorAll('input');
    inputs[0]!.value = 'recipient@example.com';
    inputs[0]!.dispatchEvent(new Event('input'));
    inputs[1]!.value = 'test-password';
    inputs[1]!.dispatchEvent(new Event('input'));
    f.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    http.expectOne('/api/v1/auth/login').flush({
      data: {
        user: {
          id: 'recipient',
          email: 'recipient@example.com',
          fullName: 'Recipient',
          status: 'active',
        },
      },
    });
    http.expectOne(`${base}/view`).flush({ data: reward });
    expect(nav).not.toHaveBeenCalled();
    expect(location.hash).toBe('');
  });
  it('opens verification links once and then claims using the verified reward ID', () => {
    login();
    history.replaceState(null, '', `/instant-reward#verify=${'v'.repeat(43)}`);
    const f = TestBed.createComponent(InstantRewardLandingPage);
    f.detectChanges();
    http.expectOne(`${base}/verify`).flush({
      data: {
        ...reward,
        status: 'VERIFIED',
        verificationRequired: true,
        verifiedAt: reward.sentAt,
      },
    });
    f.detectChanges();
    click(f, 'Claim Reward');
    const req = http.expectOne(`${base}/claim`);
    expect(req.request.body.rewardId).toBe(reward.id);
    expect(req.request.body.token).toBeUndefined();
    req.flush({
      data: {
        ...reward,
        status: 'CLAIMED',
        allowedActions: [],
        promoCode: 'THANKYOU',
        claimReceiptId: 'receipt',
      },
    });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('THANKYOU');
    expect(f.nativeElement.textContent).toContain('receipt');
  });
  it('retries claims with the same idempotency key and displays server errors', () => {
    login();
    history.replaceState(null, '', `/instant-reward#token=${'c'.repeat(43)}`);
    const f = TestBed.createComponent(InstantRewardLandingPage);
    f.detectChanges();
    http.expectOne(`${base}/view`).flush({ data: reward });
    f.detectChanges();
    click(f, 'Claim Reward');
    const first = http.expectOne(`${base}/claim`);
    const id = first.request.body.requestId;
    first.flush(
      { error: { code: 'REWARD_REVISION_CONFLICT', message: 'Retry safely' } },
      { status: 409, statusText: 'Conflict' },
    );
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Retry safely');
    click(f, 'Claim Reward');
    const retry = http.expectOne(`${base}/claim`);
    expect(retry.request.body.requestId).toBe(id);
    retry.flush({ data: { ...reward, status: 'CLAIMED', allowedActions: [] } });
  });
  it('renders My Rewards groups and requests a real email link', () => {
    login();
    const f = TestBed.createComponent(MyRewardsPage);
    f.detectChanges();
    http
      .expectOne((r) => r.url === `${base}/mine` && r.params.get('group') === 'available')
      .flush(list);
    f.detectChanges();
    click(f, 'View reward');
    click(f, 'Email me a secure reward link');
    const req = http.expectOne(`${base}/${reward.id}/request-link`);
    expect(req.request.body.confirm).toBeTrue();
    expect(req.request.body.requestId).toBeTruthy();
    req.flush({ data: reward });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Check your recipient email');
    click(f, 'Back to rewards');
    click(f, 'claimed');
    http
      .expectOne((r) => r.url === `${base}/mine` && r.params.get('group') === 'claimed')
      .flush({ data: [], pagination: list.pagination });
  });
  it('does not offer recipient mutations absent from server allowedActions', () => {
    login();
    const f = TestBed.createComponent(MyRewardsPage);
    f.detectChanges();
    http
      .expectOne((r) => r.url === `${base}/mine`)
      .flush({ ...list, data: [{ ...reward, status: 'DISABLED', allowedActions: [] }] });
    f.detectChanges();
    click(f, 'View reward');
    const text = f.nativeElement.textContent;
    expect(text).not.toContain('Claim Reward');
    expect(text).not.toContain('Email me a secure reward link');
  });
  function admin() {
    const f = TestBed.createComponent(InstantRewardsAdminPage);
    f.detectChanges();
    http.expectOne((r) => r.url === `${base}/admin`).flush(list);
    http.expectOne(`${base}/admin/summary`).flush({ data: { SENT: 1 } });
    f.detectChanges();
    return f;
  }
  it('loads admin summary, filters and actual reward details/audit', async () => {
    const f = admin();
    click(f, 'View');
    http
      .expectOne(`${base}/admin/${reward.id}`)
      .flush({ data: { ...reward, allowedActions: ['disable', 'revoke', 'resend'] } });
    http
      .expectOne((r) => r.url === `${base}/admin/${reward.id}/audit`)
      .flush({
        data: [
          {
            id: 'event',
            action: 'REWARD_CREATED',
            actorType: 'ADMIN',
            timestamp: reward.createdAt,
            metadata: {},
          },
        ],
        pagination: list.pagination,
      });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('REWARD_CREATED');
    expect(f.nativeElement.textContent).not.toContain('Confirm revoke');
    click(f, 'Back to rewards');
    await f.whenStable();
    const input = f.nativeElement.querySelector('#reward-search') as HTMLInputElement;
    input.value = 'recipient';
    input.dispatchEvent(new Event('input'));
    f.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    http
      .expectOne((r) => r.url === `${base}/admin` && r.params.get('search') === 'recipient')
      .flush(list);
    http.expectOne(`${base}/admin/summary`).flush({ data: { SENT: 1 } });
  });
  it('requires confirmation before permanent revoke and posts the entered reason', () => {
    const f = admin();
    click(f, 'View');
    http
      .expectOne(`${base}/admin/${reward.id}`)
      .flush({ data: { ...reward, allowedActions: ['revoke'] } });
    http
      .expectOne((r) => r.url === `${base}/admin/${reward.id}/audit`)
      .flush({ data: [], pagination: list.pagination });
    f.detectChanges();
    click(f, 'revoke');
    expect(f.nativeElement.querySelector('[role=dialog]').textContent).toContain(
      'Revocation is permanent',
    );
    http.expectNone(`${base}/admin/${reward.id}/revoke`);
    const reason = f.nativeElement.querySelector('#revoke-reason') as HTMLTextAreaElement;
    reason.value = 'Cancelled by support';
    reason.dispatchEvent(new Event('input'));
    click(f, 'Confirm');
    const req = http.expectOne(`${base}/admin/${reward.id}/revoke`);
    expect(req.request.body).toEqual({ confirm: true, reason: 'Cancelled by support' });
    req.flush({ data: { ...reward, status: 'REVOKED', allowedActions: [] } });
    http.expectOne((r) => r.url === `${base}/admin`).flush(list);
    http.expectOne(`${base}/admin/summary`).flush({ data: { REVOKED: 1 } });
    http
      .expectOne((r) => r.url === `${base}/admin/${reward.id}/audit`)
      .flush({ data: [], pagination: list.pagination });
  });
  it('opens the existing styled form and posts a validated draft creation', async () => {
    const f = admin();
    click(f, 'Create Instant Reward');
    await f.whenStable();
    const fields: { [key: string]: string } = {
      '#reward-email': 'new@example.com',
      '#reward-title': 'Welcome gift',
      '#reward-expiry': '2026-11-19T10:00',
      '#reward-value': '15',
    };
    for (const [selector, value] of Object.entries(fields)) {
      const input = f.nativeElement.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    f.detectChanges();
    f.nativeElement.querySelector('[role=dialog] form').dispatchEvent(new Event('submit'));
    const req = http.expectOne(`${base}/admin`);
    expect(req.request.body.recipientEmail).toBe('new@example.com');
    expect(req.request.body.title).toBe('Welcome gift');
    expect(req.request.body.createRequestId).toBeTruthy();
    expect(req.request.body.verificationRequired).toBeTrue();
    req.flush({ data: reward });
    http.expectOne((r) => r.url === `${base}/admin`).flush(list);
    http.expectOne(`${base}/admin/summary`).flush({ data: { SENT: 1 } });
    http
      .expectOne((r) => r.url === `${base}/admin/${reward.id}/audit`)
      .flush({ data: [], pagination: list.pagination });
  });
});
