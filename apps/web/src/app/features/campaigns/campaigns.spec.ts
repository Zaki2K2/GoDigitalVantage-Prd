import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Business, BusinessApi } from '../../core/business/business.service';
import { CampaignsPage } from './campaigns.page';
import { Campaign, blankCampaign } from './campaign.api';
import { CampaignPicker } from './campaign-picker';
import { CampaignMonitoring } from './campaign-monitoring';
import { EmailPreferencesPage } from './email-preferences.page';

describe('Campaign screens', () => {
  let http: HttpTestingController;
  const id = '0123456789abcdef01234567';
  const business = { id, timezone: 'UTC', role: 'owner' } as Business;
  const root = `/api/v1/businesses/${id}/campaigns`;
  const campaign: Campaign = {
    ...blankCampaign(),
    _id: '1123456789abcdef01234567',
    name: 'Birthday Special',
    businessId: id,
    ownerType: 'business',
    status: 'draft',
    revision: 2,
  };
  function setup(
    role: 'owner' | 'member' = 'owner',
    admin = false,
    status: Campaign['status'] = 'draft',
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: BusinessApi, useValue: { list: () => of([{ ...business, role }]) } },
        { provide: ActivatedRoute, useValue: { snapshot: { data: { campaignAdmin: admin } } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(CampaignsPage);
    f.detectChanges();
    const url = admin ? '/api/v1/admin/campaigns' : root;
    http
      .expectOne((r) => r.url === url)
      .flush({
        data: [{ ...campaign, status }],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
    http.expectOne(url + '/templates').flush({
      data: [
        {
          id: 'birthday',
          name: 'Birthday Deal',
          campaignType: 'promotion',
          trigger: { type: 'birthday' },
        },
      ],
      global: [],
    });
    f.detectChanges();
    return f;
  }
  afterEach(() => http.verify());
  function button(f: ComponentFixture<CampaignsPage>, label: string) {
    const b = [
      ...((f.nativeElement.querySelector('[role=dialog]') ?? f.nativeElement).querySelectorAll(
        'button',
      ) as NodeListOf<HTMLButtonElement>),
    ].find((b) => b.textContent?.trim() === label);
    expect(b).withContext(label).toBeDefined();
    return b!;
  }
  it('uses the generic wizard for birthday templates', async () => {
    const f = setup();
    button(f, 'Create Campaign').click();
    f.detectChanges();
    button(f, 'Use Template').click();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Step 2 of 5');
    expect((f.nativeElement.querySelector('#camp-name') as HTMLInputElement).value).toBe(
      'Birthday Deal',
    );
    expect(f.nativeElement.querySelector('#camp-business')).toBeNull();
  });
  it('hides mutation controls for business members', () => {
    const f = setup('member');
    expect(f.nativeElement.textContent).not.toContain('Create Campaign');
    expect(f.nativeElement.textContent).not.toContain('Duplicate');
    expect(f.nativeElement.textContent).toContain('View');
  });
  it('uses responsive cards and keeps secondary metrics out of the listing', async () => {
    const f = setup();
    const host = f.nativeElement as HTMLElement;
    host.style.display = 'block';
    host.style.width = '390px';
    await f.whenStable();
    f.detectChanges();
    const card = host.querySelector<HTMLElement>('.campaign-card')!;
    expect(card.getBoundingClientRect().width).toBeLessThanOrEqual(390);
    expect(host.querySelector('table')).toBeNull();
    expect(host.textContent).not.toContain('Redemption rate');
    button(f, 'Edit').click();
    f.detectChanges();
    await f.whenStable();
    const dialog = host.querySelector<HTMLElement>('[role=dialog]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight);
    expect(getComputedStyle(dialog.querySelector('.campaign-dialog-body')!).overflowY).toBe('auto');
    expect(host.querySelector('main')!.hasAttribute('inert')).toBeTrue();
  });
  it('uses the separate Super Admin API and target-business field', () => {
    const f = setup('owner', true);
    button(f, 'Create Campaign').click();
    f.detectChanges();
    button(f, 'Start custom').click();
    f.detectChanges();
    http
      .expectOne((r) => r.url === '/api/v1/admin/businesses')
      .flush({ data: [], pagination: { page: 1, total: 0, totalPages: 0 } });
    expect(f.nativeElement.querySelector('#camp-business')).not.toBeNull();
  });
  it('requires confirmation after a fresh server audience preview', () => {
    const f = setup();
    button(f, 'View').click();
    const detail = {
      campaign,
      estimatedRecipients: 700,
      metrics: {
        targeted: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        reconciliation: 0,
        delivered: 0,
        deliveryFailures: 0,
        issued: 0,
        redeemed: 0,
        redemptionRate: null,
      },
      executions: [],
      recipients: [],
      pagination: { page: 1, total: 0, totalPages: 0 },
    };
    http.expectOne((r) => r.url === `${root}/${campaign._id}`).flush({ data: detail });
    f.detectChanges();
    button(f, 'Review & activate').click();
    http.expectOne((r) => r.url === `${root}/${campaign._id}`).flush({ data: detail });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('700 estimated recipients');
    expect(f.nativeElement.textContent).toContain('Large campaign');
    expect(button(f, 'Confirm activate').disabled).toBeTrue();
    const checkbox = f.nativeElement.querySelector('input[type=checkbox]') as HTMLInputElement;
    checkbox.click();
    f.detectChanges();
    button(f, 'Confirm activate').click();
    const req = http.expectOne(`${root}/${campaign._id}/activate`);
    expect(req.request.body).toEqual({ confirm: true, revision: 2, confirmedCount: 700 });
    req.flush({ data: { ...campaign, status: 'active' } });
    http
      .expectOne((r) => r.url === root)
      .flush({ data: [], pagination: { page: 1, total: 0, totalPages: 0 } });
  });
  it('duplicates into a prefilled modal and creates only when saved', async () => {
    const f = setup();
    button(f, 'Actions').click();
    f.detectChanges();
    button(f, 'Duplicate').click();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect((f.nativeElement.querySelector('#camp-name') as HTMLInputElement).value).toBe(
      'Birthday Special (copy)',
    );
    http.expectNone((r) => r.method === 'POST');
    button(f, 'Save Draft').click();
    const req = http.expectOne(root);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.input.offer).toEqual(campaign.offer);
    req.flush({ data: { ...campaign, name: 'Birthday Special (copy)' } });
    http
      .expectOne((r) => r.url === root)
      .flush({ data: [campaign], pagination: { page: 1, total: 1, totalPages: 1 } });
    f.detectChanges();
    expect(f.nativeElement.querySelector('[role=dialog]')).toBeNull();
  });
  it('edits with the current revision and preserves optional settings between steps', async () => {
    const f = setup();
    button(f, 'Edit').click();
    f.detectChanges();
    await f.whenStable();
    button(f, 'Next').click();
    f.detectChanges();
    await f.whenStable();
    expect(f.nativeElement.textContent).toContain('Customers');
    button(f, 'Back').click();
    f.detectChanges();
    await f.whenStable();
    button(f, 'Save Draft').click();
    const req = http.expectOne(root + '/' + campaign._id);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.revision).toBe(2);
    expect(req.request.body.input.offerPolicy).toBe('exclusive');
    req.flush({ data: campaign });
    http
      .expectOne((r) => r.url === root)
      .flush({ data: [campaign], pagination: { page: 1, total: 1, totalPages: 1 } });
  });
  it('keeps unsaved values and confirms navigation or discard', async () => {
    const f = setup();
    button(f, 'Edit').click();
    f.detectChanges();
    await f.whenStable();
    const name = f.nativeElement.querySelector('#camp-name') as HTMLInputElement;
    name.value = 'Changed';
    name.dispatchEvent(new Event('input'));
    f.detectChanges();
    const leave = f.componentInstance.canLeave();
    f.detectChanges();
    button(f, 'Keep editing').click();
    expect(await leave).toBeFalse();
    f.detectChanges();
    await f.whenStable();
    expect((f.nativeElement.querySelector('#camp-name') as HTMLInputElement).value).toBe('Changed');
    f.nativeElement
      .querySelector('[role=dialog]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    button(f, 'Discard changes').click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('[role=dialog]')).toBeNull();
  });
  it('shows inline validation and retains the builder after a save failure', async () => {
    const f = setup();
    button(f, 'Create Campaign').click();
    f.detectChanges();
    button(f, 'Start custom').click();
    f.detectChanges();
    await f.whenStable();
    button(f, 'Next').click();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Enter a name');
    const name = f.nativeElement.querySelector('#camp-name') as HTMLInputElement;
    name.value = 'Offer';
    name.dispatchEvent(new Event('input'));
    f.detectChanges();
    button(f, 'Save Draft').click();
    http
      .expectOne(root)
      .flush({ error: { message: 'Please retry' } }, { status: 503, statusText: 'Unavailable' });
    f.detectChanges();
    expect(f.nativeElement.querySelector('[role=dialog]')).not.toBeNull();
    expect(name.value).toBe('Offer');
  });
  it('previews templates and opens the actual prefilled builder', async () => {
    const f = setup();
    button(f, 'Create Campaign').click();
    f.detectChanges();
    button(f, 'Preview').click();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Template preview');
    button(f, 'Use Template').click();
    f.detectChanges();
    await f.whenStable();
    button(f, 'Next').click();
    f.detectChanges();
    await f.whenStable();
    button(f, 'Next').click();
    f.detectChanges();
    await f.whenStable();
    expect((f.nativeElement.querySelector('#camp-trigger') as HTMLSelectElement).value).toBe(
      'birthday',
    );
  });
  for (const action of ['pause', 'resume', 'cancel']) {
    it('confirms ' + action + ' with revision and preserves retry errors', () => {
      const f = setup('owner', false, action === 'resume' ? 'paused' : 'active');
      button(f, 'Actions').click();
      f.detectChanges();
      f.detectChanges();
      button(f, action.charAt(0).toUpperCase() + action.slice(1)).click();
      if (action === 'resume')
        http
          .expectOne((r) => r.url === root + '/' + campaign._id)
          .flush({ data: { campaign: { ...campaign, status: 'paused' }, estimatedRecipients: 3 } });
      f.detectChanges();
      const box = f.nativeElement.querySelector('input[type=checkbox]') as HTMLInputElement;
      box.click();
      f.detectChanges();
      button(f, 'Confirm ' + action).click();
      const req = http.expectOne(root + '/' + campaign._id + '/' + action);
      expect(req.request.body.revision).toBe(2);
      req.flush({ error: { message: 'Conflict' } }, { status: 409, statusText: 'Conflict' });
      f.detectChanges();
      expect(f.nativeElement.querySelector('[role=dialog]')).not.toBeNull();
      expect(f.nativeElement.textContent).toContain('Conflict');
    });
  }
  it('traps keyboard focus and restores it after closing', async () => {
    const f = setup();
    const opener = button(f, 'Create Campaign');
    opener.focus();
    opener.click();
    f.detectChanges();
    await f.whenStable();
    const dialog = f.nativeElement.querySelector('[role=dialog]') as HTMLElement;
    expect(dialog.contains(document.activeElement)).toBeTrue();
    const last = button(f, 'Next');
    last.focus();
    last.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(dialog.querySelector('button'));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    await f.whenStable();
    expect(document.activeElement).toBe(opener);
  });
  it('creates through all five steps and requires a server audience confirmation', async () => {
    const f = setup();
    button(f, 'Create Campaign').click();
    f.detectChanges();
    button(f, 'Start custom').click();
    f.detectChanges();
    await f.whenStable();
    const input = f.nativeElement.querySelector('#camp-name') as HTMLInputElement;
    input.value = 'New offer';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    for (let n = 0; n < 3; n++) {
      button(f, 'Next').click();
      f.detectChanges();
      await f.whenStable();
    }
    expect(f.nativeElement.textContent).toContain('Step 5 of 5');
    const primary = f.nativeElement.querySelector(
      '.campaign-dialog-footer > button',
    ) as HTMLButtonElement;
    primary.click();
    http.expectOne(root).flush({ data: { ...campaign, name: 'New offer' } });
    http
      .expectOne((r) => r.url === root)
      .flush({ data: [campaign], pagination: { page: 1, total: 1, totalPages: 1 } });
    await f.whenStable();
    http
      .expectOne((r) => r.url === root + '/' + campaign._id)
      .flush({ data: { campaign, estimatedRecipients: 12 } });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('12 estimated recipients');
    expect(button(f, 'Confirm activate').disabled).toBeTrue();
    expect(f.nativeElement.querySelectorAll('[role=dialog]').length).toBe(1);
  });
  it('shows an actionable API error', () => {
    const f = setup();
    button(f, 'Filter / refresh').click();
    http
      .expectOne((r) => r.url === root)
      .flush(
        { error: { code: 'UNAVAILABLE', message: 'Please retry' } },
        { status: 503, statusText: 'Unavailable' },
      );
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Please retry');
  });
});

describe('Campaign production controls', () => {
  let http: HttpTestingController;
  const original = location.pathname + location.search + location.hash;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    history.replaceState(null, '', original);
  });
  it('keeps unsubscribe tokens out of the URL and requires explicit confirmation', () => {
    history.replaceState(null, '', '/email-preferences#token=signed-test-token');
    const f = TestBed.createComponent(EmailPreferencesPage);
    f.detectChanges();
    expect(location.hash).toBe('');
    http.expectNone((r) => r.method === 'POST');
    (f.nativeElement.querySelector('button') as HTMLButtonElement).click();
    const req = http.expectOne('/api/v1/public/campaign-unsubscribe/signed-test-token');
    expect(req.request.method).toBe('POST');
    req.flush({ data: { unsubscribed: true } });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('You are unsubscribed');
  });
  it('shows scheduler readiness, locks and retries without exposing unsafe resend controls', () => {
    const f = TestBed.createComponent(CampaignMonitoring);
    f.detectChanges();
    http.expectNone((r) => r.url.includes('monitoring'));
    (f.nativeElement.querySelector('button') as HTMLButtonElement).click();
    http
      .expectOne((r) => r.url === '/api/v1/admin/campaigns/monitoring')
      .flush({
        data: {
          scheduler: null,
          configuration: {
            emailEnabled: false,
            unsubscribeConfigured: false,
            schedulerConfigured: false,
            indexesReady: false,
          },
          counts: [{ _id: 'reconciliation', count: 1 }],
          locks: [{ _id: 'offers:business', at: '2026-10-20T10:00:00Z' }],
          recentChecks: [],
          recipients: [
            {
              _id: 'r1',
              campaignId: 'c1',
              businessId: 'b1',
              status: 'reconciliation',
              attempts: 3,
              nextAttemptAt: null,
              errorCode: 'EMAIL_SEND_UNCERTAIN',
              error: 'Unknown acceptance',
            },
          ],
        },
        pagination: { page: 1, total: 1, totalPages: 1 },
      });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Operator review');
    expect(f.nativeElement.textContent).toContain('EMAIL_SEND_UNCERTAIN');
    expect(f.nativeElement.textContent).toContain('Required database indexes: missing');
    expect(
      [...(f.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)].some((b) =>
        /resend|unlock/i.test(b.textContent ?? ''),
      ),
    ).toBeFalse();
  });
});

describe('Campaign audience picker', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('retains selected customers across paginated tenant queries', () => {
    const f = TestBed.createComponent(CampaignPicker);
    f.componentRef.setInput('resource', 'contacts');
    f.componentRef.setInput('businessId', 'tenant-a');
    f.componentRef.setInput('multiple', true);
    f.componentRef.setInput('selected', ['prior']);
    f.detectChanges();
    const req = http.expectOne((r) => r.url === '/api/v1/businesses/tenant-a/contacts');
    expect(req.request.params.get('pageSize')).toBe('10');
    req.flush({
      data: [{ id: 'next', fullName: 'Next Customer' }],
      pagination: { page: 1, total: 11, totalPages: 2 },
    });
    f.detectChanges();
    const selected = spyOn(f.componentInstance.selectionChange, 'emit');
    (f.nativeElement.querySelector('.list-row') as HTMLButtonElement).click();
    expect(selected).toHaveBeenCalledWith(['prior', 'next']);
    const next = [
      ...((f.nativeElement.querySelector('[role=dialog]') ?? f.nativeElement).querySelectorAll(
        'button',
      ) as NodeListOf<HTMLButtonElement>),
    ].find((b) => b.textContent?.trim() === 'Next')!;
    next.click();
    const page = http.expectOne((r) => r.url === '/api/v1/businesses/tenant-a/contacts');
    expect(page.request.params.get('page')).toBe('2');
    page.flush({ data: [], pagination: { page: 2, total: 11, totalPages: 2 } });
  });
  it('uses explicit business scoping with the existing Super Admin contact API', () => {
    const f = TestBed.createComponent(CampaignPicker);
    f.componentRef.setInput('resource', 'contacts');
    f.componentRef.setInput('businessId', 'tenant-b');
    f.componentRef.setInput('admin', true);
    f.detectChanges();
    const req = http.expectOne((r) => r.url === '/api/v1/admin/contacts');
    expect(req.request.params.get('businessId')).toBe('tenant-b');
    req.flush({ data: [], pagination: { page: 1, total: 0, totalPages: 0 } });
  });
});
