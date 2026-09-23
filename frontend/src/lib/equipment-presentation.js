import { CABLE_LOADING_MECHANISM, cableLoadingMechanism } from './equipment-load.js'
import { t } from './i18n.js'

const loadingPoints = item => Number(item?.loadingPointCount ?? item?.sideCount) === 1 ? 1 : 2

/**
 * Short, user-facing description of how a cable is physically loaded.
 *
 * `cable` is only an exercise category, so this deliberately returns null for
 * legacy/custom items whose machine kind does not make the mechanism explicit.
 */
export function cableMechanismLabel(item = {}) {
  const mechanism = cableLoadingMechanism(item)
  if (mechanism === CABLE_LOADING_MECHANISM.SELECTOR_STACK) return t('Weight stack')
  if (mechanism === CABLE_LOADING_MECHANISM.PLATE_LOADED) {
    const points = loadingPoints(item)
    return points === 1
      ? t('Plates · one loading point')
      : t('Plates · {0} loading points', points)
  }
  return null
}

export function cableEquipmentLabel(item = {}) {
  const mechanism = cableMechanismLabel(item)
  return mechanism ? `${t('Cable')} · ${mechanism}` : null
}

/** Keep the mechanism visible even after the selection sheet is closed. */
export function equipmentPickerLabel(item = {}) {
  const mechanism = cableMechanismLabel(item)
  return mechanism ? `${item.label || t('Cable')} · ${mechanism}` : item.label
}

export function equipmentPickerSubtitle(item = {}) {
  const mechanism = cableLoadingMechanism(item)
  if (mechanism === CABLE_LOADING_MECHANISM.SELECTOR_STACK) {
    return t('Select the printed value on the weight stack.')
  }
  if (mechanism === CABLE_LOADING_MECHANISM.PLATE_LOADED) {
    return t('Logged weight is the machine total; pulley ratio is not applied.')
  }
  return item.catalogEquipment ? t('Matches {0}', t(item.catalogEquipment)) : t('Explicit selection only')
}
