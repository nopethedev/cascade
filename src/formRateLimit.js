// Public forms are tokenless, so they are the easiest write endpoint to abuse.
// Keep a bounded fixed-window counter per form + remote address. This is
// intentionally process-local: a multi-process deployment should also put a
// shared limiter (or reverse-proxy limit) in front of it.
const buckets = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 10;
const MAX_BUCKETS = 5000;

function prune(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // A sustained attack from many addresses must not grow memory forever.
  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

export function allowFormSubmission(key, now = Date.now()) {
  const normalized = String(key || 'unknown').slice(0, 300);
  const bucket = buckets.get(normalized);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(normalized, { count: 1, resetAt: now + WINDOW_MS });
    if (buckets.size > MAX_BUCKETS) prune(now);
    return { ok: true, remaining: MAX_PER_WINDOW - 1, retryAfter: 0 };
  }
  if (bucket.count >= MAX_PER_WINDOW) {
    return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { ok: true, remaining: MAX_PER_WINDOW - bucket.count, retryAfter: 0 };
}

export function resetFormRateLimitForTests() {
  buckets.clear();
}
