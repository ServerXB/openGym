# Requisito 2A — Timer locale persistente e deterministico

Verifica: **2026-10-02**. Base: `06d95a7` (requisito 16 già committato).
Consegna nel worktree, **senza commit, push o deploy**.
Nome del commit proposto: `feat: persist deterministic local workout timers`.

## Risultato e confini

Recupero e serie a tempo riprendono dopo refresh, chiusura della scheda e riapertura del browser,
nel medesimo profilo/origine e con lo stesso allenamento attivo. Le schede dello stesso browser
condividono un solo timer per account; un comando obsoleto non annulla quello nuovo.

Non sono implementati 2B (timer server persistente/multi-device) e 2C (smartwatch). Il timer
locale non dipende dal server: le prove browser sono state effettuate con API/media non avviati.
Non è stata eseguita una prova su un vero stack CasaOS/Docker.

La progressione Confirmed, peso, target, conferme e recupero adattivo non vengono cambiati da
questo requisito. Il timer non modifica i workout terminati. Le serie a tempo continuano a
registrare la durata effettiva quando si preme **Fatto** prima della scadenza.

## Architettura consegnata

- Motore puro con clock iniettato: nella pagina viva usa `performance.now()`, non il numero
  di callback dell'intervallo; display `ceil(ms / 1000)`, scadenza soltanto a `ms <= 0`.
- Scadenza assoluta persistente per ricostruire il countdown dopo un nuovo caricamento.
- IndexedDB `opengym-local-timers`, versione 1, store `timers`, chiave `accountId`.
  Le transazioni read/write serializzano comandi e consumo della serie a tempo tra schede.
  Non occorre il lock di una pagina mantenuto durante il recupero; nessuna nuova dipendenza.
- `BroadcastChannel` e segnale `gym_timer_signal_v1` negli eventi storage notificano i cambi.
  Gli eventi sono soltanto segnali: si rilegge sempre il record autorevole, non il payload vecchio.
- Record versionato con `timerId`, `revision`, `kind`, `accountId`, `workoutId`, `startedAt`,
  `deadlineAt`, `durationMs`, `status`, `updatedAt`, label e binding opzionale.
- Start, modifica e cancellazione avanzano la revisione. La UI invia il token visualizzato;
  ID + revisione devono coincidere. Un record terminale resta come tombstone.
- Per una serie a tempo reale, binding a `localTimerEntryId` e `localTimerSetId`, assegnati
  solo alle righe attive. Non si usa il solo ID del catalogo né l'indice dell'array.
  Gli ID tecnici vengono rimossi dagli snapshot dei workout terminati.
- Completamento della serie e acknowledgement serializzati. `deliveryPending` consente di
  riprovare dopo un mancato salvataggio; la guardia `done` rende idempotente il replay dopo crash.
  Un risultato pendente non può essere sovrascritto da un altro timer dello stesso workout.
  Chiudere/sostituire quel workout non blocca per sempre gli allenamenti futuri.
- `updateActiveWorkout` applica il risultato all'active autorevole appena letto dalla replica
  locale, preservando modifiche di un'altra scheda non ancora ricevute via evento.
- Inizio/fine/scarto/cambio account invalidano il timer attraverso il lifecycle del workout.
  Rimozione o spunta manuale della serie annullano il timer senza attribuirlo a una riga diversa.
- Recupero e lavoro sono esclusivi in entrambe le direzioni. Un recupero zero equivale a Skip.
  I timer locali accettano fino a 24 ore; non vengono artificialmente limitati dal push legacy.
- Schema corrotto, proprietario errato o storage non disponibile: niente sovrascrittura
  silenziosa e niente countdown dichiarato salvato. La UI mostra un avviso localizzato.
- API callback preesistente conservata per chiamanti in memoria; le callback non vengono
  serializzate né indovinate dopo refresh. Il normale pulsante Avvia serie usa sempre il binding.

