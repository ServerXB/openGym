import { describe, expect, it, vi } from 'vitest'
import { createTimerRuntime } from './local-timer-runtime.js'
import { createTimer, timerToken } from './local-timer.js'

export function memoryTimers() {
  const records = new Map()
  let queue = Promise.resolve(), failing = false
  return {
    records, fail: value => { failing = value },
    async read(account) { await queue; if (failing) throw Error('storage failed'); return structuredClone(records.get(account) || null) },
    transact(account, update) {
      const action = queue.then(() => {
        if (failing) throw Error('storage failed')
        const previous = structuredClone(records.get(account) || null), record = update(previous)
        const changed = JSON.stringify(previous) !== JSON.stringify(record)
        if (changed) records.set(account, structuredClone(record))
        return { previous, record, changed }
      })
      queue = action.catch(() => {})
      return action
    }
  }
}
function fixture(storage = memoryTimers()) {
  let wall = 100000, mono = 0, n = 0, scope = { accountId: 'guest', workoutId: 'today' }
  const onChange = vi.fn(), onComplete = vi.fn(() => true), onError = vi.fn(), onMutation = vi.fn()
  const make = () => createTimerRuntime({ storage, id: () => 'timer-' + ++n,
    clock: { wallNow: () => wall, monoNow: () => mono }, getScope: () => scope,
    onChange, onComplete, onError, onMutation })
  return { storage, make, onChange, onComplete, onError, onMutation,
    latest: () => onChange.mock.lastCall?.[0],
    advance: ms => { wall += ms; mono += ms }, jump: ms => { wall += ms },
    scope: value => { scope = value } }
}
const start = runtime => runtime.command('start', { kind: 'rest', durationMs: 120000 })
const work = runtime => runtime.command('start', { kind: 'work', durationMs: 45000,
  binding: { entryId: 'entry', setId: 'set' } })

