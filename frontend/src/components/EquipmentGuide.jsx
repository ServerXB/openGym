import { fmtLoad } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { EQUIPMENT_KIND } from '../lib/equipment-load.js'
import Icon from './Icon.jsx'

const load = (value, unit) => `${fmtLoad(value)} ${unit}`

const composition = (parts, unit) => (parts || []).length
  ? parts.map(part => part.count > 1
      ? t('{0} × {1} {2}', part.count, fmtLoad(part.weight), unit)
      : load(part.weight, unit))
    .join(' + ')
  : t('no plates')

const candidate = (guide, value) => {
  if (!value) return t('none')
  const base = load(value.weight, guide.unit)
  if (![EQUIPMENT_KIND.SYMMETRIC_BAR, EQUIPMENT_KIND.LOADABLE_DUMBBELL, EQUIPMENT_KIND.PLATE_LOADED_MACHINE].includes(guide.kind)) {
    return base
  }
  const plates = composition(value.composition, guide.unit)
  return `${base} (${plates}${guide.sideCount === 2 ? ' ' + t('per side') : ''})`
}

export function equipmentGuideCopy(guide) {
  if (!guide || guide.status === 'no_load') return null
  const heading = guide.itemLabel && guide.targetWeight != null
    ? t('Target {0} · {1}', load(guide.targetWeight, guide.unit), guide.itemLabel)
    : null

  if (guide.status === 'exact') {
    if (guide.kind === EQUIPMENT_KIND.SYMMETRIC_BAR) {
      return {
        tone: 'success', icon: 'checkCircle', heading,
        detail: guide.exact.composition.length
          ? t('Load the {0} bar + {1} per side.', load(guide.tareWeight, guide.unit), composition(guide.exact.composition, guide.unit))
          : t('Use the empty {0} bar; no plates are needed.', load(guide.tareWeight, guide.unit))
      }
    }
    if (guide.kind === EQUIPMENT_KIND.LOADABLE_DUMBBELL) {
      return {
        tone: 'success', icon: 'checkCircle', heading,
        detail: t('Each dumbbell: {0} handle + {1} per side.', load(guide.tareWeight, guide.unit), composition(guide.exact.composition, guide.unit)),
        note: t('Prepare {0}; the logged weight is for one dumbbell.', guide.implementCount === 1
          ? t('one dumbbell')
          : t('{0} dumbbells', guide.implementCount))
      }
    }
    if (guide.kind === EQUIPMENT_KIND.FIXED_WEIGHT) {
      return {
        tone: 'success', icon: 'checkCircle', heading,
        detail: t('Prepare {0}.', guide.implementCount === 1
          ? t('one {0} weight', load(guide.exact.weight, guide.unit))
          : t('{0} weights of {1}', guide.implementCount, load(guide.exact.weight, guide.unit)))
      }
    }
    if (guide.kind === EQUIPMENT_KIND.MACHINE_STACK) {
      return { tone: 'success', icon: 'checkCircle', heading, detail: t('Select {0} on the machine stack.', load(guide.exact.weight, guide.unit)) }
    }
    return {
      tone: 'success', icon: 'checkCircle', heading,
      detail: guide.exact.composition.length
        ? t('Empty equipment {0}; load {1}{2}.', load(guide.tareWeight, guide.unit), composition(guide.exact.composition, guide.unit), guide.sideCount === 2 ? ' ' + t('per side') : '')
        : t('Use the empty equipment at {0}; no plates are needed.', load(guide.tareWeight, guide.unit))
    }
  }

  if (guide.status === 'nearest') {
    return {
      tone: 'warning', icon: 'info', heading,
      detail: t('Not exactly loadable. Closest lower: {0}. Closest higher: {1}.',
        candidate(guide, guide.lower), candidate(guide, guide.upper)),
      note: t('The workout target is unchanged; choose what to log.')
    }
  }
  if (guide.status === 'below_tare') {
    return {
      tone: 'warning', icon: 'info', heading,
      detail: t('The target is below the empty equipment weight of {0}.', load(guide.tareWeight, guide.unit))
    }
  }
  if (guide.status === 'unit_mismatch') {
    return {
      tone: 'warning', icon: 'info', heading: t('No loading suggestion'),
      detail: t('This profile uses {0}, while the workout uses {1}. Values are never converted automatically.', guide.profileUnit, guide.workoutUnit)
    }
  }
  if (guide.status === 'manual') {
    return {
      tone: 'manual', icon: 'info', heading,
      detail: guide.instructions || t('Follow the manual instruction configured for this equipment.')
    }
  }
  const unavailable = {
    ambiguous: 'More than one tool matches this exercise. Choose one in the exercise settings.',
    missing_item: 'The selected tool is no longer in this profile. Choose another one in the exercise settings.',
    unmapped: 'No tool in this profile matches the exercise. Choose one in the exercise settings.',
    no_profile: 'No equipment profile is active.',
    disabled: 'Loading suggestions are disabled for this exercise.',
    bodyweight: 'Pure bodyweight exercise: no loading suggestion is needed.',
    unsupported: 'This equipment and load convention cannot be calculated safely.',
    invalid: 'The next set has an invalid weight.',
    solver_limit: 'This inventory is too complex to calculate safely. Simplify duplicate or unrealistic entries.',
    unavailable: 'The configured equipment is unavailable in this workout snapshot.'
  }
  return {
    tone: 'warning', icon: 'info', heading: t('No loading suggestion'),
    detail: t(unavailable[guide.status] || unavailable[guide.reason] || unavailable.unavailable)
  }
}

export default function EquipmentGuide({ guide, preview = false }) {
  const copy = equipmentGuideCopy(guide)
  if (!copy) return null
  return <div className={`equipment-guide ${copy.tone}${preview ? ' preview' : ''}`}
    role="status" aria-live="polite">
    <Icon name={copy.icon} />
    <div>
      {copy.heading && <strong>{copy.heading}</strong>}
      <span>{copy.detail}</span>
      {copy.note && <small>{copy.note}</small>}
    </div>
  </div>
}
