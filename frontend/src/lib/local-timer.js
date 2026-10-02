export const TIMER_VERSION = 1

const MAX_DURATION_MS = 86_400_000
const STATUSES = new Set(['running', 'cancelled', 'completed'])
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isId = value => typeof value === 'string' && value.trim().length > 0
const isSafeTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
const isRevision = value => Number.isSafeInteger(value) && value > 0

/** The token captures a particular revision, including terminal revisions. */
export function timerToken(record) {
  if (!isObject(record) || !isId(record.timerId) || !isRevision(record.revision)) return null
  return { timerId: record.timerId, revision: record.revision }
}

export function matchesTimer(record, token) {
  const current = timerToken(record)
  return !!current && isObject(token) && current.timerId === token.timerId && current.revision === token.revision
}

/** Only the durable timer schema crosses the storage boundary. */
export function validateTimer(record) {
  if (!isObject(record) || record.version !== TIMER_VERSION || !timerToken(record)) return null
  if (record.kind !== 'rest' && record.kind !== 'work') return null
  if (!isId(record.accountId) || !isId(record.workoutId) || !STATUSES.has(record.status)) return null
  if (!isSafeTime(record.durationMs) || record.durationMs > MAX_DURATION_MS) return null
  if (record.durationMs === 0 && record.status !== 'cancelled') return null
  if (!isSafeTime(record.startedAt) || !isSafeTime(record.deadlineAt) || !isSafeTime(record.updatedAt)) return null
  if (record.label !== undefined && typeof record.label !== 'string') return null
  if (record.deliveryPending !== undefined && typeof record.deliveryPending !== 'boolean') return null
  if (record.elapsedSeconds !== undefined && (
    record.kind !== 'work' || record.status !== 'completed' ||
    typeof record.elapsedSeconds !== 'number' || !Number.isFinite(record.elapsedSeconds) ||
    record.elapsedSeconds <= 0 || record.elapsedSeconds > Math.max(1, record.durationMs / 1000)
  )) return null

  let binding = null
  if (record.binding !== undefined && record.binding !== null) {
    if (!isObject(record.binding) || !isId(record.binding.entryId) || !isId(record.binding.setId)) return null
    binding = { entryId: record.binding.entryId, setId: record.binding.setId }
  }
  if (record.kind === 'work' && !binding) return null

  const normalized = {
    version: TIMER_VERSION,
    timerId: record.timerId,
    revision: record.revision,
    kind: record.kind,
    accountId: record.accountId,
    workoutId: record.workoutId,
    durationMs: record.durationMs,
    startedAt: record.startedAt,
    deadlineAt: record.deadlineAt,
    updatedAt: record.updatedAt,
    status: record.status,
    label: record.label ?? '',
    binding,
  }
  if (record.deliveryPending !== undefined) normalized.deliveryPending = record.deliveryPending
  if (record.elapsedSeconds !== undefined) normalized.elapsedSeconds = record.elapsedSeconds
  return normalized
}

function requireTime(value, name) {
  if (!isSafeTime(value)) throw new RangeError(`${name} must be a finite nonnegative safe timestamp`)
  return value
}

function nextRevision(record) {
  const revision = (timerToken(record)?.revision ?? 0) + 1
  if (!isRevision(revision)) throw new RangeError('Timer revision is exhausted')
  return revision
}

export function createTimer({ kind, accountId, workoutId, durationMs, label = '', binding = null }, previous, { wallNow, monoNow, id }) {
  requireTime(wallNow, 'wallNow')
  requireTime(monoNow, 'monoNow')
  if (!isSafeTime(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS) {
    throw new RangeError('Timer duration must be greater than zero and at most 24 hours')
  }
  requireTime(wallNow + durationMs, 'deadlineAt')
  const record = validateTimer({
    version: TIMER_VERSION,
    timerId: id,
    revision: nextRevision(previous),
    kind,
    accountId,
    workoutId,
    durationMs,
    startedAt: wallNow,
    deadlineAt: wallNow + durationMs,
    updatedAt: wallNow,
    status: 'running',
    label,
    binding,
  })
  if (!record) throw new TypeError('Invalid timer fields')
  return record
}

/** A monotonic anchor is process-local and must never be persisted. */
export function anchorTimer(record, { wallNow, monoNow }) {
  const token = timerToken(record)
  if (!token || !validateTimer(record)) return null
  requireTime(wallNow, 'wallNow')
  requireTime(monoNow, 'monoNow')
  const monoDeadline = monoNow + Math.max(0, record.deadlineAt - wallNow)
  requireTime(monoDeadline, 'monoDeadline')
  return { ...token, monoDeadline }
}

export function remainingTimerMs(record, anchor, { wallNow, monoNow }) {
  if (!record || record.status !== 'running') return 0
  if (matchesTimer(record, anchor) && isSafeTime(anchor.monoDeadline)) {
    requireTime(monoNow, 'monoNow')
    return Math.max(0, anchor.monoDeadline - monoNow)
  }
  requireTime(wallNow, 'wallNow')
  return Math.max(0, record.deadlineAt - wallNow)
}

export function displayTimer(record, remaining) {
  if (!record) return null
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) throw new TypeError('Invalid remaining time')
  return {
    ...record,
    left: Math.ceil(Math.max(0, remaining) / 1000),
    total: record.durationMs / 1000,
    endsAt: record.deadlineAt,
  }
}

/** Mutations are compare-and-swap operations on an identity and revision. */
export function changeTimer(record, token, operation, remainingMs, { wallNow }) {
  if (!matchesTimer(record, token) || record.status !== 'running') return record
  if (!validateTimer(record)) throw new TypeError('Invalid timer record')
  if (!isObject(operation) || !['extend', 'cancel', 'complete'].includes(operation.type)) {
    throw new TypeError('Invalid timer operation')
  }
  requireTime(wallNow, 'wallNow')
  if (typeof remainingMs !== 'number' || !Number.isFinite(remainingMs) || Math.abs(remainingMs) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError('remainingMs must be finite and safe')
  }
  if (operation.type === 'complete' && remainingMs > 0) return record

  const result = { ...record, revision: nextRevision(record), updatedAt: wallNow }
  if (operation.type === 'extend') {
    const deltaMs = operation.deltaMs
    if (typeof deltaMs !== 'number' || !Number.isFinite(deltaMs) || Math.abs(deltaMs) > Number.MAX_SAFE_INTEGER) {
      throw new RangeError('deltaMs must be finite and safe')
    }
    const durationMs = record.durationMs + deltaMs
    const remaining = remainingMs + deltaMs
    if (durationMs > MAX_DURATION_MS || remaining > MAX_DURATION_MS) throw new RangeError('Timer cannot exceed 24 hours')
    result.durationMs = Math.max(0, durationMs)
    result.deadlineAt = requireTime(wallNow + remaining, 'deadlineAt')
    if (remaining <= 0 || durationMs <= 0) result.status = 'cancelled'
  } else {
    result.status = operation.type === 'cancel' ? 'cancelled' : 'completed'
  }
  return result
}
