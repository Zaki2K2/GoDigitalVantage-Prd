import { Types } from 'mongoose';
import { z } from 'zod';
import { notFound } from '../../shared/errors';
import { Business } from '../businesses/business.model';
import { Contact } from '../contacts/contact.model';
import { QrEvent } from '../qr/qr-event.model';
import { Response } from '../responses/response.model';
import { recentResponses } from '../responses/response.service';

export const dashboardQuery = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
});

/** The last `days` calendar dates (YYYY-MM-DD) in the business timezone, oldest first. */
export function lastDays(days: number, timeZone: string, now: Date): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(fmt.format(new Date(now.getTime() - i * 24 * 3600 * 1000)));
  }
  return [...new Set(out)];
}

type DayCount = { _id: string; n: number };

export async function getDashboard(businessId: string, days: number, now = new Date()) {
  const bid = new Types.ObjectId(businessId);
  const business = await Business.findById(bid, { timezone: 1 }).lean();
  if (!business) throw notFound('Business not found');
  const timezone = business.timezone;
  const dates = lastDays(days, timezone, now);
  const since = new Date(now.getTime() - (days + 1) * 24 * 3600 * 1000);

  const perDay = (field: string) => [
    { $match: { businessId: bid, [field]: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone } },
        n: { $sum: 1 },
      },
    },
  ];

  const [scans, responses, contacts, rating, byRating, scanDays, responseDays, recent] =
    await Promise.all([
      QrEvent.countDocuments({ businessId: bid, eventType: 'scan' }),
      Response.countDocuments({ businessId: bid }),
      Contact.countDocuments({ businessId: bid }),
      Response.aggregate<{ avg: number; n: number }>([
        { $match: { businessId: bid, rating: { $ne: null } } },
        { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } },
      ]),
      Response.aggregate<{ _id: number; n: number }>([
        { $match: { businessId: bid, rating: { $ne: null } } },
        { $group: { _id: '$rating', n: { $sum: 1 } } },
      ]),
      QrEvent.aggregate<DayCount>(perDay('occurredAt')),
      Response.aggregate<DayCount>(perDay('submittedAt')),
      recentResponses(businessId, 5),
    ]);

  const s = new Map(scanDays.map((d) => [d._id, d.n]));
  const r = new Map(responseDays.map((d) => [d._id, d.n]));
  return {
    days,
    timezone,
    totals: {
      scans,
      responses,
      contacts,
      /** Mean of the questionnaire's rating question (1-5). Not a Google review rating. */
      averageRating: rating[0] ? Math.round(rating[0].avg * 100) / 100 : null,
      ratedResponses: rating[0]?.n ?? 0,
    },
    /** Rated responses per star, index 0 = 1 star ... index 4 = 5 stars (all time). */
    ratingDistribution: [1, 2, 3, 4, 5].map((star) => byRating.find((r) => r._id === star)?.n ?? 0),
    trend: dates.map((date) => ({ date, scans: s.get(date) ?? 0, responses: r.get(date) ?? 0 })),
    recent,
  };
}
