const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trimmed, lower-cased email, or null when it does not look like one. */
export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  return v.length <= 254 && EMAIL.test(v) ? v : null;
}

/**
 * E.164 phone number, or null when invalid. Numbers must carry a country code (`+` or `00`
 * prefix): a business has no country setting yet, so guessing a default would mis-merge contacts.
 */
export function normalizePhone(raw: string): string | null {
  let v = raw.trim().replace(/[\s().-]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  return /^\+[1-9]\d{7,14}$/.test(v) ? v : null;
}
