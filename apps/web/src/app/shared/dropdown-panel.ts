import {
  Directive,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  NgZone,
  OnDestroy,
  OnInit,
  Output,
  inject,
} from '@angular/core';

/** Top-layer positioning shared by selects and action menus. The DOM stays inside its dialog. */
@Directive({
  selector: '[appDropdownPanel]',
  host: { popover: 'manual', class: 'gdv-dropdown-panel' },
})
export class DropdownPanel implements OnInit, OnDestroy {
  @Input({ required: true }) dropdownAnchor!: HTMLElement;
  @Input() dropdownMinWidth = 220;
  @Output() dropdownReady = new EventEmitter<void>();
  @Output() dropdownDismiss = new EventEmitter<void>();
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private observer?: ResizeObserver;
  private frame = 0;
  private destroyed = false;
  private readonly viewport = window.visualViewport;
  private readonly reposition = (event?: Event) => {
    if (event?.target instanceof Node && this.element.contains(event.target)) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.position());
  };
  ngOnInit() {
    this.zone.runOutsideAngular(() => {
      window.addEventListener('scroll', this.reposition, true);
      window.addEventListener('resize', this.reposition);
      this.viewport?.addEventListener('resize', this.reposition);
      this.viewport?.addEventListener('scroll', this.reposition);
      this.observer = new ResizeObserver(() => this.reposition());
      this.observer.observe(this.dropdownAnchor);
      this.observer.observe(this.element);
    });
    queueMicrotask(() => {
      if (this.destroyed) return;
      this.element.showPopover?.();
      this.position();
      this.dropdownReady.emit();
    });
  }
  position() {
    if (this.destroyed) return;
    const rect = this.dropdownAnchor.getBoundingClientRect();
    const x = this.viewport?.offsetLeft ?? 0,
      y = this.viewport?.offsetTop ?? 0;
    const width = this.viewport?.width ?? innerWidth,
      height = this.viewport?.height ?? innerHeight;
    if (rect.bottom < y || rect.top > y + height || rect.right < x || rect.left > x + width) {
      this.zone.run(() => this.dropdownDismiss.emit());
      return;
    }
    const panelWidth = Math.min(Math.max(rect.width, this.dropdownMinWidth), width - 16);
    this.element.style.width = `${panelWidth}px`;
    const below = y + height - rect.bottom - 14,
      above = rect.top - y - 14;
    const desired = Math.min(380, this.element.scrollHeight + 2);
    const up = below < desired && above > below;
    this.element.style.maxHeight = `${Math.max(48, Math.min(380, up ? above : below))}px`;
    this.element.dataset['placement'] = up ? 'top' : 'bottom';
    const panelHeight = this.element.getBoundingClientRect().height;
    this.element.style.left = `${Math.max(x + 8, Math.min(rect.left, x + width - panelWidth - 8))}px`;
    this.element.style.top = `${Math.max(y + 8, Math.min(up ? rect.top - panelHeight - 6 : rect.bottom + 6, y + height - panelHeight - 8))}px`;
  }
  @HostListener('document:pointerdown', ['$event'])
  outside(event: PointerEvent) {
    if (
      event.target instanceof Node &&
      !this.element.contains(event.target) &&
      !this.dropdownAnchor.contains(event.target)
    )
      this.dropdownDismiss.emit();
  }
  ngOnDestroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    window.removeEventListener('scroll', this.reposition, true);
    window.removeEventListener('resize', this.reposition);
    this.viewport?.removeEventListener('resize', this.reposition);
    this.viewport?.removeEventListener('scroll', this.reposition);
    this.element.hidePopover?.();
  }
}
