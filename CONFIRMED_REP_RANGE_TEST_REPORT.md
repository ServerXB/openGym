# Confirmed Rep-Range — Test Report

## Metadata

- Date: 2026-08-23
- Repository: `https://github.com/ruvelro/openGym.git`
- Branch: `feature/confirmed-rep-range-progression`
- Base revision for this recovery iteration: `c0f7c59`
- Tester role: independent implementation review and regression testing
- Overall result: **Code acceptance passed; Docker and real-browser interaction tests remain outstanding**

The initial integration review found one high-severity defect and two medium-severity
configuration/UI problems. The recovery iteration then added a manual reset and an opt-in
automatic reduction rule, and fixed the edge cases found while testing them. All code-level
findings are now covered by automated regression tests.

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

Before the manual reset and automatic recovery-reduction work started, the already-corrected
Confirmed Rep-Range suite contained 218 passing tests in 9 files:

```text
Test Files  9 passed (9)
Tests       218 passed (218)
```

## Final automated test run

Command:

```powershell
cd frontend
npm.cmd test
```

Result:

```text
Test Files  16 passed (16)
Tests       265 passed (265)
```

- Passed: 265
- Failed: 0
- Tests added since the original 192-test baseline: 73
- Tests added by the recovery reset/automatic-reduction iteration: 47
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
- persistent manual recovery epochs and repeated resets;
- pending reset behavior across discard, deletion and JSON round trips;
- old workouts completed after a reset;
- opt-in automatic recovery reduction after four successful sessions;
- failure, base, maximum, epoch, strategy and recovery-level streak boundaries;
- base edits without retroactive reinterpretation;
- narrow rep ranges and simultaneous weight/recovery progression;
- shared-plan round trips without private recovery history;
- superset timer selection using the longest member recovery.

## Frontend production build

Command:

```powershell
cd frontend
npm.cmd run build
```

Result: **Pass**

Vite transformed 111 modules and generated the production bundle successfully. The build emitted
only a chunk-size warning. This warning is unrelated to Confirmed Rep-Range and does not fail the
build.

The generated bundle was then served locally:

```powershell
cd frontend
npm.cmd run preview -- --host 127.0.0.1 --port 4177
Invoke-WebRequest http://127.0.0.1:4177/ -UseBasicParsing
```

Result: HTTP `200`, root element present, **Pass**.

Locale invariant:

```powershell
cd frontend
node scripts/check-locales.mjs
```

Result: `11 locales, 667 keys each — in sync.`, **Pass**. Languages without native
Confirmed Rep-Range copy use an explicit English fallback; Italian has complete translated copy.

Patch integrity:

```powershell
git diff --check
```

Result: **Pass**. Git printed only the repository's existing Windows LF/CRLF conversion warnings.

## Backend checks

Command:

```powershell
cd api
node --check server.js
```

Result: **Pass**

Dependencies were installed from `api/package-lock.json`, then the API was started on port 3107
with an isolated temporary data directory. The temporary directory was removed after the test.

```powershell
cd api
npm.cmd ci --ignore-scripts
$env:DATA_DIR='E:\Workspace\openGym\.tmp-api-rest-feature'
$env:PORT='3107'
$env:RP_ID='localhost'
$env:ORIGIN='http://localhost:3107'
node server.js
```

