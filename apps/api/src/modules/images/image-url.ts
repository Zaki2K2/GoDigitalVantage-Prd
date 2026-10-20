/** Versioned URL: the version changes on every upload so caches never serve a stale image. */
export function imageUrl(path: string, updatedAt: Date | null | undefined): string | null {
  return updatedAt ? `${path}?v=${new Date(updatedAt).getTime()}` : null;
}
