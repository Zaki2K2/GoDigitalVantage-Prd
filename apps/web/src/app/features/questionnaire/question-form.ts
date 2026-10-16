import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import {
  Choice,
  Question,
  QuestionType,
  QuestionnaireContent,
  isChoiceType,
} from '../../core/questionnaire/questionnaire.service';

export type ChoiceGroup = FormGroup<{
  id: FormControl<string | null>;
  label: FormControl<string>;
}>;

export type QuestionGroup = FormGroup<{
  id: FormControl<string | null>;
  type: FormControl<QuestionType>;
  label: FormControl<string>;
  helpText: FormControl<string>;
  required: FormControl<boolean>;
  choices: FormArray<ChoiceGroup>;
}>;

export type BuilderForm = FormGroup<{
  title: FormControl<string>;
  description: FormControl<string>;
  questions: FormArray<QuestionGroup>;
}>;

export function newChoiceGroup(choice: Choice = { label: '' }): ChoiceGroup {
  return new FormGroup({
    id: new FormControl<string | null>(choice.id ?? null),
    label: new FormControl(choice.label, {
      nonNullable: true,
      validators: [Validators.maxLength(120)],
    }),
  });
}

export function newQuestionGroup(
  q: Question = { type: 'short_text', label: '', helpText: null, required: false, choices: [] },
): QuestionGroup {
  const group: QuestionGroup = new FormGroup({
    id: new FormControl<string | null>(q.id ?? null),
    type: new FormControl(q.type, { nonNullable: true }),
    label: new FormControl(q.label, {
      nonNullable: true,
      validators: [Validators.maxLength(300)],
    }),
    helpText: new FormControl(q.helpText ?? '', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
    required: new FormControl(q.required, { nonNullable: true }),
    choices: new FormArray(q.choices.map((c) => newChoiceGroup(c))),
  });
  if (isChoiceType(q.type) && group.controls.choices.length === 0) {
    group.controls.choices.push(newChoiceGroup());
    group.controls.choices.push(newChoiceGroup());
  }
  return group;
}

export function newBuilderForm(): BuilderForm {
  return new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
    questions: new FormArray<QuestionGroup>([]),
  });
}

export function fillForm(form: BuilderForm, content: QuestionnaireContent): void {
  form.controls.questions.clear({ emitEvent: false });
  content.questions.forEach((q) =>
    form.controls.questions.push(newQuestionGroup(q), { emitEvent: false }),
  );
  form.patchValue({ title: content.title, description: content.description ?? '' });
  form.markAsPristine();
}

/** Switching type keeps text/required, drops choices unless the new type needs them. */
export function applyType(group: QuestionGroup, type: QuestionType): void {
  group.controls.type.setValue(type);
  const choices = group.controls.choices;
  if (!isChoiceType(type)) {
    choices.clear();
  } else if (choices.length === 0) {
    choices.push(newChoiceGroup());
    choices.push(newChoiceGroup());
  }
}

export function toContent(form: BuilderForm): QuestionnaireContent {
  const v = form.getRawValue();
  return {
    title: v.title,
    description: v.description.trim() === '' ? null : v.description,
    questions: v.questions.map((q) => ({
      ...(q.id ? { id: q.id } : {}),
      type: q.type,
      label: q.label,
      helpText: q.helpText.trim() === '' ? null : q.helpText,
      required: q.required,
      choices: isChoiceType(q.type)
        ? q.choices.map((c) => ({ ...(c.id ? { id: c.id } : {}), label: c.label }))
        : [],
    })),
  };
}
