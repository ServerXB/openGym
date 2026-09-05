import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  nativeWorkoutEnd,
  nativeWorkoutStart,
  workoutChronologyParts,
  workoutDurationTotal,
  workoutTimeDisplay,
  WORKOUT_TIME_PRECISION,
  WORKOUT_TIME_SOURCE
} from './workout-time.js'

const minute = 60000

afterEach(() => vi.restoreAllMocks())

describe('native workout timestamp capture', () => {
  it('derives the timestamp and calendar date from one captured instant', () => {
    const instant = Date.parse('2026-08-26T22:30:00.123Z')
    const now = vi.spyOn(Date, 'now').mockReturnValue(instant)

    expect(nativeWorkoutStart(undefined, 'Europe/Rome')).toEqual({
      start: instant,
      d: '2026-08-27',
      startTimeZone: 'Europe/Rome',
      timeSource: WORKOUT_TIME_SOURCE.NATIVE,
      timePrecision: WORKOUT_TIME_PRECISION.MILLISECOND
    })
    expect(now).toHaveBeenCalledTimes(1)
  })

  it('captures the end once, preserves start provenance and does not mutate active', () => {
    const active = {
      start: Date.parse('2026-08-26T16:05:00Z'),
      startTimeZone: 'Europe/Rome',
      timeSource: WORKOUT_TIME_SOURCE.NATIVE,
      timePrecision: WORKOUT_TIME_PRECISION.MILLISECOND
    }
    const before = structuredClone(active)
    const instant = Date.parse('2026-08-26T17:12:00Z')
    const now = vi.spyOn(Date, 'now').mockReturnValue(instant)

    expect(nativeWorkoutEnd(active, undefined, 'America/New_York')).toEqual({
      end: instant,
      startTimeZone: 'Europe/Rome',
      endTimeZone: 'America/New_York',
      timeSource: WORKOUT_TIME_SOURCE.NATIVE,
      timePrecision: WORKOUT_TIME_PRECISION.MILLISECOND
    })
    expect(active).toEqual(before)
    expect(now).toHaveBeenCalledTimes(1)
  })

  it('completes missing metadata when a legacy active workout is finished', () => {
    const end = Date.parse('2026-08-26T17:12:00Z')
    expect(nativeWorkoutEnd({ start: end - minute }, end, 'Europe/Rome')).toEqual({
      end,
      startTimeZone: 'Europe/Rome',
      endTimeZone: 'Europe/Rome',
      timeSource: WORKOUT_TIME_SOURCE.NATIVE,
      timePrecision: WORKOUT_TIME_PRECISION.MILLISECOND
    })
  })

  it('survives a JSON persistence round trip without changing its meaning', () => {
    const start = nativeWorkoutStart(Date.parse('2026-08-26T16:05:00.123Z'), 'Europe/Rome')
    const restored = JSON.parse(JSON.stringify(start))
    expect(restored).toEqual(start)
    expect(workoutTimeDisplay(restored, { locale: 'en-GB' }).startTime).toBe('18:05')
  })

  it('rejects an invalid capture instant instead of storing corrupt data', () => {
    expect(() => nativeWorkoutStart(Number.NaN, 'UTC')).toThrow(TypeError)
    expect(() => nativeWorkoutEnd({}, Number.POSITIVE_INFINITY, 'UTC')).toThrow(TypeError)
  })
})

