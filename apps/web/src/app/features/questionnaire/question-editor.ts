import { Component, input, output } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import {
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  QuestionType,
  isChoiceType,
} from '../../core/questionnaire/questionnaire.service';
import { Icon } from '../../shared/icon';
import { QuestionGroup, newChoiceGroup } from './question-form';

/** Editor card for one question: text, type, required flag, choices, reorder and delete. */
@Component({
  selector: 'app-question-editor',
  imports: [ReactiveFormsModule, Icon],
  templateUrl: './question-editor.html',
})
export class QuestionEditor {
  readonly group = input.required<QuestionGroup>();
  readonly index = input.required<number>();
  readonly count = input.required<number>();
  readonly issues = input<string[]>([]);
  readonly disabled = input(false);

  readonly typeChange = output<QuestionType>();
  readonly move = output<-1 | 1>();
  readonly remove = output<void>();

  protected readonly types = QUESTION_TYPES;
  protected readonly typeLabels = QUESTION_TYPE_LABELS;

  protected get number(): number {
    return this.index() + 1;
  }

  protected get hasChoices(): boolean {
    return isChoiceType(this.group().controls.type.value);
  }

  protected onType(event: Event): void {
    this.typeChange.emit((event.target as HTMLSelectElement).value as QuestionType);
  }

  protected addChoice(): void {
    const choices = this.group().controls.choices;
    if (choices.length >= 10) return;
    choices.push(newChoiceGroup());
    this.group().markAsDirty();
  }

  protected removeChoice(i: number): void {
    this.group().controls.choices.removeAt(i);
    this.group().markAsDirty();
  }
}
