# Confirmed Rep-Range — Test Report

## Metadata

- Date: 2026-08-22
- Repository: `https://github.com/ruvelro/openGym.git`
- Branch: `feature/confirmed-rep-range-progression`
- Base revision: `a5606ac588dba2c3f9946a10dd555c48e493681f`
- Tester role: independent implementation review and regression testing
- Overall result: **Code acceptance passed; Docker/browser smoke tests still outstanding**

The initial integration review found one high-severity defect and two medium-severity
configuration/UI problems. All three were corrected and are now covered by automated regression
tests.

## Environment

- OS shell: Windows PowerShell
- Frontend: React 19, Vite 8, Vitest 4
- Local Node runtime: Node.js 26.3.0
- Docker: unavailable in the test environment
- Browser end-to-end runner: unavailable

## Baseline before implementation

The original frontend suite was executed before changing the implementation.

```text
Test Files  7 passed (7)
Tests       192 passed (192)
```

No pre-existing frontend test failures were recorded.

## Final automated test run

Command:

```powershell
cd frontend
npm.cmd test
```

Result:

```text
Test Files  9 passed (9)
Tests       218 passed (218)
```

- Passed: 218
- Failed: 0
- Tests added since baseline: 26
- Result: **Pass**

The new unit tests cover:

- successful target progression from 8 to 12;
- first successful session at the top of the range;
- second consecutive top-range confirmation;
- weight increment and target reset;
- interrupted top-range confirmation streak;
- failure on the first set;
- failure after a successful first set;
- 30-second recovery increment;
- recovery cap;
- failure while recovery is already at its maximum;
- repetitions above the target;
- incomplete prescribed sets;
- optional extra sets;
- legacy configuration without the new fields;
- isolation from workouts logged under another progression policy.

## Frontend production build

Command:

```powershell
cd frontend
npm.cmd run build
```

Result: **Pass**

Vite transformed 105 modules and generated the production bundle successfully. The build emitted
only a chunk-size warning. This warning is unrelated to Confirmed Rep-Range and does not fail the
build.

## Backend checks

Command:

```powershell
cd api
node --check server.js
```

Result: **Pass**

Direct API startup was also attempted with an isolated temporary data directory. Startup did not
reach the health endpoint because the local Node 26 runtime could not resolve a transitive
WebAuthn module:

```text
ERR_MODULE_NOT_FOUND
@peculiar/asn1-schema/build/es2015/schema.js
```

No modified application file participates in this import failure. The API should be retested with
the Node version used by the project Docker image.

## Docker checks

Planned commands:

```powershell
docker compose config --quiet
docker compose up --build
```

Result: **Blocked**

Docker is not installed or not available on `PATH` in the test environment. Consequently, the
following checks remain outstanding:

- Compose configuration validation;
- frontend and backend container builds;
- API health check through nginx;
- frontend HTTP response through the composed stack;
- persistence across `docker compose down/up`.

## Domain behavior verification

| Scenario | Expected result | Result |
|---|---|---|
| `8/8/8` at target 8 | Target 9 | Pass |
| `9/9/9` at target 9 | Target 10 | Pass |
| `10/10/10` at target 10 | Target 11 | Pass |
| `11/11/11` at target 11 | Target 12 | Pass |
| First `12/12/12` | Streak 1, weight unchanged | Pass |
| Second consecutive `12/12/12` | Weight + increment, target 8, streak 0 | Pass |
| `12/12/12`, then `12/11/10` | Streak reset to 0 | Pass |
| First set below target | Weight, target and recovery unchanged | Pass |
| First set succeeds, later set fails | Recovery +30 seconds | Pass |
| Recovery near maximum | Recovery capped exactly at maximum | Pass |
| Recovery already at maximum | Recovery remains at maximum | Pass |
| Reps above target | Session succeeds | Pass |
| Prescribed set incomplete | Session fails | Pass |
| Extra set below target | Extra set ignored | Pass |
| Extra set after a prescribed miss | Extra set cannot rescue session | Pass |
| RIR/RPE values | Do not influence progression | Pass by code review |
| Automatic deload | Never performed by this strategy | Pass by code review |

## Integration review findings

### CRRP-001 — High — Incorrect rows after switching progression policy

