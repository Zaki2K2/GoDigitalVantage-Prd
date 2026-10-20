import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import QRCode from 'qrcode';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { RefreshToken } from '../src/modules/auth/refresh-token.model';
import { User } from '../src/modules/auth/user.model';
import { Business } from '../src/modules/businesses/business.model';
import { BusinessMembership } from '../src/modules/businesses/membership.model';
import {
  Questionnaire,
  QuestionnaireVersion,
} from '../src/modules/questionnaires/questionnaire.model';

const PASSWORD = 'correct-horse-battery';
let seq = 0;

interface Client {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  userId: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
}

async function newUser(): Promise<Client> {
  const agent = request.agent(createApp());
  const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
  const res = await agent
    .post('/api/v1/auth/register')
    .set('X-CSRF-Token', csrf)
    .send({ fullName: 'Owner', email: `q${++seq}-${Date.now()}@example.com`, password: PASSWORD });
  const h = (r: request.Test) => r.set('X-CSRF-Token', csrf);
  return {
    agent,
    csrf,
    userId: res.body.data.user.id,
    get: (url) => agent.get(url),
    post: (url, body = {}) => h(agent.post(url)).send(body),
    put: (url, body = {}) => h(agent.put(url)).send(body),
    patch: (url, body = {}) => h(agent.patch(url)).send(body),
  };
}

async function newBusiness(c: Client, name = 'Quiet Corner Cafe') {
  const res = await c.post('/api/v1/businesses', {
    createRequestId: randomUUID(),
    name,
    category: 'Cafe',
    timezone: 'UTC',
    email: 'private@owner.example',
  });
  return res.body.data.business as { id: string; slug: string };
}

const qUrl = (id: string, rest = '') => `/api/v1/businesses/${id}/questionnaire${rest}`;

interface View {
  draft: { title: string; questions: { id: string; label: string; choices: { id: string }[] }[] };
  draftRevision: number;
  publishedVersion: number;
  hasUnpublishedChanges: boolean;
  issues: unknown[];
  versions: { version: number }[];
}
const view = async (c: Client, id: string): Promise<View> =>
  (await c.get(qUrl(id))).body.data.questionnaire;

const draftBody = (v: View, questions: object[], over: object = {}) => ({
  baseRevision: v.draftRevision,
  title: 'Feedback',
  questions,
  ...over,
});
const rating = (label = 'Rate us', extra: object = {}) => ({
  type: 'rating',
  label,
  required: true,
  ...extra,
});
const choiceQ = (label: string, labels: string[], type = 'single_choice') => ({
  type,
  label,
  required: false,
  choices: labels.map((l) => ({ label: l })),
});

beforeAll(async () => {
  await mongoose.connect(process.env['MONGODB_URI']!);
  await Promise.all([
    User.init(),
    RefreshToken.init(),
    Business.init(),
    BusinessMembership.init(),
    Questionnaire.init(),
    QuestionnaireVersion.init(),
  ]);
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    RefreshToken.deleteMany({}),
    Business.deleteMany({}),
    BusinessMembership.deleteMany({}),
    Questionnaire.deleteMany({}),
    QuestionnaireVersion.deleteMany({}),
  ]);
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('default questionnaire', () => {
  it('is created with the business as an unpublished draft', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const v = await view(c, b.id);
    expect(v.draft.questions.length).toBeGreaterThanOrEqual(2);
    expect(v.draft.questions[0]).toMatchObject({ type: 'rating', required: true });
    expect(v.publishedVersion).toBe(0);
    expect(v.issues).toEqual([]);
    expect(await Questionnaire.countDocuments()).toBe(1);
  });

  it('is created lazily for businesses that predate it', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    await Questionnaire.deleteMany({});
    expect((await view(c, b.id)).draft.questions.length).toBeGreaterThan(0);
    await Promise.all([c.get(qUrl(b.id)), c.get(qUrl(b.id))]);
    expect(await Questionnaire.countDocuments()).toBe(1);
  });
});