Health check from a second terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3107/api/health
```

Result:

```json
{"ok":true,"users":0}
```

Result: **Pass**

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

## Recovery reset and automatic reduction — accepted behavior

### Scientific review and threshold decision

Search and verification were completed on 2026-08-23 using PubMed, PMC, journal DOI pages and
the 2026 ACSM position stand. The important negative finding is explicit: **no identified study
tested “reduce recovery by 30 seconds after N consecutive successful workouts.”** The implemented
rule is therefore evidence-informed and deliberately conservative, not a clinically validated
universal threshold.

| Evidence | Design and comparison | Relevant result | Applicability limit |
|---|---|---|---|
| [Willardson & Burkett 2005](https://pubmed.ncbi.nlm.nih.gov/15705039/) | Acute crossover, 15 trained men, 1 vs 2 vs 5 min | More repetitions/volume with longer recovery; 5 > 2 > 1 min | Acute and no cross-session algorithm |
| [Ratamess et al. 2007](https://pubmed.ncbi.nlm.nih.gov/17237951/) | Acute, 8 trained men, bench press with 30 s to 5 min | Short intervals caused larger repetition declines across sets | Small, acute study |
| [Senna et al. 2016](https://pubmed.ncbi.nlm.nih.gov/26907842/) | Acute crossover, 15 trained men, five 3RM sets, 1/2/3/5 min | At least 2 min better preserved single-joint performance; 3–5 min better for bench press | Near-maximal work; does not provide N |
| [Schoenfeld et al. 2016](https://pubmed.ncbi.nlm.nih.gov/26605807/) | RCT, 21 trained men, 8 weeks, 1 vs 3 min | 3 min produced greater strength gains and some hypertrophy advantages | Small male-only study; fixed intervals |
| [de Salles et al. 2010](https://pubmed.ncbi.nlm.nih.gov/19811949/) | 36 trained men, 16 weeks, 1 vs 3 vs 5 min | Longer intervals favored some strength outcomes | No adaptive/decreasing rule |
| [Ahtiainen et al. 2005](https://pubmed.ncbi.nlm.nih.gov/16095405/) | 13 trained men, six months, 2 vs 5 min with volume equated | Similar strength and cross-sectional-area gains | Very small sample; protocols differed beyond time |
| [Buresh et al. 2009](https://pubmed.ncbi.nlm.nih.gov/19077743/) | 12 untrained men, 10 weeks, 1 vs 2.5 min | Strength similar; greater arm CSA in longer-rest group | Six participants per group |
| [de Souza et al. 2010](https://pubmed.ncbi.nlm.nih.gov/20543741/) | RCT, 20 recreationally trained men, constant 120 s vs gradual 120→30 s | Similar short-term strength/CSA, but decreasing-rest volume was 9.4% lower for bench and 13.9% lower for squat | Calendar-based decrease, small study, not a non-inferiority trial |
| [Souza-Junior et al. 2011](https://pmc.ncbi.nlm.nih.gov/articles/PMC3215636/) | RCT, 22 trained men using creatine, 120 s constant vs −15 s/week to 30 s | Similar group-level strength/CSA; constant-rest volume was 22.9% higher for bench and 14.6% higher for squat | Calendar-based, creatine in both groups, small study; performance worsened at shorter intervals |
| [Longo et al. 2022](https://pubmed.ncbi.nlm.nih.gov/35622106/) | 28 untrained adults, knee extension, 1 vs 3 min with/equalized volume variants | Similar 1RM; hypertrophy followed achieved volume more than interval alone | Single-joint, untrained; short-rest groups needed extra work |
| [Simão et al. 2022](https://pubmed.ncbi.nlm.nih.gov/32826830/) | 33 trained men, 75 s fixed vs self-selected | Self-selected rest allowed more repetitions; strength gains were similar | Upper body only; not automatic reduction |
| [Grgic et al. 2018](https://pubmed.ncbi.nlm.nih.gov/28933024/) | Systematic review, 23 studies/491 participants | Short rest can work, but >2 min appears useful to maximize strength in trained people; 60–120 s may suffice for untrained people | Heterogeneous studies; no decrement threshold |
| [Singer et al. 2024](https://pubmed.ncbi.nlm.nih.gov/39205815/) | Systematic review/Bayesian meta-analysis, 9 studies/19 measures | Small central tendency favoring >60 s, likely mediated by volume; no appreciable difference detected above 90 s | Few studies and substantial heterogeneity |
| [Zhang et al. 2026](https://pubmed.ncbi.nlm.nih.gov/41549493/) | Randomized crossover, 20 adults, fixed/self-selected/repetition-adjusted rest | Repetition-based adjustment improved volume versus fixed 3 min and was more time-efficient than self-selected rest | Intra-session and mainly increased rest; does not test N or chronic −30 s |
| [ACSM 2026 position stand](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/) | Overview of 137 reviews and more than 30,000 participants | Current aggregate evidence is insufficient to define a universal inter-set-rest effect for hypertrophy | Broad categories; does not validate this algorithm |

Decision:

- `N = 4` successful sessions is the default.
- The two closest decreasing-rest trials trained each exercise about twice weekly and reduced
  recovery by 15 seconds per week. A 30-second change therefore spans about two weeks, or four
  exercise exposures.
- Those studies reduced on a calendar, not after success. Converting four exposures into four
  successful exposures is a conservative product inference.
- The automatic mode is **off by default**. This avoids silently applying a heuristic to legacy
  users and to lifters whose goal benefits from longer recovery.
- openGym reduces only recovery that is above the user-defined base and immediately reverses the
  step after a later-set failure. The research protocols went as low as 30 seconds; openGym never
  crosses the configured base.

### Exact domain rule

Manual mode is the backward-compatible default. Automatic mode is stored as
`restReductionStrategy: "auto_after_successes"`.

A session counts toward automatic reduction only when:

1. it was logged under Confirmed Rep-Range;
2. every prescribed set reached the prescribed repetitions;
3. its target snapshot says automatic reduction was enabled;
4. it belongs to the current manual-reset epoch;
5. it used the same **prescribed** `restSeconds` as the current effective value;
6. its snapshotted `restBaseSeconds` equals the current configured base.

Four qualifying sessions produce:

```text
next recovery = max(configured base, current recovery - 30 seconds)
automatic success count = 0
```

Weight is not a streak boundary. In a narrow range, the fourth success can legitimately produce
both a weight increase and a 30-second recovery reduction in the same next prescription. This is
necessary for the rule to remain reachable in ranges such as 8–8 and 8–10, and matches the
exposure-based evidence used to choose N. The mode is opt-in, and a later-set failure adds the
30 seconds back.

The application currently records the **prescribed** recovery, not the number of seconds the user
actually waited after using `+15`, `−15` or Skip. The UI and this report intentionally say
“prescribed with this recovery”; success is not proof that the exact duration was observed.

### Manual reset data model

The reset does not rewrite workout history. It writes one profile-level control keyed by exercise:

```json
{
  "progressionControls": {
    "exercise-id": {
      "confirmedRepRangeRest": {
        "epochId": "generated-id",
        "resetSeconds": 120,
        "resetAt": 1787430000000
      }
    }
  }
}
```

New workout targets snapshot the fields needed for deterministic reconstruction:

```json
{
  "prog": "confirmed_rep_range",
  "restSeconds": 150,
  "restBaseSeconds": 120,
  "restEpochId": "generated-id",
  "restReductionStrategy": "auto_after_successes",
  "restSuccessStreak": 1,
  "restSource": "carried"
}
```

Only recovery calculation filters on `restEpochId`. Weight, target repetitions and top-range
confirmation continue to use the complete Confirmed Rep-Range history. Old JSON has no
`progressionControls`, `restEpochId` or `restBaseSeconds`; missing values select manual mode and
legacy history without a migration.

The control is global per exercise id because the existing progression history is also global per
exercise id. A reset therefore applies to that exercise in every routine, subject to each
configuration's maximum. The confirmation dialog states this explicitly.

### Scenario acceptance matrix

| ID | Scenario | Expected result | Automated result |
|---|---|---|---|
| REST-001 | Effective 180, base 120, press manual reset | Next workout uses 120 | Pass |
| REST-002 | Reset after weight/rep/top-range progress | Only recovery changes | Pass |
| REST-003 | Inspect completed workouts after reset | Historical targets remain byte-for-byte untouched | Pass |
| REST-004 | Reset while an old workout is active | Active snapshot stays old; following workout uses new epoch/base | Pass |
| REST-005 | Start then discard reset-epoch workout | Reset remains pending | Pass |
| REST-006 | Complete then delete every post-reset workout | Old recovery never resurrects; reset becomes pending again | Pass |
| REST-007 | Reset twice before another workout | Newest epoch wins | Pass |
| REST-008 | Strategy inherited from routine | Reset is applied | Pass |
| REST-009 | Same exercise in two routines | Shared reset control is visible to both | Pass |
| REST-010 | JSON serialize/reload after reset | Same next prescription | Pass |
| REST-011 | Legacy/malformed/missing control | Safely treated as no reset | Pass |
| REST-012 | Explicit zero-second base | Zero remains valid; no truthy fallback to profile timer | Pass |
| AUTO-001 | Automatic mode omitted/unknown | Manual behavior, no decrease | Pass |
| AUTO-002 | 1, 2 or 3 qualifying successes at 180 | Stay at 180; show 1/4, 2/4 or 3/4 | Pass |
| AUTO-003 | Fourth qualifying success at 180, base 120 | Next recovery 150; count resets | Pass |
| AUTO-004 | Four successes at 130, base 120 | Next recovery exactly 120 | Pass |
| AUTO-005 | Already at base | Never decrease and do not accumulate a useless count | Pass |
| AUTO-006 | Any prescribed-set failure | Automatic count resets | Pass |
| AUTO-007 | First set fails | Recovery stays unchanged; count resets | Pass |
| AUTO-008 | First set succeeds, later set fails | Recovery +30 up to maximum; count resets | Pass |
| AUTO-009 | Maximum was edited below effective recovery | Failure never causes a paradoxical decrease | Pass |
| AUTO-010 | Manual reset during automatic count | New epoch starts count at zero | Pass |
| AUTO-011 | Stale old-epoch workout appended later | Ignored for current-epoch recovery/count | Pass |
| AUTO-012 | Automatic mode enabled after manual sessions | Manual sessions are not reused | Pass |
| AUTO-013 | Automatic mode disabled | Effective recovery carries; no automatic count/reduction | Pass |
| AUTO-014 | Base changes from 120 to 90 after old successes | No retroactive instant decrease; new observation window | Pass |
| AUTO-015 | Automatic 180→150 then one success at 150 | New count is 1/4, not old count + 1 | Pass |
| AUTO-016 | Range 8–10, fourth success also increases weight | Weight rises and recovery becomes 150 | Pass |
| TIMER-001 | Plan and target contain different recovery snapshots | Immutable plan value wins | Pass |
| TIMER-002 | Superset members prescribe 180 and 120 | Between-round timer uses 180 regardless of order | Pass |
| SHARE-001 | Export/import CRRP routine | Base/max/strategy round-trip; epoch/history excluded | Pass |
| LOCALE-001 | Run locale invariant | 11 dictionaries have identical 667-key sets | Pass |

### Defects found and corrected during this iteration

1. A maximum edited below the current recovery made a failure reduce recovery via
   `min(max, rest + 30)`. The failure path now never decreases it.
2. A stale workout from another epoch appended after new-epoch successes broke the automatic
   suffix. Foreign epochs are now filtered before counting.
3. Lowering the base could reinterpret four old at-base sessions and decrease immediately.
   `restBaseSeconds` is now snapshotted and base edits open a new observation window.
4. The same-weight guard made automatic reduction unreachable in narrow rep ranges. The rule now
   follows successful exposures, consistent with the selected evidence.
5. A new unsaved exercise could expose an immediate reset and leave an orphan control if canceled.
   New exercises now show preview-only state until saved.
6. The configuration sheet could keep showing Confirmed Rep-Range state after the draft selected
   another policy. The panel now follows the active draft policy.
7. `restWhy` existed in the domain but was not shown during the workout. A timer explanation is
   now displayed beside the progression explanation.
8. CRRP plan sharing dropped min/max/target/base/max/automatic strategy. Those configuration
   fields now round-trip while private epochs and history remain excluded.
9. A superset used only the last member's recovery, ignoring a longer CRRP prescription on another
   member. The timer now selects the maximum recovery in the unit.
10. Confirmed Rep-Range translation keys existed only in Italian. All locale dictionaries now
    explicitly share the same keys; untranslated copy falls back to English.

### Automated test files for the recovery iteration

| File | Primary responsibility |
|---|---|
| `confirmedRepRangeRest.test.js` | Reset record validation, pure/mutable apply, legacy controls, repeated reset |
| `confirmedRepRangeRestProgression.test.js` | Epoch separation, unchanged load/rep streak, zero base, lowered maximum |
| `confirmedRepRangeAutoRest.test.js` | Threshold, floor, failure, strategy/base/rest/epoch boundaries |
| `confirmedRepRangeAutoRest.integration.test.js` | Full next-prescription behavior, narrow ranges, base changes, reset interaction |
| `confirmed-rep-range.integration.test.js` | Workout snapshots, timer, discard/delete/active-old-workout/routine inheritance |
| `workout-prescription.test.js` | Centralized immutable target snapshots |
| `workout-timer.test.js` | Snapshot priority and superset maximum recovery |
| `plan-share.test.js` | Public configuration round trip without private runtime state |
| `confirmedRepRangeConfig.test.js` | Backward-compatible manual default and strategy normalization |

### How to reproduce the automated verification

From a clean checkout of this branch:

```powershell
cd E:\Workspace\openGym\frontend
npm.cmd ci
npm.cmd test
node scripts/check-locales.mjs
npm.cmd run build
```

Expected results for this revision:

```text
Test Files  16 passed (16)
Tests       265 passed (265)
11 locales, 667 keys each — in sync.
Vite production build: success (111 modules transformed)
```

Run only the recovery-focused tests while developing:

```powershell
cd E:\Workspace\openGym\frontend
npm.cmd test -- confirmedRepRangeAutoRest confirmedRepRangeRestProgression workout-prescription workout-timer plan-share confirmed-rep-range.integration progression confirmedRepRangeConfig
```

Expected focused result: `9 passed` files, `128 passed` tests.

Backend syntax/startup smoke test:

```powershell
cd E:\Workspace\openGym\api
npm.cmd ci --ignore-scripts
node --check server.js
$env:DATA_DIR='E:\Workspace\openGym\.tmp-api-rest-feature'
$env:PORT='3107'
$env:RP_ID='localhost'
$env:ORIGIN='http://localhost:3107'
node server.js
```

In a second terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3107/api/health
```

