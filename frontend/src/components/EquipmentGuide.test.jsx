import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import EquipmentGuide, { equipmentGuideCopy } from './EquipmentGuide.jsx'

const exactBar = {
  status: 'exact', targetWeight: 70, unit: 'kg', itemLabel: 'Olympic bar',
  kind: 'symmetric_bar', tareWeight: 20, sideCount: 2, implementCount: 1,
  exact: { weight: 70, composition: [{ weight: 20, count: 1 }, { weight: 5, count: 1 }] }
}

describe('equipment loading message', () => {
  it('renders exact guidance as a live textual status with an icon', () => {
    const html = renderToStaticMarkup(<EquipmentGuide guide={exactBar} />)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('<svg')
    expect(html).toContain('Target 70 kg · Olympic bar')
    expect(html).toContain('Load the 20 kg bar + 20 kg + 5 kg per side.')
  })

  it('explains impossible targets in text and leaves the target unchanged', () => {
    const guide = {
      ...exactBar, status: 'nearest', targetWeight: 63.75, exact: null,
      lower: { weight: 62.5, composition: [{ weight: 20, count: 1 }, { weight: 1.25, count: 1 }] },
      upper: { weight: 65, composition: [{ weight: 20, count: 1 }, { weight: 1.25, count: 2 }] }
    }
    const html = renderToStaticMarkup(<EquipmentGuide guide={guide} />)
    expect(html).toContain('Target 63.75 kg')
    expect(html).toContain('Not exactly loadable')
    expect(html).toContain('Closest lower: 62.5 kg')
    expect(html).toContain('The workout target is unchanged')
    expect(html).toContain('class="equipment-guide warning"')
  })

  it('states the single-dumbbell convention separately from quantity', () => {
    const copy = equipmentGuideCopy({
      ...exactBar, kind: 'loadable_dumbbell', itemLabel: 'Loadable dumbbell',
      tareWeight: 2, implementCount: 2,
      exact: { weight: 20, composition: [{ weight: 5, count: 1 }, { weight: 2, count: 2 }] }
    })
    expect(copy.detail).toContain('Each dumbbell')
    expect(copy.note).toBe('Prepare 2 dumbbells; the logged weight is for one dumbbell.')
  })

  it('explains unit mismatch without suggesting a conversion', () => {
    const copy = equipmentGuideCopy({ status: 'unit_mismatch', profileUnit: 'kg', workoutUnit: 'lb' })
    expect(copy.heading).toBe('No loading suggestion')
    expect(copy.detail).toContain('Values are never converted automatically')
  })

  it('explains the solver safety limit instead of displaying a partial composition', () => {
    const copy = equipmentGuideCopy({ status: 'solver_limit' })
    expect(copy.heading).toBe('No loading suggestion')
    expect(copy.detail).toContain('too complex to calculate safely')
    expect(copy.tone).toBe('warning')
  })
})
