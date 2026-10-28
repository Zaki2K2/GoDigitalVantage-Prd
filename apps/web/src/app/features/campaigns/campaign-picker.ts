import { HttpClient } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, finalize } from 'rxjs';
import { Page, Pagination } from '../../core/feedback/feedback.service';
import { apiErrorMessage } from '../../core/auth/auth.service';
interface Choice {
  id?: string;
  _id?: string;
  name?: string;
  fullName?: string;
  email?: string;
  emailLowercase?: string;
  phone?: string;
  phoneE164?: string;
}
/** Searches existing authorized list APIs; selected contacts always require an explicit tenant. */
@Component({
  selector: 'app-campaign-picker',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <div class="field grow">
        <label [for]="'picker-' + resource">Search {{ resource }}</label
        ><input
          [id]="'picker-' + resource"
          [(ngModel)]="search"
          [ngModelOptions]="{ standalone: true }"
        />
      </div>
      <button type="button" class="btn secondary sm" [disabled]="loading()" (click)="load()">
        Search
      </button>
    </div>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (loading()) {
      <p role="status">Loading {{ resource }}…</p>
    }
    <p class="muted">{{ selected.length }} selected</p>
    <ul class="rows">
      @for (row of rows(); track key(row)) {
        <li>
          <button
            type="button"
            class="list-row"
            [class.sel]="selected.includes(key(row))"
            [attr.aria-pressed]="selected.includes(key(row))"
            [disabled]="disabled"
            (click)="choose(row)"
          >
            <span class="main"
              ><strong>{{
                row.name ||
                  row.fullName ||
                  row.email ||
                  row.emailLowercase ||
                  row.phone ||
                  row.phoneE164
              }}</strong
              ><span class="muted">{{ row.email || row.emailLowercase }}</span></span
            >
            @if (selected.includes(key(row))) {
              <span class="badge brand">Selected</span>
            }
          </button>
        </li>
      } @empty {
        <li class="muted">No {{ resource }} found.</li>
      }
    </ul>
    @if (pagination(); as p) {
      <nav class="pager" [attr.aria-label]="resource + ' selection pages'">
        <button
          type="button"
          class="btn secondary sm"
          [disabled]="p.page <= 1 || loading()"
          (click)="load(p.page - 1)"
        >
          Previous</button
        ><span>{{ p.total }} {{ resource }}</span
        ><button
          type="button"
          class="btn secondary sm"
          [disabled]="p.page >= p.totalPages || loading()"
          (click)="load(p.page + 1)"
        >
          Next
        </button>
      </nav>
    }
  `,
})
export class CampaignPicker implements OnChanges {
  @Input() resource: 'businesses' | 'contacts' = 'businesses';
  @Input() businessId = '';
  @Input() admin = false;
  @Input() selected: string[] = [];
  @Input() multiple = false;
  @Input() disabled = false;
  @Output() selectionChange = new EventEmitter<string[]>();
  private http = inject(HttpClient);
  private destroy = inject(DestroyRef);
  private request?: Subscription;
  protected search = '';
  protected loading = signal(false);
  protected error = signal('');
  protected rows = signal<Choice[]>([]);
  protected pagination = signal<Pagination | null>(null);
  ngOnChanges(changes: SimpleChanges) {
    if (changes['resource'] || changes['businessId'] || changes['admin']) this.load();
  }
  protected key(row: Choice) {
    return row.id ?? row._id ?? '';
  }
  protected choose(row: Choice) {
    const id = this.key(row);
    this.selectionChange.emit(
      this.multiple
        ? this.selected.includes(id)
          ? this.selected.filter((v) => v !== id)
          : [...this.selected, id]
        : [id],
    );
  }
  protected load(page = 1) {
    if (this.resource === 'contacts' && !this.businessId) return;
    if (this.resource === 'contacts' && this.admin) {
      // Platform administrators never browse a business's customers; the API refuses it as well.
      this.request?.unsubscribe();
      this.rows.set([]);
      this.pagination.set(null);
      this.error.set(
        'Individual customers belong to the business and are not visible to platform administrators. Use a segment, tag or all-customers audience instead.',
      );
      return;
    }
    this.request?.unsubscribe();
    this.loading.set(true);
    this.error.set('');
    const url =
      this.resource === 'businesses'
        ? '/api/v1/admin/businesses'
        : `/api/v1/businesses/${this.businessId}/contacts`;
    this.request = this.http
      .get<Page<Choice>>(url, {
        params: {
          page,
          pageSize: 10,
          search: this.search,
          ...(this.resource === 'businesses' ? { status: 'active' } : {}),
        },
      })
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (r) => {
          this.rows.set(r.data);
          this.pagination.set(r.pagination);
        },
        error: (e) => this.error.set(apiErrorMessage(e)),
      });
  }
}
