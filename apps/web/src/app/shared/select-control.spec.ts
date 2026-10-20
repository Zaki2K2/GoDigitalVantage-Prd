import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { AppSelect } from './app-select';
import { SelectControl, SelectOption } from './select-control';
import { ActionMenu } from './action-menu';
import { DialogFocus } from './dialog-focus';
import { DropdownPanel } from './dropdown-panel';

@Component({
  imports: [SelectControl, AppSelect, ActionMenu, DialogFocus, FormsModule, ReactiveFormsModule],
  template: `
    <form [formGroup]="form">
      <label for="native">Rating</label>
      <select appSelect id="native" formControlName="native" (change)="changes = changes + 1">
        <option [ngValue]="null" disabled>Choose a rating</option>
        <optgroup label="Ratings">
          <option [ngValue]="1">One</option>
          <option [ngValue]="2">Two</option>
        </optgroup>
      </select>
      <select
        appSelect
        id="native-multi"
        multiple
        formControlName="nativeMulti"
        aria-label="Native multiple"
      >
        <option [ngValue]="1">One</option>
        <option [ngValue]="2">Two</option>
        <option [ngValue]="3" disabled>Three</option>
      </select>
      <div id="single">
        <app-select
          label="Offer"
          [options]="options"
          formControlName="single"
          [loading]="loading"
          [error]="error"
        />
      </div>
      <div id="multi">
        <app-select
          label="Customers"
          [multiple]="true"
          [options]="options"
          formControlName="multi"
        />
      </div>
      <label for="custom">Category</label
      ><input appSelect id="custom" list="categories" formControlName="custom" maxlength="80" />
      <datalist id="categories">
        <option value="Cafe"></option>
        <option value="Retail"></option>
      </datalist>
    </form>
    <label for="filter">Status</label
    ><select appSelect id="filter" [(ngModel)]="filter" (change)="filtered = filtered + 1">
      <option value="">All</option>
      <option value="active">Active</option>
    </select>
    <select appSelect id="async" [(ngModel)]="asyncValue" aria-label="Async">
      @for (o of asyncOptions; track o.value) {
        <option [value]="o.value">{{ o.label }}</option>
      }
    </select>
    <app-action-menu label="Actions"
      ><button (click)="actions = actions + 1">Run action</button
      ><button disabled>Unavailable</button><a href="#help">Help</a></app-action-menu
    >
    @if (modal) {
      <section
        appDialogFocus
        role="dialog"
        aria-label="Test modal"
        class="test-modal"
        style="position:fixed;right:8px;bottom:8px;width:250px;height:100px;overflow:hidden;background:var(--surface);z-index:99999"
        (keydown.escape)="modal = false"
      >
        <label for="modal-select">Modal select</label
        ><select appSelect id="modal-select" [(ngModel)]="modalValue">
          <option value="a">Alpha</option>
          <option value="b">Beta</option>
        </select>
        <button>Modal end</button>
      </section>
    }
  `,
})
class SelectHarness {
  readonly form = new FormGroup({
    native: new FormControl<number | null>(2, Validators.required),
    nativeMulti: new FormControl<number[]>([1], { nonNullable: true }),
    single: new FormControl<string | null>(null, Validators.required),
    multi: new FormControl<string[]>([], { nonNullable: true }),
    custom: new FormControl('Custom category', {
      nonNullable: true,
      validators: Validators.required,
    }),
  });
  options: SelectOption[] = [
    { value: 'a', label: 'Alpha', description: 'Weekend offer', icon: 'gift', group: 'Promotions' },
    { value: 'b', label: 'Beta', description: 'Loyalty reward', group: 'Promotions' },
    { value: 'c', label: 'Unavailable', disabled: true, group: 'Other' },
    { value: 'd', label: 'Delta', group: 'Other' },
  ];
  asyncOptions: SelectOption[] = [];
  asyncValue = 'two';
  filter = '';
  filtered = 0;
  changes = 0;
  actions = 0;
  loading = false;
  error = '';
  modal = false;
  modalValue = 'a';
}