Status: **Resolved and regression-tested**

Resolution:

- `applyPrescription()` now applies explicit targets even when the prescription kind is `first`;
- fieldless first-session prescriptions used by existing strategies remain no-ops;
- integrated tests cover switches from Linear, Double and Greyskull and verify both generated
  rows and target snapshots.

Reproduction:

1. Log an exercise under Linear progression as `3 × 5 @ 60 kg`.
2. Change it to Confirmed Rep-Range.
3. Configure a starting target of 8 reps.
4. Start the next workout.

Observed code path:

1. `nextPrescription()` correctly returns a `first` plan with target 8.
2. `buildSets()` carries the repetitions from the previous workout and can create rows containing
   5 reps.
3. `applyPrescription()` returns without applying a plan whose kind is `first`.
4. The workout target snapshot is nevertheless saved as 8 reps.

Impact:

The UI can present `5/5/5` while the progression engine judges the workout against `8/8/8`.
Completing the displayed rows therefore records an unexpected failure unless the user manually
changes every row.

Relevant files:

- `frontend/src/lib/progression.js`
- `frontend/src/lib/history.js`
- `frontend/src/sheets.jsx`

Required regression test:

```text
previous Linear workout
→ switch to Confirmed Rep-Range at target 8
→ build next workout
→ every generated set must contain 8 reps
→ target snapshot must also contain 8 reps
```

#### Manual UI reproduction

Prerequisites:

- use a disposable guest profile or a test account;
- set the unit to kilograms;
- ensure Bench Press is present in a routine;
- set the profile rest timer to 90 seconds;
- configure Bench Press as `3 sets`, `5 reps`, `60 kg`, Linear progression.

Steps:

1. Start the routine containing Bench Press.
2. Complete Bench Press as `60×5 / 60×5 / 60×5`.
3. Finish and save the workout.
4. Open the routine editor.
5. Open Bench Press.
6. Select **Confirmed Rep-Range**.
7. Set:
   - Minimum reps: 8;
   - Maximum reps: 12;
   - Current target reps: 8;
   - Weight increment: 2.5 kg;
   - Current rest time: 120 seconds;
   - Maximum rest time: 240 seconds.
8. Save the exercise.
9. Start the same routine again.
10. Inspect all three Bench Press rows before editing them.
11. Record the displayed reps and weight.
12. If the rows display 5 reps, complete them without manually changing the repetitions.
13. Finish the workout and start the routine once more.
14. Inspect the progression explanation and next prescription.

Expected:

- step 10 displays `70×8` or the configured/current working weight with 8 reps on every row;
- the displayed rows and the saved target snapshot both use target 8;
- completing all displayed rows is evaluated as success;
- the following workout prescribes target 9.

Actual in the reviewed code path:

- `buildSets()` may carry 5 reps from the preceding Linear workout;
- `applyPrescription()` does not replace them because the new plan has kind `first`;
- the target snapshot nevertheless records target 8;
- completing the displayed `5/5/5` can be evaluated as a failure against `8/8/8`.

Evidence to capture:

- screenshot of the Confirmed Rep-Range configuration;
- screenshot of the three rows immediately after starting the workout;
- exported state or browser localStorage before finishing;
- the active entry's `target`, `plan` and `sets` values;
- screenshot of the next workout's progression explanation.

Pass criterion after a fix:

```text
active.entries[n].target.reps === 8
active.entries[n].target.targetReps === 8
active.entries[n].sets.every(set => set.r === 8)
```

The same procedure must also be repeated when switching from Double and Greyskull.

### CRRP-002 — Medium/High — Routine-level selection produces an implicit 10–10 range

Status: **Resolved and regression-tested**

Resolution:

- a shared pure configuration helper defines canonical defaults: range 8–12, starting target 8,
  profile recovery, maximum recovery 240 seconds and streak 0;
- selecting Confirmed Rep-Range at routine level materializes these fields on rep exercises that
  inherit the routine rule;
- explicit per-exercise progression overrides remain untouched;
- the domain applies the same normalization to already-saved/imported incomplete configurations,
  so compatibility does not depend on revisiting the routine editor.

Reproduction:

