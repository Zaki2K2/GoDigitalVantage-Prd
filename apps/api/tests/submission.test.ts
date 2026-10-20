import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { RefreshToken } from '../src/modules/auth/refresh-token.model';
import { User } from '../src/modules/auth/user.model';
import { Business } from '../src/modules/businesses/business.model';
import { BusinessMembership } from '../src/modules/businesses/membership.model';
import { ConsentEvent, Contact } from '../src/modules/contacts/contact.model';
import { QrEvent } from '../src/modules/qr/qr-event.model';
import {
  Questionnaire,
  QuestionnaireVersion,
} from '../src/modules/questionnaires/questionnaire.model';
import { Response } from '../src/modules/responses/response.model';

const PASSWORD = 'correct-horse-battery';
let seq = 0;

interface Owner {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
}

async function newOwner(): Promise<Owner> {
  const agent = request.agent(createApp());
  const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
  await agent
    .post('/api/v1/auth/register')
    .set('X-CSRF-Token', csrf)
    .send({ fullName: 'Owner', email: `s${++seq}-${Date.now()}@example.com`, password: PASSWORD });
  const h = (r: request.Test) => r.set('X-CSRF-Token', csrf);
  return {
    agent,
    csrf,
    get: (url) => agent.get(url),
    post: (url, body = {}) => h(agent.post(url)).send(body),
    put: (url, body = {}) => h(agent.put(url)).send(body),
    patch: (url, body = {}) => h(agent.patch(url)).send(body),
  };
}

interface Q {
  id: string;
  type: string;
  label: string;
  choices: { id: string; label: string }[];
}
interface World {
  owner: Owner;
  businessId: string;
  slug: string;
  qs: { short: Q; long: Q; single: Q; multi: Q; rating: Q };
}

/** A business with a published questionnaire containing all five question types. */
async function newWorld(name = 'Harbor Cafe'): Promise<World> {
  const owner = await newOwner();
  const b = (
    await owner.post('/api/v1/businesses', {
      createRequestId: randomUUID(),
      name,
      category: 'Cafe',
      timezone: 'UTC',
    })
  ).body.data.business as { id: string; slug: string };
  await owner.patch(`/api/v1/businesses/${b.id}`, {
    googleReviewUrl: 'https://g.page/r/harbor/review',
  });
  const base = `/api/v1/businesses/${b.id}/questionnaire`;
  const v = (await owner.get(base)).body.data.questionnaire;
  const draft = await owner.put(`${base}/draft`, {
    baseRevision: v.draftRevision,
    title: 'Feedback',
    questions: [
      { type: 'short_text', label: 'Your order', required: true },
      { type: 'long_text', label: 'Comments', required: false },
      {
        type: 'single_choice',
        label: 'Visit type',
        required: false,
        choices: [{ label: 'Dine in' }, { label: 'Takeaway' }],
      },
      {
        type: 'multiple_choice',
        label: 'Liked',
        required: false,
        choices: [{ label: 'Coffee' }, { label: 'Staff' }, { label: 'Music' }],
      },
      { type: 'rating', label: 'Rate us', required: true },
    ],
  });
  const rev = draft.body.data.questionnaire.draftRevision;
  await owner.post(`${base}/publish`, { expectedRevision: rev });
  const qs = await publicQuestions(b.slug);
  return { owner, businessId: b.id, slug: b.slug, qs };
}

async function publicQuestions(slug: string) {
  const res = await request(createApp()).get(`/api/v1/public/${slug}`);
  const list = res.body.data.questionnaire.questions as Q[];
  const by = (t: string) => list.find((q) => q.type === t)!;
  return {
    short: by('short_text'),
    long: by('long_text'),
    single: by('single_choice'),
    multi: by('multiple_choice'),
    rating: by('rating'),
  };
}

const answers = (w: World, rating = 5, extra: object[] = []) => [
  { questionId: w.qs.short.id, text: 'Flat white' },
  { questionId: w.qs.rating.id, rating },
  ...extra,
];
const body = (w: World, over: object = {}) => ({
  idempotencyKey: randomUUID(),
  answers: answers(w),
  ...over,
});
const submit = (app: ReturnType<typeof createApp>, slug: string, b: object) =>
  request(app).post(`/api/v1/public/${slug}/responses`).send(b);