describe('durable timer runtime', () => {
  it('recovers a delayed 35-second tick without counting interval callbacks', async () => {
    const f = fixture(), r = f.make(); await start(r); f.advance(35000); await r.tick()
    expect(f.latest().left).toBe(85); expect(f.onComplete).not.toHaveBeenCalled()
  })
  it('does not finish with 499 milliseconds remaining', async () => {
    const f = fixture(), r = f.make(); await start(r); f.advance(119501); await r.tick()
    expect(f.latest().left).toBe(1); expect(f.onComplete).not.toHaveBeenCalled()
    f.advance(499); await r.tick(); expect(f.latest()).toBeNull(); expect(f.onComplete).toHaveBeenCalledTimes(1)
  })
  it.each([3600000, -50000])('does not jump when live wall clock moves by %i', async shift => {
    const f = fixture(), r = f.make(); await start(r); f.advance(35000); f.jump(shift)
    await r.restore(); await r.tick(); expect(f.latest().left).toBe(85)
  })
  it('refresh reconstructs the deadline with a new monotonic anchor', async () => {
    const f = fixture(), r = f.make(); await start(r); f.advance(35000)
    await f.make().restore(); expect(f.latest().left).toBe(85)
  })
  it('rest expiry fires once across concurrent tabs and delayed callbacks', async () => {
    const f = fixture(), a = f.make(), b = f.make(); await start(a); await b.restore()
    f.advance(120000); await Promise.all([a.tick(), b.tick(), a.tick()])
    await a.restore(); await b.restore(); expect(f.onComplete).toHaveBeenCalledTimes(1)
  })
  it('pending work is consumed once by concurrent restoring tabs', async () => {
    const f = fixture(), a = f.make(), b = f.make(); await work(a); await b.restore()
    f.advance(45000); await Promise.all([a.tick(), b.tick()])
    await Promise.all([a.restore(), b.restore()]); expect(f.onComplete).toHaveBeenCalledTimes(1)
    expect(f.storage.records.get('guest').deliveryPending).toBe(false)
  })
  it('does not lose pending completion when workout persistence rejects it', async () => {
    const f = fixture(), a = f.make(); await work(a); f.onComplete.mockReturnValue(false)
    f.advance(45000); await a.tick(); expect(f.storage.records.get('guest').deliveryPending).toBe(true)
    expect(await start(a)).toBe(false)
    f.onComplete.mockReturnValue(true); await f.make().restore()
    expect(f.storage.records.get('guest').deliveryPending).toBe(false)
  })
  it('replays completion after a crash between timer expiry and saving its workout', async () => {
    const f = fixture(), a = f.make(); await work(a)
    const old = f.storage.records.get('guest')
    f.storage.records.set('guest', { ...old, status: 'completed', revision: old.revision + 1, deliveryPending: true, elapsedSeconds: 45 })
    await f.make().restore(); expect(f.onComplete).toHaveBeenCalledWith(expect.anything(), 45)
  })
  it('early completion logs elapsed time, not rounded display remaining', async () => {
    const f = fixture(), a = f.make(); await work(a); f.advance(7350)
    await a.command('finish'); expect(f.onComplete).toHaveBeenCalledWith(expect.anything(), 7)
  })
  it('extensions use actual remaining milliseconds', async () => {
    const f = fixture(), a = f.make(); await start(a); f.advance(35500)
    await a.command('extend', { deltaMs: 15000 }); expect(f.latest().left).toBe(100)
    expect(f.latest().deadlineAt).toBe(235000)
  })
  it('exhausting subtraction cancels without falsely completing rest', async () => {
    const f = fixture(), a = f.make(); await start(a); f.advance(110000)
    await a.command('extend', { deltaMs: -15000 }); expect(f.latest()).toBeNull()
    expect(f.onComplete).not.toHaveBeenCalled()
  })
  it.each(['cancel', 'finish', 'complete', 'extend'])('rejects stale %s commands after extension', async type => {
    const f = fixture(), a = f.make(); await start(a); const token = a.token()
    await a.command('extend', { deltaMs: 15000 })
    expect(await a.command(type, { deltaMs: 15000 }, token)).toBe(false)
    expect(f.latest().left).toBe(135)
  })
  it('stale cancellation cannot cancel a newly started work timer', async () => {
    const f = fixture(), a = f.make(); await start(a); const old = a.token(); await work(a)
    expect(await a.command('cancel', {}, old)).toBe(false); expect(f.latest().kind).toBe('work')
  })
  it('a stale start cannot replace a timer started by another tab', async () => {
    const f = fixture(), a = f.make(), b = f.make(); await start(a); await b.restore()
    await work(a); expect(await start(b)).toBe(false); expect(f.latest().kind).toBe('work')
  })
  it('a tab that has not restored cannot overwrite an existing running timer', async () => {
    const f = fixture(), a = f.make(), b = f.make(); await start(a)
    expect(await start(b)).toBe(false)
  })
  it('rest and work are mutually exclusive in both directions', async () => {
    const f = fixture(), a = f.make(); await start(a); await work(a); await start(a)
    expect(f.latest().kind).toBe('rest'); expect(f.latest().revision).toBe(3)
  })
  it('timers in distinct device repositories are independent', async () => {
    const first = fixture(), second = fixture(); await start(first.make())
    await second.make().restore(); expect(second.latest()).toBeNull()
  })
  it.each([null, { accountId: 'other', workoutId: 'today' }, { accountId: 'guest', workoutId: 'tomorrow' }])('does not deliver into a departed scope %j', async scope => {
    const f = fixture(), a = f.make(); await work(a); f.advance(45000); f.scope(scope)
    await a.restore(); expect(f.latest()).toBeNull(); expect(f.onComplete).not.toHaveBeenCalled()
  })
  it('new workout replaces an obsolete timer without reusing its binding', async () => {
    const f = fixture(), a = f.make(); await work(a); f.scope({ accountId: 'guest', workoutId: 'tomorrow' })
    a.clearView(); await start(a); expect(f.latest().workoutId).toBe('tomorrow')
  })
  it('an abandoned workout pending result cannot permanently block future workouts', async () => {
    const f = fixture(), a = f.make(); await work(a); f.onComplete.mockReturnValue(false)
    f.advance(45000); await a.tick(); f.scope({ accountId: 'guest', workoutId: 'tomorrow' })
    a.clearView(); expect(await start(a)).toBe(true)
    expect(f.latest().workoutId).toBe('tomorrow')
  })
  it('departed-workout cancellation cannot affect its replacement', async () => {
    const f = fixture(), a = f.make(); await start(a); const old = a.token()
    f.scope({ accountId: 'guest', workoutId: 'tomorrow' }); a.clearView(); await start(a)
    await a.cancelScope({ accountId: 'guest', workoutId: 'today' }, old)
    expect(f.storage.records.get('guest').status).toBe('running')
  })
  it('storage failure reports error and never shows an unpersisted running timer', async () => {
    const f = fixture(), a = f.make(); f.storage.fail(true)
    expect(await start(a)).toBe(false); expect(f.onError).toHaveBeenCalledTimes(1)
    expect(f.latest()).toBeUndefined(); expect(f.onMutation).not.toHaveBeenCalled()
  })
  it.each([{ version: 99 }, { ...createTimer({ kind: 'rest', accountId: 'foreign', workoutId: 'today', durationMs: 120000 }, null, { wallNow: 100000, monoNow: 0, id: 'foreign' }) }])('preserves malformed or foreign persisted records', async original => {
    const f = fixture(), a = f.make(); f.storage.records.set('guest', structuredClone(original))
    await a.restore(); expect(await start(a)).toBe(false)
    expect(f.storage.records.get('guest')).toEqual(original); expect(f.onError).toHaveBeenCalled()
  })
  it('no-scope commands cannot create orphan timers', async () => {
    const f = fixture(), a = f.make(); f.scope(null)
    expect(await start(a)).toBe(false); expect(f.storage.records.size).toBe(0)
  })
  it('terminal revisions remain as tombstones and reject old events', async () => {
    const f = fixture(), a = f.make(); await start(a); const token = a.token()
    await a.command('cancel'); await a.restore(); expect(f.latest()).toBeNull()
    expect(await a.command('extend', { deltaMs: 15000 }, token)).toBe(false)
    expect(timerToken(f.storage.records.get('guest')).revision).toBe(2)
  })
})
