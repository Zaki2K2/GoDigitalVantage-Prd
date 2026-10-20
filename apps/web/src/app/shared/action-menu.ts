import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Input,
  inject,
  signal,
} from '@angular/core';
import { DropdownPanel } from './dropdown-panel';
import { Icon } from './icon';

let nextMenu = 0;

/** Project real buttons/links: their handlers, permissions and confirmation flows remain unchanged. */
@Component({
  selector: 'app-action-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DropdownPanel, Icon],
  template: `
    <button
      #anchor
      type="button"
      [class]="triggerClass"
      aria-haspopup="menu"
      [attr.aria-label]="ariaLabel || label"
      [attr.aria-expanded]="opened()"
      [attr.aria-controls]="opened() ? menuId : null"
      (click)="toggle()"
    >
      @if (iconOnly) {
        <app-icon name="chevron-down" [size]="18" />
      } @else if (customTrigger) {
        <ng-content select="[menuTrigger]" />
      } @else {
        {{ label }}<app-icon name="chevron-down" [size]="14" />
      }
    </button>
    @if (opened()) {
      <div
        appDropdownPanel
        [dropdownAnchor]="anchor"
        (dropdownDismiss)="close(false)"
        (dropdownReady)="ready()"
        [id]="menuId"
        role="menu"
        tabindex="-1"
        (keydown)="key($event); $event.stopPropagation()"
        [attr.aria-label]="label"
        class="gdv-action-menu"
        (click)="activate($event)"
      >
        <ng-content />
      </div>
    }
  `,
  host: { class: 'gdv-action-menu-host' },
})
export class ActionMenu {
  @Input() label = 'Actions';
  @Input() ariaLabel = '';
  @Input() iconOnly = false;
  protected readonly menuId = `gdv-menu-${++nextMenu}`;
  @Input() customTrigger = false;
  @Input() triggerClass = 'btn secondary sm';
  protected readonly opened = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private opener?: HTMLElement;
  private focusLast = false;
  constructor() {
    this.host.addEventListener(
      'click',
      (event) => {
        if ((event.target as HTMLElement).closest('[role="menuitem"]'))
          this.opener?.focus({ preventScroll: true });
      },
      true,
    );
  }
  protected toggle() {
    if (this.opened()) {
      this.close();
      return;
    }
    this.opener = this.host.querySelector('button')!;
    this.opened.set(true);
  }
  protected ready() {
    const items = this.items();
    (this.focusLast ? items[items.length - 1] : items[0])?.focus();
    this.focusLast = false;
  }
  private items() {
    const items = Array.from(
      this.host.querySelectorAll<HTMLElement>('[role="menu"] button, [role="menu"] a[href]'),
    );
    for (const item of items) {
      item.setAttribute('role', 'menuitem');
      item.tabIndex = -1;
      if (item.matches(':disabled')) item.setAttribute('aria-disabled', 'true');
    }
    return items.filter((item) => !item.matches(':disabled, [aria-disabled="true"]'));
  }
  close(restore = true) {
    if (!this.opened()) return;
    this.host.querySelector<HTMLElement>('[popover]')?.hidePopover?.();
    this.opened.set(false);
    if (restore) {
      this.opener?.focus();
      queueMicrotask(() => {
        if (
          this.opener?.isConnected &&
          (document.activeElement === document.body || this.host.contains(document.activeElement))
        )
          this.opener.focus({ preventScroll: true });
      });
    }
  }
  protected activate(event: MouseEvent) {
    if ((event.target as HTMLElement).closest('button:not(:disabled), a[href]')) this.close();
  }
  @HostListener('keydown', ['$event'])
  key(event: KeyboardEvent) {
    if (!this.opened()) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.focusLast = event.key === 'ArrowUp';
        this.toggle();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key === 'Tab') {
      this.close();
      return;
    }
    const items = this.items();
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    ]?.focus();
  }
}
