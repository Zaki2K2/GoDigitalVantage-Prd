import { Component, computed, inject, input, output, signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { apiErrorMessage } from '../../core/auth/auth.service';
import {
  PublishIssue,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  QuestionType,
  QuestionnaireApi,
  QuestionnaireView,
} from '../../core/questionnaire/questionnaire.service';
import { Icon } from '../../shared/icon';
import { QuestionEditor } from './question-editor';
import { applyType, fillForm, newBuilderForm, newQuestionGroup, toContent } from './question-form';
import { QuestionnaireFormView } from './questionnaire-form-view';

/** Questionnaire manager: edit the draft, preview it, save, and publish a new version. */
@Component({
  selector: 'app-questionnaire-builder',
  imports: [ReactiveFormsModule, QuestionEditor, QuestionnaireFormView, Icon],
  templateUrl: './questionnaire-builder.html',
})
export class QuestionnaireBuilder {
  private readonly api = inject(QuestionnaireApi);

  readonly businessId = input.required<string>();
  /** Members can view but not change the questionnaire. */
  readonly canEdit = input(true);
  /** Emits whether a version is publicly available, on load and after each publish. */
  readonly publishedChange = output<boolean>();

  protected readonly form = newBuilderForm();
  protected readonly types = QUESTION_TYPES;
  protected readonly typeLabels = QUESTION_TYPE_LABELS;

  protected readonly view = signal<QuestionnaireView | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly publishing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly success = signal<string | null>(null);
  protected readonly conflict = signal(false);
  protected readonly previewing = signal(false);
  protected readonly dirty = signal(false);
  protected readonly publishIssues = signal<PublishIssue[]>([]);
  protected readonly preview = signal(toContent(this.form));

  protected readonly busy = computed(() => this.saving() || this.publishing());
  protected readonly canPublish = computed(
    () => this.canEdit() && !this.busy() && (this.dirty() || !!this.view()?.hasUnpublishedChanges),
  );

  constructor() {
    this.form.valueChanges.subscribe(() => {
      this.dirty.set(this.form.dirty);
      this.preview.set(toContent(this.form)); // keeps the live preview in sync
    });
    queueMicrotask(() => this.load());
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.conflict.set(false);
    this.api.get(this.businessId()).subscribe({
      next: (v) => {
        this.apply(v);
        this.loading.set(false);
        this.publishedChange.emit(v.publishedVersion > 0);
      },
      error: (err: unknown) => {
        this.loadError.set(apiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  private apply(v: QuestionnaireView): void {
    this.view.set(v);
    this.publishIssues.set(v.issues);
    fillForm(this.form, v.draft);
    this.dirty.set(false);
    if (!this.canEdit()) this.form.disable({ emitEvent: false });
  }

  protected addQuestion(type: QuestionType): void {
    this.form.controls.questions.push(
      newQuestionGroup({ type, label: '', helpText: null, required: false, choices: [] }),
    );
    this.form.markAsDirty();
    this.dirty.set(true);
    this.success.set(null);
  }

  protected removeQuestion(i: number): void {
    this.form.controls.questions.removeAt(i);
    this.touched();
  }

  protected moveQuestion(i: number, dir: -1 | 1): void {
    const list = this.form.controls.questions;
    const target = i + dir;
    if (target < 0 || target >= list.length) return;
    const item = list.at(i);
    list.removeAt(i);
    list.insert(target, item);
    this.touched();
  }

  protected changeType(i: number, type: QuestionType): void {
    applyType(this.form.controls.questions.at(i), type);
    this.touched();
  }

  private touched(): void {
    this.form.markAsDirty();
    this.dirty.set(true);
    this.success.set(null);
  }

  protected issuesFor(id: string | null): string[] {
    if (!id) return [];
    return this.publishIssues()
      .filter((x) => x.questionId === id)
      .map((x) => x.message);
  }

  protected generalIssues(): string[] {
    return this.publishIssues()
      .filter((x) => x.questionId === null)
      .map((x) => x.message);
  }

  protected togglePreview(): void {
    if (!this.previewing()) this.preview.set(toContent(this.form));
    this.previewing.update((p) => !p);
  }

  protected saveDraft(): void {
    if (this.busy() || !this.canEdit()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Fix the highlighted fields before saving.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.success.set(null);
    this.persist().subscribe({
      next: (v) => {
        this.apply(v);
        this.saving.set(false);
        this.success.set('Draft saved.');
      },
      error: (err: unknown) => this.fail(err, this.saving),
    });
  }

  protected publish(): void {
    if (!this.canPublish()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Fix the highlighted fields before publishing.');
      return;
    }
    this.publishing.set(true);
    this.error.set(null);
    this.success.set(null);
    const saved$ = this.dirty() ? this.persist() : null;
    const run = (v: QuestionnaireView) =>
      this.api.publish(this.businessId(), v.draftRevision).subscribe({
        next: (published) => {
          this.apply(published);
          this.publishing.set(false);
          this.success.set(`Published version ${published.publishedVersion}.`);
          this.publishedChange.emit(true);
        },
        error: (err: unknown) => this.fail(err, this.publishing),
      });
    if (saved$) {
      saved$.subscribe({
        next: (v) => {
          // Re-sync so new questions pick up their server-assigned ids (needed to show issues).
          this.apply(v);
          run(v);
        },
        error: (err: unknown) => this.fail(err, this.publishing),
      });
    } else {
      run(this.view()!);
    }
  }

  private persist() {
    return this.api.saveDraft(this.businessId(), this.view()!.draftRevision, toContent(this.form));
  }

  private fail(err: unknown, flag: { set(v: boolean): void }): void {
    flag.set(false);
    const body = (
      err as { error?: { error?: { code?: string; details?: { issues?: PublishIssue[] } } } }
    ).error?.error;
    this.conflict.set(body?.code === 'REVISION_CONFLICT');
    if (body?.details?.issues) this.publishIssues.set(body.details.issues);
    this.error.set(apiErrorMessage(err));
  }
}
