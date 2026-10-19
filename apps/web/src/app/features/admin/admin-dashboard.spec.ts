import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminDashboard, PlatformMetric } from './admin-dashboard';

describe('Super Admin dashboard presentation', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));
  function render(metrics: PlatformMetric[], rating: number | null = null) {
    const fixture = TestBed.createComponent(AdminDashboard);
    fixture.componentRef.setInput('metrics', metrics);
    fixture.componentRef.setInput('averageRating', rating);
    fixture.detectChanges();
    return fixture;
  }
  it('shows real totals and the calculated business health share', () => {
    const f = render(
      [
        { label: 'Businesses', value: 20 },
        { label: 'Active businesses', value: 15 },
        { label: 'Users', value: 1200 },
        { label: 'Responses', value: 85 },
        { label: 'Promotions', value: 9 },
      ],
      4.25,
    );
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('1,200');
    expect(el.textContent).toContain('75% active');
    expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('75');
    expect(el.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('4.25');
    expect(el.querySelectorAll('section[aria-label="Platform totals"] > a').length).toBe(4);
  });
  it('handles an empty platform without inventing ratings or producing invalid percentages', () => {
    const f = render([
      { label: 'Businesses', value: 0 },
      { label: 'Active businesses', value: 0 },
    ]);
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No ratings yet');
    expect(el.textContent).not.toContain('NaN');
    expect(el.querySelector('[role="meter"]')).toBeNull();
    expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0');
    expect(el.querySelector('aside')).toBeNull();
  });
  it('links moderation counts to the correct filtered admin lists', () => {
    const f = render([
      { label: 'Suspended businesses', value: 2 },
      { label: 'Disabled users', value: 3 },
    ]);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('aside')?.textContent).toContain('2 suspended businesses');
    expect(el.querySelector('aside a[href="/admin/businesses?status=suspended"]')).not.toBeNull();
    expect(el.querySelector('aside a[href="/admin/users?status=disabled"]')).not.toBeNull();
  });
});
