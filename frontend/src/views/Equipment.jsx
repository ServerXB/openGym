import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXDB } from '../lib/exercises.js'
import { fmtLoad, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import {
  CABLE_LOADING_MECHANISM,
  EQUIPMENT_KIND,
  EQUIPMENT_KINDS,
  cableLoadingMechanism,
  defaultCatalogEquipment,
  normalizeEquipmentItem,
  normalizeEquipmentProfile
} from '../lib/equipment-load.js'
import { cableMechanismLabel } from '../lib/equipment-presentation.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Row, Section, Segmented, SelectRow, Stepper, Switch, TextArea, TextField } from '../components/ui.jsx'

const KIND_KEYS = {
  [EQUIPMENT_KIND.SYMMETRIC_BAR]: 'Barbell with symmetric plates',
  [EQUIPMENT_KIND.LOADABLE_DUMBBELL]: 'Loadable dumbbell',
  [EQUIPMENT_KIND.FIXED_WEIGHT]: 'Fixed dumbbell or kettlebell',
  [EQUIPMENT_KIND.MACHINE_STACK]: 'Machine weight stack',
  [EQUIPMENT_KIND.PLATE_LOADED_MACHINE]: 'Plate-loaded machine',
  [EQUIPMENT_KIND.CUSTOM]: 'Manual or other equipment'
}

const CABLE_EQUIPMENT_TYPE = 'cable_machine'

const KIND_HELP = {
  [EQUIPMENT_KIND.SYMMETRIC_BAR]: 'The logged weight is the total including the empty bar; plates must match on both sides.',
  [EQUIPMENT_KIND.LOADABLE_DUMBBELL]: 'The logged weight is always one dumbbell. Plate inventory is shared by the number of dumbbells selected on the exercise.',
  [EQUIPMENT_KIND.FIXED_WEIGHT]: 'Each inventory value is the weight of one complete dumbbell or kettlebell.',
  [EQUIPMENT_KIND.MACHINE_STACK]: 'Each inventory value is one load selectable on the machine stack.',
  [EQUIPMENT_KIND.PLATE_LOADED_MACHINE]: 'The logged weight is the total including the empty machine resistance.',
  [EQUIPMENT_KIND.CUSTOM]: 'No formula is assumed. The instruction is shown exactly as written.'
}

const CATALOG_EQUIPMENT = [...new Set(EXDB.map(ex => ex.eq).filter(Boolean))].sort()

const plateInventoryKind = kind => [
  EQUIPMENT_KIND.SYMMETRIC_BAR,
  EQUIPMENT_KIND.LOADABLE_DUMBBELL,
  EQUIPMENT_KIND.PLATE_LOADED_MACHINE
].includes(kind)

const inventoryKind = kind => plateInventoryKind(kind) || [
  EQUIPMENT_KIND.FIXED_WEIGHT,
  EQUIPMENT_KIND.MACHINE_STACK
].includes(kind)

const hasTare = kind => [
  EQUIPMENT_KIND.SYMMETRIC_BAR,
  EQUIPMENT_KIND.LOADABLE_DUMBBELL,
  EQUIPMENT_KIND.PLATE_LOADED_MACHINE
].includes(kind)

const defaultItem = () => ({
  id: `equipment-item:${uid()}`,
  label: '',
  kind: EQUIPMENT_KIND.SYMMETRIC_BAR,
  catalogEquipment: 'barbell',
  tareWeight: 20,
  implementCount: 1,
  sideCount: 2,
  denominations: []
})

function Profiles() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const profiles = Array.isArray(S.equipmentProfiles) ? S.equipmentProfiles : []
  const addProfile = () => {
    const id = `equipment-profile:${uid()}`
    update(state => {
      state.equipmentProfiles = Array.isArray(state.equipmentProfiles) ? state.equipmentProfiles : []
      state.equipmentProfiles.push({
        schemaVersion: 1, id, name: t('New equipment profile'), unit: state.unit === 'lb' ? 'lb' : 'kg', items: []
      })
      if (!state.activeEquipmentProfileId) state.activeEquipmentProfileId = id
    })
    nav(`/settings/equipment/${encodeURIComponent(id)}`)
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Equipment')}</h1></div>
    </div>

    <Section title={t('Next workouts')} footer={t('The active profile is copied when a workout starts. Changing it never rewrites an active or completed workout.')}>
      <SelectRow icon="dumbbell" iconTint="var(--blue)" title={t('Active equipment profile')}
        value={S.activeEquipmentProfileId || ''}
        onChange={value => update(state => { state.activeEquipmentProfileId = value || null })}
        options={[
          { value: '', label: t('No loading suggestions') },
          ...profiles.map(profile => ({ value: profile.id, label: profile.name || t('Unnamed profile') }))
        ]} />
    </Section>

    <Section title={t('Profiles')} footer={t('Create separate profiles for each gym, home setup or travel location.')}>
      {profiles.length ? profiles.map(profile => (
        <Row key={profile.id} icon="barbell" iconTint="var(--teal)"
          title={profile.name || t('Unnamed profile')}
          subtitle={t('{0} tools · {1}', Array.isArray(profile.items) ? profile.items.length : 0, profile.unit || 'kg')}
          value={profile.id === S.activeEquipmentProfileId ? t('Active') : null}
          accessory="chevron" onClick={() => nav(`/settings/equipment/${encodeURIComponent(profile.id)}`)} />
      )) : <Row icon="dumbbell" iconTint="var(--grey)" title={t('No equipment profiles yet')}
        subtitle={t('Add the bars, dumbbells, plates and machines you actually have available.')} />}
    </Section>

    <Button variant="primary" icon="plus" onClick={addProfile}>{t('Add equipment profile')}</Button>
  </div>
}

function InventoryEditor({ draft, setDraft, unit }) {
  const stack = draft.kind === EQUIPMENT_KIND.MACHINE_STACK
  const plateLoadedCable = cableLoadingMechanism(draft) === CABLE_LOADING_MECHANISM.PLATE_LOADED
  const rows = Array.isArray(draft.denominations) ? draft.denominations : []
  const change = (index, field, value) => setDraft(current => ({
    ...current,
    denominations: current.denominations.map((row, rowIndex) => rowIndex === index
      ? { ...row, [field]: value }
      : row)
  }))
  const remove = index => setDraft(current => ({
    ...current,
    denominations: current.denominations.filter((_row, rowIndex) => rowIndex !== index)
  }))
  return <div className="equipment-inventory">
    <div className="equipment-subhead">{t(stack
      ? 'Selectable loads'
      : plateInventoryKind(draft.kind)
        ? 'Plate inventory (optional)'
        : 'Available weights and quantities')}</div>
    <p className="cfg-help">{t(stack
      ? 'Enter every value printed on the machine stack.'
      : plateLoadedCable
        ? 'Quantities are total pieces in this profile, not pieces per loading point.'
        : 'Quantities are total pieces in this profile, not pieces per side.')}</p>
    {plateInventoryKind(draft.kind) &&
      <p className="cfg-help">{t(plateLoadedCable
        ? 'Leave the plate inventory empty to calculate only the load per loading point. Add plates later for calculated compositions and nearest alternatives.'
        : 'Leave the plate inventory empty to calculate only the load per side. Add plates later for calculated compositions and nearest alternatives.')}</p>}
    {rows.map((row, index) => <div className="equipment-inventory-row" key={index}>
      <Stepper label={t('Weight')} unit={unit} value={row.weight || 0} step={0.25}
        onChange={value => change(index, 'weight', value)} />
      {!stack && <Stepper label={t('Quantity')} value={row.count || 0} step={1} decimal={false}
        onChange={value => change(index, 'count', Math.round(value))} />}
      <button type="button" className="iconbtn equipment-remove" aria-label={t('Remove inventory row')}
        onClick={() => remove(index)}><Icon name="trash" /></button>
    </div>)}
    <Button type="button" size="sm" icon="plus" onClick={() => setDraft(current => ({
      ...current,
      denominations: [...(current.denominations || []), { weight: 0, count: stack ? 1 : 2 }]
    }))}>{t('Add weight')}</Button>
  </div>
}

export function ItemEditor({ profileId, item, unit, close }) {
  const update = useStore(s => s.update)
  const [draft, setDraft] = useState(() => structuredClone(item || defaultItem()))
  const editing = !!item
  const cableMechanism = cableLoadingMechanism(draft)
  const cablePreset = !!cableMechanism
  const equipmentType = cablePreset ? CABLE_EQUIPMENT_TYPE : draft.kind
  const kindOptions = [
    { value: CABLE_EQUIPMENT_TYPE, label: t('Cable machine') },
    ...EQUIPMENT_KINDS.map(value => ({ value, label: t(KIND_KEYS[value]) }))
  ]
  const catalogOptions = [
    { value: '', label: t('No automatic match') },
    ...CATALOG_EQUIPMENT.map(value => ({ value, label: t(value) }))
  ]
  const setKind = selection => setDraft(current => {
    if (selection === CABLE_EQUIPMENT_TYPE) {
      return {
        ...current,
        kind: EQUIPMENT_KIND.MACHINE_STACK,
        catalogEquipment: 'cable',
        tareWeight: 0,
        sideCount: 1,
        // Stack values and plate denominations have different meanings. Starting the guided
        // cable preset empty prevents a plausible-looking but physically invalid crossover.
        denominations: []
      }
    }
    return {
      ...current,
      kind: selection,
      sideCount: selection === EQUIPMENT_KIND.PLATE_LOADED_MACHINE
        ? (current.sideCount === 1 ? 1 : 2)
        : 2,
      // A new kind must not silently keep the previous kind's automatic match (for example a
      // loadable dumbbell still classified as barbell). More specific catalog variants remain
      // available in the picker immediately below.
      catalogEquipment: selection === current.kind && !cableLoadingMechanism(current)
        ? current.catalogEquipment
        : defaultCatalogEquipment(selection)
    }
  })
  const setCableMechanism = mechanism => setDraft(current => {
    const kind = mechanism === CABLE_LOADING_MECHANISM.PLATE_LOADED
      ? EQUIPMENT_KIND.PLATE_LOADED_MACHINE
      : EQUIPMENT_KIND.MACHINE_STACK
    if (kind === current.kind && current.catalogEquipment === 'cable') return current
    return {
      ...current,
      kind,
      catalogEquipment: 'cable',
      tareWeight: kind === EQUIPMENT_KIND.MACHINE_STACK ? 0 : current.tareWeight || 0,
      sideCount: kind === EQUIPMENT_KIND.MACHINE_STACK ? 1 : 2,
      denominations: []
    }
  })
  const cableDefaultLabel = cableMechanism === CABLE_LOADING_MECHANISM.PLATE_LOADED
    ? 'Plate-loaded cable'
    : 'Cable weight stack'
  const kindHelp = cablePreset
    ? cableMechanism === CABLE_LOADING_MECHANISM.PLATE_LOADED
      ? 'The logged weight is the machine total. It is divided across the loading points after subtracting empty resistance. Pulley ratio is not applied.'
      : 'Enter each value printed on this cable weight stack.'
    : KIND_HELP[draft.kind]
  const save = () => {
    const normalized = normalizeEquipmentItem({
      ...draft,
      label: draft.label.trim() || t(cablePreset ? cableDefaultLabel : KIND_KEYS[draft.kind]),
      denominations: (draft.denominations || []).map(row => ({
        ...row,
        count: draft.kind === EQUIPMENT_KIND.MACHINE_STACK ? 1 : row.count
      }))
    })
    if (!normalized) return
    update(state => {
      const profile = (state.equipmentProfiles || []).find(candidate => candidate.id === profileId)
      if (!profile) return
      profile.items = Array.isArray(profile.items) ? profile.items : []
      const index = profile.items.findIndex(candidate => candidate.id === normalized.id)
      if (index >= 0) profile.items[index] = normalized
      else profile.items.push(normalized)
    })
    close()
  }
  const remove = () => {
    close()
    confirmSheet({
      title: t('Delete equipment?'),
      message: t('Future workouts will no longer use “{0}”. Active and completed workouts keep their snapshot.', item.label),
      confirmText: t('Delete'), danger: true,
      onConfirm: () => update(state => {
        const profile = (state.equipmentProfiles || []).find(candidate => candidate.id === profileId)
        if (profile) profile.items = (profile.items || []).filter(candidate => candidate.id !== item.id)
      })
    })
  }

  return <>
    <h3>{editing ? t('Edit equipment') : t('Add equipment')}</h3>
    <div className="equipment-field">
      <label htmlFor="equipment-label">{t('Name')}</label>
      <TextField id="equipment-label" value={draft.label}
        placeholder={t(cablePreset ? cableDefaultLabel : KIND_KEYS[draft.kind])}
        onChange={event => setDraft(current => ({ ...current, label: event.target.value }))} />
    </div>
    <div className="sect-b equipment-picker-group">
      <SelectRow icon="wrench" iconTint="var(--indigo)" title={t('Equipment type')}
        value={equipmentType} options={kindOptions} onChange={setKind} />
      {cablePreset
        ? <Row icon="link" iconTint="var(--blue)" title={t('Automatic exercise match')} value={t('cable')} />
        : <SelectRow icon="link" iconTint="var(--blue)" title={t('Automatic exercise match')}
            value={draft.catalogEquipment || ''} options={catalogOptions}
            onChange={catalogEquipment => setDraft(current => ({ ...current, catalogEquipment }))} />}
    </div>
    {cablePreset && <fieldset className="equipment-cable-mechanism">
      <legend>{t('How is this cable loaded?')}</legend>
      <Segmented options={[
        { value: CABLE_LOADING_MECHANISM.SELECTOR_STACK, label: t('Weight stack') },
        { value: CABLE_LOADING_MECHANISM.PLATE_LOADED, label: t('Plates on pegs') }
      ]} value={cableMechanism} onChange={setCableMechanism} />
    </fieldset>}
    <p className="cfg-help equipment-kind-help">{t(kindHelp)}</p>

    {hasTare(draft.kind) && <div className="equipment-grid">
      <Stepper label={t(draft.kind === EQUIPMENT_KIND.LOADABLE_DUMBBELL
        ? 'Empty handle weight'
        : cablePreset
          ? 'Empty cable resistance'
          : 'Empty equipment weight')}
        unit={unit} value={draft.tareWeight || 0} step={0.25}
        onChange={tareWeight => setDraft(current => ({ ...current, tareWeight }))} />
      {draft.kind === EQUIPMENT_KIND.PLATE_LOADED_MACHINE && <div className="equipment-field">
        <span className="equipment-label">{t(cablePreset ? 'Loading points' : 'Loading sides')}</span>
        <Segmented options={[
          { value: 1, label: t('One') }, { value: 2, label: t('Two') }
        ]} value={draft.sideCount === 1 ? 1 : 2}
          onChange={sideCount => setDraft(current => ({ ...current, sideCount }))} />
      </div>}
    </div>}

    {inventoryKind(draft.kind) && <InventoryEditor draft={draft} setDraft={setDraft} unit={unit} />}

    {draft.kind === EQUIPMENT_KIND.CUSTOM && <div className="equipment-field">
      <label htmlFor="equipment-instructions">{t('Instruction shown during workout')}</label>
      <TextArea id="equipment-instructions" value={draft.instructions || ''}
        placeholder={t('Example: use the red resistance band')}
        onChange={event => setDraft(current => ({ ...current, instructions: event.target.value }))} />
    </div>}

    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {editing && <><div style={{ height: 8 }} /><Button variant="danger" onClick={remove}>{t('Delete equipment')}</Button></>}
  </>
}

function ProfileEditor({ profileId }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const openSheet = useUI(s => s.openSheet)
  const profile = (S.equipmentProfiles || []).find(candidate => candidate.id === profileId)
  useEffect(() => { if (!profile) nav('/settings/equipment', { replace: true }) }, [!!profile, nav])
  const normalized = useMemo(() => normalizeEquipmentProfile(profile), [profile])
  if (!profile || !normalized) return null

  const editItem = item => openSheet(close => (
    <ItemEditor profileId={profile.id} item={item} unit={normalized.unit} close={close} />
  ))
  const deleteProfile = () => confirmSheet({
    title: t('Delete equipment profile?'),
    message: t('Future workouts will no longer use “{0}”. Active and completed workouts keep their snapshot.', profile.name),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      update(state => {
        state.equipmentProfiles = (state.equipmentProfiles || []).filter(candidate => candidate.id !== profile.id)
        if (state.activeEquipmentProfileId === profile.id) {
          state.activeEquipmentProfileId = state.equipmentProfiles[0]?.id || null
        }
      })
      nav('/settings/equipment')
    }
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings/equipment')} aria-label={t('Equipment')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Equipment profile')}</h1></div>
    </div>

    <Section title={t('Profile')} footer={t('Changing this profile affects only workouts started afterwards.')}>
      <div className="lrow equipment-name-row">
        <label className="lrow-m" htmlFor="profile-name"><span className="lrow-t">{t('Name')}</span></label>
        <TextField id="profile-name" defaultValue={profile.name}
          onBlur={event => update(state => {
            const target = (state.equipmentProfiles || []).find(candidate => candidate.id === profile.id)
            if (target) target.name = event.target.value.trim() || t('Unnamed profile')
          })} />
      </div>
      <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}>
        <Segmented className="seg-inline" options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
          value={profile.unit === 'lb' ? 'lb' : 'kg'} onChange={unit => update(state => {
            const target = (state.equipmentProfiles || []).find(candidate => candidate.id === profile.id)
            if (target) target.unit = unit
          })} />
      </Row>
      <Row icon="checkCircle" iconTint="var(--green)" title={t('Use for next workouts')}>
        <Switch ariaLabel={t('Use for next workouts')} checked={S.activeEquipmentProfileId === profile.id}
          onChange={checked => update(state => { state.activeEquipmentProfileId = checked ? profile.id : null })} />
      </Row>
    </Section>

    <Section title={t('Equipment and inventory')} footer={t('Automatic matching works only when exactly one tool matches an exercise category. Choose an explicit tool on the exercise when needed.')}>
      {normalized.items.length ? normalized.items.map(item => (
        <Row key={item.id} icon={item.kind === EQUIPMENT_KIND.SYMMETRIC_BAR ? 'barbell' : 'dumbbell'}
          iconTint="var(--indigo)" title={item.label}
          subtitle={[
            cableMechanismLabel(item) || t(KIND_KEYS[item.kind]),
            hasTare(item.kind) ? t('empty {0} {1}', fmtLoad(item.tareWeight), normalized.unit) : null,
            inventoryKind(item.kind) ? t('{0} inventory values', item.denominations.length) : null
          ].filter(Boolean).join(' · ')}
          accessory="chevron" onClick={() => editItem(item)} />
      )) : <Row icon="wrench" iconTint="var(--grey)" title={t('No equipment in this profile')}
        subtitle={t('Add the equipment you use. Plate inventory is optional and can be added later for detailed loading suggestions.')} />}
    </Section>

    <Button variant="primary" icon="plus" onClick={() => editItem(null)}>{t('Add equipment')}</Button>
    <div style={{ height: 10 }} />
    <Button variant="danger" onClick={deleteProfile}>{t('Delete equipment profile')}</Button>
  </div>
}

export default function Equipment() {
  const { profileId } = useParams()
  return profileId ? <ProfileEditor profileId={decodeURIComponent(profileId)} /> : <Profiles />
}
