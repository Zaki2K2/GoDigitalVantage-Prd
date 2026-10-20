import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Avatar } from './avatar';
import { ImageUpload } from './image-upload';

@Component({
  imports: [Avatar],
  template: `<app-avatar [src]="src()" [name]="name()" [shape]="shape()" />`,
})
class Host {
  src = signal<string | null>(null);
  name = signal('Ada Lovelace');
  shape = signal<'circle' | 'square'>('circle');
}

describe('Avatar', () => {
  function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, host: fixture.componentInstance };
  }

  it('shows initials and no image when there is no source', () => {
    const { el } = setup();
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent?.trim()).toBe('AL');
  });

  it('uses a single initial for square business logos', () => {
    const { fixture, el, host } = setup();
    host.shape.set('square');
    host.name.set('joe’s coffee');
    fixture.detectChanges();
    expect(el.textContent?.trim()).toBe('J');
  });

  it('keeps the image hidden until it loads, then reveals it', () => {
    const { fixture, el, host } = setup();
    host.src.set('/api/v1/users/me/avatar?v=1');
    fixture.detectChanges();
    const img = el.querySelector('img')!;
    expect(img.classList.contains('opacity-0')).toBe(true);
    img.dispatchEvent(new Event('load'));
    fixture.detectChanges();
    expect(el.querySelector('img')!.classList.contains('opacity-0')).toBe(false);
  });

  it('falls back to initials when the image fails and recovers on a new source', () => {
    const { fixture, el, host } = setup();
    host.src.set('/broken?v=1');
    fixture.detectChanges();
    el.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent?.trim()).toBe('AL');
    host.src.set('/fixed?v=2');
    fixture.detectChanges();
    expect(el.querySelector('img')).not.toBeNull();
  });
});

describe('ImageUpload', () => {
  function setup(canEdit = true, url: string | null = null) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(ImageUpload);
    fixture.componentRef.setInput('kind', 'avatar');
    fixture.componentRef.setInput('endpoint', '/api/v1/users/me/avatar');
    fixture.componentRef.setInput('canEdit', canEdit);
    fixture.componentRef.setInput('url', url);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('offers Upload without Remove when no image exists', () => {
    const { el } = setup();
    const labels = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(labels.some((l) => l?.includes('Upload photo'))).toBe(true);
    expect(labels).not.toContain('Remove');
  });

  it('offers Replace and Remove when an image exists', () => {
    const { el } = setup(true, '/api/v1/users/me/avatar?v=1');
    const labels = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(labels.some((l) => l?.includes('Replace photo'))).toBe(true);
    expect(labels).toContain('Remove');
  });

  it('hides controls for read-only viewers', () => {
    const { el } = setup(false, '/x?v=1');
    expect(el.querySelector('button')).toBeNull();
  });

  it('rejects unsupported files client-side without calling the API', async () => {
    const { fixture, el } = setup();
    const http = TestBed.inject(HttpTestingController);
    const input = el.querySelector('input[type=file]') as HTMLInputElement;
    const data = new DataTransfer();
    data.items.add(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
    input.files = data.files;
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('PNG, JPG or WebP');
    http.expectNone('/api/v1/users/me/avatar');
  });

  it('removes through the API and reports the change', () => {
    const { fixture, el } = setup(true, '/api/v1/users/me/avatar?v=1');
    const http = TestBed.inject(HttpTestingController);
    let result: string | null | undefined;
    fixture.componentInstance.changed.subscribe((v) => (result = v));
    const remove = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Remove',
    )!;
    remove.click();
    // The CSRF cookie may be absent in tests; satisfy the token fetch first if requested.
    const csrf = http.match('/api/v1/auth/csrf');
    csrf.forEach((r) => r.flush({ data: { csrfToken: 't' } }));
    http
      .expectOne('/api/v1/users/me/avatar')
      .flush(null, { status: 204, statusText: 'No Content' });
    expect(result).toBeNull();
  });
});