Il record del timer è separato da `S`: non entra in sync, export JSON o snapshot storici.
Un backup/import può contenere l'active locale e i suoi binding, ma non trasferisce il countdown
a un altro dispositivo. Vecchi JSON privi di timer/binding restano leggibili, senza migrazioni
manuali. Un recupero già in memoria sulla build precedente non può essere recuperato dopo
aver ricaricato la pagina per installare questa versione.

### Notifiche

Il mobile usa una notifica locale di recupero con ID 200, distinto dai promemoria settimanali,
alla stessa `deadlineAt`. Controlla il permesso già concesso senza aprire prompt automatici.
Scheduling/cancellazione sono serializzati e le risposte obsolete non possono riattivare
una notifica cancellata.

Il push legacy riceve ora la deadline assoluta anziché riaggiungere il tempo di trasporto.
I client precedenti con `{ seconds }` rimangono compatibili. Le deadline esplicite non valide,
scadute o oltre un'ora vengono rifiutate; il recupero locale continua comunque. Il limite di
un'ora e la `Map` in RAM del push restano responsabilità della futura fase 2B.
`api/Dockerfile` include il nuovo helper; il test di packaging avvia esattamente i file copiati.

Contratti verificati tramite tipi SDK installati e documentazione ufficiale:
[Capacitor Local Notifications](https://capacitorjs.com/docs/apis/local-notifications/).
La scelta di IndexedDB evita di dipendere dai Web Locks, limitati ai secure context nel
[contratto W3C](https://www.w3.org/TR/web-locks/).

## Risultati automatici

| Gate | Risultato |
|---|---|
| Frontend completo | **1.126/1.126 PASS**, 58 file, 174 test aggiunti rispetto a `06d95a7` |
| Backend completo | **32/32 PASS**, 4 suite, inclusi endpoint/packaging e restart del processo |
| Build produzione | **PASS**, 138 moduli; solo warning preesistente sui chunk grandi |
| Localizzazioni | **PASS**, 11 lingue con 989 chiavi ciascuna |
| Solver attrezzatura | **PASS**, 2.000 confronti deterministici brute-force |
| Browser timer | **25/25 PASS**: 23 controlli + 2 dopo riavvio completo del browser |
| Browser storico 16 | **30/30 PASS** |
| Browser stallo 17 | **28/28 PASS** |
| Browser recovery-first | **6/6 PASS** |
| Browser attrezzatura | **29/29 PASS** |
| Whitespace | `git diff --check` PASS |

Nessuna regressione rilevata nei controlli eseguiti. Ambiente: Windows PowerShell, Node 26.3,
Vitest 4, Vite 8, Edge Chromium headless, profilo temporaneo isolato. Node 22/Docker reali,
Safari e hardware mobile non sono stati eseguiti e non sono inclusi nel PASS.

### Matrice dei nuovi test

| Area | Test e scenari |
|---|---|
| Motore, 50 | Clock monotono, 35 s senza tick, 499 ms residui, clock avanti/indietro, restore, revisioni, nuovo timer, sottrazione, payload/schema non validi, limiti e durata effettiva |
| Runtime, 35 | Transazioni concorrenti, scadenza unica, replay pendente, storage fallito, stale start/cancel/extend/finish, cambio scope, device separati, tombstone, record di altro account preservati |
| Serie a tempo, 41 | Identificativi stabili, stesso catalogo in slot/giornate diverse, riga rimossa/riaggiunta/spostata, set già spuntato, superset, serie opzionali, durata effettiva e storico invariato |
| Notifiche, 23 | Deadline, permessi senza prompt, ID riservato, cancellazione, import/permessi tardivi, offline/plugin fallito, account e niente push durante il lavoro |
| Integrazione UI, 20 | Timer duraturo, remount StrictMode, clock, pulsanti/revisioni, recupero lungo, lavoro/recupero esclusivi, refresh serie a tempo, early finish, close/replace/account, row removal e mancato salvataggio |
| Store, 4 nuovi | Edit di altra scheda non ancora ricevuto, active chiuso/sostituito, envelope corrotto preservato |
| Snapshot, 1 nuovo | Binding tecnici esclusi dal workout terminato, active originale immutato |
| Backend, 9 nuovi | Helper: 7 confini della deadline/legacy. Endpoint nel pacchetto Docker: 2 test di deadline, cancel, legacy, input errati e autenticazione |

Browser: pulsanti reali Avvia serie/Annulla/+15/Skip; refresh con identità/deadline conservate;
seconda scheda; token obsoleto; wall clock avanti/indietro nella pagina viva; avviso locale una
sola volta sia per recupero sia per lavoro tra due schede; esatta riga ripristinata; recupero
prescritto; edit non ricevuto dall'altra scheda preservato; early finish cambiando esercizio;
rimozione/riaggiunta; workout sostituito; record corrotto senza overwrite; browser chiuso e
riaperto con il timer ancora in corso.

Durante il collaudo sono stati corretti i controlli dell'harness: refresh reale invece della
sola navigazione hash, attesa delle Promise invece di `Boolean(Promise)`, fixture workout
distinte e tolleranza di 20 ms nel confronto tra clock wall/monotono. Si è riavviato Vite dopo
le modifiche per evitare copie differenti dei moduli introdotte dall'HMR. Non sono state
allentate le asserzioni funzionali né aumentati i timeout applicativi/backend.
Il collaudo storico 16 ora attende anche la nuova `performance.timeOrigin` dopo reload:
non può scambiare un trigger del documento precedente per quello della pagina appena caricata.

## Replica dei test automatici

Da `E:\Workspace\openGym`, con dipendenze già installate; in un clone nuovo usare prima
`npm.cmd ci` nelle due cartelle, senza cambiare lockfile.

```powershell
cd frontend
npm.cmd test
npm.cmd test -- src/lib/local-timer.test.js src/lib/local-timer-runtime.test.js src/lib/timed-set-completion.test.js src/lib/timer-notifications.test.js src/store/useUI.integration.test.js src/store/useStore.test.js src/lib/workout-scope.test.js
npm.cmd run build
node scripts/check-locales.mjs
node scripts/check-equipment-solver.mjs
cd ..\api
npm.cmd test
cd ..
git diff --check
```

### Replica browser (solo profilo usa-e-getta)

Non utilizzare un browser personale: lo script scrive fixture guest e altera il DB locale
di test. Niente server/credenziali di produzione. Chiudere eventuali CDP QA già attivi.

Terminale 1: avviare Vite **dopo** le ultime modifiche dei sorgenti e non editarli durante i test.

```powershell
cd E:\Workspace\openGym\frontend
npm.cmd run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

Terminale 2:

```powershell
cd E:\Workspace\openGym\frontend
$timerQaProfile = Join-Path ([System.IO.Path]::GetTempPath()) ('opengym-timer-qa-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $timerQaProfile | Out-Null
$timerQaEdge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
function Start-TimerQaBrowser {
  Start-Process -FilePath $timerQaEdge -WindowStyle Hidden -ArgumentList @(
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=9223', ('--user-data-dir=' + $timerQaProfile), 'about:blank'
  )
  $timerQaReady = $false
  for ($timerQaAttempt = 0; $timerQaAttempt -lt 100; $timerQaAttempt++) {
    try {
      Invoke-WebRequest -Uri 'http://127.0.0.1:9223/json/version' -UseBasicParsing | Out-Null
      $timerQaReady = $true
      break
    } catch { Start-Sleep -Milliseconds 100 }
  }
  if (-not $timerQaReady) { throw 'CDP QA non disponibile' }
}
Start-TimerQaBrowser
node scripts/check-local-timers-browser.mjs
if ($LASTEXITCODE -ne 0) { throw 'Test timer fallito' }
# Lo script chiude Edge lasciando un recupero di 900 s nel profilo.
# Riaprire lo STESSO profilo entro 900 s, senza cancellarlo o avviare altri test nel mezzo.
Start-TimerQaBrowser
node scripts/check-local-timers-browser.mjs --verify-restart
if ($LASTEXITCODE -ne 0) { throw 'Test restart fallito' }
```

Per le regressioni, nello stesso terminale:

```powershell
$env:OPENGYM_CDP_URL = 'http://127.0.0.1:9223'
foreach ($timerQaScript in @(
  'check-exercise-session-history-browser.mjs', 'check-confirmed-stall-browser.mjs',
  'check-confirmed-recovery-browser.mjs', 'check-equipment-browser.mjs'
)) {
  Start-TimerQaBrowser
  node ('scripts/' + $timerQaScript)
  if ($LASTEXITCODE -ne 0) { throw ('Regressione fallita: ' + $timerQaScript) }
}
```

Ogni script chiude il browser. Terminato il collaudo, fermare Vite con Ctrl+C. Eliminare solo
la directory temporanea verificata (non un profilo personale, né il workspace):

```powershell
$timerQaResolved = [System.IO.Path]::GetFullPath($timerQaProfile)
$timerQaTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
if (-not $timerQaResolved.StartsWith($timerQaTemp, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not ([System.IO.Path]::GetFileName($timerQaResolved)).StartsWith('opengym-timer-qa-')) {
  throw 'Percorso QA non sicuro'
}
Remove-Item -LiteralPath $timerQaResolved -Recurse -Force
```

## Gate manuali prima del rilascio sul target

1. Fare un backup normale del profilo e dei volumi CasaOS. Non manipolare lo storico per testare
   il timer. Usare un account/profilo QA separato.
2. Avviare recupero 120 s, attendere 35 s, refresh: circa 85 s, non un nuovo recupero completo.
3. Chiudere e riaprire browser/PWA nello stesso profilo: deadline e workout devono coincidere.
   Cancellazione deve restare cancellata dopo refresh; +15/−15/Skip allineati tra due schede.
4. Avviare una serie a tempo, andare su un altro esercizio/Storico recente, refresh e finire
   anticipatamente: viene registrata solo la serie originale e la durata effettiva.
5. Rimuovere e riaggiungere quella serie, spuntarla manualmente, scartare/finire l'allenamento
   o cambiare account: il vecchio timer non può scrivere sul nuovo contesto.
6. Interrompere API/stack: il timer locale deve continuare e riprendere dopo reload se la shell
   offline è già disponibile. Il restart del push server NON è coperto da 2A.
7. Safari/iOS e Android: background, sospensione, schermo bloccato e risparmio energetico.
   Nel mobile nativo verificare permessi, notifica e cancellazione con OS reale.

Notifiche OS/push sono best-effort: non si promette esattamente un avviso tra canali diversi.
La deduplicazione verificata riguarda il completamento locale tra schede del medesimo browser.
La ripresa su pagina nuova usa necessariamente il wall clock: un cambio dell'ora mentre il
browser è completamente chiuso non è distinguibile dal vero tempo trascorso. Sleep e sospensione
del clock monotono richiedono prove sui dispositivi. Cancellazione dei dati del sito, eviction
OS, modalità privata o profilo/origine diversa non conservano il timer. Nessuna sincronizzazione
con un secondo dispositivo o con il timer nativo dell'app Orologio viene dichiarata.

## Consegna e rollback

Un solo requisito pronto per un commit dedicato. Nessun git add/commit/push effettuato.
Rollback futuro tramite revert del commit concordato: nessuna migrazione distruttiva, DB locale
versionato separato e nessun campo timer imposto nei JSON del server. La build precedente
ignora il DB; al ritorno alla nuova versione i record vengono verificati contro il workout
attivo, senza applicare risultati a un workout diverso. Prossimo sviluppo: requisito **4**, solo
dopo questa consegna e il via libera dell'utente.