Stop the server with `Ctrl+C`. Remove only the explicitly created temporary directory after
verifying its resolved path is inside the repository.

### How to reproduce the manual reset in the UI

1. Configure an exercise with Confirmed Rep-Range, base recovery 120 s and maximum 240 s.
2. Complete the first prescribed set, then miss a later prescribed set. Repeat once so effective
   recovery reaches 180 s.
3. Reopen the exercise configuration.
4. Verify the sheet shows `Initial recovery: 120s` and `Effective recovery: 180s`, plus the reason.
5. Press `Reset recovery to 120s` and read the confirmation describing future-only/global scope.
6. Confirm the reset.
7. Verify the effective next recovery becomes 120 s while weight, target reps and top-range
   confirmation stay unchanged.
8. Open an old completed workout and confirm its captured recovery is still 150/180 s.
9. Start the next workout and confirm its target/plan and timer use 120 s.
10. Refresh before completing it; confirm the active snapshot remains 120 s.

Active-workout boundary variant:

1. Start a workout while effective recovery is 180 s.
2. Without completing it, perform the reset from another browser/device or persisted state.
3. Confirm the already-started workout remains at 180 s.
4. Complete or discard it.
5. Confirm the next newly built workout uses 120 s.

### How to reproduce automatic −30 seconds