1. Select Confirmed Rep-Range as the routine progression.
2. Do not open and save each exercise configuration.
3. Start a workout with an exercise configured only as `reps: 10`.

Observed result:

```text
minReps = 10
maxReps = 10
targetReps = 10
```

The exercise skips normal rep-range progression and immediately behaves as a top-range target
requiring two confirmations before increasing weight.

Expected resolution options:

- initialize every affected exercise when the routine policy changes;
- define domain defaults consistent with the UI;
- or prevent routine-level activation until every exercise has valid parameters.

#### Manual UI reproduction

Prerequisites:

- create a new disposable routine;
- add an exercise with the ordinary default configuration `3 sets × 10 reps`;
- do not open the exercise configuration again after adding it.

Steps:

1. Open the routine editor.
2. Set the routine-level progression to **Confirmed Rep-Range**.
3. Do not open or save the individual exercise.
4. Start the routine.
5. Complete all sets as `10/10/10` and finish the workout.
6. Start the routine again.
7. Complete all sets as `10/10/10` and finish the workout.
8. Start the routine a third time.
9. Inspect the prescribed reps and weight.

Expected:

- the application either asks for the missing per-exercise range before starting;
- or initializes a documented range such as 8–12 consistently;
- or prevents routine-level Confirmed Rep-Range from applying to unconfigured exercises.

Actual in the reviewed code path:

- `reps: 10` is used as minimum, maximum and current target;
- the implicit range becomes 10–10;
- the first workout is immediately treated as top-range confirmation 1/2;
- the second successful workout can trigger a weight increase without progressing through a
  meaningful rep range.

Technical state to inspect before the first workout:

```json
{
  "routine": { "prog": "confirmed_rep_range" },
  "exercise": { "sets": 3, "reps": 10, "weight": 70 }
}
```

Evidence to capture:

- exported routine JSON before opening the individual exercise;
- first workout's `entry.target` and `entry.plan`;
- progression explanation after the first success;
- third workout's prescribed weight and reps.

Pass criterion after a fix:

- no exercise starts this strategy with an accidental range where `minReps === maxReps` unless
  the user explicitly configured that range;
- domain defaults and UI defaults produce exactly the same stored values.

### CRRP-003 — Medium — “Current target reps” displays stale configuration

Status: **Resolved and regression-tested**

Resolution:

- the editable fields are now labelled **Starting target reps** and **Starting rest time**;
- the editor separately displays the effective next-workout reps and recovery derived from
  `nextPrescription()`;
- UI saving and domain calculation use the same normalized defaults.

After the algorithm advances from 8 to 9 or 10, the effective target is derived from workout
history. The routine configuration still contains the initial `targetReps: 8`.

Reopening the exercise editor therefore displays 8 as “Current target reps” even when the next
workout will prescribe 9 or 10.

Expected resolution options:

- display the current value returned by `nextPrescription()`;
- rename the field to “Starting target reps”;
- or introduce an explicit progression reset/override operation.

#### Manual UI reproduction

Prerequisites:

- configure an exercise as Confirmed Rep-Range with range 8–12 and current target 8;
- use a clean history for this strategy.

Steps:

1. Start the routine.
2. Complete every prescribed set at target 8.
3. Finish the workout.
4. Start and finish the next workout successfully at target 9.
5. Verify that the following workout would prescribe target 10.
6. Return to the routine editor without starting that workout.
7. Open the exercise configuration.
8. Read the value shown in **Current target reps**.

Expected:

- the field displays 10 if it is genuinely the current target;
- alternatively, the UI labels the stored value as the starting/reset target and separately
  displays the effective next target as 10.

Actual in the reviewed code path:

- the field reads the original routine configuration;
- it can display 8 while `nextPrescription()` will prescribe 10.

Evidence to capture:

- screenshot of the target-10 progression explanation;
- screenshot of the exercise editor showing the conflicting value;
- routine exercise JSON;
- latest workout target snapshot;
- result of `nextPrescription()` for the same state.

Pass criterion after a fix:

- the value labelled “Current target reps” always equals the target used to construct the next
  workout;
- any manual edit has explicit, documented reset/override semantics.

## Timer integration

Static review confirms that the workout timer selects recovery in this order:

