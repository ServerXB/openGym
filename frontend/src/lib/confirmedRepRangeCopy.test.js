import { describe, expect, it } from 'vitest'
import confirmedRepRangeFallback from './confirmedRepRangeLocaleFallback.js'
import italian from '../locales/it.js'

const LOADED_CONFIRMATION = 'Maximum reached last workout: confirmation 1 of 2 recorded. Repeat it once more at the same load to increase weight.'
const UNLOADED_CONFIRMATION = 'Maximum reached last workout: confirmation 1 of 2 recorded. Repeat it once more to complete the progression step.'

describe('Confirmed Rep-Range first-confirmation copy', () => {
  it('states that the latest maximum was recorded and explains why loaded work holds', () => {
    expect(confirmedRepRangeFallback[LOADED_CONFIRMATION]).toBe(LOADED_CONFIRMATION)
    expect(italian[LOADED_CONFIRMATION]).toBe(
      'Massimo raggiunto nell\'ultimo allenamento: prima conferma registrata (1 / 2). Ripetilo un\'altra volta con lo stesso peso per aumentare il carico.'
    )
  })

  it('does not promise a weight increase for unloaded progression', () => {
    expect(confirmedRepRangeFallback[UNLOADED_CONFIRMATION]).toBe(UNLOADED_CONFIRMATION)
    expect(italian[UNLOADED_CONFIRMATION]).toContain('completare il passo di progressione')
  })
})

describe('Confirmed recovery-first copy', () => {
  const loaded = 'Maximum reached at the configured base recovery: confirmation 1 of 2 recorded. Repeat it at the same load and recovery to increase weight.'
  const unloaded = 'Maximum reached at the configured base recovery: confirmation 1 of 2 recorded. Repeat it at the same recovery to complete the progression step.'
  const paused = 'Maximum reached, but progression is paused until recovery returns to its base of {0}s. No maximum confirmations are counted above base.'
  const fresh = 'Recovery is at its base of {0}s. Complete two new maximum-rep sessions at this recovery to progress; earlier confirmations do not count.'

  it.each([loaded, unloaded, paused, fresh])('provides Italian copy and an explicit English fallback: %s', key => {
    expect(confirmedRepRangeFallback[key]).toBe(key)
    expect(italian[key]).toBeTruthy()
    expect(italian[key]).not.toBe(key)
  })
  it('explains the base condition and distinguishes a held maximum from a counted confirmation', () => {
    expect(italian[paused]).toContain('progressione è sospesa')
    expect(italian[paused]).toContain('non si accumulano')
    expect(italian[fresh]).toContain('due nuove sessioni')
    expect(italian[loaded]).toContain('stesso peso e recupero')
    expect(italian[unloaded]).not.toContain('aumentare il carico')
  })
})
