import { Component, computed, input, signal } from '@angular/core';

/**
 * User photo or business logo with an initials fallback. The initials tile is always rendered
 * underneath; the image only fades in once it has actually loaded, so a missing, slow or broken
 * image never shows a broken icon or an empty box.
 */
@Component({
  selector: 'app-avatar',
  host: {
    class: 'relative inline-flex shrink-0 overflow-hidden',
    '[class.rounded-full]': 'shape() === "circle"',
    '[class.rounded-2xl]': 'shape() === "square" && size() >= 48',
    '[class.rounded-lg]': 'shape() === "square" && size() < 48',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
  },
  template: `
    <span
      class="flex size-full items-center justify-center bg-gradient-to-br from-brand-500 to-blue-light-500 font-semibold text-white"
      [style.font-size.px]="size() * 0.4"
      aria-hidden="true"
    >
      {{ initials() }}
    </span>
    @if (visibleSrc(); as url) {
      <img
        [src]="url"
        alt=""
        class="absolute inset-0 size-full bg-white transition-opacity duration-200 dark:bg-gray-900"
        [class.object-cover]="shape() === 'circle'"
        [class.object-contain]="shape() === 'square'"
        [class.p-0.5]="shape() === 'square'"
        [class.opacity-0]="loaded() !== url"
        decoding="async"
        (load)="loaded.set(url)"
        (error)="failed.set(url)"
      />
    }
  `,
})
export class Avatar {
  readonly src = input<string | null | undefined>(null);
  readonly name = input('');
  readonly size = input(36);
  /** Circle (people, cropped to fill) or square (business logos, shown whole). */
  readonly shape = input<'circle' | 'square'>('circle');

  protected readonly loaded = signal<string | null>(null);
  protected readonly failed = signal<string | null>(null);

  protected readonly visibleSrc = computed(() => {
    const url = this.src();
    return url && this.failed() !== url ? url : null;
  });

  protected readonly initials = computed(() => {
    const words = this.name().split(/\s+/).filter(Boolean);
    const letters = this.shape() === 'circle' ? words.slice(0, 2) : words.slice(0, 1);
    return (
      letters
        .map((w) => w.charAt(0))
        .join('')
        .toUpperCase() || '?'
    );
  });
}
