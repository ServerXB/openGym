import { normalizeProgressionScopes } from './progression-scope.js'

const clone = value => JSON.parse(JSON.stringify(value))

// Load is deliberately tolerant in two separate phases. A corrupt/unreadable value falls back
// to defaults; a valid value whose deterministic backfill cannot be written (quota/private mode)
// is still returned to the user instead of looking like an empty profile.
export function loadStoredState(storage, key, defaults, { prepare } = {}) {
  let raw
  try {
    raw = storage?.getItem(key)
  } catch {
    return normalizeProgressionScopes(clone(defaults))
  }
  if (!raw) return normalizeProgressionScopes(clone(defaults))

  let state
  try {
    state = Object.assign(clone(defaults), JSON.parse(raw))
    prepare?.(state)
    state = normalizeProgressionScopes(state)
  } catch {
    return normalizeProgressionScopes(clone(defaults))
  }

  try {
    storage?.setItem(key, JSON.stringify(state))
  } catch {
    // Best effort only: the parsed in-memory profile is authoritative for this boot.
  }
  return state
}