describe('draft editing', () => {
  it('adds, edits, reorders and deletes questions with stable ids', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const v0 = await view(c, b.id);
    const [first, second, third] = v0.draft.questions;

    // add a choice question, edit label, reorder, delete one
    const save1 = await c.put(
      qUrl(b.id, '/draft'),
      draftBody(v0, [
        { ...third!, label: 'Edited' },
        first!,
        choiceQ('Pick one', ['A', 'B', 'C'], 'multiple_choice'),
      ]),
    );
    expect(save1.status).toBe(200);
    const v1: View = save1.body.data.questionnaire;
    expect(v1.draftRevision).toBe(v0.draftRevision + 1);
    expect(v1.draft.questions.map((q) => q.label)).toEqual(['Edited', first!.label, 'Pick one']);
    expect(v1.draft.questions[0]!.id).toBe(third!.id); // ids survive edits/reorders
    expect(v1.draft.questions.some((q) => q.id === second!.id)).toBe(false);
    expect(v1.draft.questions[2]!.choices).toHaveLength(3);
    expect(v1.draft.questions[2]!.choices.every((ch) => !!ch.id)).toBe(true);
    expect(await view(c, b.id)).toMatchObject({ draftRevision: v1.draftRevision });
  });

  it('allows incomplete drafts but reports publish issues', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const v = await view(c, b.id);
    const res = await c.put(
      qUrl(b.id, '/draft'),
      draftBody(v, [rating(''), choiceQ('Pick', ['Only one'])]),
    );
    expect(res.status).toBe(200);
    expect(res.body.data.questionnaire.issues.length).toBe(2);
  });

  it('validates structure with Zod', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const v = await view(c, b.id);
    const put = (questions: object[], over: object = {}) =>
      c.put(qUrl(b.id, '/draft'), draftBody(v, questions, over));

    expect((await put([{ ...rating(), type: 'date' }])).status).toBe(422);
    expect((await put([rating('x', { choices: [{ label: 'a' }] })])).status).toBe(422);
    expect(
      (
        await put([
          choiceQ(
            'too many',
            Array.from({ length: 11 }, (_, i) => `c${i}`),
          ),
        ])
      ).status,
    ).toBe(422);
    expect((await put(Array.from({ length: 31 }, () => rating()))).status).toBe(422);
    expect((await put([rating('dup', { id: 'x' }), rating('dup2', { id: 'x' })])).status).toBe(422);
    expect((await put([rating()], { title: '' })).status).toBe(422);
    expect((await put([rating()], { publishedVersion: 9 })).status).toBe(422);
    expect((await put([{ ...rating(), required: 'yes' }])).status).toBe(422);
  });

  it('rejects a stale baseRevision with 409 and keeps the newer draft', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const v = await view(c, b.id);
    expect((await c.put(qUrl(b.id, '/draft'), draftBody(v, [rating('Newer')]))).status).toBe(200);
    const stale = await c.put(qUrl(b.id, '/draft'), draftBody(v, [rating('Stale')]));
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('REVISION_CONFLICT');
    expect((await view(c, b.id)).draft.questions[0]!.label).toBe('Newer');
  });
});

describe('publishing and versions', () => {
  it('publishes an immutable version and preserves history', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const v0 = await view(c, b.id);
    const p1 = await c.post(qUrl(b.id, '/publish'), { expectedRevision: v0.draftRevision });
    expect(p1.status).toBe(200);
    expect(p1.body.data.questionnaire).toMatchObject({
      publishedVersion: 1,
      hasUnpublishedChanges: false,
    });

    // publishing does not bump the draft revision, so v0's revision is still current
    const edited = await c.put(qUrl(b.id, '/draft'), draftBody(v0, [rating('Version two')]));
    expect(edited.status).toBe(200);
    const v1 = edited.body.data.questionnaire as View;
    expect(v1.hasUnpublishedChanges).toBe(true);

    const p2 = await c.post(qUrl(b.id, '/publish'), { expectedRevision: v1.draftRevision });
    expect(p2.body.data.questionnaire.publishedVersion).toBe(2);
    expect(p2.body.data.questionnaire.versions.map((x: { version: number }) => x.version)).toEqual([
      2, 1,
    ]);

    const old = await c.get(qUrl(b.id, '/versions/1'));
    expect(old.body.data.version.questions).toHaveLength(v0.draft.questions.length);
    const latest = await c.get(qUrl(b.id, '/versions/2'));
    expect(latest.body.data.version.questions[0].label).toBe('Version two');
    expect((await c.get(qUrl(b.id, '/versions/9'))).status).toBe(404);
    expect(await QuestionnaireVersion.countDocuments()).toBe(2);
  });

  it('refuses invalid, empty and unchanged publishes', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    let v = await view(c, b.id);

    const bad = [
      [],
      [rating('')],
      [choiceQ('One choice', ['x'])],
      [choiceQ('Blank choice', ['x', ' '])],
      [choiceQ('Same', ['Yes', 'yes'])],
    ];
    for (const questions of bad) {
      const saved = await c.put(qUrl(b.id, '/draft'), draftBody(v, questions));
      v = saved.body.data.questionnaire;
      const res = await c.post(qUrl(b.id, '/publish'), { expectedRevision: v.draftRevision });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('QUESTIONNAIRE_INVALID');
      expect(res.body.error.details.issues.length).toBeGreaterThan(0);
    }
    expect(await QuestionnaireVersion.countDocuments()).toBe(0);

    const good = await c.put(qUrl(b.id, '/draft'), draftBody(v, [rating()]));
    v = good.body.data.questionnaire;
    expect(
      (await c.post(qUrl(b.id, '/publish'), { expectedRevision: v.draftRevision })).status,
    ).toBe(200);
    const again = await c.post(qUrl(b.id, '/publish'), { expectedRevision: v.draftRevision });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NOTHING_TO_PUBLISH');
  });

  it('rejects publishing a stale revision', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const v = await view(c, b.id);
    await c.put(qUrl(b.id, '/draft'), draftBody(v, [rating('Changed')]));
    const res = await c.post(qUrl(b.id, '/publish'), { expectedRevision: v.draftRevision });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REVISION_CONFLICT');
  });

  it('concurrent publishes of the same draft create exactly one version', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const v = await view(c, b.id);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        c.post(qUrl(b.id, '/publish'), { expectedRevision: v.draftRevision }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await QuestionnaireVersion.countDocuments()).toBe(1);
    expect((await view(c, b.id)).publishedVersion).toBe(1);
  });

  it('marks the questionnaire onboarding step complete on publish', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const v = await view(c, b.id);
    await c.post(qUrl(b.id, '/publish'), { expectedRevision: v.draftRevision });
    const ob = await c.get(`/api/v1/businesses/${b.id}/onboarding`);
    expect(ob.body.data.onboarding.completedSteps).toContain('questionnaire');
  });
});

