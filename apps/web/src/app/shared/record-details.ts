import { Component, input } from '@angular/core';
/** Read-only structured inspection, shared across platform entities. */
@Component({
  selector: 'app-record-details',
  template: `
    <dl class="grid gap-3 sm:grid-cols-2">
      @for (entry of entries(value()); track entry[0]) {
        <div class="min-w-0 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <dt class="text-theme-xs text-gray-500">{{ label(entry[0]) }}</dt>
          <dd class="m-0 mt-1 break-words text-theme-sm">
            @if (nested(entry[1])) {
              <app-record-details [value]="entry[1]" />
            } @else {
              {{ display(entry[1]) }}
            }
          </dd>
        </div>
      } @empty {
        <p class="sub">No details recorded.</p>
      }
    </dl>
  `,
})
export class RecordDetails {
  readonly value = input<unknown>();
  protected entries(value: unknown): [string, unknown][] {
    return value && typeof value === 'object'
      ? Object.entries(value).filter(([key]) => key !== '__v')
      : [];
  }
  protected nested(value: unknown): boolean {
    return value !== null && typeof value === 'object';
  }
  protected label(key: string): string {
    return key
      .replace(/^_id$/, 'ID')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replaceAll('_', ' ')
      .replace(/^./, (character) => character.toUpperCase());
  }
  protected display(value: unknown): string {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value))
      return new Date(value).toLocaleString();
    return String(value);
  }
}
