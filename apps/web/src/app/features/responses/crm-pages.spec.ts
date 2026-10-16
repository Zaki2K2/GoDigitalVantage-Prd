import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ContactsPage } from '../contacts/contacts.page';
import { DashboardPage } from '../dashboard/dashboard.page';
import { ResponsesPage } from './responses.page';

const BIZ = {
  id: 'b1',
  name: 'Joes',
  role: 'owner',
  slug: 'joes',
  category: 'Cafe',
  timezone: 'UTC',
  googleReviewUrl: null,
  onboarding: {},
};
const page = (data: unknown[], total = data.length, p = 1, totalPages = 1) => ({
  data,
  pagination: { page: p, pageSize: 15, total, totalPages },
});
const item = (id: string, over: object = {}) => ({
  id,
  submittedAt: '2026-10-01T10:00:00Z',
  rating: 5,
  questionnaireVersion: 1,
  preview: 'Great espresso',
  contact: null,
  ...over,
});

describe('CRM views', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { user: () => ({ fullName: 'Owner' }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  const businesses = () =>
    http.expectOne('/api/v1/businesses').flush({ data: { businesses: [BIZ] } });
  const settle = async (f: { detectChanges: () => void; whenStable: () => Promise<unknown> }) => {
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
  };

  describe('ResponsesPage', () => {
    it('lists responses, labelling anonymous and identified customers', async () => {
      const f = TestBed.createComponent(ResponsesPage);
      f.detectChanges();
      businesses();
      http
        .expectOne((r) => r.url === '/api/v1/businesses/b1/responses')
        .flush(
          page([
            item('r1'),
            item('r2', {
              rating: 2,
              contact: { id: 'c1', fullName: 'Ana Lee', email: null, phone: null },
            }),
          ]),
        );
      await settle(f);
      const text = (f.nativeElement as HTMLElement).textContent!;
      expect(text).toContain('Anonymous');
      expect(text).toContain('Ana Lee');
      expect(text).toContain('Great espresso');
    });

    it('applies filters and search to the request, resets the page and paginates', async () => {
      const f = TestBed.createComponent(ResponsesPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      businesses();
      http.expectOne((r) => r.url.endsWith('/responses')).flush(page([item('r1')], 40, 1, 3));
      await settle(f);

      const search = el.querySelector<HTMLInputElement>('#f-search')!;
      search.value = 'espresso';
      search.dispatchEvent(new Event('input'));
      const rating = el.querySelector<HTMLSelectElement>('#f-rating')!;
      rating.value = '5';
      rating.dispatchEvent(new Event('change'));
      el.querySelector<HTMLFormElement>('form.toolbar')!.dispatchEvent(new Event('submit'));
      const req = http.expectOne((r) => r.url.endsWith('/responses'));
      expect(req.request.params.get('search')).toBe('espresso');
      expect(req.request.params.get('rating')).toBe('5');
      expect(req.request.params.get('page')).toBe('1');
      req.flush(page([item('r1')], 40, 1, 3));
      await settle(f);

      el.querySelector<HTMLButtonElement>('.pager button:last-child')!.click();
      const next = http.expectOne((r) => r.url.endsWith('/responses'));
      expect(next.request.params.get('page')).toBe('2');
      expect(next.request.params.get('search')).toBe('espresso');
      next.flush(page([], 40, 2, 3));
    });

    it('shows an empty state, and a distinct one when filters match nothing', async () => {
      const f = TestBed.createComponent(ResponsesPage);
      f.detectChanges();
      businesses();
      http.expectOne((r) => r.url.endsWith('/responses')).flush(page([]));
      await settle(f);
      expect((f.nativeElement as HTMLElement).textContent).toContain('No responses yet');
    });

    it('shows an error message when loading fails', async () => {
      const f = TestBed.createComponent(ResponsesPage);
      f.detectChanges();
      businesses();
      http
        .expectOne((r) => r.url.endsWith('/responses'))
        .flush({ error: { code: 'X', message: 'Boom' } }, { status: 500, statusText: 'err' });
      await settle(f);
      expect((f.nativeElement as HTMLElement).querySelector('.alert')!.textContent).toContain(
        'Boom',
      );
    });

    it('opens the answer snapshot, contact and consent for one response', async () => {
      const f = TestBed.createComponent(ResponsesPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      businesses();
      http.expectOne((r) => r.url.endsWith('/responses')).flush(page([item('r1')]));
      await settle(f);
      const opener = el.querySelector<HTMLButtonElement>('.list-row')!;
      opener.focus();
      opener.click();
      http.expectOne('/api/v1/businesses/b1/responses/r1').flush({
        data: {
          ...item('r1', {
            contact: { id: 'c1', fullName: 'Ana Lee', email: 'ana@example.com', phone: null },
          }),
          consent: { reviewRequestSms: false, marketingSms: true, wordingVersion: 'v1' },
          answers: [
            {
              questionId: 'a',
              type: 'rating',
              label: 'Rate us',
              required: true,
              text: null,
              rating: 5,
              choices: [],
            },
            {
              questionId: 'b',
              type: 'multiple_choice',
              label: 'Liked',
              required: false,
              text: null,
              rating: null,
              choices: [
                { id: '1', label: 'Coffee' },
                { id: '2', label: 'Staff' },
              ],
            },
            {
              questionId: 'c',
              type: 'long_text',
              label: 'Comments',
              required: false,
              text: 'Lovely',
              rating: null,
              choices: [],
            },
          ],
        },
      });
      await settle(f);
      const text = el.querySelector('.detail')!.textContent!;
      for (const s of [
        'Rate us',
        '5 / 5',
        'Coffee',
        'Staff',
        'Lovely',
        'ana@example.com',
        'promotions yes',
        'review request no',
      ]) {
        expect(text).toContain(s);
      }
      expect(
        el.querySelectorAll('.detail input, .detail textarea, .detail [contenteditable]').length,
      ).toBe(0);
      const close = el.querySelector<HTMLButtonElement>('.drawer-close')!;
      expect(document.activeElement).toBe(close);
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      close.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBeTrue();
      close.click();
      await settle(f);
      expect(document.activeElement).toBe(opener);
    });

    it('cancels an older detail request when another response is opened', async () => {
      const f = TestBed.createComponent(ResponsesPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      businesses();
      http.expectOne((r) => r.url.endsWith('/responses')).flush(page([item('r1'), item('r2')]));
      await settle(f);
      const rows = el.querySelectorAll<HTMLButtonElement>('.list-row');
      rows[0]!.click();
      const old = http.expectOne('/api/v1/businesses/b1/responses/r1');
      rows[1]!.click();
      expect(old.cancelled).toBeTrue();
      http
        .expectOne('/api/v1/businesses/b1/responses/r2')
        .flush({ data: { ...item('r2'), answers: [], consent: null } });
      await settle(f);
      expect(el.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it('rejects a reversed date range before making a request', async () => {
      const f = TestBed.createComponent(ResponsesPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      businesses();
      http.expectOne((r) => r.url.endsWith('/responses')).flush(page([]));
      await settle(f);
      for (const [selector, value] of [
        ['#f-from', '2026-10-10'],
        ['#f-to', '2026-10-01'],
      ]) {
        const input = el.querySelector<HTMLInputElement>(selector!)!;
        input.value = value!;
        input.dispatchEvent(new Event('change'));
      }
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle(f);
      expect(el.textContent).toContain('start date must be on or before');
      http.expectNone((r) => r.url.endsWith('/responses'));
    });
  });

  describe('ContactsPage', () => {
    it('lists, searches and shows consent history', async () => {
      const f = TestBed.createComponent(ContactsPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      businesses();
      const contact = {
        id: 'c1',
        fullName: 'Ana Lee',
        email: 'ana@example.com',
        phone: '+14155550123',
        responseCount: 2,
        firstResponseAt: '2026-10-01T10:00:00Z',
        lastResponseAt: '2026-10-02T10:00:00Z',
        consent: { reviewRequestSms: null, marketingSms: '2026-10-01T10:00:00Z' },
      };
      http.expectOne((r) => r.url.endsWith('/contacts')).flush(page([contact]));
      await settle(f);
      expect(el.textContent).toContain('Ana Lee');

      const search = el.querySelector<HTMLInputElement>('#c-search')!;
      search.value = '0123';
      search.dispatchEvent(new Event('input'));
      el.querySelector<HTMLFormElement>('form.toolbar')!.dispatchEvent(new Event('submit'));
      const req = http.expectOne((r) => r.url.endsWith('/contacts'));
      expect(req.request.params.get('search')).toBe('0123');
      req.flush(page([contact]));
      await settle(f);

      el.querySelector<HTMLButtonElement>('.list-row')!.click();
      http.expectOne('/api/v1/businesses/b1/contacts/c1').flush({
        data: {
          contact,
          responses: [
            { id: 'r1', submittedAt: '2026-10-01T10:00:00Z', rating: 5, questionnaireVersion: 1 },
          ],
          consentEvents: [
            {
              id: 'e1',
              purpose: 'marketing_sms',
              choice: 'granted',
              wordingVersion: 'v1',
              wordingText: 't',
              source: 'public_form',
              capturedAt: '2026-10-01T10:00:00Z',
            },
          ],
        },
      });
      await settle(f);
      const text = el.querySelector('.detail')!.textContent!;
      expect(text).toContain('review request not granted');
      expect(text).toContain('promotions granted');
      expect(text).toContain('marketing_sms granted via public_form');
    });
  });

  describe('DashboardPage', () => {
    it('renders server numbers, recent feedback and a separate Google note', async () => {
      const f = TestBed.createComponent(DashboardPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      businesses();
      http
        .expectOne('/api/v1/businesses/b1/qr')
        .flush({ data: { slug: 'joes', publicUrl: 'http://x/r/joes', published: true } });
      http
        .expectOne((r) => r.url.endsWith('/dashboard'))
        .flush({
          data: {
            days: 2,
            timezone: 'UTC',
            totals: {
              scans: 12,
              responses: 7,
              contacts: 3,
              averageRating: 4.25,
              ratedResponses: 4,
            },
            ratingDistribution: [0, 0, 1, 1, 2],
            trend: [
              { date: '2026-10-01', scans: 4, responses: 1 },
              { date: '2026-10-02', scans: 8, responses: 6 },
            ],
            recent: [item('r1')],
          },
        });
      await settle(f);
      const stats = el.querySelector('.stats')!.textContent!;
      for (const s of ['12', '7', '3', '4.25', 'from 4 rated responses'])
        expect(stats).toContain(s);
      expect(el.querySelectorAll('.trend .col').length).toBe(2);
      expect(el.textContent).toContain('Great espresso');
      expect(el.textContent).toContain('Google review counts and ratings are not connected');
      expect(el.querySelector('[data-testid="smile-score"]')?.textContent).toContain('75%');
      expect(el.textContent).toContain('3 of 4 rated responses');
      expect(el.querySelector('table caption')?.textContent).toContain('Daily activity in UTC');
    });

    it('shows a null average as a dash and an empty-recent hint', async () => {
      const f = TestBed.createComponent(DashboardPage);
      const el = f.nativeElement as HTMLElement;
      f.detectChanges();
      businesses();
      http
        .expectOne('/api/v1/businesses/b1/qr')
        .flush({ data: { slug: 'joes', publicUrl: 'u', published: true } });
      http
        .expectOne((r) => r.url.endsWith('/dashboard'))
        .flush({
          data: {
            days: 1,
            timezone: 'UTC',
            totals: { scans: 0, responses: 0, contacts: 0, averageRating: null, ratedResponses: 0 },
            ratingDistribution: [0, 0, 0, 0, 0],
            trend: [{ date: '2026-10-01', scans: 0, responses: 0 }],
            recent: [],
          },
        });
      await settle(f);
      expect(el.querySelectorAll('.stat dd')[3]!.textContent).toContain('–');
      expect(el.textContent).toContain('No responses yet');
      expect(el.querySelector('[data-testid="smile-score"]')?.textContent).toContain('—');
    });
  });
});
