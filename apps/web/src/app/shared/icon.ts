import { Component, input } from '@angular/core';
export type IconName =
  | 'gift'
  | 'ticket'
  | 'send'
  | 'dashboard'
  | 'responses'
  | 'contacts'
  | 'form'
  | 'qr'
  | 'business'
  | 'logout'
  | 'menu'
  | 'close'
  | 'star'
  | 'eye'
  | 'copy'
  | 'download'
  | 'search'
  | 'check'
  | 'printer'
  | 'plus'
  | 'sun'
  | 'moon'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-left'
  | 'chevron-right'
  | 'arrow-right'
  | 'arrow-left'
  | 'arrow-up'
  | 'arrow-down'
  | 'trash'
  | 'external'
  | 'sparkles'
  | 'refresh'
  | 'alert'
  | 'info'
  | 'check-circle'
  | 'grip'
  | 'shield'
  | 'edit'
  | 'filter'
  | 'calendar'
  | 'zap'
  | 'user'
  | 'mail'
  | 'phone'
  | 'trending-up'
  | 'link'
  | 'settings'
  | 'display'
  | 'palette';
/** Locally bundled Bootstrap Icons; labels belong to the surrounding control. */
@Component({
  selector: 'app-icon',
  host: { class: 'inline-flex shrink-0' },
  template: `<svg
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <use [attr.href]="'/assets/bootstrap-icons.svg#' + name()" />
  </svg>`,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(20);
  readonly stroke = input(1.8);
}
