import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  DestroyRef,
  AfterViewInit,
  EventEmitter,
  HostListener,
  Input,
  Injector,
  Output,
  computed,
  forwardRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, NgControl, Validators } from '@angular/forms';
import { Icon, IconName } from './icon';
import { DropdownPanel } from './dropdown-panel';

export type SelectValue = string | number | boolean | null;
export interface SelectOption {
  value: SelectValue;
  label: string;
  description?: string;
  icon?: IconName;
  group?: string;
  disabled?: boolean;
}
let nextId = 0;

/** Standalone CVA for new forms; AppSelect enhances existing native value accessors with this same view. */
@Component({
  selector: 'app-select',
  imports: [Icon, DropdownPanel],
  templateUrl: './select-control.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectControl), multi: true },
  ],
  host: { class: 'gdv-select' },
})
export class SelectControl implements ControlValueAccessor, AfterViewInit {
  private readonly optionState = signal<readonly SelectOption[]>([]);
  @Input() set options(options: readonly SelectOption[]) {
    this.optionState.set(options);
  }
  get options() {
    return this.optionState();
  }
  @Input() multiple = false;
  @Input() searchable = true;
  @Input() clearable = true;
  @Input() allowCustom = false;
  private disabledValue = false;
  @Input() set disabled(value: boolean) {
    this.disabledValue = value;
    if (value) this.close(false);
  }
  get disabled() {
    return this.disabledValue;
  }
  @Input() required = false;
  @Input() loading = false;
  @Input() invalid = false;
  @Input() label = 'Choose an option';
  @Input() labelledBy: string | null = null;
  @Input() describedBy: string | null = null;
  @Input() placeholder = 'Select an option';
  @Input() error = '';
  @Input() maxLength = 524288;
  @Input() value: SelectValue | SelectValue[] = null;
  @Output() valueChange = new EventEmitter<SelectValue | SelectValue[]>();
  @Output() touched = new EventEmitter<void>();
  protected readonly uid = `gdv-select-${++nextId}`;
  protected readonly opened = signal(false);
  protected readonly query = signal('');
  protected readonly active = signal(-1);
  protected readonly limit = signal(80);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly trigger = viewChild<ElementRef<HTMLElement>>('trigger');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  private onChange: (value: SelectValue | SelectValue[]) => void = () => {};
  private onTouched = () => {};
  // Input options may change asynchronously; filter on demand with OnPush, never clone/sort source arrays.
  private readonly filteredOptions = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    return query
      ? this.options.filter((o) =>
          `${o.label} ${o.description ?? ''} ${o.group ?? ''}`.toLocaleLowerCase().includes(query),
        )
      : this.options;
  });
  protected get filtered() {
    return this.filteredOptions();
  }
  protected get triggerElement() {
    return this.trigger()!.nativeElement;
  }
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly injector = inject(Injector);
  protected get isRequired() {
    return (
      this.required ||
      !!this.injector
        .get(NgControl, null, { self: true })
        ?.control?.hasValidator(Validators.required)
    );
  }
  protected get isInvalid() {
    const control = this.injector.get(NgControl, null, { self: true });
    return (
      this.invalid || !!this.error || !!(control?.invalid && (control.touched || control.dirty))
    );
  }
  private readonly destroy = inject(DestroyRef);
  ngAfterViewInit() {
    this.injector
      .get(NgControl, null, { self: true })
      ?.control?.events.pipe(takeUntilDestroyed(this.destroy))
      .subscribe(() => this.cdr.markForCheck());
  }
  protected get selected() {
    return this.options.filter((o) => this.isSelected(o));
  }
  protected get display() {
    return (
      this.selected.map((o) => o.label).join(', ') ||
      (this.allowCustom ? String(this.value ?? '') : this.placeholder)
    );
  }
  protected get hasValue() {
    return Array.isArray(this.value)
      ? this.value.length > 0
      : this.value !== null && this.value !== '';
  }
  protected isSelected(option: SelectOption) {
    return Array.isArray(this.value)
      ? this.value.includes(option.value)
      : Object.is(this.value, option.value);
  }
  writeValue(value: SelectValue | SelectValue[]) {
    this.value = value;
    this.cdr.markForCheck();
  }
  registerOnChange(fn: (value: SelectValue | SelectValue[]) => void) {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void) {
    this.onTouched = fn;
  }
  setDisabledState(disabled: boolean) {
    this.disabled = disabled;
    this.cdr.markForCheck();
    if (disabled) this.close(false);
  }
  focus() {
    this.trigger()?.nativeElement.focus();
  }
  protected toggle() {
    if (this.opened()) this.close();
    else this.open();
  }
  open() {
    if (this.disabled || this.opened()) return;
    this.query.set('');
    this.limit.set(80);
    const selected = this.options.findIndex((o) => !o.disabled && this.isSelected(o));
    this.active.set(
      selected >= 0 && selected < 80 ? selected : this.options.findIndex((o) => !o.disabled),
    );
    this.opened.set(true);
  }
  protected panelReady() {
    this.search()?.nativeElement.focus();
    this.revealActive();
  }
  close(restore = true) {
    if (!this.opened()) return;
    this.element.querySelector<HTMLElement>('[popover]')?.hidePopover?.();
    this.opened.set(false);
    this.query.set('');
    this.markTouched();
    if (restore) {
      this.focus();
      queueMicrotask(() => {
        if (
          this.element.isConnected &&
          (document.activeElement === document.body ||
            this.element.contains(document.activeElement))
        )
          this.focus();
      });
    }
  }
  protected choose(option: SelectOption) {
    if (option.disabled || this.disabled || this.loading) return;
    const values = Array.isArray(this.value) ? this.value : [];
    this.commit(
      this.multiple
        ? this.isSelected(option)
          ? values.filter((v) => v !== option.value)
          : [...values, option.value]
        : option.value,
    );
    if (!this.multiple) this.close();
  }
  protected clear() {
    this.commit(this.multiple ? [] : this.allowCustom ? '' : null);
    this.close();
  }
  protected filter(event: Event) {
    this.query.set((event.target as HTMLInputElement).value);
    this.active.set(this.filtered.findIndex((o) => !o.disabled));
    this.limit.set(80);
    if (this.allowCustom) this.commit(this.query());
  }
  protected customInput(event: Event) {
    this.open();
    this.filter(event);
  }
  protected commit(value: SelectValue | SelectValue[]) {
    this.value = value;
    this.onChange(value);
    this.valueChange.emit(value);
  }
  private markTouched() {
    this.onTouched();
    this.touched.emit();
  }
  @HostListener('focusout', ['$event'])
  blur(event: FocusEvent) {
    if (!(event.relatedTarget instanceof Node) || !this.element.contains(event.relatedTarget)) {
      this.close(false);
      this.markTouched();
    }
  }
  @HostListener('keydown', ['$event'])
  key(event: KeyboardEvent) {
    if (this.disabled || event.isComposing) return;
    if (event.key === 'Escape' && this.opened()) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key === 'Tab') {
      this.close(false);
      return;
    }
    if (!this.opened()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key) && !this.allowCustom) {
        event.preventDefault();
        this.open();
      }
      return;
    }
    const options = this.filtered;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (this.allowCustom && ['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1;
      let index = event.key === 'Home' ? -1 : event.key === 'End' ? options.length : this.active();
      for (let n = 0; n < options.length; n++) {
        index = (index + direction + options.length) % options.length;
        if (!options[index]?.disabled) break;
      }
      this.active.set(index);
      this.limit.set(Math.max(80, index + 1));
      this.revealActive();
    } else if (
      event.key === 'Enter' ||
      (event.key === ' ' && event.target === this.trigger()?.nativeElement)
    ) {
      event.preventDefault();
      event.stopPropagation();
      const option = options[this.active()];
      if (option) this.choose(option);
    } else if (
      !this.searchable &&
      !this.allowCustom &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const index = options.findIndex(
        (o) => !o.disabled && o.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()),
      );
      if (index >= 0) {
        this.active.set(index);
        this.limit.set(Math.max(80, index + 1));
        this.revealActive();
      }
    }
  }
  private revealActive() {
    queueMicrotask(() => {
      const option = this.element.querySelector<HTMLElement>(
        `[data-option-index="${this.active()}"]`,
      );
      const list = this.element.querySelector<HTMLElement>('.gdv-select-options');
      if (!option || !list) return;
      const row = option.getBoundingClientRect(),
        viewport = list.getBoundingClientRect();
      if (row.top < viewport.top) list.scrollTop += row.top - viewport.top;
      else if (row.bottom > viewport.bottom) list.scrollTop += row.bottom - viewport.bottom;
    });
  }
}
