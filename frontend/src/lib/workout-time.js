import { dateLocale } from './i18n.js'
import { durPart, localTZ } from './format.js'

export const WORKOUT_TIME_SOURCE = Object.freeze({
  NATIVE: 'native',
  IMPORT: 'import'
})

export const WORKOUT_TIME_PRECISION = Object.freeze({
  DATE_ONLY: 'date-only',
  MINUTE: 'minute',
  SECOND: 'second',
  MILLISECOND: 'millisecond'
})

const TIMED_PRECISIONS = new Set([
  WORKOUT_TIME_PRECISION.MINUTE,
  WORKOUT_TIME_PRECISION.SECOND,
  WORKOUT_TIME_PRECISION.MILLISECOND
])
const MAX_DATE_MS = 8640000000000000
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const timestampOf = value => {
  const n = value instanceof Date ? value.getTime() : value
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_DATE_MS ? n : null
}

const requiredTimestamp = (value, field) => {
  const timestamp = timestampOf(value)
  if (timestamp == null) throw new TypeError(`${field} must be a valid timestamp`)
  return timestamp
}

const canonicalTimeZone = value => {
  if (typeof value !== 'string' || !value) return null
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: value }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

const safeTimeZone = (value, fallback = 'UTC') =>
  canonicalTimeZone(value) || canonicalTimeZone(fallback) || 'UTC'

const safeLocale = value => {
  try {
    const [locale] = Intl.getCanonicalLocales(value || 'en-GB')
    return locale || 'en-GB'
  } catch {
    return 'en-GB'
  }
}

const datePartsAt = (timestamp, timeZone) => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone
    }).formatToParts(new Date(timestamp))
    return Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  } catch {
    return null
  }
}

const dateKeyAt = (timestamp, timeZone) => {
  const parts = datePartsAt(timestamp, timeZone)
  return parts?.year && parts?.month && parts?.day
    ? `${parts.year}-${parts.month}-${parts.day}`
    : null
}

/** Calendar key for an absolute instant in a specific zone. */
export function workoutDateKey(now, timeZone = localTZ()) {
  const timestamp = requiredTimestamp(now, 'now')
  return dateKeyAt(timestamp, safeTimeZone(timeZone))
}

const validDateKey = value => {
  const match = typeof value === 'string' && value.match(ISO_DATE)
  if (!match) return null
  const [, year, month, day] = match
  const candidate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12))
  return candidate.getUTCFullYear() === Number(year) &&
    candidate.getUTCMonth() === Number(month) - 1 &&
    candidate.getUTCDate() === Number(day)
    ? value
    : null
}

const formatDateKey = (dateKey, locale) => {
  const valid = validDateKey(dateKey)
  if (!valid) return ''
  const [year, month, day] = valid.split('-').map(Number)
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(Date.UTC(year, month - 1, day, 12)))
  } catch {
    return ''
  }
}

const formatClock = (timestamp, locale, timeZone, includeSeconds = false) => {
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit', minute: '2-digit', ...(includeSeconds ? { second: '2-digit' } : {}), timeZone
    }).format(new Date(timestamp))
  } catch {
    return ''
  }
}

const formatTimeZoneName = (timestamp, locale, timeZone, style) => {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: style })
      .formatToParts(new Date(timestamp))
      .find(part => part.type === 'timeZoneName')?.value || ''
  } catch {
    return ''
  }
}

/**
 * Captures the complete native start stamp from one instant. Passing `now` makes
 * the operation deterministic in tests and prevents a date/timestamp mismatch at midnight.
 */
export function nativeWorkoutStart(now = Date.now(), timeZone = localTZ()) {
  const start = requiredTimestamp(now, 'now')
  const startTimeZone = safeTimeZone(timeZone)
  return {
    start,
    d: workoutDateKey(start, startTimeZone),
    startTimeZone,
    timeSource: WORKOUT_TIME_SOURCE.NATIVE,
    timePrecision: WORKOUT_TIME_PRECISION.MILLISECOND
  }
}

/**
 * Captures a native end stamp without mutating the active workout. Older active
 * workouts did not carry provenance, so their missing metadata is completed here.
 */
export function nativeWorkoutEnd(active, now = Date.now(), timeZone = localTZ()) {
  const end = requiredTimestamp(now, 'now')
  const endTimeZone = safeTimeZone(timeZone)
  return {
    end,
    startTimeZone: safeTimeZone(active?.startTimeZone, endTimeZone),
    endTimeZone,
    timeSource: typeof active?.timeSource === 'string'
      ? active.timeSource
      : WORKOUT_TIME_SOURCE.NATIVE,
    timePrecision: active?.timePrecision === WORKOUT_TIME_PRECISION.DATE_ONLY ||
      TIMED_PRECISIONS.has(active?.timePrecision)
      ? active.timePrecision
      : WORKOUT_TIME_PRECISION.MILLISECOND
  }
}

const precisionFacts = (workout, start, end) => {
  if (workout?.timePrecision === WORKOUT_TIME_PRECISION.DATE_ONLY) {
    return { precision: WORKOUT_TIME_PRECISION.DATE_ONLY, hasKnownTime: false, explicit: true }
  }
  if (TIMED_PRECISIONS.has(workout?.timePrecision)) {
    return { precision: workout.timePrecision, hasKnownTime: start != null, explicit: true }
  }

  // Legacy native workouts have a real positive interval. The old CSV importer instead
  // represented an unknown clock as a synthetic 18:00 start with start === end.
  const hasKnownTime = start != null && (end == null || end > start)
  return {
    precision: hasKnownTime
      ? WORKOUT_TIME_PRECISION.MILLISECOND
      : WORKOUT_TIME_PRECISION.DATE_ONLY,
    hasKnownTime,
    explicit: false
  }
}