describe('authorization and tenant isolation', () => {
  it('blocks other tenants everywhere', async () => {
    const owner = await newUser();
    const other = await newUser();
    const b = await newBusiness(owner);
    const v = await view(owner, b.id);
    await owner.post(qUrl(b.id, '/publish'), { expectedRevision: v.draftRevision });

    expect((await other.get(qUrl(b.id))).status).toBe(403);
    expect((await other.put(qUrl(b.id, '/draft'), draftBody(v, [rating()]))).status).toBe(403);
    expect((await other.post(qUrl(b.id, '/publish'), { expectedRevision: 1 })).status).toBe(403);
    expect((await other.get(qUrl(b.id, '/versions/1'))).status).toBe(403);
    expect((await other.get(`/api/v1/businesses/${b.id}/qr`)).status).toBe(403);
    expect((await other.get(`/api/v1/businesses/${b.id}/qr.svg`)).status).toBe(403);
    expect((await other.get(`/api/v1/businesses/${b.id}/qr.png`)).status).toBe(403);
    expect((await request(createApp()).get(qUrl(b.id))).status).toBe(401);
  });

  it('lets members read but only the owner modify', async () => {
    const owner = await newUser();
    const member = await newUser();
    const b = await newBusiness(owner);
    await BusinessMembership.create({ businessId: b.id, userId: member.userId, role: 'member' });
    const v = await view(owner, b.id);

    expect((await member.get(qUrl(b.id))).status).toBe(200);
    expect((await member.get(`/api/v1/businesses/${b.id}/qr`)).status).toBe(200);
    expect((await member.put(qUrl(b.id, '/draft'), draftBody(v, [rating()]))).status).toBe(403);
    expect(
      (await member.post(qUrl(b.id, '/publish'), { expectedRevision: v.draftRevision })).status,
    ).toBe(403);
    expect(await QuestionnaireVersion.countDocuments()).toBe(0);
  });

  it('requires CSRF for draft and publish', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const v = await view(c, b.id);
    expect((await c.agent.put(qUrl(b.id, '/draft')).send(draftBody(v, [rating()]))).status).toBe(
      403,
    );
    expect((await c.agent.post(qUrl(b.id, '/publish')).send({ expectedRevision: 1 })).status).toBe(
      403,
    );
  });
});

