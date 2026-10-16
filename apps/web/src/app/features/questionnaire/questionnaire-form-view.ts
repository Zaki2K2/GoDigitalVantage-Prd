import { Component, input } from '@angular/core';
import { Question } from '../../core/questionnaire/questionnaire.service';

/**
 * Read-only rendering of a questionnaire, used for the owner's preview;
 * controls are disabled (the live form is the public page).
 */
@Component({
  selector: 'app-questionnaire-form-view',
  templateUrl: './questionnaire-form-view.html',
})
export class QuestionnaireFormView {
  readonly title = input.required<string>();
  readonly description = input<string | null>(null);
  readonly questions = input.required<Question[]>();
  /** Unique prefix so ids stay valid when two views are on one page. */
  readonly prefix = input('q');

  protected readonly stars = [1, 2, 3, 4, 5];
}
