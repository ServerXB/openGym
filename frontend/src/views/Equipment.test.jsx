import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const harness = vi.hoisted(() => ({
  state: null,
  update: vi.fn(),
  openSheet: vi.fn()
}))

vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({ S: harness.state, update: harness.update })
}))

vi.mock('../store/useUI.js', () => ({
  useUI: selector => selector({ openSheet: harness.openSheet })
}))

vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))

import Equipment, { ItemEditor } from './Equipment.jsx'

const renderAt = path => renderToStaticMarkup(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/settings/equipment" element={<Equipment />} />
      <Route path="/settings/equipment/:profileId" element={<Equipment />} />
    </Routes>
  </MemoryRouter>
)

beforeEach(() => {
  harness.update.mockReset()
  harness.openSheet.mockReset()
  harness.state = {
    unit: 'kg', activeEquipmentProfileId: 'equipment-profile:gym',
    equipmentProfiles: [{
      schemaVersion: 1,
      id: 'equipment-profile:gym',
      name: 'Palestra',
      unit: 'kg',
      items: [{
        id: 'bar-main', label: 'Bilanciere olimpico', kind: 'symmetric_bar',
        catalogEquipment: 'barbell', tareWeight: 20, sideCount: 2,
        denominations: [{ weight: 20, count: 2 }, { weight: 5, count: 4 }]
      }]
    }]
  }
})

describe('equipment profile UX', () => {
  it('shows which profile will be frozen into the next workout', () => {
    const html = renderAt('/settings/equipment')
    expect(html).toContain('Active equipment profile')
    expect(html).toContain('Palestra')
    expect(html).toContain('Changing it never rewrites an active or completed workout.')
    expect(html).toContain('1 tools · kg')
  })

  it('renders the profile model, inventory and future-only wording', () => {
    const html = renderAt('/settings/equipment/equipment-profile%3Agym')
    expect(html).toContain('Changing this profile affects only workouts started afterwards.')
    expect(html).toContain('Bilanciere olimpico')
    expect(html).toContain('Barbell with symmetric plates')
    expect(html).toContain('empty 20 kg')
    expect(html).toContain('2 inventory values')
    expect(html).toContain('Add equipment')
  })

  it('distinguishes selectorized and plate-loaded cables in the profile list', () => {
    harness.state.equipmentProfiles[0].items = [{
      id: 'cable-stack', label: 'Cavo Technogym', kind: 'machine_stack',
      catalogEquipment: 'cable', tareWeight: 0, sideCount: 1,
      denominations: [{ weight: 20, count: 1 }]
    }, {
      id: 'cable-plates', label: 'Cavo garage', kind: 'plate_loaded_machine',
      catalogEquipment: 'cable', tareWeight: 10, sideCount: 2, denominations: []
    }]

    const html = renderAt('/settings/equipment/equipment-profile%3Agym')

    expect(html).toContain('Cavo Technogym')
    expect(html).toContain('Weight stack')
    expect(html).toContain('Cavo garage')
    expect(html).toContain('Plates · 2 loading points')
    expect(html).toContain('empty 10 kg')
  })

  it('renders a guided cable mechanism choice without exposing pulley conversion', () => {
    const item = {
      id: 'cable-plates', label: 'Cavo garage', kind: 'plate_loaded_machine',
      catalogEquipment: 'cable', tareWeight: 10, sideCount: 2, denominations: []
    }
    const html = renderToStaticMarkup(
      <ItemEditor profileId="equipment-profile:gym" item={item} unit="kg" close={() => {}} />
    )

    expect(html).toContain('Cable machine')
    expect(html).toContain('How is this cable loaded?')
    expect(html).toContain('Weight stack')
    expect(html).toContain('Plates on pegs')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Empty cable resistance')
    expect(html).toContain('Loading points')
    expect(html).toContain('Pulley ratio is not applied')
    expect(html).toContain('Plate inventory (optional)')
    expect(html).toContain('not pieces per loading point')
    expect(html).toContain('load per loading point')
  })
})