let app: ReturnType<typeof createApp>;

const MODELS = [
  User,
  RefreshToken,
  Business,
  BusinessMembership,
  Questionnaire,
  QuestionnaireVersion,
  Response,
  Contact,
  ConsentEvent,
  QrEvent,
];

beforeAll(async () => {
  await mongoose.connect(process.env['MONGODB_URI']!);
  await Promise.all(MODELS.map((m) => (m as typeof User).init()));
});
beforeEach(async () => {
  app = createApp();
  await Promise.all(MODELS.map((m) => (m as typeof User).deleteMany({})));
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('public form payload', () => {
  it('exposes branding, review link and consent wording, nothing owner-only', async () => {
    const w = await newWorld();
    const res = await request(app).get(`/api/v1/public/${w.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.business).toEqual({
      name: 'Harbor Cafe',
      slug: w.slug,
      category: 'Cafe',
      googleReviewUrl: 'https://g.page/r/harbor/review',
      logoUrl: null,
    });
    expect(res.body.data.consent.wordingVersion).toBeTruthy();
    expect(res.body.data.consent.marketingSms).toContain('Optional');
    expect(JSON.stringify(res.body)).not.toMatch(/ownerUserId|email|phone|businessId/);
  });
});

describe('submission validation and snapshots', () => {
  it('stores an anonymous response with label snapshots and contactId null', async () => {
    const w = await newWorld();
    const res = await submit(
      app,
      w.slug,
      body(w, {
        answers: answers(w, 4, [
          { questionId: w.qs.long.id, text: '  Lovely  ' },
          { questionId: w.qs.single.id, choiceIds: [w.qs.single.choices[1]!.id] },
          {
            questionId: w.qs.multi.id,
            choiceIds: [w.qs.multi.choices[0]!.id, w.qs.multi.choices[2]!.id],
          },
        ]),
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.googleReviewUrl).toBe('https://g.page/r/harbor/review');
    const doc = (await Response.findById(res.body.data.responseId).lean())!;
    expect(doc.contactId).toBeNull();
    expect(doc.rating).toBe(4);
    expect(doc.questionnaireVersion).toBe(1);
    expect(doc.answers.map((a) => [a.type, a.label])).toEqual([
      ['short_text', 'Your order'],
      ['long_text', 'Comments'],
      ['single_choice', 'Visit type'],
      ['multiple_choice', 'Liked'],
      ['rating', 'Rate us'],
    ]);
    expect(doc.answers[1]!.text).toBe('Lovely');
    expect(doc.answers[2]!.choices).toEqual([w.qs.single.choices[1]]);
    expect(doc.answers[3]!.choices.map((c) => c.label)).toEqual(['Coffee', 'Music']);
    expect(await Contact.countDocuments()).toBe(0);
  });

  it('accepts omitted optional answers', async () => {
    const w = await newWorld();
    expect((await submit(app, w.slug, body(w))).status).toBe(201);
  });

  const issuesOf = (res: request.Response) =>
    (res.body.error.details.issues as { questionId: string | null; message: string }[]).map((i) => [
      i.questionId,
      i.message,
    ]);

  it('rejects missing required answers with per-question messages', async () => {
    const w = await newWorld();
    const res = await submit(app, w.slug, body(w, { answers: [] }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SUBMISSION_INVALID');
    expect(issuesOf(res)).toEqual([
      [w.qs.short.id, 'This question is required'],
      [w.qs.rating.id, 'This question is required'],
    ]);
    const blank = await submit(
      app,
      w.slug,
      body(w, { answers: [{ questionId: w.qs.short.id, text: '   ' }] }),
    );
    expect(issuesOf(blank)).toContainEqual([w.qs.short.id, 'This question is required']);
  });

  it('rejects bad values per question type', async () => {
    const w = await newWorld();
    const bad = async (extra: object[], expected: string) => {
      const res = await submit(app, w.slug, body(w, { answers: [...answers(w), ...extra] }));
      expect(res.status).toBe(422);
      expect(res.body.error.details.issues.map((i: { message: string }) => i.message)).toContain(
        expected,
      );
    };
    await bad(
      [{ questionId: w.qs.long.id, text: 'x'.repeat(2001) }],
      'Please keep this under 2000 characters',
    );
    await bad(
      [{ questionId: w.qs.single.id, choiceIds: ['nope'] }],
      'Choose one of the listed options',
    );
    await bad(
      [{ questionId: w.qs.single.id, choiceIds: w.qs.single.choices.map((c) => c.id) }],
      'Choose only one option',
    );
    await bad(
      [{ questionId: w.qs.multi.id, choiceIds: ['nope'] }],
      'Choose one of the listed options',
    );
    await bad([{ questionId: 'ghost', text: 'x' }], 'Unknown question in answers');
    const r = await submit(app, w.slug, body(w, { answers: answers(w, 9) }));
    expect(r.body.error.details.issues[0].message).toBe('Choose a rating from 1 to 5');
    const r2 = await submit(app, w.slug, body(w, { answers: answers(w, 2.5) }));
    expect(r2.status).toBe(422);
    expect(await Response.countDocuments()).toBe(0);
  });

  it('rejects malformed bodies and unknown slugs', async () => {
    const w = await newWorld();
    expect((await submit(app, w.slug, { answers: [] })).status).toBe(422); // no key
    expect((await submit(app, w.slug, body(w, { extra: 1 }))).status).toBe(422);
    const missing = await submit(app, 'no-such-business', body(w));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('FORM_UNAVAILABLE');
  });

  it('does not accept submissions for a disabled business or an unpublished form', async () => {
    const w = await newWorld();
    await Business.updateOne({ _id: w.businessId }, { status: 'disabled' });
    expect((await submit(app, w.slug, body(w))).status).toBe(404);
    const owner = await newOwner();
    const b = (
      await owner.post('/api/v1/businesses', {
        createRequestId: randomUUID(),
        name: 'Unpublished',
        category: 'Shop',
        timezone: 'UTC',
      })
    ).body.data.business;
    expect((await submit(app, b.slug, body(w))).status).toBe(404);
  });
});

describe('contacts and consent', () => {
  it('normalizes email and phone, and never grants consent by default', async () => {
    const w = await newWorld();
    const res = await submit(
      app,
      w.slug,
      body(w, {
        contact: { fullName: ' Ana Lee ', email: '  ANA@Example.COM ', phone: '+1 (415) 555-0123' },
      }),
    );
    expect(res.status).toBe(201);
    const c = (await Contact.findOne().lean())!;
    expect(c.emailLowercase).toBe('ana@example.com');
    expect(c.phoneE164).toBe('+14155550123');
    expect(c.fullName).toBe('Ana Lee');
    expect(c.consent.marketingSms).toBeNull();
    expect(c.consent.reviewRequestSms).toBeNull();
    expect(await ConsentEvent.countDocuments()).toBe(0);
    const r = (await Response.findById(res.body.data.responseId).lean())!;
    expect(String(r.contactId)).toBe(String(c._id));
    expect(r.consentSnapshot).toMatchObject({ reviewRequestSms: false, marketingSms: false });
  });

  it('records explicit consent separately, with purpose, wording version and source', async () => {
    const w = await newWorld();
    await submit(
      app,
      w.slug,
      body(w, {
        contact: { phone: '0014155550123' },
        consent: { marketingSms: true },
      }),
    );
    const events = await ConsentEvent.find().lean();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      purpose: 'marketing_sms',
      choice: 'granted',
      source: 'public_form',
    });
    expect(events[0]!.wordingVersion).toBeTruthy();
    expect(events[0]!.wordingText).toContain('Harbor Cafe');
    const c = (await Contact.findOne().lean())!;
    expect(c.consent.marketingSms).toBeInstanceOf(Date);
    expect(c.consent.reviewRequestSms).toBeNull();
  });

  it('refuses consent without a phone, and name-only or invalid contact details', async () => {
    const w = await newWorld();
    const fields = async (contact: object, consent?: object) => {
      const res = await submit(app, w.slug, body(w, { contact, consent }));
      expect(res.status).toBe(422);
      return res.body.error.details.issues.map((i: { field: string }) => i.field);
    };
    expect(await fields({ email: 'a@b.co' }, { marketingSms: true })).toContain('consent');
    expect(await fields({ fullName: 'Only Name' })).toContain('contact');
    expect(await fields({ email: 'not-an-email' })).toContain('contact.email');
    expect(await fields({ phone: '4155550123' })).toContain('contact.phone');
    expect(await Response.countDocuments()).toBe(0);
  });

  it('keeps blank contact details anonymous', async () => {
    const w = await newWorld();
    const res = await submit(
      app,
      w.slug,
      body(w, { contact: { fullName: '', email: '', phone: '' } }),
    );
    expect(res.status).toBe(201);
    expect((await Response.findOne().lean())!.contactId).toBeNull();
  });

  it('deduplicates per business, fills empty fields only, never overwrites', async () => {
    const w = await newWorld();
    const phone = '+14155550123';
    await submit(app, w.slug, body(w, { contact: { fullName: 'Ana', phone } }));
    await submit(
      app,
      w.slug,
      body(w, { contact: { fullName: 'Someone Else', phone, email: 'ana@example.com' } }),
    );
    await submit(app, w.slug, body(w, { contact: { email: 'ANA@example.com' } }));
    const contacts = await Contact.find().lean();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      fullName: 'Ana',
      phoneE164: phone,
      emailLowercase: 'ana@example.com',
    });
    expect(await Response.countDocuments({ contactId: contacts[0]!._id })).toBe(3);
  });

  it('never merges contacts across businesses', async () => {
    const a = await newWorld('Cafe A');
    const b = await newWorld('Cafe B');
    const contact = { phone: '+14155550123', email: 'same@example.com' };
    await submit(app, a.slug, body(a, { contact }));
    await submit(app, b.slug, body(b, { contact }));
    const all = await Contact.find().lean();
    expect(all).toHaveLength(2);
    expect(new Set(all.map((c) => String(c.businessId))).size).toBe(2);
  });
});

describe('idempotency', () => {
  it('returns the original response for a repeated key', async () => {
    const w = await newWorld();
    const b = body(w, { contact: { phone: '+14155550123' }, consent: { reviewRequestSms: true } });
    const first = await submit(app, w.slug, b);
    const again = await submit(app, w.slug, b);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.data.duplicate).toBe(true);
    expect(again.body.data.responseId).toBe(first.body.data.responseId);
    expect(await Response.countDocuments()).toBe(1);
    expect(await ConsentEvent.countDocuments()).toBe(1);
  });

  it('keeps keys independent per business', async () => {
    const a = await newWorld('Cafe A');
    const b = await newWorld('Cafe B');
    const key = randomUUID();
    expect((await submit(app, a.slug, body(a, { idempotencyKey: key }))).status).toBe(201);
    expect((await submit(app, b.slug, body(b, { idempotencyKey: key }))).status).toBe(201);
    expect(await Response.countDocuments()).toBe(2);
  });

  it('creates exactly one response, contact and consent under concurrent submits', async () => {
    const w = await newWorld();
    const b = body(w, { contact: { phone: '+14155550123' }, consent: { marketingSms: true } });
    const results = await Promise.all(Array.from({ length: 8 }, () => submit(app, w.slug, b)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(7);
    expect(new Set(results.map((r) => r.body.data.responseId)).size).toBe(1);
    expect(await Response.countDocuments()).toBe(1);
    expect(await Contact.countDocuments()).toBe(1);
    expect(await ConsentEvent.countDocuments()).toBe(1);
  });

  it('creates one contact when different submissions race on the same phone', async () => {
    const w = await newWorld();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        submit(app, w.slug, body(w, { contact: { phone: '+14155550123' } })),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await Contact.countDocuments()).toBe(1);
    expect(await Response.countDocuments()).toBe(6);
  });
});

describe('questionnaire history', () => {
  it('keeps old responses readable after the questionnaire changes, and accepts the old version', async () => {
    const w = await newWorld();
    const old = await submit(app, w.slug, body(w));
    const base = `/api/v1/businesses/${w.businessId}/questionnaire`;
    const view = (await w.owner.get(base)).body.data.questionnaire;
    const qs = view.draft.questions.map((q: Q) =>
      q.type === 'rating' ? { ...q, label: 'Rate v2' } : q,
    );
    const saved = await w.owner.put(`${base}/draft`, {
      baseRevision: view.draftRevision,
      title: 'v2',
      questions: qs.slice(0, 2).concat(qs[4]),
    });
    await w.owner.post(`${base}/publish`, {
      expectedRevision: saved.body.data.questionnaire.draftRevision,
    });

    const detail = await w.owner.get(
      `/api/v1/businesses/${w.businessId}/responses/${old.body.data.responseId}`,
    );
    expect(detail.body.data.questionnaireVersion).toBe(1);
    expect(detail.body.data.answers.map((a: { label: string }) => a.label)).toContain('Rate us');

    // A customer who loaded v1 can still submit it; the response records v1.
    const late = await submit(app, w.slug, body(w, { version: 1 }));
    expect(late.status).toBe(201);
    expect((await Response.findById(late.body.data.responseId).lean())!.questionnaireVersion).toBe(
      1,
    );
    // Without a version the current (v2) form is used, where the removed question is unknown.
    const current = await submit(
      app,
      w.slug,
      body(w, {
        answers: [
          ...answers(w),
          { questionId: w.qs.single.id, choiceIds: [w.qs.single.choices[0]!.id] },
        ],
      }),
    );
    expect(current.status).toBe(422);
    expect((await submit(app, w.slug, body(w, { version: 9 }))).status).toBe(404);
  });
});

describe('spam protection', () => {
  it('silently drops honeypot submissions', async () => {
    const w = await newWorld();
    const res = await submit(app, w.slug, body(w, { website: 'http://spam.example' }));
    expect(res.status).toBe(201);
    expect(res.body.data.googleReviewUrl).toBeNull();
    expect(await Response.countDocuments()).toBe(0);
    expect(await Contact.countDocuments()).toBe(0);
  });

  it('rate limits public submissions per IP', async () => {
    const w = await newWorld();
    const limited = createApp();
    const codes: number[] = [];
    for (let i = 0; i < 27; i++) codes.push((await submit(limited, w.slug, body(w))).status);
    expect(codes.slice(0, 25).every((c) => c === 201)).toBe(true);
    expect(codes.slice(25)).toEqual([429, 429]);
    const last = await submit(limited, w.slug, body(w));
    expect(last.body.error.code).toBe('RATE_LIMITED');
    expect(await Response.countDocuments()).toBe(25);
  });
});

describe('QR scan tracking', () => {
  const scan = (a: ReturnType<typeof createApp>, slug: string, ua = 'Mozilla/5.0 Phone A') =>
    request(a).post(`/api/v1/public/${slug}/scan`).set('User-Agent', ua);

  it('counts one scan per visitor per window, and stores no raw IP or user agent', async () => {
    const w = await newWorld();
    expect((await scan(app, w.slug)).status).toBe(204);
    expect((await scan(app, w.slug)).status).toBe(204);
    expect(await QrEvent.countDocuments()).toBe(1);
    await scan(app, w.slug, 'Mozilla/5.0 Phone B');
    expect(await QrEvent.countDocuments()).toBe(2);
    const raw = JSON.stringify(await QrEvent.find().lean());
    expect(raw).not.toMatch(/Mozilla|127\.0\.0\.1|::1/);
    const ev = (await QrEvent.findOne().lean())!;
    expect(ev).toMatchObject({ eventType: 'scan', qrId: w.slug });
  });

  it('ignores crawlers and unknown or unpublished links', async () => {
    const w = await newWorld();
    await scan(app, w.slug, 'Googlebot/2.1');
    expect(await QrEvent.countDocuments()).toBe(0);
    expect((await scan(app, 'nope-nope')).status).toBe(404);
    expect(await QrEvent.countDocuments()).toBe(0);
  });

  it('does not count the page data fetch itself', async () => {
    const w = await newWorld();
    await request(app).get(`/api/v1/public/${w.slug}`);
    expect(await QrEvent.countDocuments()).toBe(0);
  });
});

describe('responses and contacts API (portal)', () => {
  async function seed() {
    const w = await newWorld();
    const cases: [number, string, object | undefined][] = [
      [5, 'Great espresso', { fullName: 'Ana Lee', email: 'ana@example.com' }],
      [3, 'Slow service', undefined],
      [4, 'Nice patio', { phone: '+14155550999' }],
    ];
    for (const [rating, comment, contact] of cases) {
      await submit(
        createApp(),
        w.slug,
        body(w, {
          answers: answers(w, rating, [{ questionId: w.qs.long.id, text: comment }]),
          contact,
        }),
      );
      await new Promise((r) => setTimeout(r, 5));
    }
    return w;
  }
  const url = (w: World, rest: string) => `/api/v1/businesses/${w.businessId}${rest}`;

  it('lists with pagination, newest first', async () => {
    const w = await seed();
    const page1 = await w.owner.get(url(w, '/responses?pageSize=2'));
    expect(page1.status).toBe(200);
    expect(page1.body.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(page1.body.data.map((r: { preview: string }) => r.preview)).toEqual([
      'Nice patio',
      'Slow service',
    ]);
    const page2 = await w.owner.get(url(w, '/responses?pageSize=2&page=2'));
    expect(page2.body.data).toHaveLength(1);
  });

  it('filters by rating, contact type and search (answers and contact fields)', async () => {
    const w = await seed();
    const ratings = async (qs: string) =>
      (await w.owner.get(url(w, `/responses?${qs}`))).body.data.map(
        (r: { rating: number }) => r.rating,
      );
    expect(await ratings('rating=3')).toEqual([3]);
    expect(await ratings('contact=anonymous')).toEqual([3]);
    expect((await ratings('contact=identified')).sort()).toEqual([4, 5]);
    expect(await ratings('search=espresso')).toEqual([5]);
    expect(await ratings('search=ana@example')).toEqual([5]);
    expect(await ratings('search=Ana%20Lee')).toEqual([5]);
    expect(await ratings('search=%2E%2A')).toEqual([]); // regex input is escaped
    expect(await ratings(`from=${new Date(Date.now() + 86400000).toISOString()}`)).toEqual([]);
    expect((await w.owner.get(url(w, '/responses?rating=9'))).status).toBe(422);
  });

  it('shows detail with answers and the linked contact; responses are read-only', async () => {
    const w = await seed();
    const list = (await w.owner.get(url(w, '/responses?search=espresso'))).body.data;
    const detail = await w.owner.get(url(w, `/responses/${list[0].id}`));
    expect(detail.body.data.contact).toMatchObject({
      fullName: 'Ana Lee',
      email: 'ana@example.com',
    });
    expect(detail.body.data.answers).toHaveLength(3);
    expect((await w.owner.put(url(w, `/responses/${list[0].id}`), { rating: 1 })).status).toBe(404);
    expect((await w.owner.patch(url(w, `/responses/${list[0].id}`), { rating: 1 })).status).toBe(
      404,
    );
    expect(
      (
        await w.owner.agent
          .delete(url(w, `/responses/${list[0].id}`))
          .set('X-CSRF-Token', w.owner.csrf)
      ).status,
    ).toBe(404);
    expect((await w.owner.get(url(w, '/responses/not-an-id'))).status).toBe(404);
  });

  it('lists, searches and shows contacts with consent history', async () => {
    const w = await newWorld();
    await submit(
      app,
      w.slug,
      body(w, {
        contact: { fullName: 'Ana Lee', phone: '+14155550123' },
        consent: { marketingSms: true },
      }),
    );
    await submit(app, w.slug, body(w, { contact: { email: 'bo@example.com' } }));
    const all = await w.owner.get(url(w, '/contacts'));
    expect(all.body.pagination.total).toBe(2);
    const found = await w.owner.get(url(w, '/contacts?search=0123'));
    expect(found.body.data).toHaveLength(1);
    expect(found.body.data[0]).toMatchObject({ fullName: 'Ana Lee', responseCount: 1 });
    expect(found.body.data[0].consent.marketingSms).toBeTruthy();
    const detail = await w.owner.get(url(w, `/contacts/${found.body.data[0].id}`));
    expect(detail.body.data.consentEvents[0]).toMatchObject({
      purpose: 'marketing_sms',
      choice: 'granted',
    });
    expect(detail.body.data.responses).toHaveLength(1);
    expect((await w.owner.get(url(w, '/contacts/zzz'))).status).toBe(404);
  });

  it('isolates tenants and requires authentication', async () => {
    const a = await seed();
    const b = await newWorld('Other Cafe');
    const resp = (await a.owner.get(url(a, '/responses'))).body.data[0].id as string;
    const contact = (await a.owner.get(url(a, '/contacts'))).body.data[0].id as string;
    for (const path of ['/responses', '/contacts', '/dashboard']) {
      expect((await b.owner.get(url(a, path))).status).toBe(403);
      expect((await request(app).get(url(a, path))).status).toBe(401);
    }
    expect((await b.owner.get(url(a, `/responses/${resp}`))).status).toBe(403);
    // Own business + another tenant's ids resolves to nothing.
    expect((await b.owner.get(url(b, `/responses/${resp}`))).status).toBe(404);
    expect((await b.owner.get(url(b, `/contacts/${contact}`))).status).toBe(404);
    expect((await b.owner.get(url(b, '/responses'))).body.pagination.total).toBe(0);
  });
});

describe('dashboard aggregation', () => {
  it('reports exact totals, average rating, trend and recent feedback', async () => {
    const w = await newWorld();
    for (const [r, contact] of [
      [5, { phone: '+14155550001' }],
      [3, undefined],
      [4, { phone: '+14155550001' }],
    ] as [number, object | undefined][]) {
      await submit(createApp(), w.slug, body(w, { answers: answers(w, r), contact }));
    }
    await request(app).post(`/api/v1/public/${w.slug}/scan`).set('User-Agent', 'Phone 1');
    await request(app).post(`/api/v1/public/${w.slug}/scan`).set('User-Agent', 'Phone 2');
    await request(app).post(`/api/v1/public/${w.slug}/scan`).set('User-Agent', 'Phone 2');

    const res = await w.owner.get(`/api/v1/businesses/${w.businessId}/dashboard?days=7`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.totals).toEqual({
      scans: 2,
      responses: 3,
      contacts: 1,
      averageRating: 4,
      ratedResponses: 3,
    });
    expect(d.ratingDistribution).toEqual([0, 0, 1, 1, 1]);
    expect(d.trend).toHaveLength(7);
    const today = d.trend[6];
    expect(today.date).toBe(new Date().toISOString().slice(0, 10));
    expect(today).toMatchObject({ scans: 2, responses: 3 });
    expect(
      d.trend
        .slice(0, 6)
        .every((t: { scans: number; responses: number }) => t.scans + t.responses === 0),
    ).toBe(true);
    expect(d.recent).toHaveLength(3);
    expect(d.recent[0].rating).toBe(4);
    expect(JSON.stringify(d)).not.toMatch(/google/i);
  });

  it('returns zeros and a null average for a business with no activity', async () => {
    const w = await newWorld();
    const d = (await w.owner.get(`/api/v1/businesses/${w.businessId}/dashboard`)).body.data;
    expect(d.totals).toEqual({
      scans: 0,
      responses: 0,
      contacts: 0,
      averageRating: null,
      ratedResponses: 0,
    });
    expect(d.ratingDistribution).toEqual([0, 0, 0, 0, 0]);
    expect(d.trend).toHaveLength(30);
    expect(d.recent).toEqual([]);
  });

  it('counts only its own tenant data', async () => {
    const a = await newWorld('A');
    const b = await newWorld('B');
    await submit(app, a.slug, body(a));
    const d = (await b.owner.get(`/api/v1/businesses/${b.businessId}/dashboard`)).body.data;
    expect(d.totals.responses).toBe(0);
  });
});