```text
entry.plan.restSeconds
→ entry.target.restSeconds
→ profile restSec
```

This connects adaptive recovery to the timer used during the workout. However, there is currently
no automated integration test asserting the value passed to `startRest()`.

Recommended test:

```text
10/9/8 at 120 seconds
→ next workout plan contains 150 seconds
→ completing a non-final set calls startRest(150)
```

### Manual timer reproduction

Prerequisites:

- exercise configured as `3 × 10`;
- Confirmed Rep-Range selected;
- current recovery 120 seconds;
- maximum recovery 240 seconds.

Steps:

1. Start the workout.
2. Record `10/9/8` and mark the three prescribed sets complete.
3. Finish and save the workout.
4. Start the next workout.
5. Confirm that the progression explanation reports recovery `120 → 150 seconds`.
6. Complete only the first set.
7. Observe the rest timer immediately after checking the set.
8. Refresh the browser while the workout remains active.
9. Complete the second set and observe the timer again.

Expected:

- the next workout target remains 10;
- weight is unchanged;
- both timer starts use 150 seconds;
- refreshing does not restore the exercise recovery to the global value;
- the active workout keeps `restSeconds: 150` in its target/plan snapshot.

Repeat the same procedure from 230 seconds with a maximum of 240. The next timer must start at
exactly 240 seconds. Repeat once more at 240; it must remain 240.

First-set control case:

1. Configure recovery at 120 seconds and target 10.
2. Record the first set as 9 reps.
3. Leave later prescribed sets incomplete and finish early.
4. Start the next workout.
5. Confirm that recovery and timer remain at 120 seconds.

## Persistence and backward compatibility

Static review confirms:

- old top-level state is overlaid on current defaults;
- new progression fields are optional;
- finished workout targets are snapshotted rather than rewritten;
- localStorage, server sync and mobile file persistence serialize the complete state;
- no database or manual migration was introduced.

The existing compatibility test confirms that a Confirmed Rep-Range configuration without the
new fields does not throw. A complete persistence round-trip test is still recommended for:

```text
legacy JSON
→ load state
→ build workout
→ finish workout
→ serialize
→ reload
→ calculate identical next prescription
```

### Browser refresh test

1. Configure Confirmed Rep-Range and start a workout.
2. Complete at least one set.
3. Copy the current active entry's `target`, `plan` and `sets` from browser storage.
4. Refresh the page.
5. Confirm that the active workout reopens.
6. Compare target, plan, sets, recovery and streak with the values captured before refresh.

Pass criterion: the values are identical and no completed set is lost.

### Frontend/backend restart test

1. Sign in with a disposable test account.
2. Configure the strategy and finish a successful workout.
3. Wait for state synchronization to complete.
4. Stop the frontend and backend processes.
5. Restart both processes.
6. Sign in again.
7. Start the routine.
8. Confirm that the next target, weight, recovery and streak match the prescription calculated
   before restart.

### Docker persistence test

