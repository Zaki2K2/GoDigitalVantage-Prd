import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PublicForm } from '../../core/questionnaire/questionnaire.service';
import { PublicFormPage, phoneLooksValid } from './public-form.page';

const FORM: PublicForm = {
  business: {
    name: 'Joes Cafe',
    slug: 'joes',
    category: 'Cafe',
    googleReviewUrl: 'https://g.page/r/joes/review',
  },
  questionnaire: {
    version: 2,
    publishedAt: '2026-01-01',
    title: 'Tell us',
    description: null,
    questions: [
      { id: 's', type: 'short_text', label: 'Order', helpText: null, required: true, choices: [] },
      {
        id: 'l',
        type: 'long_text',
        label: 'Comments',
        helpText: null,
        required: false,
        choices: [],
      },
      {
        id: 'sc',
        type: 'single_choice',
        label: 'Visit type',
        helpText: null,
        required: false,
        choices: [
          { id: 'c1', label: 'Dine in' },
          { id: 'c2', label: 'Takeaway' },
        ],
      },
      {
        id: 'mc',
        type: 'multiple_choice',
        label: 'Liked',
        helpText: null,
        required: false,
        choices: [
          { id: 'm1', label: 'Coffee' },
          { id: 'm2', label: 'Staff' },
        ],
      },
      { id: 'r', type: 'rating', label: 'Rate us', helpText: null, required: true, choices: [] },
    ],
  },
  consent: {
    wordingVersion: 'v1',
    reviewRequestSms: 'Text me a Google review link. (Optional)',
    marketingSms: 'Send me promotions. (Optional)',
  },
};