describe('QR code and public URL', () => {
  it('encodes the configured LAN URL in both locally generated download formats', async () => {
    const originalBase = env.PUBLIC_APP_BASE_URL;
    env.PUBLIC_APP_BASE_URL = 'http://192.168.1.10:4200';
    try {
      const c = await newUser();
      const b = await newBusiness(c);
      const expectedUrl = `http://192.168.1.10:4200/r/${b.slug}`;
      const qr = await c.get(`/api/v1/businesses/${b.id}/qr`);
      expect(qr.body.data.publicUrl).toBe(expectedUrl);
      expect(qr.body.data.publicUrl).not.toContain('localhost');
      const options = { errorCorrectionLevel: 'M' as const, margin: 4, width: 1024 };

      const svg = await c
        .get(`/api/v1/businesses/${b.id}/qr.svg?download=1`)
        .buffer(true)
        .parse(binary);
      expect(svg.status).toBe(200);
      expect(svg.headers['content-disposition']).toContain(`${b.slug}-qr.svg`);
      expect((svg.body as Buffer).toString()).toBe(
        await QRCode.toString(expectedUrl, { ...options, type: 'svg' }),
      );

      const png = await c
        .get(`/api/v1/businesses/${b.id}/qr.png?download=1`)
        .buffer(true)
        .parse(binary);
      expect(png.status).toBe(200);
      expect(png.headers['content-disposition']).toContain(`${b.slug}-qr.png`);
      expect(png.body as Buffer).toEqual(
        await QRCode.toBuffer(expectedUrl, { ...options, type: 'png' }),
      );
      // No outbound requests or remote image API is involved in either renderer.
    } finally {
      env.PUBLIC_APP_BASE_URL = originalBase;
    }
  });

  it('has a permanent URL that survives renames and republishing', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const first = (await c.get(`/api/v1/businesses/${b.id}/qr`)).body.data;
    expect(first.publicUrl).toBe(`http://localhost:4200/r/${b.slug}`);
    expect(first.published).toBe(false);

    const v = await view(c, b.id);
    await c.post(qUrl(b.id, '/publish'), { expectedRevision: v.draftRevision });
    await c.patch(`/api/v1/businesses/${b.id}`, { name: 'Totally Different Name' });
    const v2 = await view(c, b.id);
    await c.put(qUrl(b.id, '/draft'), draftBody(v2, [rating('New')]));
    const v3 = await view(c, b.id);
    await c.post(qUrl(b.id, '/publish'), { expectedRevision: v3.draftRevision });

    const after = (await c.get(`/api/v1/businesses/${b.id}/qr`)).body.data;
    expect(after.publicUrl).toBe(first.publicUrl);
    expect(after.published).toBe(true);
  });

  it('serves SVG and PNG images; downloads set a filename', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const svg = await c.get(`/api/v1/businesses/${b.id}/qr.svg`).buffer(true).parse(binary);
    expect(svg.status).toBe(200);
    expect(svg.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect((svg.body as Buffer).toString()).toContain('<svg');
    expect(svg.headers['content-disposition']).toBeUndefined();

    const png = await c.get(`/api/v1/businesses/${b.id}/qr.png`).buffer(true).parse(binary);
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toMatch(/image\/png/);
    expect((png.body as Buffer).subarray(1, 4).toString()).toBe('PNG');

    const dl = await c.get(`/api/v1/businesses/${b.id}/qr.png?download=1`);
    expect(dl.headers['content-disposition']).toContain(`${b.slug}-qr.png`);
  });

  it('exposes only the public URL, nothing about the owner', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const body = JSON.stringify((await c.get(`/api/v1/businesses/${b.id}/qr`)).body);
    expect(body).not.toContain('private@owner.example');
    expect(body).not.toContain(b.id);
    expect(body).not.toContain(c.userId);
  });
});

