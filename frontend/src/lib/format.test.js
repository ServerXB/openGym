import { describe, expect, it } from 'vitest'
import { fmtLoad, fmtNum } from './format.js'

describe('localized numeric formatting', () => {
  it('preserves centesimal micro-loads without adding trailing zeroes', () => {
    expect(fmtLoad(63.75)).toBe('63.75')
    expect(fmtLoad(62.5)).toBe('62.5')
    expect(fmtLoad(64)).toBe('64')
  })

  it('rounds floating-point noise at the same centesimal domain boundary as loads', () => {
    expect(fmtLoad(63.74999999999999)).toBe('63.75')
    expect(fmtLoad(63.754)).toBe('63.75')
  })

  it('does not expand generic measurements to two decimal places', () => {
    expect(fmtNum(8.25)).toBe('8.3')
    expect(fmtNum(7.54)).toBe('7.5')
  })
})
