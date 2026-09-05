import { describe, expect, it } from 'vitest'
import { localTZ } from './format.js'
import { parseWhen, parseWorkoutCSV } from './import-csv.js'
import { workoutChronologyParts, workoutTimeDisplay } from './workout-time.js'

const HEVY = 'title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps'
const parse = (...lines) => parseWorkoutCSV([HEVY, ...lines].join('\n'), { unit: 'kg' })
const onlyWorkout = parsed => {
  expect(parsed.error).toBeUndefined()
  expect(parsed.workouts).toHaveLength(1)
  return parsed.workouts[0]
}

describe('import date validation', () => {
  it('classifies supported values by their actual precision', () => {
    expect(parseWhen('2026-08-29')).toEqual({ d: '2026-08-29', t: null, precision: 'date-only' })
    expect(parseWhen('29 Aug 2026, 07:05')).toEqual({ d: '2026-08-29', t: 25_500_000, precision: 'minute' })
    expect(parseWhen('2026-08-29 07:05:59 +0200')).toEqual({
      d: '2026-08-29', t: 25_559_000, precision: 'second',
      epoch: Date.parse('2026-08-29T07:05:59+02:00'), offset: '+02:00'
    })
    expect(parseWhen('2026-08-29T07:05:59.125Z')).toEqual({
      d: '2026-08-29', t: 25_559_125, precision: 'millisecond',
      epoch: Date.parse('2026-08-29T07:05:59.125Z'), offset: 'UTC'
    })
  })

  it.each([
    '2026-02-29',
    '2026-13-01',
    '31 Apr 2026, 10:00',
    '2026-01-01 24:00',
    '2026-01-01 12:60',
    '2026-01-01 12:00:60',
    '2026-01-01 12:00:00 +2460',
    '2026-01-01 trailing junk',
  ])('rejects an invalid date or clock: %s', value => {
    expect(parseWhen(value)).toBeNull()
  })

  it('still accepts a real leap day', () => {
    expect(parseWhen('2024-02-29')).toMatchObject({ d: '2024-02-29', precision: 'date-only' })
  })
})