describe('public form (no login)', () => {
  it('shows the published version anonymously, never the draft', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const v = await view(c, b.id);
    await c.put(qUrl(b.id, '/draft'), draftBody(v, [rating('Published question')]));
    const v1 = await view(c, b.id);
    await c.post(qUrl(b.id, '/publish'), { expectedRevision: v1.draftRevision });
    await c.put(
      qUrl(b.id, '/draft'),
      draftBody(v1, [rating('Unpublished edit')], { baseRevision: v1.draftRevision }),
    );

    const res = await request(createApp()).get(`/api/v1/public/${b.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.business).toEqual({
      name: 'Quiet Corner Cafe',
      slug: b.slug,
      category: 'Cafe',
      googleReviewUrl: null,
      logoUrl: null,
    });
    expect(res.body.data.questionnaire.version).toBe(1);
    expect(res.body.data.questionnaire.questions[0].label).toBe('Published question');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('Unpublished edit');
    expect(raw).not.toContain('private@owner.example');
    expect(raw).not.toContain(c.userId);
    expect(raw).not.toContain(b.id);
  });

  it('serves the same URL with the new version after republishing', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const v = await view(c, b.id);
    await c.post(qUrl(b.id, '/publish'), { expectedRevision: v.draftRevision });
    const saved = await c.put(
      qUrl(b.id, '/draft'),
      draftBody(v, [rating('Second')], { baseRevision: v.draftRevision }),
    );
    await c.post(qUrl(b.id, '/publish'), {
      expectedRevision: saved.body.data.questionnaire.draftRevision,
    });
    const res = await request(createApp()).get(`/api/v1/public/${b.slug}`);
    expect(res.body.data.questionnaire.version).toBe(2);
  });

  it('returns the same 404 for unpublished, unknown, malformed and disabled links', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const app = createApp();
    const unpublished = await request(app).get(`/api/v1/public/${b.slug}`);
    expect(unpublished.status).toBe(404);
    expect(unpublished.body.error.code).toBe('FORM_UNAVAILABLE');

    const v = await view(c, b.id);
    await c.post(qUrl(b.id, '/publish'), { expectedRevision: v.draftRevision });
    expect((await request(app).get(`/api/v1/public/${b.slug}`)).status).toBe(200);

    for (const slug of ['no-such-business', 'Bad_Slug!', 'x'.repeat(80), '%20']) {
      const res = await request(app).get(`/api/v1/public/${slug}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(unpublished.body);
    }
    await Business.updateOne({ _id: b.id }, { status: 'disabled' });
    expect((await request(app).get(`/api/v1/public/${b.slug}`)).status).toBe(404);
  });
});

describe('finishing onboarding', () => {
  const finish = (c: Client, id: string) => c.post(`/api/v1/businesses/${id}/onboarding/finish`);
  const step = (c: Client, id: string, body: object) =>
    c.patch(`/api/v1/businesses/${id}/onboarding`, body);

  it('cannot skip past the questionnaire or finish without required setup', async () => {
    const c = await newUser();
    const b = await newBusiness(c);

    const skip = await step(c, b.id, { currentStep: 'confirm' });
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe('QUESTIONNAIRE_NOT_PUBLISHED');

    const early = await finish(c, b.id);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('ONBOARDING_INCOMPLETE');
    expect(early.body.error.details.missing).toEqual(['confirm', 'questionnaire']);

    // forge the flags directly: still refused because real state is checked
    await Business.updateOne(
      { _id: b.id },
      { 'onboarding.completedSteps': ['business', 'confirm', 'questionnaire', 'qr'] },
    );
    const forged = await finish(c, b.id);
    expect(forged.status).toBe(409);
    expect(forged.body.error.details.missing).toEqual(['questionnaire']);
    expect((await Business.findById(b.id).lean())?.onboarding?.completedAt).toBeNull();
  });

  it('completes server-side once confirmed and published; idempotent; resumes correctly before', async () => {
    const c = await newUser();
    const b = await newBusiness(c);
    const v = await view(c, b.id);
    await c.post(qUrl(b.id, '/publish'), { expectedRevision: v.draftRevision });

    // not confirmed yet
    expect((await finish(c, b.id)).body.error.details.missing).toEqual(['confirm']);
    expect((await step(c, b.id, { currentStep: 'confirm' })).status).toBe(200);
    expect((await step(c, b.id, { completeStep: 'confirm' })).status).toBe(200);
    expect((await step(c, b.id, { currentStep: 'qr' })).status).toBe(200);

    const done = await finish(c, b.id);
    expect(done.status).toBe(200);
    const biz = done.body.data.business;
    expect(biz.status).toBe('active');
    expect(biz.onboarding.completedAt).toBeTruthy();
    expect(biz.onboarding.completedSteps).toEqual(['business', 'questionnaire', 'confirm', 'qr']);

    const again = await finish(c, b.id);
    expect(again.status).toBe(200);
    expect(again.body.data.business.onboarding.completedAt).toBe(biz.onboarding.completedAt);
    expect((await request(createApp()).get(`/api/v1/public/${b.slug}`)).status).toBe(200);
  });

  it('is owner-only and tenant-isolated', async () => {
    const owner = await newUser();
    const member = await newUser();
    const other = await newUser();
    const b = await newBusiness(owner);
    await BusinessMembership.create({ businessId: b.id, userId: member.userId, role: 'member' });
    expect((await finish(member, b.id)).status).toBe(403);
    expect((await finish(other, b.id)).status).toBe(403);
    expect(
      (await request(createApp()).post(`/api/v1/businesses/${b.id}/onboarding/finish`)).status,
    ).toBe(403); // CSRF first
  });
});

function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
