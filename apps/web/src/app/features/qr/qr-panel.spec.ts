import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { QrPanel } from './qr-panel';

describe('QrPanel', () => {
  let fixture: ComponentFixture<QrPanel>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;

  async function open(published: boolean) {
    fixture = TestBed.createComponent(QrPanel);
    fixture.componentRef.setInput('businessId', 'b1');
    fixture.componentRef.setInput('businessName', 'Joes');
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne('/api/v1/businesses/b1/qr').flush({
      data: { slug: 'joes', publicUrl: 'https://app.example/r/joes', published },
    });
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [QrPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('shows preview, link, downloads and print', async () => {
    await open(true);
    expect(el().querySelector<HTMLImageElement>('img.code')!.getAttribute('src')).toBe(
      '/api/v1/businesses/b1/qr.svg',
    );
    expect(el().querySelector<HTMLInputElement>('#qr-url')!.value).toBe(
      'https://app.example/r/joes',
    );
    const hrefs = Array.from(el().querySelectorAll<HTMLAnchorElement>('a[download]')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual([
      '/api/v1/businesses/b1/qr.png?download=1',
      '/api/v1/businesses/b1/qr.svg?download=1',
    ]);
    expect(el().textContent).toContain('Print');
    expect(el().querySelector('.notice')).toBeNull();
  });

  it('warns when the questionnaire is not published', async () => {
    await open(false);
    expect(el().querySelector('.notice')!.textContent).toContain('not published yet');
  });

  it('copies the link', async () => {
    await open(true);
    const written: string[] = [];
    spyOn(navigator.clipboard, 'writeText').and.callFake(async (t: string) => {
      written.push(t);
    });
    Array.from(el().querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent?.includes('Copy link'))!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(written).toEqual(['https://app.example/r/joes']);
    expect(el().textContent).toContain('Link copied');
  });

  it('shows an error state', async () => {
    fixture = TestBed.createComponent(QrPanel);
    fixture.componentRef.setInput('businessId', 'b1');
    fixture.componentRef.setInput('businessName', 'Joes');
    fixture.detectChanges();
    await Promise.resolve();
    http
      .expectOne('/api/v1/businesses/b1/qr')
      .flush(
        { error: { code: 'FORBIDDEN', message: 'No access' } },
        { status: 403, statusText: 'x' },
      );
    fixture.detectChanges();
    expect(el().querySelector('.alert')!.textContent).toContain('No access');
  });
});
