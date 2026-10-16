import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BusinessInput } from '../../core/business/business.service';
import { BusinessForm } from './business-form';

@Component({
  imports: [BusinessForm],
  template: `<app-business-form
    [saving]="saving()"
    [error]="error()"
    (submitted)="received.push($event)"
  />`,
})
class Host {
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly received: BusinessInput[] = [];
}

describe('BusinessForm', () => {
  let fixture: ComponentFixture<Host>;
  const el = () => fixture.nativeElement as HTMLElement;
  const type = (id: string, value: string) => {
    const input = el().querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const submit = () => {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('blocks submit and shows errors for missing/invalid fields', () => {
    type('email', 'nope');
    type('googleReviewUrl', 'http://insecure.example');
    submit();
    expect(fixture.componentInstance.received.length).toBe(0);
    const errors = Array.from(el().querySelectorAll('.error')).map((e) => e.textContent);
    expect(errors.some((t) => t?.includes('business name'))).toBeTrue();
    expect(errors.some((t) => t?.includes('valid email'))).toBeTrue();
    expect(errors.some((t) => t?.includes('https://'))).toBeTrue();
  });

  it('emits values when valid', () => {
    type('name', 'Joes');
    type('category', 'Cafe');
    type('timezone', 'Europe/London');
    submit();
    expect(fixture.componentInstance.received).toEqual([
      {
        name: 'Joes',
        category: 'Cafe',
        email: '',
        phone: '',
        address: '',
        timezone: 'Europe/London',
        googleReviewUrl: '',
      },
    ]);
  });

  it('shows saving and error states', () => {
    fixture.componentInstance.saving.set(true);
    fixture.componentInstance.error.set('Server said no');
    fixture.detectChanges();
    expect(el().querySelector('button[type=submit]')!.hasAttribute('disabled')).toBeTrue();
    expect(el().querySelector('.alert')!.textContent).toContain('Server said no');
  });
});
