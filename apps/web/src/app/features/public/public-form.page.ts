import { Avatar } from '../../shared/avatar';
import { RewardCard } from '../../shared/reward-card';
import { requestId } from '../../shared/request-id';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnChanges,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { apiErrorMessage } from '../../core/auth/auth.service';
import {
  FeedbackApi,
  Submission,
  SubmissionAnswer,
  SubmissionIssue,
  SubmissionResult,
} from '../../core/feedback/feedback.service';
import { PublicForm, QuestionnaireApi } from '../../core/questionnaire/questionnaire.service';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+[1-9]\d{7,14}$/;
const MAX_SHORT = 300;
const MAX_LONG = 2000;

/** Matches the server's phone normalisation so errors show before sending. */
export function phoneLooksValid(raw: string): boolean {
  let v = raw.trim().replace(/[\s().-]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  return PHONE.test(v);
}

/**
 * Anonymous page opened from the QR code. No login. Contact details and text-message permission
 * are optional; permission boxes start unticked and are never implied by submitting feedback.
 */
@Component({
  selector: 'app-public-form-page',
  imports: [Avatar, RewardCard],
  templateUrl: './public-form.page.html',
})
export class PublicFormPage implements OnChanges {
  private readonly forms = inject(QuestionnaireApi);
  private readonly feedback = inject(FeedbackApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private formRequest?: Subscription;
  private submissionRequest?: Subscription;

  /** Bound from the `:slug` route parameter. */
  readonly slug = input.required<string>();

  protected readonly form = signal<PublicForm | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  protected readonly submitting = signal(false);
  protected readonly result = signal<SubmissionResult | null>(null);
  protected readonly formError = signal<string | null>(null);
  /** Field errors keyed by question id, or `contact.email`, `contact.phone`, `contact`, `consent`. */
  protected readonly errors = signal<Record<string, string>>({});

  protected readonly text = signal<Record<string, string>>({});
  protected readonly rating = signal<Record<string, number>>({});
  protected readonly picked = signal<Record<string, string[]>>({});
  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly phone = signal('');
  protected readonly reviewSms = signal(false);
  protected readonly marketingSms = signal(false);
  protected readonly whatsappFollowUp = signal(false);
  protected readonly honeypot = signal('');
  protected readonly stars = [1, 2, 3, 4, 5];
  protected readonly progress = computed(() => {
    const questions = this.form()?.questionnaire.questions ?? [];
    const answered = questions.filter((question) => {
      const id = question.id ?? '';
      return !!this.text()[id]?.trim() || !!this.rating()[id] || !!this.picked()[id]?.length;
    }).length;
    return {
      answered,
      total: questions.length,
      percent: questions.length ? Math.round((answered / questions.length) * 100) : 0,
    };
  });

  /** One key per page load: retries and double clicks can never create a second response. */
  private idempotencyKey = requestId();

  ngOnChanges(): void {
    this.submissionRequest?.unsubscribe();
    this.form.set(null);
    this.result.set(null);
    this.formError.set(null);
    this.errors.set({});
    this.text.set({});
    this.rating.set({});
    this.picked.set({});
    this.name.set('');
    this.email.set('');
    this.phone.set('');
    this.reviewSms.set(false);
    this.marketingSms.set(false);
    this.whatsappFollowUp.set(false);
    this.honeypot.set('');
    this.submitting.set(false);
    this.idempotencyKey = requestId();
    this.load();
  }

  protected load(): void {
    this.state.set('loading');
    this.formRequest?.unsubscribe();
    const slug = this.slug();
    this.formRequest = this.forms
      .publicForm(slug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (f) => {
          this.form.set(f);
          this.state.set('ready');
          // One count per real page load; analytics failures never affect the visitor.
          this.feedback
            .scan(slug)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({ error: () => undefined });
        },
        error: (err: unknown) => {
          this.state.set(
            err instanceof HttpErrorResponse && err.status === 404 ? 'unavailable' : 'error',
          );
        },
      });
  }

  protected describedBy(
    index: number,
    help: string | null | undefined,
    id: string | undefined,
  ): string | null {
    return (
      [help ? `h-${index}` : '', this.errors()[id ?? ''] ? `e-${index}` : '']
        .filter(Boolean)
        .join(' ') || null
    );
  }

  private focusInvalid(): void {
    afterNextRender(
      () => {
        const invalid = this.element.querySelector<HTMLElement>('[aria-invalid="true"]');
        const target = invalid?.matches('fieldset')
          ? invalid.querySelector<HTMLElement>('input, textarea')
          : invalid;
        (target ?? this.element.querySelector<HTMLElement>('[data-form-error]'))?.focus();
      },
      { injector: this.injector },
    );
  }

  protected textOf(id: string | undefined): string {
    return this.text()[id ?? ''] ?? '';
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected chk(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  protected setText(id: string, value: string): void {
    this.text.update((m) => ({ ...m, [id]: value }));
    this.clear(id);
    this.clear('answers');
  }

  protected setRating(id: string, value: number): void {
    this.rating.update((m) => ({ ...m, [id]: value }));
    this.clear(id);
    this.clear('answers');
  }

  protected setSingle(id: string, choiceId: string): void {
    this.picked.update((m) => ({ ...m, [id]: [choiceId] }));
    this.clear(id);
    this.clear('answers');
  }

  protected toggleMulti(id: string, choiceId: string, on: boolean): void {
    this.picked.update((m) => {
      const rest = (m[id] ?? []).filter((c) => c !== choiceId);
      return { ...m, [id]: on ? [...rest, choiceId] : rest };
    });
    this.clear(id);
    this.clear('answers');
  }

  protected isPicked(id: string, choiceId: string): boolean {
    return (this.picked()[id] ?? []).includes(choiceId);
  }

  protected setPhone(value: string): void {
    this.phone.set(value);
    if (!value.trim()) {
      // Text-message permission only makes sense with a number.
      this.reviewSms.set(false);
      this.marketingSms.set(false);
      this.whatsappFollowUp.set(false);
    }
    this.clear('contact.phone');
    this.clear('contact');
    this.clear('consent');
  }

  protected setContact(field: 'name' | 'email', value: string): void {
    (field === 'name' ? this.name : this.email).set(value);
    this.clear(field === 'email' ? 'contact.email' : 'contact');
    this.clear('contact');
  }

  private clear(key: string): void {
    if (this.errors()[key]) {
      this.errors.update(({ [key]: _gone, ...rest }) => rest);
    }
  }

  protected submit(): void {
    const f = this.form();
    if (!f || this.submitting() || this.result()) return;
    const { errors, answers } = this.collect(f);
    this.errors.set(errors);
    this.formError.set(null);
    if (Object.keys(errors).length > 0) {
      this.formError.set('Please fix the highlighted fields.');
      this.focusInvalid();
      return;
    }

    const body: Submission = {
      idempotencyKey: this.idempotencyKey,
      version: f.questionnaire.version,
      answers,
      website: this.honeypot(),
    };
    const phone = this.phone().trim();
    const email = this.email().trim();
    const name = this.name().trim();
    if (phone || email || name) {
      body.contact = { fullName: name, email, phone };
      body.consent = {
        reviewRequestSms: this.reviewSms(),
        marketingSms: this.marketingSms(),
        whatsappFollowUp: this.whatsappFollowUp(),
      };
    }

    this.submitting.set(true);
    this.submissionRequest = this.feedback
      .submit(this.slug(), body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.result.set(r);
          this.submitting.set(false);
          afterNextRender(
            () => this.element.querySelector<HTMLElement>('[data-confirmation]')?.focus(),
            { injector: this.injector },
          );
        },
        error: (err: unknown) => {
          this.submitting.set(false);
          this.showServerError(err);
        },
      });
  }

  private collect(f: PublicForm) {
    const errors: Record<string, string> = {};
    const answers: SubmissionAnswer[] = [];
    for (const q of f.questionnaire.questions) {
      const id = q.id ?? '';
      if (q.type === 'short_text' || q.type === 'long_text') {
        const t = (this.text()[id] ?? '').trim();
        const max = q.type === 'short_text' ? MAX_SHORT : MAX_LONG;
        if (t.length > max) errors[id] = `Please keep this under ${max} characters`;
        else if (t) answers.push({ questionId: id, text: t });
        else if (q.required) errors[id] = 'This question is required';
      } else if (q.type === 'rating') {
        const r = this.rating()[id];
        if (r) answers.push({ questionId: id, rating: r });
        else if (q.required) errors[id] = 'This question is required';
      } else {
        const ids = this.picked()[id] ?? [];
        if (ids.length) answers.push({ questionId: id, choiceIds: ids });
        else if (q.required) errors[id] = 'This question is required';
      }
    }
    if (answers.length === 0 && Object.keys(errors).length === 0) {
      errors['answers'] = 'Please answer at least one question';
    }

    const email = this.email().trim();
    const phone = this.phone().trim();
    if (email && !EMAIL.test(email)) errors['contact.email'] = 'Enter a valid email address';
    if (phone && !phoneLooksValid(phone)) {
      errors['contact.phone'] = 'Enter a phone number with country code, e.g. +14155550123';
    }
    if (this.name().trim() && !email && !phone) {
      errors['contact'] = 'Add an email or phone number, or clear your name to stay anonymous';
    }
    if ((this.reviewSms() || this.marketingSms() || this.whatsappFollowUp()) && !phone) {
      errors['consent'] = 'Text message permission needs a phone number';
    }
    return { errors, answers };
  }

  private showServerError(err: unknown): void {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as {
        error?: { code?: string; details?: { issues?: SubmissionIssue[] } };
      } | null;
      const issues = body?.error?.details?.issues;
      if (err.status === 422 && issues?.length) {
        const map: Record<string, string> = {};
        for (const i of issues) map[i.questionId ?? i.field] = i.message;
        this.errors.set(map);
        this.formError.set('Please fix the highlighted fields.');
        this.focusInvalid();
        return;
      }
      if (err.status === 429) {
        this.formError.set('Too many submissions from this connection. Please try again later.');
        return;
      }
      if (err.status === 404) {
        this.formError.set('This form is no longer available.');
        return;
      }
    }
    this.formError.set(apiErrorMessage(err));
  }
}
