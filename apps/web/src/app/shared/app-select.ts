import {
  afterEveryRender,
  ComponentRef,
  DestroyRef,
  Directive,
  ElementRef,
  Input,
  NgZone,
  OnInit,
  ViewContainerRef,
  inject,
} from '@angular/core';
import { NgControl } from '@angular/forms';
import { SelectControl, SelectOption, SelectValue } from './select-control';
import { IconName } from './icon';

let nextLabel = 0;

/** Progressive enhancement: native Angular CVAs, values, options, validators and change handlers stay authoritative. */
@Directive({ selector: 'select[appSelect], input[appSelect][list]' })
export class AppSelect implements OnInit {
  @Input() appSelectLoading = false;
  @Input() appSelectSearchable: boolean | 'auto' = 'auto';
  @Input() appSelectPlaceholder = 'Select an option';
  private readonly source =
    inject<ElementRef<HTMLSelectElement | HTMLInputElement>>(ElementRef).nativeElement;
  private readonly container = inject(ViewContainerRef);
  private readonly control = inject(NgControl, { self: true, optional: true });
  private readonly destroy = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private view?: ComponentRef<SelectControl>;
  private observer?: MutationObserver;
  private dirty = true;
  private optionCount = -1;
  private last = new Map<string, unknown>();
  private originalTabIndex = this.source.getAttribute('tabindex');
  private originalHidden = this.source.getAttribute('aria-hidden');
  constructor() {
    afterEveryRender(() => this.sync());
  }
  ngOnInit() {
    // Older browsers retain the fully functional native control rather than a clipped overlay.
    if (!('showPopover' in HTMLElement.prototype)) return;
    this.source.classList.add('gdv-select-source');
    this.source.tabIndex = -1;
    this.source.setAttribute('aria-hidden', 'true');
    this.view = this.container.createComponent(SelectControl);
    this.view.instance.valueChange.subscribe((value) => this.write(value));
    this.view.instance.touched.subscribe(() => this.source.dispatchEvent(new FocusEvent('blur')));
    const focus = () => this.view?.instance.focus();
    const change = () => this.sync();
    this.source.addEventListener('focus', focus);
    this.source.addEventListener('invalid', focus);
    this.source.addEventListener('change', change);
    this.source.addEventListener('input', change);
    this.zone.runOutsideAngular(() => {
      this.observer = new MutationObserver((records) => {
        this.dirty ||= records.some((r) => r.target !== this.source || r.type !== 'attributes');
        this.zone.run(() => this.sync());
      });
      this.observer.observe(this.source, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      if (this.source instanceof HTMLInputElement && this.source.list)
        this.observer.observe(this.source.list, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
    });
    this.destroy.onDestroy(() => {
      this.observer?.disconnect();
      this.source.removeEventListener('focus', focus);
      this.source.removeEventListener('invalid', focus);
      this.source.removeEventListener('change', change);
      this.source.removeEventListener('input', change);
      this.source.classList.remove('gdv-select-source');
      if (this.originalTabIndex === null) this.source.removeAttribute('tabindex');
      else this.source.setAttribute('tabindex', this.originalTabIndex);
      if (this.originalHidden === null) this.source.removeAttribute('aria-hidden');
      else this.source.setAttribute('aria-hidden', this.originalHidden);
    });
  }
  private set(name: string, value: unknown) {
    if (this.last.get(name) === value) return;
    this.last.set(name, value);
    this.view?.setInput(name, value);
  }
  private sync() {
    if (!this.view) return;
    const native = this.source;
    const select = native instanceof HTMLSelectElement;
    const options = select ? native.options : native.list?.options;
    if ((options?.length ?? 0) !== this.optionCount) this.dirty = true;
    if (this.dirty) {
      this.optionCount = options?.length ?? 0;
      const entries: SelectOption[] = Array.from(options ?? [])
        .filter((o) => !o.hidden)
        .map((o) => ({
          value: select ? String(o.index) : o.value,
          label: o.label || o.textContent?.trim() || o.value,
          description: o.dataset['description'],
          icon: o.dataset['icon'] as IconName | undefined,
          group: o.parentElement instanceof HTMLOptGroupElement ? o.parentElement.label : undefined,
          disabled:
            o.disabled ||
            (o.parentElement instanceof HTMLOptGroupElement && o.parentElement.disabled),
        }));
      this.set('options', entries);
      this.dirty = false;
    }
    const value = select
      ? native.multiple
        ? Array.from(native.selectedOptions).map((o) => String(o.index))
        : native.selectedIndex < 0
          ? null
          : String(native.selectedIndex)
      : native.value;
    const signature = JSON.stringify(value);
    if (this.last.get('selection') !== signature) {
      this.last.set('selection', signature);
      this.set('value', value);
    }
    const labels = Array.from(native.labels ?? [])
      .map((label) => {
        if (!label.id) label.id = `gdv-label-${++nextLabel}`;
        return label.id;
      })
      .join(' ');
    this.set(
      'label',
      native.getAttribute('aria-label') ||
        Array.from(native.labels ?? [])
          .map((l) => l.textContent?.trim())
          .join(' ') ||
        this.appSelectPlaceholder,
    );
    this.set('labelledBy', native.getAttribute('aria-labelledby') || labels || null);
    this.set('describedBy', native.getAttribute('aria-describedby'));
    this.set('disabled', native.matches(':disabled'));
    this.set(
      'invalid',
      native.getAttribute('aria-invalid') === 'true' ||
        native.classList.contains('invalid') ||
        !!(this.control?.invalid && (this.control.touched || this.control.dirty)),
    );
    this.set('loading', this.appSelectLoading);
    this.set('required', native.required);
    this.set('multiple', select && native.multiple);
    this.set('allowCustom', !select);
    this.set('maxLength', !select && native.maxLength >= 0 ? native.maxLength : 524288);
    this.set('placeholder', native.getAttribute('placeholder') || this.appSelectPlaceholder);
    this.set(
      'clearable',
      !select ||
        native.multiple ||
        (native.value !== '' &&
          Array.from(native.options).some((o) => !o.disabled && o.value === '')),
    );
    this.set(
      'searchable',
      this.appSelectSearchable === 'auto' ? (options?.length ?? 0) > 7 : this.appSelectSearchable,
    );
  }
  private write(value: SelectValue | SelectValue[]) {
    const native = this.source;
    if (native instanceof HTMLSelectElement) {
      for (const option of Array.from(native.options))
        option.selected = Array.isArray(value)
          ? value.includes(String(option.index))
          : String(option.index) === value;
      if (value === null) {
        const empty = Array.from(native.options).find((o) => o.value === '' && !o.disabled);
        native.selectedIndex = empty?.index ?? -1;
      }
      native.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      native.value = String(value ?? '');
      native.dispatchEvent(new Event('input', { bubbles: true }));
      native.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.sync();
  }
}