1. Produce an effective recovery above base, for example base 120 s/effective 180 s.
2. Enable `Automatic recovery reduction` and save.
3. Complete every prescribed set successfully in four consecutive workouts that all prescribe
   180 s. The target reps may change; weight may also change.
4. After workouts 1–3, confirm the UI reports 1/4, 2/4 and 3/4.
5. After workout 4, start or preview the next workout.
6. Confirm recovery is 150 s, source/reason says automatic decrease, and the count is 0/4.
7. Complete four successful workouts prescribed at 150 s.
8. Confirm the next value is 120 s, never 90 s.

Failure reversal:

1. After automatic recovery becomes 150 s, complete the first set at target and miss a later set.
2. Confirm the next recovery returns to 180 s and automatic count is zero.
3. Alternatively miss the first set; confirm recovery stays 150 s and count resets. Inter-set
   recovery did not precede the first set, so the algorithm does not attribute that miss to it.

Narrow-range variant:

1. Configure min 8, max 10, base 120, effective 180 and automatic mode.
2. Successfully complete targets 8, 9, 10 and the second top-range confirmation at 10.
3. Confirm the next prescription increases weight, resets target to 8 and reduces recovery to
   150 s in the same transition.

Base-edit variant:

1. Accumulate successful automatic-mode sessions at base 120 s.
2. Change the initial recovery to 90 s and save.
3. Confirm effective recovery remains 120 s and automatic progress restarts at 0/4.
4. Complete four clean sessions prescribed at 120 s.
5. Confirm recovery then becomes 90 s.