describe('workout chronology presentation', () => {
  it('omits unknown durations from aggregates instead of inventing zero minutes', () => {
    const start = Date.parse('2026-08-26T16:05:00Z')
    const dateOnly = {
      start, end: start, timeSource: WORKOUT_TIME_SOURCE.IMPORT,
      timePrecision: WORKOUT_TIME_PRECISION.DATE_ONLY
    }
    const known = {
      start, end: start + 20 * minute, timeSource: WORKOUT_TIME_SOURCE.NATIVE,
      timePrecision: WORKOUT_TIME_PRECISION.MILLISECOND
    }

    expect(workoutDurationTotal([dateOnly])).toBeNull()
    expect(workoutDurationTotal([dateOnly, known])).toBe(20 * minute)
    expect(workoutDurationTotal(null)).toBeNull()
  })

  it('formats a native same-day interval and its meaningful duration', () => {
    const start = Date.parse('2026-08-26T16:05:00Z')
    const workout = {
      d: '2026-08-26', start, end: start + 67 * minute,
      startTimeZone: 'Europe/Rome', endTimeZone: 'Europe/Rome',
      timeSource: WORKOUT_TIME_SOURCE.NATIVE,
      timePrecision: WORKOUT_TIME_PRECISION.MILLISECOND
    }
    const display = workoutTimeDisplay(workout, { locale: 'en-GB' })

    expect(display.dateLabel).toContain('26 Aug')
    expect(display.dateLabel).toContain('2026')
    expect(display.timeRange).toBe('18:05\u201319:12')
    expect(display.durationMs).toBe(67 * minute)
    expect(display.hasKnownTime).toBe(true)
    expect(display.dateOnly).toBe(false)
    expect(workoutChronologyParts(workout, { locale: 'en-GB' })).toEqual([
      display.dateLabel, '18:05\u201319:12', '1h 7m'
    ])
  })

  it('uses the selected locale for the complete date and clock range', () => {
    const start = Date.parse('2026-08-26T16:05:00Z')
    const display = workoutTimeDisplay({
      d: '2026-08-26', start, end: start + 67 * minute,
      startTimeZone: 'Europe/Rome', endTimeZone: 'Europe/Rome',
      timeSource: WORKOUT_TIME_SOURCE.NATIVE,
      timePrecision: WORKOUT_TIME_PRECISION.MILLISECOND
    }, { locale: 'it-IT' })

    expect(display.dateLabel.toLowerCase()).toContain('26 ago 2026')
    expect(display.timeRange).toBe('18:05–19:12')
  })

  it('never displays the technical placeholder clock of a date-only import', () => {
    const placeholder = Date.parse('2026-08-26T18:00:00Z')
    const workout = {
      d: '2026-08-26', start: placeholder, end: placeholder,
      startTimeZone: 'UTC', endTimeZone: 'UTC',
      timeSource: WORKOUT_TIME_SOURCE.IMPORT,
      timePrecision: WORKOUT_TIME_PRECISION.DATE_ONLY
    }
    const display = workoutTimeDisplay(workout, { locale: 'en-GB' })

    expect(display.dateLabel).toContain('26 Aug')
    expect(display.timeRange).toBe('')
    expect(display.durationMs).toBeNull()
    expect(display.dateOnly).toBe(true)
    expect(workoutChronologyParts(workout, { locale: 'en-GB' })).toEqual([display.dateLabel])
    expect(workoutChronologyParts(workout, { locale: 'en-GB' }).join(' ')).not.toContain('18:00')
  })

  it('recognizes the equal start/end placeholder written by the legacy importer', () => {
    const placeholder = Date.parse('2026-08-26T18:00:00Z')
    const display = workoutTimeDisplay(
      { d: '2026-08-26', start: placeholder, end: placeholder },
      { locale: 'en-GB', fallbackTimeZone: 'UTC' }
    )

    expect(display.source).toBe('legacy')
    expect(display.precision).toBe(WORKOUT_TIME_PRECISION.DATE_ONLY)
    expect(display.timeRange).toBe('')
  })

  it('keeps real legacy intervals readable without requiring a migration', () => {
    const start = Date.parse('2026-08-26T16:05:00Z')
    const display = workoutTimeDisplay(
      { d: '2026-08-26', start, end: start + 20 * minute },
      { locale: 'en-GB', fallbackTimeZone: 'Europe/Rome' }
    )

    expect(display.source).toBe('legacy')
    expect(display.timeRange).toBe('18:05\u201318:25')
    expect(display.durationMs).toBe(20 * minute)
  })

  it('shows a known imported start even when no end clock was supplied', () => {
    const display = workoutTimeDisplay({
      d: '2026-08-26',
      start: Date.parse('2026-08-26T16:05:00Z'),
      startTimeZone: 'Europe/Rome',
      timeSource: WORKOUT_TIME_SOURCE.IMPORT,
      timePrecision: WORKOUT_TIME_PRECISION.MINUTE
    }, { locale: 'en-GB' })

    expect(display.timeRange).toBe('18:05')
    expect(display.durationMs).toBeNull()
    expect(display.dateOnly).toBe(false)
  })

  it('does not turn an imported technical end equal to start into a known end', () => {
    const start = Date.parse('2026-08-26T16:05:00Z')
    const display = workoutTimeDisplay({
      d: '2026-08-26', start, end: start,
      startTimeZone: 'Europe/Rome', endTimeZone: 'Europe/Rome',
      timeSource: WORKOUT_TIME_SOURCE.IMPORT,
      timePrecision: WORKOUT_TIME_PRECISION.MINUTE
    }, { locale: 'en-GB' })

    expect(display.timeRange).toBe('18:05')
    expect(display.endTime).toBe('')
    expect(display.durationMs).toBeNull()
    expect(display.dateOnly).toBe(false)
  })

  it('adds the final calendar date when an interval crosses midnight', () => {
    const display = workoutTimeDisplay({
      d: '2026-08-26',
      start: Date.parse('2026-08-26T21:30:00Z'),
      end: Date.parse('2026-08-26T22:30:00Z'),
      startTimeZone: 'Europe/Rome', endTimeZone: 'Europe/Rome',
      timeSource: WORKOUT_TIME_SOURCE.NATIVE,
      timePrecision: WORKOUT_TIME_PRECISION.MILLISECOND
    }, { locale: 'en-GB' })

    expect(display.crossesDate).toBe(true)
    expect(display.changesTimeZone).toBe(false)
    expect(display.timeRange).toMatch(/^23:30\u2013.*27 Aug 2026.*00:30$/)
  })

  it('adds the final calendar date when the workout ends in another timezone', () => {
    const display = workoutTimeDisplay({
      d: '2026-08-26',
      start: Date.parse('2026-08-26T15:00:00Z'),
      end: Date.parse('2026-08-26T16:00:00Z'),
      startTimeZone: 'Europe/Rome', endTimeZone: 'America/New_York',
      timeSource: WORKOUT_TIME_SOURCE.NATIVE,
      timePrecision: WORKOUT_TIME_PRECISION.MILLISECOND
    }, { locale: 'en-GB' })

    expect(display.crossesDate).toBe(false)
    expect(display.changesTimeZone).toBe(true)
    expect(display.endDateLabel).toContain('26 Aug')
    expect(display.endDateLabel).toContain('2026')
    expect(display.timeRange).toMatch(/^17:00 GMT\+2\u2013.*26 Aug 2026.*12:00 GMT-4$/)
    expect(display.changesOffset).toBe(true)
  })

  it('uses timezone rules across a DST transition while duration stays absolute', () => {
    const display = workoutTimeDisplay({
      d: '2026-03-29',
      start: Date.parse('2026-03-29T00:30:00Z'),
      end: Date.parse('2026-03-29T01:30:00Z'),
      startTimeZone: 'Europe/Rome', endTimeZone: 'Europe/Rome',
      timeSource: WORKOUT_TIME_SOURCE.NATIVE,
      timePrecision: WORKOUT_TIME_PRECISION.MILLISECOND
    }, { locale: 'en-GB' })

    expect(display.timeRange).toBe('01:30 GMT+1\u201303:30 GMT+2')
    expect(display.durationMs).toBe(60 * minute)
    expect(display.crossesDate).toBe(false)
    expect(display.changesOffset).toBe(true)
  })

  it('disambiguates the repeated wall clock during the autumn DST fallback', () => {
    const display = workoutTimeDisplay({
      d: '2026-10-25',
      start: Date.parse('2026-10-25T00:30:00Z'),
      end: Date.parse('2026-10-25T01:30:00Z'),
      startTimeZone: 'Europe/Rome', endTimeZone: 'Europe/Rome',
      timeSource: WORKOUT_TIME_SOURCE.NATIVE,
      timePrecision: WORKOUT_TIME_PRECISION.MILLISECOND
    }, { locale: 'en-GB' })

    expect(display.startTime).toBe('02:30')
    expect(display.endTime).toBe('02:30')
    expect(display.timeRange).toBe('02:30 GMT+2\u201302:30 GMT+1')
    expect(display.durationMs).toBe(60 * minute)
    expect(display.changesOffset).toBe(true)
  })

  it('does not fabricate a negative range when corrupted data ends before it starts', () => {
    const start = Date.parse('2026-08-26T16:05:00Z')
    const display = workoutTimeDisplay({
      d: '2026-08-26', start, end: start - minute,
      startTimeZone: 'Europe/Rome',
      timeSource: WORKOUT_TIME_SOURCE.NATIVE,
      timePrecision: WORKOUT_TIME_PRECISION.MILLISECOND
    }, { locale: 'en-GB' })

    expect(display.timeRange).toBe('18:05')
    expect(display.durationMs).toBeNull()
  })

  it('returns safe empty presentation for invalid dates, timestamps, locales and zones', () => {
    const display = workoutTimeDisplay({
      d: '2026-02-30', start: Number.NaN, end: Number.POSITIVE_INFINITY,
      startTimeZone: 'Mars/Olympus', endTimeZone: 'Nowhere/Base',
      timePrecision: WORKOUT_TIME_PRECISION.MILLISECOND
    }, { locale: 'not_a_locale', fallbackTimeZone: 'also/not-a-zone' })
    const parts = workoutChronologyParts({
      d: 'totally-invalid', start: Number.NaN, end: Number.NaN
    }, { locale: 'not_a_locale', fallbackTimeZone: 'also/not-a-zone' })

    expect(display.dateLabel).toBe('')
    expect(display.timeRange).toBe('')
    expect(display.durationMs).toBeNull()
    expect(parts).toEqual([])
    expect(JSON.stringify({ display, parts })).not.toContain('Invalid Date')
  })
})