Run in a Docker-enabled environment:

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps
curl.exe --fail http://localhost:8080/api/health
curl.exe --fail --head http://localhost:8080/
```

Then:

1. create a disposable account and configure the progression;
2. finish at least one workout;
3. export or record the expected next prescription;
4. run `docker compose down` without deleting volumes/data;
5. run `docker compose up -d`;
6. sign in and confirm the state and next prescription are unchanged;
7. reboot the host if reboot persistence is part of the release gate;
8. repeat the API health and frontend HTTP checks.

Do not use `docker compose down -v`, because that intentionally deletes volumes.

### Legacy JSON test fixture

Use a copy of a state created before Confirmed Rep-Range existed. It must omit all new fields:

```json
{
  "unit": "kg",
  "restSec": 90,
  "routines": [
    {
      "id": "legacy-routine",
      "name": "Legacy",
      "ex": [
        {
          "id": "0025",
          "sets": 3,
          "mode": "reps",
          "reps": 10,
          "weight": 60,
          "prog": "linear"
        }
      ]
    }
  ],
  "workouts": [],
  "bodyweight": [],
  "exWeights": {}
}
```

Steps:

1. import or load the fixture through the normal application path;
2. confirm the routine and exercise remain visible;
3. start and finish a workout under the original policy;
4. confirm no new strategy is selected implicitly;
5. switch explicitly to Confirmed Rep-Range;
6. configure and save all required parameters;
7. reload the application;
8. verify that both the old workout and new configuration remain readable.

Pass criterion: no exception, data loss, manual migration prompt or retroactive workout change.

## Complete six-session acceptance test

Configuration:

```text
Exercise: Bench Press
Sets: 3
Minimum reps: 8
Maximum reps: 12
Current target: 8
Weight: 70 kg
Weight increment: 2.5 kg
Current recovery: 120 seconds
Maximum recovery: 240 seconds
```

Procedure:

1. Session 1: complete `8/8/8`; finish and save.
2. Start Session 2 and verify `70 kg × 9`; complete `9/9/9`; finish and save.
3. Start Session 3 and verify `70 kg × 10`; complete `10/10/10`; finish and save.
4. Start Session 4 and verify `70 kg × 11`; complete `11/11/11`; finish and save.
5. Start Session 5 and verify `70 kg × 12`; complete `12/12/12`; finish and save.
6. Start Session 6 and verify:
   - weight remains 70 kg;
   - target remains 12;
   - UI reports `Top range confirmation: 1 / 2`.
7. Complete Session 6 as `12/12/12`; finish and save.
8. Start Session 7 and verify:
   - weight is 72.5 kg;
   - target is 8;
   - streak is 0;
   - UI reports the old/new weight and target reset.

At every session capture:

- displayed row values before editing;
- progression explanation;
- timer value after the first and second sets;
- saved workout target snapshot;
- next prescription after saving.

Acceptance criterion: every displayed prescription, target snapshot, recorded history entry and
next calculation agrees with the table above.

## Interrupted streak acceptance test

1. Reach target 12 at 70 kg.
2. Complete `12/12/12`; verify confirmation 1/2 in the following workout.
3. Record `12/11/10`; finish the workout.
4. Start again; verify target 12, weight 70 kg and streak 0.
5. Complete `12/12/12`; start again and verify confirmation 1/2, not a weight increase.
6. Complete another `12/12/12`; start again and verify 72.5 kg × 8.

Acceptance criterion: only the final two genuinely consecutive successes trigger the increase.

## Extra-set acceptance test

Success case:

1. Configure 3 prescribed sets at target 10.
2. Add a fourth set during the workout.
3. Record `10/10/10/1` with all sets checked.
4. Finish and start the next workout.
5. Verify that the prescribed work was successful and target becomes 11.

Failure case:

1. Configure 3 prescribed sets at target 10.
2. Add a fourth set.
3. Record `10/9/10/20`.
4. Finish and start the next workout.
5. Verify target remains 10 and recovery increases by 30 seconds.

Acceptance criterion: the fourth set neither causes a failure nor rescues a failure in the first
three prescribed sets.

## Evidence template

Use this block for every manual execution:

```text
Test ID:
Date/time:
Tester:
Commit SHA:
Browser/device:
Profile type: guest / signed-in
Initial state or fixture:
Steps completed:
Expected result:
Actual result:
Pass / Fail / Blocked:
Screenshot paths:
Exported-state path:
Console errors:
Notes:
```

## Missing end-to-end coverage

Before release, add automated or manual verification for:

- selecting the policy in the routine editor;
- configuring all exercise fields;
- starting and finishing six consecutive example sessions;
- switching from Linear, Double and Greyskull;
- refreshing during an active workout;
- restarting frontend and backend;
- rest timer behavior after adaptive recovery;
- profile sync between two browser sessions;
- backup export/import round trip;
- Docker down/up persistence;
- mobile persistence if the Capacitor build is in scope.

## Release recommendation

**The code-level acceptance gate is passed.**

CRRP-001, CRRP-002 and CRRP-003 are resolved and protected by automated tests. The complete
frontend suite, production build and backend syntax check pass. Release remains conditional on
the Docker and real-browser smoke tests that cannot run in the current environment.

After the fixes, rerun:

1. the complete frontend suite;
2. production frontend build;
3. the new integration tests described above;
4. Docker Compose build and startup;
5. API health and frontend HTTP smoke tests;
6. a manual six-session Confirmed Rep-Range workflow.
