import { anchorTimer, changeTimer, createTimer, displayTimer, matchesTimer, remainingTimerMs, timerToken, validateTimer } from './local-timer.js'

// Clock and durable repository are injectable. Interval cadence never determines elapsed time.
export function createTimerRuntime({ storage, clock, getScope, id, onChange = () => {},
  onComplete = () => true, onMutation = () => {}, onError = () => {} }) {
  let record = null, anchor = null, restoring = 0, completing = null
  const now = () => ({ wallNow: clock.wallNow(), monoNow: clock.monoNow() })
  const sameScope = (a, b) => a?.accountId === b?.accountId && a?.workoutId === b?.workoutId
  const activeScope = () => { const s = getScope(); return s?.accountId && s?.workoutId ? s : null }
  const readValid = (raw, accountId) => {
    if (!raw) return null
    const parsed = validateTimer(raw)
    if (!parsed || (accountId && parsed.accountId !== accountId)) throw new Error('Invalid timer record; original data preserved')
    return parsed
  }
  const publish = () => onChange(record?.status === 'running'
    ? displayTimer(record, remainingTimerMs(record, anchor, now())) : null)
  function adopt(next) {
    if (!matchesTimer(next, timerToken(record))) anchor = next ? anchorTimer(next, now()) : null
    record = next
    publish()
  }
  async function deliver(next, scope, live = false) {
    if (next?.status !== 'completed' || (!live && !next.deliveryPending)) return
    if (!sameScope(scope, activeScope())) return
    if (!next.deliveryPending) { onComplete(next, next.elapsedSeconds ?? next.durationMs / 1000); return }
    // Domain persistence is synchronous. Deliver and acknowledge inside the same serialized
    // transaction so another tab cannot also consume a pending work result. If this transaction
    // fails after the domain save, the set's done guard makes crash recovery idempotent.
    await storage.transact(scope.accountId, raw => {
      const current = readValid(raw, scope.accountId)
      if (!sameScope(scope, activeScope()) || !matchesTimer(current, timerToken(next)) || !current.deliveryPending) return raw
      const delivered = onComplete(current, current.elapsedSeconds ?? current.durationMs / 1000)
      if (delivered?.then) throw new Error('Timer completion persistence must be synchronous')
      return delivered === false ? raw : { ...current, deliveryPending: false }
    })
  }
  async function restore() {
    const epoch = ++restoring, scope = activeScope()
    if (!scope) { adopt(null); return }
    try {
      const saved = readValid(await storage.read(scope.accountId), scope.accountId)
      if (epoch !== restoring || !sameScope(scope, activeScope())) return
      if (saved?.workoutId !== scope.workoutId) { adopt(null); return }
      adopt(saved)
      await deliver(saved, scope)
      await tick()
    } catch (error) { if (epoch === restoring) onError(error) }
  }
  async function command(type, options = {}, expected = timerToken(record)) {
    const scope = activeScope()
    if (!scope) return false
    try {
      const result = await storage.transact(scope.accountId, raw => {
        const current = readValid(raw, scope.accountId)
        if (!sameScope(scope, activeScope())) return raw
        if (type === 'start') {
          if (current?.deliveryPending && current.workoutId === scope.workoutId) return raw // retry a failed save, not overwrite it
          // A delayed start command cannot displace a newer timer from another tab.
          if (expected && !matchesTimer(current, expected)) return raw
          if (!expected && current?.status === 'running' && current.workoutId === scope.workoutId) return raw
          return createTimer({ ...options, ...scope }, current, { ...now(), id: id() })
        }
        if (current?.workoutId !== scope.workoutId || !matchesTimer(current, expected)) return raw
        const time = now(), remaining = remainingTimerMs(current, anchor, time)
        const next = changeTimer(current, expected,
          { type: type === 'finish' ? 'cancel' : type, ...options }, remaining, time)
        if (next === current) return raw
        if ((type === 'finish' || type === 'complete') && current.kind === 'work') {
          return { ...next, status: 'completed', deliveryPending: true,
            elapsedSeconds: type === 'finish' ? Math.max(1, Math.floor((current.durationMs - remaining) / 1000)) : current.durationMs / 1000 }
        }
        return next
      })
      if (!sameScope(scope, activeScope())) return false
      const accepted = readValid(result.record, scope.accountId)
      adopt(accepted?.workoutId === scope.workoutId ? accepted : null)
      if (!result.changed) return false
      onMutation(result.record)
      await deliver(result.record, scope, type === 'complete' || type === 'finish')
      return true
    } catch (error) { onError(error); return false }
  }
  async function tick() {
    if (record?.status !== 'running') return
    if (!sameScope(record, activeScope())) { adopt(null); return }
    publish()
    if (remainingTimerMs(record, anchor, now()) > 0) return
    const token = timerToken(record), key = JSON.stringify(token)
    if (completing === key) return
    completing = key
    try { await command('complete', {}, token) } finally { if (completing === key) completing = null }
  }
  return {
    restore, tick, command,
    token: () => timerToken(record),
    clearView: () => { restoring++; adopt(null) },
    // Cancel a departed workout without touching a timer which replaced it in another tab.
    async cancelScope(scope, expected) {
      if (!scope?.accountId || !expected) return
      try {
        const result = await storage.transact(scope.accountId, raw => {
          const current = readValid(raw, scope.accountId)
          return current?.workoutId === scope.workoutId
            ? changeTimer(current, expected, { type: 'cancel' }, 0, now()) : raw
        })
        if (result.changed) onMutation(result.record)
      } catch (error) { onError(error) }
    }
  }
}
