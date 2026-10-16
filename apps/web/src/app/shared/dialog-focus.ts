import { DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  Directive,
  ElementRef,
  HostListener,
  OnDestroy,
  inject,
} from '@angular/core';

/** Keyboard focus stays in a modal drawer and returns to its opener when dismissed. */
@Directive({ selector: '[appDialogFocus]' })
export class DialogFocus implements AfterViewInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly opener = this.document.activeElement;
  private readonly previousOverflow = this.document.body.style.overflow;

  ngAfterViewInit(): void {
    this.document.body.style.overflow = 'hidden';
    this.element.tabIndex = -1;
    this.focusFirst();
  }

  private controls(): HTMLElement[] {
    return Array.from(
      this.element.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (element) => element.getClientRects().length > 0 && !element.closest('[hidden], [inert]'),
    );
  }

  private focusFirst(): void {
    (this.controls()[0] ?? this.element).focus({ preventScroll: true });
  }

  @HostListener('document:focusin', ['$event'])
  protected containFocus(event: FocusEvent): void {
    if (event.target instanceof Node && !this.element.contains(event.target)) this.focusFirst();
  }

  @HostListener('keydown', ['$event'])
  protected tab(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const controls = this.controls();
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) {
      event.preventDefault();
      this.element.focus();
    } else if (
      event.shiftKey &&
      (this.document.activeElement === first || this.document.activeElement === this.element)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  ngOnDestroy(): void {
    this.document.body.style.overflow = this.previousOverflow;
    const opener = this.opener;
    queueMicrotask(() => {
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    });
  }
}
