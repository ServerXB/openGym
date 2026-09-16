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
