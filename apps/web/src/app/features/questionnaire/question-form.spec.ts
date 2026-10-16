import { applyType, fillForm, newBuilderForm, newQuestionGroup, toContent } from './question-form';

describe('question form helpers', () => {
  it('round-trips content, keeping ids and dropping empty optional fields', () => {
    const form = newBuilderForm();
    fillForm(form, {
      title: 'T',
      description: null,
      questions: [
        {
          id: 'q1',
          type: 'multiple_choice',
          label: 'Pick',
          helpText: null,
          required: true,
          choices: [
            { id: 'c1', label: 'A' },
            { id: 'c2', label: 'B' },
          ],
        },
      ],
    });
    const out = toContent(form);
    expect(out.description).toBeNull();
    expect(out.questions[0]).toEqual({
      id: 'q1',
      type: 'multiple_choice',
      label: 'Pick',
      helpText: null,
      required: true,
      choices: [
        { id: 'c1', label: 'A' },
        { id: 'c2', label: 'B' },
      ],
    });
    expect(form.pristine).toBeTrue();
  });

  it('omits ids for new questions so the server assigns them', () => {
    const form = newBuilderForm();
    form.controls.questions.push(newQuestionGroup());
    expect('id' in toContent(form).questions[0]!).toBeFalse();
  });

  it('applyType manages choices; non-choice types never send choices', () => {
    const g = newQuestionGroup();
    applyType(g, 'single_choice');
    expect(g.controls.choices.length).toBe(2);
    applyType(g, 'rating');
    expect(g.controls.choices.length).toBe(0);
    const form = newBuilderForm();
    form.controls.questions.push(g);
    expect(toContent(form).questions[0]!.choices).toEqual([]);
  });
});
