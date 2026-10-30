import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ContactFollowUp } from './contact-followup';
import { ContactItem } from '../../core/feedback/feedback.service';

const contact = (over: Partial<ContactItem> = {}): ContactItem => ({
  id: 'c1',
  fullName: 'Zelda',
  email: null,
  phone: '+14155550123',
  responseCount: 1,
  firstResponseAt: '2026-01-01T00:00:00Z',
  lastResponseAt: '2026-01-01T00:00:00Z',
  consent: {
    reviewRequestSms: null,
    marketingSms: null,
    whatsappFollowUp: '2026-01-01T00:00:00Z',
  },
  ...over,
});

function setup(c: ContactItem, canSend = true) {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(ContactFollowUp);
  fixture.componentRef.setInput('businessId', 'b1');
  fixture.componentRef.setInput('contact', c);
  fixture.componentRef.setInput('canSend', canSend);
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne((r) => r.url.endsWith('/followups') && r.method === 'GET').flush({ data: [] });
  if (canSend)
    http
      .expectOne((r) => r.url.endsWith('/followups/config'))
      .flush({ data: { whatsappApi: false } });
  fixture.detectChanges();
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}

describe('ContactFollowUp', () => {
  it('review-request and promotional permission do not enable WhatsApp follow-up', () => {
    const { el } = setup(
      contact({
        consent: {
          reviewRequestSms: '2026-01-01T00:00:00Z',
          marketingSms: '2026-01-01T00:00:00Z',
          whatsappFollowUp: null,
        },
      }),
    );
    expect(el.textContent).toContain('has not given WhatsApp follow-up permission');
    expect(el.querySelector('textarea')).toBeNull();
  });

  it('offers click-to-chat only when the Cloud API is off, and shows the prepared link', () => {
    const { fixture, http, el } = setup(contact());
    expect(el.textContent).not.toContain('Send via WhatsApp');
    const area = el.querySelector('textarea')!;
    area.value = 'Hello Zelda';
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const btn = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('click-to-chat'),
    )!;
    btn.click();
    const req = http.expectOne((r) => r.method === 'POST');
    expect(req.request.body).toEqual({ channel: 'click_to_chat', message: 'Hello Zelda' });
    req.flush({
      data: {
        id: 'f1',
        direction: 'outbound',
        channel: 'click_to_chat',
        body: 'Hello Zelda',
        template: null,
        status: 'prepared',
        errorCode: null,
        createdAt: '2026-01-02T00:00:00Z',
      },
      link: 'https://wa.me/14155550123?text=Hello%20Zelda',
    });
    fixture.detectChanges();
    expect(el.querySelector('a')!.getAttribute('href')).toContain('https://wa.me/14155550123');
    expect(el.textContent).toContain('prepared');
  });

  it('asks for explicit confirmation before a template replaces the typed message', () => {
    const { fixture, http, el } = setup(contact());
    http.match(() => true); // none pending
    fixture.componentInstance['apiEnabled'].set(true);
    fixture.detectChanges();
    const area = el.querySelector('textarea')!;
    area.value = 'Sorry about your visit';
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Send via WhatsApp'))!
      .click();
    const first = http.expectOne((r) => r.method === 'POST');
    expect(first.request.body.confirmTemplate).toBeUndefined();
    first.flush(
      {
        error: {
          code: 'TEMPLATE_CONFIRMATION_REQUIRED',
          message: 'x',
          details: { template: 'hello_world' },
        },
      },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    expect(el.textContent).toContain('Your message will NOT be sent');
    expect(el.textContent).toContain('hello_world');
    expect(el.textContent).toContain('Not sent: Sorry about your visit');
    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Send template'))!
      .click();
    const second = http.expectOne((r) => r.method === 'POST');
    expect(second.request.body.confirmTemplate).toBe('hello_world');
  });

  it('read-only members see history but no send controls', () => {
    const { el } = setup(contact(), false);
    expect(el.querySelector('textarea')).toBeNull();
    expect(el.textContent).toContain('No follow-ups yet');
  });
});
