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

import Equipment from './Equipment.jsx'

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
})
