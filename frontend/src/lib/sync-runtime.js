export const MAX_SYNC_RETRY_MS = 60_000

// Full jitter avoids every open tab/device retrying the instant CasaOS comes back. The first
// retry remains quick, while the cap guarantees we also recover when navigator.onLine never
// changes (for example only the API container was restarted).
export function syncRetryDelay(attempt, random = Math.random) {
  const ceiling = Math.min(MAX_SYNC_RETRY_MS, 1_000 * (2 ** Math.max(0, attempt)))
  return Math.max(250, Math.round(ceiling * (0.5 + (random() * 0.5))))
}

export function syncErrorKind(error, online = true) {
  if (error?.status === 401) return 'auth_required'
  if (error?.status === 412) return 'conflict'
  if (error?.status === 400 || error?.status === 409 || error?.status === 413) return 'error'
  if (!online || error?.code === 'API_TIMEOUT' || !error?.status || error.status >= 500) return 'offline'
  return 'error'
}

export const isTransientSyncError = error => (
  !error?.status || error?.code === 'API_TIMEOUT' || error.status >= 500
)