const durationOf = (start, end, facts) =>
  facts.hasKnownTime && start != null && end != null && end > start ? end - start : null

/** Meaningful elapsed time, or null when either clock is unknown or invalid. */
export function workoutDurationMs(workout) {
  const value = workout && typeof workout === 'object' ? workout : {}
  const start = timestampOf(value.start)
  const end = timestampOf(value.end)
  return durationOf(start, end, precisionFacts(value, start, end))
}

/** Sum only known workout durations; null lets aggregate UI omit an invented "0 min". */
export function workoutDurationTotal(workouts) {
  let total = 0
  let hasKnownDuration = false
  for (const workout of Array.isArray(workouts) ? workouts : []) {
    const duration = workoutDurationMs(workout)
    if (duration == null) continue
    total += duration
    hasKnownDuration = true
  }
  return hasKnownDuration ? total : null
}

/**
 * Builds safe, localized presentation facts for native, imported and legacy workouts.
 * Empty strings/nulls are returned for invalid or unknown data; "Invalid Date" is never emitted.
 */
export function workoutTimeDisplay(workout, options = {}) {
  const value = workout && typeof workout === 'object' ? workout : {}
  const locale = safeLocale(options.locale || dateLocale())
  const fallbackTimeZone = safeTimeZone(options.fallbackTimeZone || localTZ())
  const startTimeZone = safeTimeZone(value.startTimeZone, fallbackTimeZone)
  const endTimeZone = safeTimeZone(value.endTimeZone, startTimeZone)
  const start = timestampOf(value.start)
  const end = timestampOf(value.end)
  const facts = precisionFacts(value, start, end)
  const durationMs = durationOf(start, end, facts)

  const actualStartDate = start == null ? null : dateKeyAt(start, startTimeZone)
  const date = validDateKey(value.d) || actualStartDate || ''
  const dateLabel = formatDateKey(date, locale)
  // An identical technical end is also used when an import knows only the start clock.
  // A positive interval is therefore required before presenting an end or a duration.
  const canShowEnd = durationMs != null
  const actualEndDate = canShowEnd ? dateKeyAt(end, endTimeZone) : null
  const changesTimeZone = canShowEnd && startTimeZone !== endTimeZone
  const startOffset = canShowEnd
    ? formatTimeZoneName(start, 'en-GB', startTimeZone, 'longOffset')
    : ''
  const endOffset = canShowEnd
    ? formatTimeZoneName(end, 'en-GB', endTimeZone, 'longOffset')
    : ''
  const changesOffset = canShowEnd && !!startOffset && !!endOffset && startOffset !== endOffset
  const crossesDate = canShowEnd && actualStartDate !== actualEndDate
  const showEndDate = canShowEnd && (crossesDate || changesTimeZone)
  const showImportedSeconds = value.timeSource === WORKOUT_TIME_SOURCE.IMPORT &&
    (facts.precision === WORKOUT_TIME_PRECISION.SECOND ||
      facts.precision === WORKOUT_TIME_PRECISION.MILLISECOND)

  const startTime = facts.hasKnownTime && start != null
    ? formatClock(start, locale, startTimeZone, showImportedSeconds)
    : ''
  const endTime = canShowEnd ? formatClock(end, locale, endTimeZone, showImportedSeconds) : ''
  const endDateLabel = showEndDate ? formatDateKey(actualEndDate, locale) : ''
  const showZoneOffset = canShowEnd && (changesTimeZone || changesOffset)
  const startZoneLabel = showZoneOffset
    ? formatTimeZoneName(start, locale, startTimeZone, 'shortOffset')
    : ''
  const endZoneLabel = showZoneOffset
    ? formatTimeZoneName(end, locale, endTimeZone, 'shortOffset')
    : ''
  const startLabel = `${startTime}${startZoneLabel ? ` ${startZoneLabel}` : ''}`
  const endLabel = `${endTime}${endZoneLabel ? ` ${endZoneLabel}` : ''}`
  const timeRange = startTime
    ? endTime
      ? `${startLabel}–${endDateLabel ? `${endDateLabel} ` : ''}${endLabel}`
      : startLabel
    : ''

  return {
    date,
    dateLabel,
    startTime,
    endTime,
    startZoneLabel,
    endZoneLabel,
    endDateLabel,
    timeRange,
    durationMs,
    hasKnownTime: facts.hasKnownTime,
    dateOnly: !facts.hasKnownTime,
    precision: facts.precision,
    source: typeof value.timeSource === 'string' ? value.timeSource : 'legacy',
    startTimeZone,
    endTimeZone,
    crossesDate,
    changesTimeZone,
    changesOffset
  }
}

/** Date, optional clock range and optional meaningful duration, ready for UI joining. */
export function workoutChronologyParts(workout, options = {}) {
  const display = workoutTimeDisplay(workout, options)
  return [
    ...(display.dateLabel ? [display.dateLabel] : []),
    ...(display.timeRange ? [display.timeRange] : []),
    ...durPart(display.durationMs)
  ]
}