Superset variant:

1. Put two exercises in one superset; prescribe 180 s to the first and 120 s to the second.
2. Complete one full round.
3. Confirm the between-round timer starts at 180 s regardless of member order.

### Persistence and synchronization reproduction

Browser/local persistence:

1. Perform a manual reset and optionally accumulate 1–3 automatic successes.
2. Inspect `gym_state_v1` in browser local storage and record `progressionControls`, active
   `plan` and `target`.
3. Refresh and compare the values.
4. Close/reopen the browser and compare again.

Server synchronization:

1. Sign in with a disposable profile and perform the reset.
2. Wait at least two seconds for the debounced push, or background the tab to flush it.
3. Open a second signed-in browser, pull state and verify the same epoch/effective recovery.
4. Complete one workout on the second browser, sync, then verify the next prescription on the
   first browser.

Plan sharing:

1. Export a plan containing automatic Confirmed Rep-Range settings.
2. Import it into a disposable profile.
3. Verify min/max/initial target/base/maximum/automatic mode are present.
4. Verify no recovery epoch or workout history traveled with the plan.

Docker/CasaOS persistence remains a manual release gate because Docker is unavailable here:

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps
curl.exe --fail http://localhost:8080/api/health
curl.exe --fail --head http://localhost:8080/
```

After creating/resetting state, run `docker compose down` **without `-v`**, then
`docker compose up -d` and repeat the checks. `down -v` intentionally deletes persisted data and
must not be used for this test.

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

CRRP-001, CRRP-002 and CRRP-003 remain resolved. Manual reset, automatic reduction, base/epoch
snapshots, range changes, timer integration, plan sharing and the edge-case fixes listed above are
protected by 265 passing tests. The production build, locale invariant, frontend HTTP smoke,
backend syntax/startup and API health checks pass.

Release remains conditional on Docker/CasaOS persistence and real-browser interaction checks that
cannot run in this environment. This is an infrastructure/UI automation limitation, not a known
code failure. The automatic strategy must continue to be described as opt-in and evidence-informed,
not as a scientifically proven universal prescription.

After the fixes, rerun:

1. the complete frontend suite;
2. production frontend build;
3. the new integration tests described above;
4. Docker Compose build and startup;
5. API health and frontend HTTP smoke tests;
6. a manual six-session Confirmed Rep-Range workflow.