describe('PublicFormPage', () => {
  let fixture: ComponentFixture<PublicFormPage>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(sel: string) => el().querySelector<T>(sel)!;

  async function open(slug = 'joes', form: PublicForm | null = FORM) {
    fixture = TestBed.createComponent(PublicFormPage);
    fixture.componentRef.setInput('slug', slug);
    fixture.detectChanges();
    await Promise.resolve();
    if (form) {
      http.expectOne(`/api/v1/public/${slug}`).flush({ data: form });
      // Exactly one scan per page load.
      http.expectOne(`/api/v1/public/${slug}/scan`).flush(null, { status: 204, statusText: 'OK' });
      fixture.detectChanges();
    }
  }

  const type = (sel: string, value: string) => {
    const i = q<HTMLInputElement>(sel);
    i.value = value;
    i.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const tick = (sel: string, on = true) => {
    const i = q<HTMLInputElement>(sel);
    i.checked = on;
    i.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };
  const submit = () => {
    q<HTMLFormElement>('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  };
  const fillRequired = () => {
    type('#q-0', 'Flat white');
    tick('input[name="q-4"][value="4"]');
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PublicFormPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('renders branding and every question type as an enabled control, with consent unticked', async () => {
    await open();
    const text = el().textContent!;
    expect(text).toContain('Joes Cafe');
    for (const t of ['Order', 'Comments', 'Visit type', 'Liked', 'Rate us'])
      expect(text).toContain(t);
    expect(el().querySelectorAll('input[type=radio][name="q-4"]').length).toBe(5);
    expect(el().querySelectorAll('input[type=checkbox]:not([disabled])').length).toBe(2); // multi-choice
    const consent = el().querySelectorAll<HTMLInputElement>('.consent input');
    expect(consent.length).toBe(2);
    consent.forEach((c) => {
      expect(c.checked).toBeFalse();
      expect(c.disabled).toBeTrue(); // needs a phone number first
    });
    expect(text).toContain('Send me promotions. (Optional)');
    expect(q('button[type=submit]').textContent).toContain('Send feedback');
  });

  it('shows required-field errors and sends nothing', async () => {
    await open();
    submit();
    expect(el().textContent).toContain('This question is required');
    expect(q('#q-0').getAttribute('aria-invalid')).toBe('true');
    expect(el().querySelectorAll('.error').length).toBe(2);
    await fixture.whenStable();
    expect(document.activeElement).toBe(q('#q-0'));
  });

  it('reports progress and focuses an unanswered rating after validation', async () => {
    await open();
    expect(q('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('0');
    expect(q<HTMLInputElement>('#q-0').required).toBeTrue();
    type('#q-0', 'Flat white');
    expect(q('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('1');
    submit();
    await fixture.whenStable();
    expect(document.activeElement).toBe(q('input[name="q-4"]'));
  });

  it('clears answers and loads the correct form when the public slug changes', async () => {
    await open();
    fillRequired();
    fixture.componentRef.setInput('slug', 'another-business');
    fixture.detectChanges();
    http.expectOne('/api/v1/public/another-business').flush({ data: FORM });
    http
      .expectOne('/api/v1/public/another-business/scan')
      .flush(null, { status: 204, statusText: 'OK' });
    fixture.detectChanges();
    expect(q<HTMLInputElement>('#q-0').value).toBe('');
    expect(q('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('0');
  });

  it('validates contact details before sending', async () => {
    await open();
    fillRequired();
    type('#c-email', 'nope');
    type('#c-phone', '4155550123');
    submit();
    expect(el().textContent).toContain('Enter a valid email address');
    expect(el().textContent).toContain('country code');
    type('#c-email', '');
    type('#c-phone', '');
    type('#c-name', 'Only Name');
    submit();
    expect(el().textContent).toContain('clear your name to stay anonymous');
  });

  it('submits an anonymous response with no contact or consent', async () => {
    await open();
    fillRequired();
    tick('input[name="q-2"]'); // first radio of single choice
    submit();
    const req = http.expectOne('/api/v1/public/joes/responses');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.has('X-CSRF-Token')).toBeFalse();
    expect(req.request.body.contact).toBeUndefined();
    expect(req.request.body.consent).toBeUndefined();
    expect(req.request.body.version).toBe(2);
    expect(req.request.body.answers).toEqual([
      { questionId: 's', text: 'Flat white' },
      { questionId: 'sc', choiceIds: ['c1'] },
      { questionId: 'r', rating: 4 },
    ]);
    expect(req.request.body.idempotencyKey.length).toBeGreaterThanOrEqual(16);
    expect(req.request.body.website).toBe('');
    req.flush({ data: { responseId: 'x', duplicate: false, googleReviewUrl: null } });
  });

  it('sends contact details and only the consent the customer ticked', async () => {
    await open();
    fillRequired();
    type('#c-name', 'Ana');
    type('#c-phone', '+1 415 555 0123');
    expect(q<HTMLInputElement>('.consent input').disabled).toBeFalse();
    tick('.consent label:nth-of-type(2) input');
    submit();
    const req = http.expectOne('/api/v1/public/joes/responses');
    expect(req.request.body.contact).toEqual({
      fullName: 'Ana',
      email: '',
      phone: '+1 415 555 0123',
    });
    expect(req.request.body.consent).toEqual({
      reviewRequestSms: false,
      marketingSms: true,
      whatsappFollowUp: false,
    });
    req.flush({ data: { responseId: 'x', duplicate: false, googleReviewUrl: null } });
  });

  it('clears consent when the phone number is removed', async () => {
    await open();
    type('#c-phone', '+14155550123');
    tick('.consent label:nth-of-type(1) input');
    type('#c-phone', '');
    expect(q<HTMLInputElement>('.consent input').checked).toBeFalse();
    expect(q<HTMLInputElement>('.consent input').disabled).toBeTrue();
  });

  it('prevents double submission and reuses one idempotency key across retries', async () => {
    await open();
    fillRequired();
    submit();
    submit(); // second click while the first is in flight
    const first = http.expectOne('/api/v1/public/joes/responses');
    expect(q<HTMLButtonElement>('button[type=submit]').disabled).toBeTrue();
    expect(q<HTMLInputElement>('#q-0').disabled).toBeTrue();
    first.flush({ error: { code: 'X', message: 'Boom' } }, { status: 500, statusText: 'err' });
    fixture.detectChanges();
    expect(el().querySelector('.alert')!.textContent).toContain('Boom');
    expect(q<HTMLButtonElement>('button[type=submit]').disabled).toBeFalse();
    expect(q<HTMLInputElement>('#q-0').disabled).toBeFalse();
    submit();
    const retry = http.expectOne('/api/v1/public/joes/responses');
    expect(retry.request.body.idempotencyKey).toBe(first.request.body.idempotencyKey);
    retry.flush({ data: { responseId: 'x', duplicate: true, googleReviewUrl: null } });
  });

  it('maps server validation issues onto the questions', async () => {
    await open();
    fillRequired();
    submit();
    http.expectOne('/api/v1/public/joes/responses').flush(
      {
        error: {
          code: 'SUBMISSION_INVALID',
          message: 'Please fix the highlighted answers',
          details: { issues: [{ questionId: 'l', field: 'answer', message: 'Too long' }] },
        },
      },
      { status: 422, statusText: 'Unprocessable' },
    );
    fixture.detectChanges();
    expect(el().textContent).toContain('Too long');
    expect(el().textContent).toContain('Please fix the highlighted fields');
  });

  it('explains rate limiting', async () => {
    await open();
    fillRequired();
    submit();
    http
      .expectOne('/api/v1/public/joes/responses')
      .flush(
        { error: { code: 'RATE_LIMITED', message: 'x' } },
        { status: 429, statusText: 'Too Many' },
      );
    fixture.detectChanges();
    expect(el().textContent).toContain('Too many submissions');
  });

  it('shows the thank-you page with the Google review link (for any rating)', async () => {
    await open();
    fillRequired();
    submit();
    http.expectOne('/api/v1/public/joes/responses').flush({
      data: { responseId: 'x', duplicate: false, googleReviewUrl: FORM.business.googleReviewUrl },
    });
    fixture.detectChanges();
    expect(el().textContent).toContain('Thank you');
    expect(el().querySelector('form')).toBeNull();
    const link = q<HTMLAnchorElement>('a.btn');
    expect(link.getAttribute('href')).toBe('https://g.page/r/joes/review');
    expect(link.rel).toContain('noopener');
  });

  it('shows the recovery reward card on the thank-you page', async () => {
    await open();
    fillRequired();
    submit();
    http.expectOne('/api/v1/public/joes/responses').flush({
      data: {
        responseId: 'x',
        duplicate: false,
        googleReviewUrl: null,
        reward: {
          token: 'abc.def',
          status: 'issued',
          code: 'GDV-AAAA-BBBB',
          discount: {
            type: 'percent',
            value: 15,
            currency: 'USD',
            minSpend: null,
            maxDiscount: null,
          },
          issuedAt: null,
          expiresAt: '2026-12-01T00:00:00Z',
          redeemedAt: null,
          terms: 'One per table.',
        },
      },
    });
    fixture.detectChanges();
    const text = el().textContent!;
    for (const t of ['GDV-AAAA-BBBB', '15% off', 'One per table.', 'No review is required']) {
      expect(text).toContain(t);
    }
    expect(el().querySelector('a[href="/reward/abc.def"]')).not.toBeNull();
  });

  it('omits the review link when none is configured', async () => {
    await open();
    fillRequired();
    submit();
    http
      .expectOne('/api/v1/public/joes/responses')
      .flush({ data: { responseId: 'x', duplicate: false, googleReviewUrl: null } });
    fixture.detectChanges();
    expect(el().querySelector('a.btn')).toBeNull();
    expect(el().textContent).toContain('Thank you');
  });

  it('shows a friendly page for unavailable links and does not count a scan', async () => {
    await open('nope', null);
    http
      .expectOne('/api/v1/public/nope')
      .flush(
        { error: { code: 'FORM_UNAVAILABLE', message: 'x' } },
        { status: 404, statusText: 'Not Found' },
      );
    fixture.detectChanges();
    expect(el().textContent).toContain('This form isn’t available');
  });

  it('shows retry on server errors', async () => {
    await open('joes', null);
    http.expectOne('/api/v1/public/joes').flush({}, { status: 500, statusText: 'err' });
    fixture.detectChanges();
    expect(el().textContent).toContain('Something went wrong');
    el().querySelector<HTMLButtonElement>('button')!.click();
    http.expectOne('/api/v1/public/joes').flush({}, { status: 500, statusText: 'err' });
  });
});

describe('phoneLooksValid', () => {
  it('requires a country code', () => {
    expect(phoneLooksValid('+1 (415) 555-0123')).toBeTrue();
    expect(phoneLooksValid('00441234567890')).toBeTrue();
    expect(phoneLooksValid('4155550123')).toBeFalse();
    expect(phoneLooksValid('+12')).toBeFalse();
  });
});
