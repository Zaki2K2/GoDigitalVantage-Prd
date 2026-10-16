import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CSRF_COOKIE_NAME } from '../../core/auth/auth.service';
import { QuestionnaireView } from '../../core/questionnaire/questionnaire.service';
import { QuestionnaireBuilder } from './questionnaire-builder';

const URL_Q = '/api/v1/businesses/b1/questionnaire';

const view = (over: Partial<QuestionnaireView> = {}): QuestionnaireView => ({
  draft: {
    title: 'Feedback',
    description: null,
    questions: [
      { id: 'q1', type: 'rating', label: 'Rate us', helpText: null, required: true, choices: [] },
      { id: 'q2', type: 'long_text', label: 'Why?', helpText: null, required: false, choices: [] },
    ],
  },
  draftRevision: 3,
  publishedRevision: 0,
  publishedVersion: 0,
  hasUnpublishedChanges: true,
  issues: [],
  versions: [],
  ...over,
});

describe('QuestionnaireBuilder', () => {
  let fixture: ComponentFixture<QuestionnaireBuilder>;
  let http: HttpTestingController;
  const el = () => fixture.nativeElement as HTMLElement;
  const published: boolean[] = [];

  async function init(v: QuestionnaireView = view(), canEdit = true) {
    fixture = TestBed.createComponent(QuestionnaireBuilder);
    fixture.componentRef.setInput('businessId', 'b1');
    fixture.componentRef.setInput('canEdit', canEdit);
    fixture.componentInstance.publishedChange.subscribe((p) => published.push(p));
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne(URL_Q).flush({ data: { questionnaire: v } });
    fixture.detectChanges();
  }

  const click = (selector: string, index = 0) => {
    el().querySelectorAll<HTMLButtonElement>(selector)[index]!.click();
    fixture.detectChanges();
  };
  const labels = () =>
    Array.from(el().querySelectorAll<HTMLInputElement>('input[id^="label-"]')).map((i) => i.value);
  const buttonByText = (text: string) =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.trim().startsWith(text),
    )!;
  const typeInto = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(() => {
    published.length = 0;
    document.cookie = `${CSRF_COOKIE_NAME}=tok; path=/`;
    TestBed.configureTestingModule({
      imports: [QuestionnaireBuilder],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    document.cookie = `${CSRF_COOKIE_NAME}=; path=/; max-age=0`;
    http.verify();
  });

  it('shows loading, then the loaded questions and status', async () => {
    fixture = TestBed.createComponent(QuestionnaireBuilder);
    fixture.componentRef.setInput('businessId', 'b1');
    fixture.detectChanges();
    expect(el().textContent).toContain('Loading questionnaire');
    await Promise.resolve();
    http.expectOne(URL_Q).flush({ data: { questionnaire: view() } });
    fixture.detectChanges();
    expect(labels()).toEqual(['Rate us', 'Why?']);
    expect(el().textContent).toContain('Not published yet');
  });

  it('shows an error with retry when loading fails', async () => {
    fixture = TestBed.createComponent(QuestionnaireBuilder);
    fixture.componentRef.setInput('businessId', 'b1');
    fixture.detectChanges();
    await Promise.resolve();
    http
      .expectOne(URL_Q)
      .flush({ error: { code: 'X', message: 'Boom' } }, { status: 500, statusText: 'err' });
    fixture.detectChanges();
    expect(el().querySelector('.alert')!.textContent).toContain('Boom');
    click('.btn.secondary');
    http.expectOne(URL_Q).flush({ data: { questionnaire: view() } });
  });

  it('shows an empty state when there are no questions', async () => {
    await init(view({ draft: { title: 'T', description: null, questions: [] } }));
    expect(el().querySelector('.empty')!.textContent).toContain('No questions yet');
  });

  it('adds every question type, with two starter choices for choice types', async () => {
    await init();
    click('.add-buttons button', 2); // single choice
    click('.add-buttons button', 3); // multiple choice
    click('.add-buttons button', 0); // short text
    expect(labels().length).toBe(5);
    expect(el().querySelectorAll('.choice input').length).toBe(4);
  });

  it('reorders and deletes questions', async () => {
    await init();
    click('[aria-label="Move question 2 up"]');
    expect(labels()).toEqual(['Why?', 'Rate us']);
    click('[aria-label="Move question 1 down"]');
    expect(labels()).toEqual(['Rate us', 'Why?']);
    expect(
      (el().querySelector('[aria-label="Move question 1 up"]') as HTMLButtonElement).disabled,
    ).toBeTrue();
    click('[aria-label="Delete question 1"]');
    expect(labels()).toEqual(['Why?']);
  });

  it('changing type to a choice type adds choices, and back to text removes them', async () => {
    await init();
    const select = el().querySelector<HTMLSelectElement>('#type-0')!;
    select.value = 'single_choice';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el().querySelectorAll('.choice input').length).toBe(2);
    click('.choices .btn');
    expect(el().querySelectorAll('.choice input').length).toBe(3);
    click('[aria-label="Remove choice 3 of question 1"]');
    expect(el().querySelectorAll('.choice input').length).toBe(2);
    select.value = 'short_text';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el().querySelectorAll('.choice input').length).toBe(0);
  });

  it('saves the draft with the base revision and ordered content', async () => {
    await init();
    typeInto(el().querySelector<HTMLInputElement>('#label-0')!, 'Rate your visit');
    click('[aria-label="Move question 1 down"]');
    buttonByText('Save draft').click();
    const req = http.expectOne(`${URL_Q}/draft`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.baseRevision).toBe(3);
    expect(req.request.body.questions.map((q: { label: string }) => q.label)).toEqual([
      'Why?',
      'Rate your visit',
    ]);
    expect(req.request.body.questions[1].id).toBe('q1'); // ids preserved
    req.flush({ data: { questionnaire: view({ draftRevision: 4 }) } });
    fixture.detectChanges();
    expect(el().textContent).toContain('Draft saved');
    expect(buttonByText('Save draft').disabled).toBeTrue();
  });

  it('publish saves unsaved edits first, then publishes the new revision', async () => {
    await init();
    typeInto(el().querySelector<HTMLInputElement>('#label-1')!, 'Changed');
    buttonByText('Publish').click();
    http.expectOne(`${URL_Q}/draft`).flush({ data: { questionnaire: view({ draftRevision: 4 }) } });
    const pub = http.expectOne(`${URL_Q}/publish`);
    expect(pub.request.body).toEqual({ expectedRevision: 4 });
    pub.flush({
      data: {
        questionnaire: view({
          draftRevision: 4,
          publishedRevision: 4,
          publishedVersion: 2,
          hasUnpublishedChanges: false,
        }),
      },
    });
    fixture.detectChanges();
    expect(el().textContent).toContain('Published version 2');
    expect(el().textContent).toContain('Live: version 2');
    expect(published).toEqual([false, true]);
  });

  it('shows server publish problems next to the offending question', async () => {
    await init();
    buttonByText('Publish').click();
    http.expectOne(`${URL_Q}/publish`).flush(
      {
        error: {
          code: 'QUESTIONNAIRE_INVALID',
          message: 'Fix the highlighted problems to publish',
          details: {
            issues: [{ questionId: 'q2', field: 'label', message: 'Question text is empty' }],
          },
        },
      },
      { status: 422, statusText: 'Unprocessable' },
    );
    fixture.detectChanges();
    expect(el().querySelector('.has-issue .error')!.textContent).toContain(
      'Question text is empty',
    );
    expect(el().querySelector('.alert')!.textContent).toContain('Fix the highlighted');
  });

  it('shows publish problems on a question added in the same session (ids synced after auto-save)', async () => {
    await init();
    click('.add-buttons button', 2); // new single-choice question, no id yet
    typeInto(el().querySelector<HTMLInputElement>('#label-2')!, 'Visit type');
    buttonByText('Publish').click();
    const saved = view({
      draftRevision: 4,
      draft: {
        ...view().draft,
        questions: [
          ...view().draft.questions,
          {
            id: 'server-id',
            type: 'single_choice',
            label: 'Visit type',
            helpText: null,
            required: false,
            choices: [
              { id: 'c1', label: '' },
              { id: 'c2', label: '' },
            ],
          },
        ],
      },
    });
    http.expectOne(`${URL_Q}/draft`).flush({ data: { questionnaire: saved } });
    http.expectOne(`${URL_Q}/publish`).flush(
      {
        error: {
          code: 'QUESTIONNAIRE_INVALID',
          message: 'Fix the highlighted problems to publish',
          details: {
            issues: [{ questionId: 'server-id', field: 'choices', message: 'A choice is empty' }],
          },
        },
      },
      { status: 422, statusText: 'Unprocessable' },
    );
    fixture.detectChanges();
    expect(el().querySelector('.has-issue .error')!.textContent).toContain('A choice is empty');
  });

  it('offers a reload when the draft changed elsewhere (409)', async () => {
    await init();
    typeInto(el().querySelector<HTMLInputElement>('#label-0')!, 'x');
    buttonByText('Save draft').click();
    http
      .expectOne(`${URL_Q}/draft`)
      .flush(
        { error: { code: 'REVISION_CONFLICT', message: 'Changed elsewhere' } },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();
    click('.reload');
    http.expectOne(URL_Q).flush({ data: { questionnaire: view({ draftRevision: 9 }) } });
  });

  it('previews the unsaved draft read-only', async () => {
    await init();
    typeInto(el().querySelector<HTMLInputElement>('#label-0')!, 'Unsaved wording');
    buttonByText('Preview').click();
    fixture.detectChanges();
    const preview = el().querySelector('app-questionnaire-form-view')!;
    expect(preview.textContent).toContain('Unsaved wording');
    expect(preview.querySelectorAll('input:enabled, textarea:enabled').length).toBe(0);
    buttonByText('Back to editing').click();
    fixture.detectChanges();
    expect(labels()[0]).toBe('Unsaved wording');
  });

  it('is read-only for non-owners', async () => {
    await init(view(), false);
    expect(el().textContent).toContain('Only the business owner');
    expect(el().querySelector('.add-buttons')).toBeNull();
    expect(
      Array.from(el().querySelectorAll('button')).some((b) => b.textContent?.includes('Publish')),
    ).toBeFalse();
    expect(el().querySelector<HTMLInputElement>('#label-0')!.disabled).toBeTrue();
  });
});