describe('Shared dropdowns', () => {
  let f: ComponentFixture<SelectHarness>;
  let host: HTMLElement;
  async function settle() {
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
  }
  async function open(selector: string) {
    const trigger = host.querySelector<HTMLElement>(selector)!;
    expect(trigger).withContext(selector).not.toBeNull();
    trigger.scrollIntoView({ block: 'center' });
    trigger.click();
    await settle();
  }
  const options = () => Array.from(host.querySelectorAll<HTMLElement>('[role=option]'));
  const panel = () => host.querySelector<HTMLElement>('[appDropdownPanel]')!;
  const key = (element: HTMLElement, key: string) =>
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  beforeEach(async () => {
    TestBed.configureTestingModule({});
    f = TestBed.createComponent(SelectHarness);
    host = f.nativeElement;
    await settle();
  });

  it('preserves numeric native ngValue, original names and change handlers', async () => {
    const native = host.querySelector<HTMLSelectElement>('#native')!;
    expect(native.value).not.toBe('2'); // Angular encodes numeric ngValue.
    await open('#native + app-select .gdv-select-trigger');
    expect(
      options()
        .find((o) => o.textContent?.includes('Two'))
        ?.getAttribute('aria-selected'),
    ).toBe('true');
    options()
      .find((o) => o.textContent?.includes('One'))!
      .click();
    await settle();
    expect(f.componentInstance.form.controls.native.value).toBe(1);
    expect(f.componentInstance.changes).toBe(1);
    expect(native.id).toBe('native');
    expect(host.querySelector('[role=listbox]')).toBeNull();
  });
  it('preserves native multiple selection and disabled options', async () => {
    await open('#native-multi + app-select .gdv-select-trigger');
    options()[1]!.click();
    await settle();
    expect(f.componentInstance.form.controls.nativeMulti.value).toEqual([1, 2]);
    options()[2]!.click();
    await settle();
    expect(f.componentInstance.form.controls.nativeMulti.value).toEqual([1, 2]);
    expect(host.querySelector('[role=listbox]')!.getAttribute('aria-multiselectable')).toBe('true');
  });
  it('implements single-select CVA, validation, touched and reactive reset', async () => {
    await open('#single .gdv-select-trigger');
    options()[1]!.click();
    await settle();
    const control = f.componentInstance.form.controls.single;
    expect(control.value).toBe('b');
    expect(control.valid).toBeTrue();
    expect(control.touched).toBeTrue();
    expect(host.querySelector('#single [role=combobox]')!.getAttribute('aria-required')).toBe(
      'true',
    );
    control.reset();
    await settle();
    expect(host.querySelector('#single .gdv-select-value')!.textContent).toContain(
      'Select an option',
    );
    control.markAsTouched();
    await settle();
    expect(host.querySelector('#single [role=combobox]')!.getAttribute('aria-invalid')).toBe(
      'true',
    );
  });
  it('supports multi-select checkboxes, chips and clear', async () => {
    await open('#multi .gdv-select-trigger');
    options()[0]!.click();
    options()[1]!.click();
    options()[3]!.click();
    await settle();
    expect(f.componentInstance.form.controls.multi.value).toEqual(['a', 'b', 'd']);
    expect(host.querySelectorAll('.gdv-option-checkbox.checked').length).toBe(3);
    expect(host.querySelector('#multi .gdv-select-chips')!.textContent).toContain('+1');
    host.querySelector<HTMLButtonElement>('#multi .gdv-select-clear')!.click();
    await settle();
    expect(f.componentInstance.form.controls.multi.value).toEqual([]);
  });
  it('searches labels, descriptions and groups without changing a selection', async () => {
    await open('#single .gdv-select-trigger');
    const input = host.querySelector<HTMLInputElement>('.gdv-select-search input')!;
    expect(document.activeElement).toBe(input);
    input.value = 'loyalty';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(options().length).toBe(1);
    expect(options()[0]!.textContent).toContain('Beta');
    expect(f.componentInstance.form.controls.single.value).toBeNull();
    input.value = 'missing';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(host.textContent).toContain('No options found.');
  });
  it('supports keyboard navigation, skips disabled entries and does not submit the form', async () => {
    await open('#single .gdv-select-trigger');
    const input = host.querySelector<HTMLInputElement>('.gdv-select-search input')!;
    key(input, 'Home');
    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    await settle();
    expect(input.getAttribute('aria-activedescendant')).toContain('-3');
    key(input, 'Enter');
    await settle();
    expect(f.componentInstance.form.controls.single.value).toBe('d');
    expect(document.activeElement).toBe(host.querySelector('#single .gdv-select-trigger'));
  });
  it('closes on outside pointer and Escape and leaves the next Tab target available', async () => {
    await open('#single .gdv-select-trigger');
    key(host.querySelector<HTMLInputElement>('.gdv-select-search input')!, 'Escape');
    await settle();
    expect(panel()).toBeNull();
    await open('#single .gdv-select-trigger');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await settle();
    expect(panel()).toBeNull();
    await open('#single .gdv-select-trigger');
    key(host.querySelector<HTMLInputElement>('.gdv-select-search input')!, 'Tab');
    await settle();
    expect(panel()).toBeNull();
  });
  it('reflects async options and retains the original programmatic value', async () => {
    f.componentInstance.asyncOptions = [
      { value: 'one', label: 'First' },
      { value: 'two', label: 'Second' },
    ];
    await settle();
    expect(host.querySelector('#async + app-select .gdv-select-value')!.textContent).toContain(
      'Second',
    );
    f.componentInstance.asyncValue = 'one';
    await settle();
    expect(host.querySelector('#async + app-select .gdv-select-value')!.textContent).toContain(
      'First',
    );
  });
  it('keeps editable suggestions editable and emits exact custom text', async () => {
    const input = host.querySelector<HTMLInputElement>('#custom + app-select input')!;
    expect(input.value).toBe('Custom category');
    input.value = 'Independent studio';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(f.componentInstance.form.controls.custom.value).toBe('Independent studio');
    input.value = 'Cafe';
    input.dispatchEvent(new Event('input'));
    await settle();
    options()[0]!.click();
    await settle();
    expect(f.componentInstance.form.controls.custom.value).toBe('Cafe');
  });
  it('keeps filters and their default-empty reset behavior unchanged', async () => {
    await open('#filter + app-select .gdv-select-trigger');
    options()[1]!.click();
    await settle();
    expect(f.componentInstance.filter).toBe('active');
    expect(f.componentInstance.filtered).toBe(1);
    host.querySelector<HTMLButtonElement>('#filter + app-select .gdv-select-clear')!.click();
    await settle();
    expect(f.componentInstance.filter).toBe('');
    expect(f.componentInstance.filtered).toBe(2);
  });
  it('shows loading, error, disabled and option metadata states', async () => {
    f.componentInstance.loading = true;
    f.componentInstance.error = 'Could not load offers';
    await settle();
    await open('#single .gdv-select-trigger');
    expect(panel().textContent).toContain('Loading options...');
    expect(options().length).toBe(0);
    key(host.querySelector<HTMLInputElement>('.gdv-select-search input')!, 'Escape');
    await settle();
    f.componentInstance.loading = false;
    await settle();
    await open('#single .gdv-select-trigger');
    expect(host.querySelector('.gdv-select-group')!.textContent).toBe('Promotions');
    expect(host.querySelector('.gdv-option-description')!.textContent).toBe('Weekend offer');
    expect(options()[0]!.querySelector('app-icon')).not.toBeNull();
    f.componentInstance.form.controls.single.disable();
    await settle();
    expect(
      host.querySelector<HTMLButtonElement>('#single .gdv-select-trigger')!.disabled,
    ).toBeTrue();
  });
  it('bounds initial rendering for long lists and keeps every option reachable by search', async () => {
    f.componentInstance.options = Array.from({ length: 2000 }, (_, i) => ({
      value: String(i),
      label: 'Customer ' + i,
    }));
    await settle();
    await open('#single .gdv-select-trigger');
    expect(options().length).toBe(80);
    const input = host.querySelector<HTMLInputElement>('.gdv-select-search input')!;
    input.value = 'Customer 1999';
    input.dispatchEvent(new Event('input'));
    await settle();
    expect(options().length).toBe(1);
    options()[0]!.click();
    await settle();
    expect(f.componentInstance.form.controls.single.value).toBe('1999');
  });
  it('opens in the top layer inside a clipped modal and Escape closes only the dropdown', async () => {
    f.componentInstance.modal = true;
    await settle();
    await open('#modal-select + app-select .gdv-select-trigger');
    expect(panel().matches(':popover-open')).toBeTrue();
    expect(panel().closest('[role=dialog]')).not.toBeNull();
    const box = panel().getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.bottom).toBeLessThanOrEqual(innerHeight - 8);
    expect(panel().dataset['placement']).toBe('top');
    key(
      host.querySelector<HTMLElement>('#modal-select + app-select .gdv-select-trigger')!,
      'Escape',
    );
    await settle();
    expect(f.componentInstance.modal).toBeTrue();
    expect(panel()).toBeNull();
  });
  for (const width of [390, 768, 1280]) {
    it('clamps edge positioning and wraps long labels at ' + width + 'px', async () => {
      f.componentInstance.options = [
        { value: 'a', label: 'A very long customer-facing option label '.repeat(12) },
      ];
      await settle();
      const trigger = host.querySelector<HTMLElement>('#single .gdv-select-trigger')!;
      spyOnProperty(window.visualViewport!, 'width', 'get').and.returnValue(width);
      spyOn(trigger, 'getBoundingClientRect').and.returnValue(
        new DOMRect(width - 150, innerHeight - 60, 142, 44),
      );
      await open('#single .gdv-select-trigger');
      f.debugElement.query(By.directive(DropdownPanel)).injector.get(DropdownPanel).position();
      const box = panel().getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(8);
      expect(box.right).toBeLessThanOrEqual(width - 8);
      expect(panel().scrollWidth).toBeLessThanOrEqual(panel().clientWidth);
      expect(options()[0]!.textContent).toContain('customer-facing');
    });
  }
  it('shares accessible menu semantics while keeping callbacks and disabled actions intact', async () => {
    await open('app-action-menu > button');
    const menu = host.querySelector<HTMLElement>('[role=menu]')!;
    expect(menu.matches(':popover-open')).toBeTrue();
    expect(document.activeElement?.textContent).toContain('Run action');
    key(document.activeElement as HTMLElement, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('Help');
    key(document.activeElement as HTMLElement, 'Escape');
    await settle();
    expect(host.querySelector('[role=menu]')).toBeNull();
    await open('app-action-menu > button');
    host.querySelector<HTMLButtonElement>('[role=menuitem]')!.click();
    await settle();
    expect(f.componentInstance.actions).toBe(1);
    expect(host.querySelector('[role=menu]')).toBeNull();
  });
});
