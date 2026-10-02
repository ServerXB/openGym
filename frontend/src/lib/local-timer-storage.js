// IndexedDB read/write transactions serialize timer commands across tabs, including on HTTP.
// Timers are local-only: never part of the profile sync/export or the server's workout history.
export const TIMER_SIGNAL_KEY = 'gym_timer_signal_v1'
export function createTimerStorage({ indexedDB = globalThis.indexedDB, signal = () => {} } = {}) {
  let database
  const open = () => database ||= new Promise((resolve, reject) => {
    if (!indexedDB) { reject(new Error('Timer storage unavailable')); return }
    const request = indexedDB.open('opengym-local-timers', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('timers', { keyPath: 'accountId' })
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Timer database upgrade blocked'))
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = null }
      resolve(request.result)
    }
  }).catch(error => { database = null; throw error })
  async function transact(accountId, updater, mode = 'readwrite') {
    const db = await open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('timers', mode), store = tx.objectStore('timers')
      const request = store.get(accountId)
      let output, failure
      request.onsuccess = () => {
        try {
          const previous = request.result || null
          const record = updater(previous)
          const changed = JSON.stringify(record) !== JSON.stringify(previous)
          output = { previous, record, changed }
          if (changed) store.put(record)
        } catch (error) { failure = error; tx.abort() }
      }
      tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('Timer transaction failed'))
      tx.oncomplete = () => {
        if (output.changed) { try { signal(accountId) } catch { /* persistence already committed */ } }
        resolve(output)
      }
    })
  }
  return { transact, read: async accountId => (await transact(accountId, value => value, 'readonly')).record }
}
