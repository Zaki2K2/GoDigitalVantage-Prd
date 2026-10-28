import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { createPublicScanLimiter, createPublicSubmitLimiter } from '../../middleware/rate-limit';
import { CONSENT_WORDING_VERSION, consentWording } from '../contacts/contact.service';
import { getPublicForm, loadPublished } from '../questionnaires/questionnaire.service';
import { recordScan } from '../qr/scan.service';
import { submissionSchema } from '../responses/response.schemas';
import { publicCard } from '../rewards/reward.service';
import { submitResponse } from '../responses/submission.service';

/** Anonymous endpoints: no cookies, no CSRF (mounted before the CSRF-protected group). */
export function createPublicRouter() {
  const router = Router();
  const submitLimiter = createPublicSubmitLimiter();
  const scanLimiter = createPublicScanLimiter();
  const slugOf = (v: unknown) => (typeof v === 'string' ? v : '');

  router.get('/public/:slug', async (req, res) => {
    const form = await getPublicForm(slugOf(req.params['slug']));
    const wording = consentWording(form.business.name);
    res.set('Cache-Control', 'no-cache');
    res.json({
      data: {
        ...form,
        consent: {
          wordingVersion: CONSENT_WORDING_VERSION,
          reviewRequestSms: wording.review_request_sms,
          marketingSms: wording.marketing_sms,
          whatsappFollowUp: wording.whatsapp_followup,
        },
      },
    });
  });

  /** Called once per real page load by the public page (not per asset or API read). */
  router.post('/public/:slug/scan', scanLimiter, async (req, res) => {
    await recordScan(slugOf(req.params['slug']), req.ip ?? '', req.get('user-agent') ?? '');
    res.status(204).end();
  });

  /** Customer reward card. The link is a signed token, so it cannot be guessed or enumerated. */
  router.get('/public/rewards/:token', scanLimiter, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await publicCard(slugOf(req.params['token'])) });
  });

  router.post('/public/:slug/responses', submitLimiter, async (req, res) => {
    const slug = slugOf(req.params['slug']);
    const input = submissionSchema.parse(req.body);
    if (input.website && input.website.trim() !== '') {
      // Honeypot tripped: look successful to the bot, store nothing.
      await loadPublished(slug);
      res.status(201).json({
        data: {
          responseId: randomBytes(12).toString('hex'),
          duplicate: false,
          googleReviewUrl: null,
          reward: null,
        },
      });
      return;
    }
    const result = await submitResponse(slug, input, {
      ip: req.ip ?? '',
      userAgent: req.get('user-agent') ?? '',
    });
    res.status(result.duplicate ? 200 : 201).json({ data: result });
  });

  return router;
}
