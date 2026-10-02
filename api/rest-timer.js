const MAX_REST_MS = 3600 * 1000;

/** Validate an absolute deadline while retaining the legacy seconds request format. */
export function secondsUntilRestDeadline(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Number.isFinite(now)) return null;
  if (Object.hasOwn(body, 'deadlineAt')) {
    if (!Number.isFinite(body.deadlineAt)) return null;
    const remainingMs = body.deadlineAt - now;
    return remainingMs > 0 && remainingMs <= MAX_REST_MS ? remainingMs / 1000 : null;
  }
  // Keep the existing endpoint's coercion, rounding and clamp for older clients.
  return Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
}
