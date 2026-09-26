import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { dateLocale, t } from '../lib/i18n.js'

const LABELS = {
  offline_local: 'Offline — changes saved on this device',
  offline: 'Offline — changes saved on this device',
  pending: '{0} changes waiting to sync',
  syncing: 'Syncing…',
  synced: 'Synced at {0}',
  conflict: 'Sync conflict — your copies are safe',
  auth_required: 'Sign in again to sync',
  storage_error: 'Local save failed — stop editing and export a backup',
  error: 'Sync paused — your changes are saved on this device',
  local: 'Saved on this device',
}

const timeLabel = value => value
  ? new Date(value).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
  : '—'

function downloadJSON(value, name) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(href)
}

export default function SyncStatus() {
  const user = useStore(s => s.user)
  const active = useStore(s => s.S.active)
  const sync = useStore(s => s.sync)
  const syncNow = useStore(s => s.syncNow)
  const resolve = useStore(s => s.resolveSyncConflict)
  const [details, setDetails] = useState(false)

  if (!user || !sync) return null
  const status = sync.status || 'local'
  const template = LABELS[status] || LABELS.error
  const label = status === 'pending'
    ? t(template, Math.max(1, sync.pendingCount || 1))
    : status === 'synced'
      ? t(template, timeLabel(sync.lastSyncAt))
      : t(template)
  const canRetry = ['offline_local', 'offline', 'pending', 'error'].includes(status)
  const conflict = sync.conflict
  const conflictCount = conflict?.conflicts?.length || 0
  const otherCopyLabel = conflict?.kind === 'device' ? t('Export other device copy') : t('Export server copy')
  const useOtherLabel = conflict?.kind === 'device' ? t('Use other device copy') : t('Use server')

  return (
    <section className={'syncbar ' + status} aria-label={t('Synchronization status')}>
      <div className="syncbar-main" role="status" aria-live="polite">
        <span className="syncbar-dot" aria-hidden="true" />
        <span className="syncbar-label">{label}</span>
        {canRetry && <button type="button" className="syncbar-action" onClick={() => syncNow()}>{t('Sync now')}</button>}
        {status === 'conflict' && !active && (
          <button type="button" className="syncbar-action" aria-expanded={details} onClick={() => setDetails(v => !v)}>
            {details ? t('Hide details') : t('Review')}
          </button>
        )}
      </div>
      {status === 'conflict' && active && (
        <div className="syncbar-note">{t('Finish the workout before resolving this conflict.')}</div>
      )}
      {status === 'conflict' && details && !active && conflict && (
        <div className="syncbar-details">
          <p>{t('{0} conflicting fields. Non-conflicting changes are already combined.', conflictCount)}</p>
          <div className="syncbar-paths">
            {(conflict.conflicts || []).slice(0, 4).map(item => <code key={item.path}>{item.path || '/'}</code>)}
            {conflictCount > 4 && <span>{t('+{0} more', conflictCount - 4)}</span>}
          </div>
          <div className="syncbar-buttons">
            <button type="button" onClick={() => downloadJSON(conflict.local, 'opengym-conflict-this-device.json')}>{t('Export this device')}</button>
            <button type="button" onClick={() => downloadJSON(conflict.remote, 'opengym-conflict-other-copy.json')}>{otherCopyLabel}</button>
            <button type="button" onClick={() => resolve('local')}>{t('Use this device')}</button>
            <button type="button" onClick={() => resolve('remote')}>{useOtherLabel}</button>
          </div>
        </div>
      )}
    </section>
  )
}
