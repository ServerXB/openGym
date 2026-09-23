import { describe, expect, it } from 'vitest'
import italian from '../locales/it.js'
import {
  cableEquipmentLabel,
  cableMechanismLabel,
  equipmentPickerLabel,
  equipmentPickerSubtitle
} from './equipment-presentation.js'

describe('cable equipment presentation', () => {
  it('distinguishes selectorized and plate-loaded cable tools in compact labels', () => {
    const stack = {
      id: 'stack', label: 'Technogym cable', kind: 'machine_stack',
      catalogEquipment: 'cable', sideCount: 1
    }
    const twoPoints = {
      id: 'plates-two', label: 'Garage cable', kind: 'plate_loaded_machine',
      catalogEquipment: 'cable', sideCount: 2
    }
    const onePoint = { ...twoPoints, id: 'plates-one', sideCount: 1 }

    expect(cableMechanismLabel(stack)).toBe('Weight stack')
    expect(cableMechanismLabel(twoPoints)).toBe('Plates · 2 loading points')
    expect(cableMechanismLabel(onePoint)).toBe('Plates · one loading point')
    expect(cableEquipmentLabel(stack)).toBe('Cable · Weight stack')
    expect(equipmentPickerLabel(twoPoints)).toBe('Garage cable · Plates · 2 loading points')
    expect(equipmentPickerSubtitle(stack)).toBe('Select the printed value on the weight stack.')
    expect(equipmentPickerSubtitle(twoPoints))
      .toBe('Logged weight is the machine total; pulley ratio is not applied.')
  })

  it('does not label unrelated or ambiguous equipment as a cable mechanism', () => {
    const generic = {
      id: 'generic', label: 'Generic plate machine', kind: 'plate_loaded_machine',
      catalogEquipment: 'leverage machine', sideCount: 2
    }
    const ambiguous = { id: 'cable-custom', label: 'Cable note', kind: 'custom', catalogEquipment: 'cable' }
    const forged = {
      id: 'forged', label: 'Not a cable', kind: 'fixed_weight',
      cableLoadingMechanism: 'plate_loaded', sideCount: 2
    }

    expect(cableMechanismLabel(generic)).toBeNull()
    expect(cableMechanismLabel(ambiguous)).toBeNull()
    expect(cableMechanismLabel(forged)).toBeNull()
    expect(equipmentPickerLabel(generic)).toBe('Generic plate machine')
    expect(equipmentPickerSubtitle(generic)).toBe('Matches leverage machine')
  })

  it('provides native Italian copy for every cable-specific operational label', () => {
    expect(italian['Cable machine']).toBe('Macchina a cavo')
    expect(italian['How is this cable loaded?']).toBe('Come si carica questo cavo?')
    expect(italian['Plates · {0} loading points']).toBe('Dischi · {0} punti di carico')
    expect(italian['Load {0} on each side.']).toBe('Carica {0} su ciascun lato.')
    expect(italian['Pulley ratio is not applied.'])
      .toBe('Il rapporto delle pulegge non viene applicato.')
  })
})
