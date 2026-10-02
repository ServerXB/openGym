import { t } from './i18n.js'

// Separate from the repeating workout-day reminders (100–106).
export const REST_NOTIFICATION_ID = 200

/** Best-effort alerts. Call only when adopting or changing a timer, never per tick. */
export function createTimerNotifier({
  mobile = false,
  user = () => null,
  api,
  loadNative = () => import('@capacitor/local-notifications'),
  wallNow = Date.now
} = {}) {
  let pending = Promise.resolve()
  let generation = 0

  return function notify(record) {
    const request = ++generation
    const snapshot = record ? { ...record } : null
    const accountId = user()?.id
    const current = () => request === generation

    const apply = async () => {
      if (!current()) return false
      try {
        const running = snapshot?.kind === 'rest' && snapshot.status === 'running'
          && Number.isFinite(snapshot.deadlineAt) && snapshot.deadlineAt > wallNow()

        if (mobile) {
          const loaded = await loadNative()
          const native = loaded.LocalNotifications || loaded
          if (!current()) return false
          await native.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] })
          if (!current()) return false
          if (!running) return true

          // Starting/restoring a timer must never cause an OS permission prompt.
          const permission = await native.checkPermissions()
          if (!current() || permission?.display !== 'granted') return false
          if (snapshot.deadlineAt <= wallNow()) return true
          await native.schedule({ notifications: [{
            id: REST_NOTIFICATION_ID,
            title: t('Rest timer'),
            body: t('Rest over — next set!'),
            schedule: { at: new Date(snapshot.deadlineAt), allowWhileIdle: true }
          }] })
          return true
        }

        if (!accountId || user()?.id !== accountId || typeof api !== 'function'
          || (snapshot?.accountId && snapshot.accountId !== accountId)) return false
        const path = running ? '/api/push/rest-timer' : '/api/push/rest-timer/cancel'
        await api(path, {
          method: 'POST',
          body: JSON.stringify(running ? { deadlineAt: snapshot.deadlineAt } : {})
        })
        return true
      } catch {
        // Neither a plugin failure nor an offline push endpoint can stop the countdown.
        return false
      }
    }

    // Serialize both scheduling and cancellation. An older permission/import response
    // cannot schedule after a later cancel, and an in-flight schedule is cancelled next.
    pending = pending.then(apply, apply)
    return pending
  }
}