describe('workout import timestamp provenance', () => {
  it('keeps date-only imports compatible without claiming an invented clock', () => {
    const parsed = parseWorkoutCSV([
      'Date,Exercise,Weight,Reps',
      '2026-08-29,Bench Press,60,10',
    ].join('\n'), { unit: 'kg' })
    const workout = onlyWorkout(parsed)

    expect(workout).toMatchObject({
      d: '2026-08-29',
      timeSource: 'import',
      timePrecision: 'date-only',
    })
    expect(workout.start).toBe(new Date(2026, 7, 29, 18, 0, 0, 0).getTime())
    expect(workout.end).toBe(workout.start)
    expect(workout).not.toHaveProperty('startTimeZone')
    expect(workout).not.toHaveProperty('endTimeZone')
    expect(workoutChronologyParts(workout, { locale: 'en-GB' })).toHaveLength(1)
    expect(workoutTimeDisplay(workout, { locale: 'en-GB' }).timeRange).toBe('')
  })

  it('stores imported minute clocks with the local interpretation zone', () => {
    const workout = onlyWorkout(parse(
      'Push,"29 Aug 2026, 18:05","29 Aug 2026, 19:12",Bench Press (Barbell),0,normal,60,10',
    ))

    expect(workout).toMatchObject({
      d: '2026-08-29',
      start: new Date(2026, 7, 29, 18, 5, 0, 0).getTime(),
      end: new Date(2026, 7, 29, 19, 12, 0, 0).getTime(),
      timeSource: 'import',
      timePrecision: 'minute',
      startTimeZone: localTZ(),
      endTimeZone: localTZ(),
    })
    expect(workoutTimeDisplay(workout, { locale: 'en-GB' }).timeRange).toBe('18:05–19:12')
  })

  it('preserves an explicit end date after midnight', () => {
    const workout = onlyWorkout(parse(
      'Late,"29 Aug 2026, 23:30","30 Aug 2026, 00:45",Bench Press (Barbell),0,normal,60,10',
    ))

    expect(workout.start).toBe(new Date(2026, 7, 29, 23, 30, 0, 0).getTime())
    expect(workout.end).toBe(new Date(2026, 7, 30, 0, 45, 0, 0).getTime())
    expect(workout.end - workout.start).toBe(75 * 60_000)
    expect(workoutTimeDisplay(workout, { locale: 'en-GB' }).timeRange)
      .toMatch(/^23:30–.*30 Aug 2026.*00:45$/)
  })

  it('honours explicit ISO offsets, seconds and the resulting local calendar day', () => {
    const previous = process.env.TZ
    process.env.TZ = 'Europe/Rome'
    try {
      const workout = onlyWorkout(parse(
        'ISO,2026-08-29T23:30:15Z,2026-08-30T00:45:45Z,Bench Press (Barbell),0,normal,60,10',
      ))

      expect(workout).toMatchObject({
        d: '2026-08-30',
        start: Date.parse('2026-08-29T23:30:15Z'),
        end: Date.parse('2026-08-30T00:45:45Z'),
        startTimeZone: 'Europe/Rome', endTimeZone: 'Europe/Rome',
        timeSource: 'import', timePrecision: 'second'
      })
      expect(workout.end - workout.start).toBe(75 * 60_000 + 30_000)
      expect(workoutTimeDisplay(workout, { locale: 'en-GB' }).timeRange)
        .toBe('01:30:15–02:45:45')
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })

  it('keeps distinct ISO seconds inside the same displayed minute', () => {
    const previous = process.env.TZ
    process.env.TZ = 'UTC'
    try {
      const workout = onlyWorkout(parse(
        'Seconds,2026-08-29T10:00:01Z,2026-08-29T10:00:59Z,Bench Press (Barbell),0,normal,60,10',
      ))
      const display = workoutTimeDisplay(workout, { locale: 'en-GB' })

      expect(workout.end - workout.start).toBe(58_000)
      expect(workout.timePrecision).toBe('second')
      expect(display.timeRange).toBe('10:00:01–10:00:59')
      expect(display.durationMs).toBe(58_000)
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })

  it('ignores an invalid end clock without dropping an otherwise valid set', () => {
    const workout = onlyWorkout(parse(
      'Push,"29 Aug 2026, 18:05","29 Aug 2026, 25:00",Bench Press (Barbell),0,normal,60,10',
    ))

    expect(workout.end).toBe(workout.start)
    expect(workout.entries[0].sets).toHaveLength(1)
    expect(workoutTimeDisplay(workout, { locale: 'en-GB' }).timeRange).toBe('18:05')
  })

  it('builds each local instant independently across a DST transition', () => {
    const previous = process.env.TZ
    process.env.TZ = 'Europe/Rome'
    try {
      const workout = onlyWorkout(parse(
        'DST,"29 Mar 2026, 01:30","29 Mar 2026, 03:30",Bench Press (Barbell),0,normal,60,10',
      ))

      expect(workout.startTimeZone).toBe('Europe/Rome')
      expect(workout.start).toBe(Date.parse('2026-03-29T00:30:00.000Z'))
      expect(workout.end).toBe(Date.parse('2026-03-29T01:30:00.000Z'))
      expect(workout.end - workout.start).toBe(60 * 60_000)
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })

  it('rejects a local wall clock that does not exist during the spring DST jump', () => {
    const previous = process.env.TZ
    process.env.TZ = 'Europe/Rome'
    try {
      const parsed = parse(
        'DST,"29 Mar 2026, 02:30",,Bench Press (Barbell),0,normal,60,10',
        'DST,"29 Mar 2026, 03:30",,Bench Press (Barbell),1,normal,60,10',
      )
      const workout = onlyWorkout(parsed)

      expect(parsed.skipped).toBe(1)
      expect(parsed.sets).toBe(1)
      expect(workout.start).toBe(Date.parse('2026-03-29T01:30:00.000Z'))
      expect(workout.entries[0].sets).toHaveLength(1)
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })

  it('skips invalid dated rows instead of normalising them into another day', () => {
    const parsed = parseWorkoutCSV([
      'Date,Exercise,Weight,Reps',
      '2026-02-29,Bench Press,60,10',
      '2026-02-28,Bench Press,60,10',
    ].join('\n'), { unit: 'kg' })

    expect(parsed.skipped).toBe(1)
    expect(parsed.sets).toBe(1)
    expect(parsed.workouts.map(w => w.d)).toEqual(['2026-02-28'])
  })
})
