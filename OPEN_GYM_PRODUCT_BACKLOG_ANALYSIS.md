# openGym — Analisi funzionale e architetturale del backlog prodotto

- Data: 2026-09-26
- Branch analizzato: `feature/confirmed-rep-range-progression`
- Revisione di partenza analizzata: `274ccdf`
- Revisione del codice verificata: `1963555`
- Stato: completati e verificati i requisiti 1, 5, 6, 7, 7A, 11, 12 e 14
- Ambito: requisiti 1–17 e relativa estensione 7A comunicati dopo l'implementazione Confirmed Rep-Range
- Ultimo aggiornamento funzionale: cavo a pacco pesi e cavo caricato a dischi distinti, con guida esplicita per punto/lato
- Ultimo aggiornamento backlog: aggiunti il requisito 16, storico delle ultime quattro sessioni nel workout, e il requisito 17, rilevazione dello stallo Confirmed con riduzione controllata del carico; solo analisi, sviluppo non autorizzato
- Priorità di sviluppo: il requisito 15 è proposto come P0 per il rischio di perdita silenziosa dei dati; fino a validazione della nuova priorità il primo requisito approvato resta 2A; il requisito 13 non è ancora autorizzato allo sviluppo; i requisiti 8 e 9 restano esclusi

## 1. Obiettivo

Questo documento trasforma i diciassette requisiti raccolti in specifiche verificabili, separando:

- difetti già presenti;
- nuove funzionalità locali;
- cambi di dominio che possono alterare la progressione;
- integrazioni che richiedono OAuth, segreti server e servizi esterni;
- decisioni ancora necessarie prima di scrivere codice.

Il principio guida rimane lo stesso usato per Confirmed Rep-Range: una sessione terminata è uno
snapshot immutabile. Una modifica successiva a routine, attrezzatura, palestra, alias o account
esterno può influenzare solo il futuro e non deve reinterpretare retroattivamente lo storico.

## 2. Risultato sintetico dell'analisi

| ID | Requisito | Stato | Riscontro | Priorità | Dimensione |
|---|---|---|---|---|---|
| 1 | Nascondere peso nel corpo libero | **Completato** | Tre modalità di carico, invarianti a peso zero e disclosure zavorra | P1 | Media |
| 2 | Sincronizzare timer e orologio, epic complessiva | **Non completato** | Nessuna delle tre fasi sottostanti soddisfa ancora integralmente i propri criteri di rilascio | P2 | Grande/Epic |
| 2A | Timer locale persistente e deterministico | **Non completato** | Esiste la fondazione a deadline, ma il timer è in memoria e si perde al refresh | P1 | Media |
| 2B | Timer persistente server e multi-device | **Non completato** | Il server usa una `Map` in RAM, senza record revisionato o ripristino dopo restart | P2 | Grande |
| 2C | Controllo da smartwatch | **Non completato** | Non esistono companion, pairing o comandi bidirezionali watchOS/Wear OS | P2 | Grande |
| 3 | Esporre e documentare API | **Non completato** | Esistono endpoint interni, non una API pubblica sicura, versionata e documentata | P2 | Grande |
| 4 | Scorrere tra routine | **Non completato** | La navigazione richiede ancora il ritorno alla lista | P1 | Media |
| 5 | Auto-riduzione recupero attiva di default | **Completato** | Attiva sulle nuove selezioni Confirmed; decoder legacy intenzionalmente invariato | P1 | Piccola |
| 6 | Istanze dello stesso esercizio | **Completato** | Slot stabili, gruppi compatibili, snapshot, reader legacy e fix del riepilogo fine esercizio | P0 | Grande |
| 7 | Calcolo attrezzatura/piastre | **Completato** | Profili, override slot, solver, modalità manuale per lato, snapshot e guida accessibile | P2 | Grande |
| 7A | Cavi caricati a dischi | **Completato** | Preset guidato, distinzione pacco pesi/dischi, uno o due punti, guida totale/per punto e nessun rapporto pulegge implicito; commit `ca68f78` | P1 | Piccola/Media |
| 8 | Peso da Withings | **Non completato** | Fattibilità analizzata; OAuth/polling server-side non implementati e requisito fuori scope corrente | P3 | Grande |
| 9 | Dati Polar Flow | **Non completato** | Fattibilità analizzata; nessuna integrazione AccessLink e requisito fuori scope corrente | P3 | Grande |
| 10 | Alias esercizi | **Non completato** | Non esistono ancora alias utente, editor e ricerca centralizzata | P1 | Media |
| 11 | Adattamento dopo modifiche manuali | **Completato** | Livello dimostrato, outcome, serie opzionali e carico uniforme implementati e verificati | P0 | Grande |
| 12 | Orario/data inizio e fine | **Completato** | Lifecycle deterministico, UI localizzata, import e lettura legacy | P1 | Piccola/Media |
| 13 | Riscaldamento specifico guidato | **Non completato** | Analisi funzionale pronta; sviluppo non ancora autorizzato | P1 proposta | Media |
| 14 | Richiesta del peso corporeo configurabile | **Completato** | Switch persistente nelle Impostazioni; opt-out salta il popup senza alterare le misurazioni | P1 | Piccola |
| 15 | Funzionamento offline e sync alla riconnessione | **Non completato** | Persistenza locale e cache runtime sono solo fondazioni parziali; mancano cold start garantito, retry, revisioni, merge e conflitti sicuri | P0 proposta | Grande/Epic |
| 16 | Ultime quattro sessioni durante il workout | **Non completato** | Esiste soltanto la riga “Ultima volta”; manca una vista scoped, completa e richiamabile delle quattro sessioni precedenti | P1 | Piccola/Media |
| 17 | Rilevazione stallo Confirmed e riduzione controllata del carico | **Non completato** | Confirmed mantiene indefinitamente carico/target e adatta solo il recupero; non esiste un segnale di qualità tecnica né una regressione spiegabile | P1 proposta | Grande |

`Completato` significa che lo scope concordato è presente nel codice ed è coperto da test
automatici. La colonna `Commit principale` distingue ciò che è già committato dallo stato
transitorio “pronto per il commit”; 7A è in questo stato perché è stato richiesto di fermarsi
prima di ogni commit. `Non completato` resta il valore anche quando esiste una fondazione
parziale: in questo modo la colonna risponde in modo binario alla domanda “è implementato o no?”.
I collaudi manuali su CasaOS, dispositivi fisici, screen reader e provider reali restano gate
separati e non vengono confusi con lo stato dell'implementazione.

### 2.1 Evidenze dell'audit di implementazione

Audit aggiornato il 2026-09-23 sulla revisione `ca68f78`. La regressione automatica corrente è
verde: **37/37 file di test e 635/635 test**; anche
la build Vite di produzione termina con
successo. Resta il warning non bloccante già noto sui chunk di grandi dimensioni.

| ID | Commit principale | Evidenza verificata |
|---|---|---|
| 1 | `e63972b` | `exercise-load-mode.js`, prescrizione/storico/workout e relativi test |
| 5 | `e121e7d` | default configurazione Confirmed, integrazione e auto-rest |
| 6 | `37127be`, hardening `5cd46bb` | `progression-scope.js`, snapshot, storico e isolamento tra routine/giorni |
| 7 | `ebf93f8`, estensione `75c741e` | `equipment-load.js`, `EquipmentGuide.jsx`, profili, snapshot e test solver/UI |
| 7A | `ca68f78` | preset cavo, meccanismo esplicito, formula per punto, snapshot/legacy, copy/accessibilità e smoke browser a 320 px |
| 11 | `2ba04d0` | `progression.js`, `workout-set-status.js` e matrice Confirmed 4×8–10 |
| 12 | `a438f11` | `workout-time.js`, lifecycle, import e rendering storico |
| 14 | `1963555` | setting persistente, compatibilità legacy e start flow pianificato/freestyle |

Per i requisiti non completati l'audit ha verificato anche l'assenza dello scope richiesto, non
soltanto la mancanza di un'etichetta nel backlog: 2A non persiste il timer, 2B non ha stato server
duraturo, 2C non ha companion, 3 non ha contratto API pubblico, 4 non ha rail, 10 non ha alias
utente, 8/9 non hanno provider, 13 non ha ancora motore o popup, 15 non ha un'app shell
precacheata né un protocollo di riconciliazione revisionato, 16 non ha una vista delle quattro
sessioni e 17 non ha rilevazione o reset del carico Confirmed.

Le correzioni 6 e 11 sono state affrontate prima del requisito 7 perché decidono quale storico
appartiene a una prescrizione. Questo ha permesso di aggiungere l'attrezzatura per slot senza
contaminare gruppi di progressione condivisi o indipendenti.

## 3. Dipendenze consigliate

```text
Identità slot/progressione (6)
├── risultati manuali e Confirmed (11)
│   ├── storico recente scoped nel workout (16)
│   └── rilevazione stallo e regressione controllata (17)
├── reset e recupero per istanza (5)
└── attrezzatura scelta per slot (7)
    └── riscaldamento specifico e carichi praticabili (13)

Timestamp completi (12)
└── collegamento temporale workout ↔ Polar (9)

DTO, provenance, segreti e API v1 (3)
├── Withings (8)
└── Polar Flow (9)

Timer locale persistente (2A)
└── eventuale timer multi-device/watch (2B/2C)

Replica locale + app shell + sync revisionato (15)
├── continuità offline della web app/PWA
├── merge e conflitti multi-device senza perdita silenziosa
└── fondazione di concorrenza riutilizzabile dal timer multi-device (2B)
```

I punti 1, 4 e 10 possono procedere in parallelo dopo avere fissato il modello dello slot. Il
punto 5 è un quick win, purché non cambi il significato dei vecchi JSON. Il punto 13 può iniziare
solo dopo i punti 1, 6, 7 e 11, già necessari per conoscere senza ambiguità carico, attrezzo,
occorrenza e prossima serie allenante del workout attivo. Il punto 16 riusa l'identità di
progressione già stabilizzata e può precedere il 17, così le evidenze di uno stallo sono
consultabili nello stesso componente. Il punto 15 non assorbe 2A: rende durevoli dati e sync,
mentre l'esattezza del countdown dopo refresh resta responsabilità del timer locale.

## 4. Principi trasversali

### 4.1 Snapshot immutabili

All'avvio di un workout devono essere congelati almeno:

- identità dell'esercizio e dell'occorrenza nella routine;
- prescrizione, range, serie, recupero e incremento;
- profilo attrezzatura e convenzione del carico, quando usati;
- istante e fuso di inizio;
- versione delle regole necessaria a spiegare la prescrizione.

Il workout completato deve conservare questi dati. Le schermate storiche leggono lo snapshot,
non le impostazioni correnti.

### 4.2 Nessuna deduzione silenziosa

Quando `eq` non basta a capire se il numero indica peso totale, per mano o per lato, openGym deve
chiedere una scelta. Quando due attività Polar potrebbero corrispondere allo stesso workout, deve
chiedere quale collegare. Quando lo stesso esercizio viene aggiunto con configurazioni diverse,
deve rendere visibile se la progressione è condivisa o indipendente.

### 4.3 Compatibilità progressiva

- I vecchi JSON devono continuare a essere leggibili senza migrazioni manuali.
- Un campo assente mantiene il vecchio comportamento, salvo che l'utente compia una nuova azione
  esplicita.
- Le normalizzazioni avvengono in lettura o al successivo salvataggio dell'oggetto interessato.
- Nessuna procedura deve riscrivere i workout terminati solo per aggiungere nuovi campi.

### 4.4 Provenienza

Ogni dato importato deve indicare almeno `source`, `externalId`, `measuredAt`/`startedAt` e
`importedAt`. Un valore manuale non deve essere sovrascritto silenziosamente da Withings e un
allenamento Polar non deve essere interpretato come prova di serie, ripetizioni o peso.

### 4.5 Local-first senza perdita silenziosa

`Salvato sul dispositivo` e `sincronizzato col server` sono stati differenti. Nessun timestamp
client, retry fuori ordine o copia offline può sovrascrivere una revisione remota non letta. Un
conflitto non ricomponibile resta visibile finché l'utente non sceglie; logout e cambio account non
cancellano dati pending implicitamente.

### 4.6 Evidenza prima dell'automazione

Una serie di numeri può dimostrare che un target non è stato raggiunto, non che una ripetizione era
“sporca”, dolorosa o inutile. Le funzioni di coaching devono separare misure, dichiarazioni
dell'utente e inferenze; quando l'evidenza non giustifica una soglia universale, openGym propone
un'azione spiegabile e reversibile invece di applicarla in silenzio.

## 5. Analisi dettagliata

### 5.1 Corpo libero: non mostrare il peso

#### Stato dell'implementazione

Implementato nella Release B con commit e gate dedicati documentati in
`OPEN_GYM_RELEASE_TEST_REPORT.md`.

La modalità di carico è derivata senza nuovi campi persistenti:

- `external`: esercizio non a corpo libero;
- `pure_bodyweight`: corpo libero con `weight <= 0`;
- `added_bodyweight`: corpo libero con `weight > 0`.

Il target congelato del workout è autoritativo quando contiene `weight`, compreso lo zero. Gli
snapshot più vecchi privi del campo possono riconoscere una zavorra soltanto da serie completate
con peso positivo. Non sono richieste migrazioni e i workout terminati non vengono modificati.

Per il corpo libero puro:

- Reps, Time e Confirmed non mostrano campi peso;
- configurazione, target e nuove serie forzano il peso a zero;
- storico, `exWeights` e `progressionWeights` incompatibili non vengono riutilizzati;
- PR, badge Best e conferma top weight ignorano difensivamente carichi anomali nascosti;
- l'incremento di carico non è persistito né usato per separare scope equivalenti;
- l'incremento Time resta disponibile perché rappresenta secondi, non chilogrammi;
- Confirmed continua a progredire in ripetizioni e serie fino al limite esistente.

La zavorra è dietro l'azione esplicita `Aggiungi zavorra`. L'azione apre un unico campo `Peso
aggiunto`; `Rimuovi zavorra` azzera il draft e torna alla modalità pura. Le configurazioni legacy
con `bodyweight: true` e peso positivo restano zavorrate e seguono la normale progressione di
carico.

Riferimenti principali: `frontend/src/lib/exercise-load-mode.js`, `frontend/src/lib/history.js`,
`frontend/src/lib/progression.js`, `frontend/src/lib/workout-prescription.js`,
`frontend/src/lib/workout-records.js`, `frontend/src/sheets.jsx` e
`frontend/src/views/Workout.jsx`.

#### Scenari di accettazione validati

| Scenario | Risultato atteso |
|---|---|
| Push-up Reps corpo libero | Serie e ripetizioni, nessun peso |
| Plank Time corpo libero | Serie e secondi, nessun peso |
| Pull-up Confirmed puro | Range/recupero, gruppo Carico assente |
| Dip con zavorra esplicita | Mostra solo `Peso aggiunto` |
| Passaggio weighted → corpo libero | Le nuove serie partono da peso zero |
| JSON legacy bodyweight con peso 10 | Resta zavorrato e leggibile |
| Workout storico zavorrato | Continua a mostrare `+10`, senza modifiche |

#### Test necessari

- helper e compatibilità: built-in/custom, override espliciti, snapshot completi e legacy;
- Reps, Time e Confirmed, inclusi strategia ereditata e progressione serie;
- storico, mappe operative, PR e top weight;
- passaggi fra le tre modalità e protezione del valore aggiunto configurato;
- target/serie a peso zero anche contro piani o righe anomali;
- scope condivisi/indipendenti, import/export piano e immutabilità JSON;
- build produzione e sincronizzazione delle undici lingue.

### 5.2 Sincronizzazione timer orologio/openGym

Il requisito può significare tre cose differenti e non vanno confuse:

1. il countdown openGym deve restare corretto quando il telefono sospende la pagina o cambia tab;
2. lo stesso countdown deve comparire su più tab/dispositivi;
3. il countdown deve apparire o essere controllabile da smartwatch/app Orologio.

| Fase | Stato | Verifica |
|---|---|---|
| 2A — timer locale | **Non completato** | Deadline già presente, ma nessuna persistenza su refresh/restart, revisione o sync fra tab |
| 2B — server/multi-device | **Non completato** | Timer push soltanto in RAM e nessun modello di conflitto/ripristino |
| 2C — smartwatch | **Non completato** | Nessun companion o controllo bidirezionale implementato |

#### Stato attuale

`frontend/src/store/useUI.js` usa già `endsAt = Date.now() + durata` e a ogni tick ricalcola il
tempo restante. Questo evita il classico errore di decrementare un contatore quando il browser
ritarda i callback. Esiste anche un tick su `visibilitychange`.

Restano però questi limiti:

- il timer vive solo in memoria e si perde al refresh o alla chiusura;
- `Date.now()` può saltare se cambia manualmente l'orologio di sistema;
- `Math.round` può mostrare zero prima della deadline effettiva;
- il timer push del server usa un `Map<userId, Timeout>` solo in RAM;
- un restart Docker perde il timer push;
- due dispositivi dello stesso utente si sovrascrivono;
- il secondo dispositivo non vede il countdown del primo.

#### MVP raccomandato: timer openGym autoritativo

```json
{
  "timerId": "timer-uuid",
  "revision": 3,
  "kind": "rest",
  "workoutId": "workout-uuid",
  "startedAt": 1787742000000,
  "deadlineAt": 1787742120000,
  "durationMs": 120000,
  "status": "running",
  "updatedAt": 1787742000000
}
```

- Durante la pagina attiva usare `performance.now()` per la durata monotona.
- Conservare `deadlineAt` per refresh/riavvio.
- Calcolare il display con `ceil(remainingMs / 1000)` e terminare solo quando
  `remainingMs <= 0`.
- Persistenza locale collegata all'active workout.
- `BroadcastChannel` o evento storage per allineare più tab dello stesso browser.
- Ogni start/extend/cancel incrementa `revision`; un comando vecchio non può cancellare un timer
  nuovo.
- La local notification nativa e il push devono usare la stessa deadline assoluta.

Il timer server multi-device è una seconda fase: oggi l'active workout è intenzionalmente locale.
Per renderlo condiviso serve un record persistente per `timerId + deviceId + workoutId`, un
`serverNow` per stimare l'offset e una regola di concorrenza. Non va riutilizzata la chiave solo
`userId`.

#### Smartwatch

Una PWA non può garantire il controllo bidirezionale del timer nativo dell'app Orologio. L'MVP
realistico è instradare la notifica `Recupero terminato` al watch. Un vero countdown interattivo
richiede una companion app/watchOS/Wear OS o funzioni native specifiche.

Su Android un'app nativa può chiedere all'app Orologio di avviare un timer tramite
[`ACTION_SET_TIMER`](https://developer.android.com/reference/android/provider/AlarmClock), ma si
creerebbero due timer separati e non una sincronizzazione affidabile. Apple espone notifiche,
Live Activities e App Intents per le proprie app; un'esperienza watch completa richiede comunque
un target nativo ([Apple watchOS apps](https://developer.apple.com/documentation/watchos-apps/)).

#### Test necessari

- fake clock con tick ritardato di 35 secondi;
- nessun completamento con 499 ms residui;
- hidden/visible, refresh e force-close;
- salto del wall clock avanti/indietro durante una pagina viva;
- extend/cancel e revisioni obsolete;
- due tab e due dispositivi indipendenti;
- restart server/Docker con timer pendente;
- evento scaduto emesso una sola volta;
- prove manuali iOS Safari, Android Chrome, risparmio energetico e watch associato.

La precisione del display al ritorno in foreground può avere uno SLA, per esempio entro un
secondo. La consegna di notifiche in background resta best-effort perché dipende dal sistema
operativo.

### 5.3 API esportabile e documentazione Markdown

#### Stato attuale

Il backend contiene endpoint same-origin per passkey, sincronizzazione, push e amministrazione.
`GET/PUT /api/data` legge o sostituisce l'intero stato JSON dell'utente. Non esistono:

- API versionate;
- DTO pubblici indipendenti dallo storage;
- token personali e scope;
- ETag/revisioni o controllo di concorrenza;
- paginazione;
- specifica OpenAPI;
- CORS configurabile per client esterni.

`/api/data` è un protocollo interno fragile: il frontend applica una politica `_ts` last-write-
wins e il server rimuove l'active workout. Non deve diventare il contratto pubblico.

#### Decisione raccomandata

Fase documentale:

- `docs/API_INTERNAL.md` descrive gli endpoint esistenti come interni e instabili;
- `docs/openapi.yaml` diventa la fonte unica della nuova API pubblica;
- `docs/API.md` spiega autenticazione, versioning, esempi, errori, privacy e link alla reference
  generata.

La specifica OpenAPI pubblicata più recente è 3.2.0, ma per compatibilità degli strumenti è
ragionevole iniziare con OpenAPI 3.1.2. La specifica ufficiale chiarisce che OpenAPI può alimentare
documentazione, client e test dalla stessa descrizione
([OpenAPI Specification](https://spec.openapis.org/oas/latest.html)).

Prima versione pubblica, sola lettura:

```text
GET /api/v1/profile
GET /api/v1/bodyweights?cursor=&limit=
GET /api/v1/workouts?cursor=&limit=&from=&to=
GET /api/v1/workouts/{workoutId}
GET /api/v1/exercises
```

I DTO devono usare nomi estesi, timestamp RFC 3339 UTC, valori con unità e provenance. Non devono
esporre abbreviazioni o dettagli casuali del JSON interno.

Per client esterni usare Personal Access Token casuali di almeno 256 bit:

- mostrati una sola volta;
- nel database si salva soltanto hash, prefix, scope, scadenza, revoca e ultimo uso;
- scope iniziali: `profile:read`, `bodyweight:read`, `workouts:read`;
- rate limit e log senza token/payload sanitari;
- niente CORS wildcard con credenziali.

Le scritture arrivano in una fase successiva, con ID stabili, schema validation,
`Idempotency-Key`, lock per utente ed ETag/`If-Match`. Non devono mai trasformarsi in un
`PUT /api/data` cieco.

#### Test necessari

- autenticazione 401/403 e matrice scope;
- creazione, revoca, scadenza e rotazione PAT;
- paginazione stabile;
- serializzazione unità, timezone e provenance;
- `If-Match` concorrente con risposta 412;
- idempotenza delle scritture future;
- nessun segreto nei payload o nei log;
- verifica CI route pubbliche ↔ OpenAPI;
- non regressione della sincronizzazione legacy.

### 5.4 Navigazione scorrevole tra routine

#### Stato attuale

La vista Piano mostra una lista verticale. L'editor è una route singola `/plan/r/:id` con il solo
pulsante per tornare al Piano. Ogni cambio di pathname rimonta la vista e porta lo scroll in alto.

Riferimenti: `frontend/src/views/Plan.jsx:38-48`, `frontend/src/views/RoutineEdit.jsx:18-49` e
`frontend/src/App.jsx:48-66`.

#### UX raccomandata

Aggiungere nell'editor un rail orizzontale delle routine:

- chip con icona e nome;
- routine corrente con `aria-current="page"`;
- chip selezionato portato automaticamente in vista;
- frecce precedente/successiva come alternativa a swipe/scroll;
- navigazione con `replace`, così Back torna al Piano anziché ripercorrere tutte le routine;
- `overflow-x: auto`, scroll snap leggero, touch target 44 px e focus visibile;
- deep link `/plan/r/:id` preservato.

Non consiglio uno swipe-only fra intere pagine: entra in conflitto con stepper, chip e bottom
sheet e non è accessibile da tastiera. Il rail soddisfa lo scorrimento richiesto senza imporre
gesture nascoste.

Dopo l'eliminazione si apre la routine successiva; se non esiste, la precedente; si torna al
Piano solo quando non rimangono routine.

#### Test necessari

- zero, una e molte routine;
- id inesistente, riordino ed eliminazione;
- Back/deep link e stato scroll;
- 320 px e reflow 200%;
- tastiera, focus, `aria-current` e screen reader;
- input nome/configurazione salvati prima di cambiare routine.

### 5.5 Riduzione automatica del recupero selezionata di default

#### Stato dell'implementazione

Implementato nella Release B con gate dedicati documentati in
`OPEN_GYM_RELEASE_TEST_REPORT.md`.

Il decoder `confirmedRepRangeConfig` non è stato cambiato: campo assente, `null` o sconosciuto
continuano a produrre `manual`. Una factory separata materializza
`auto_after_successes` esclusivamente durante una transizione effettiva verso Confirmed.
Di conseguenza leggere, importare, sincronizzare o avviare un vecchio JSON non abilita alcuna
automazione implicita.

La nuova scelta persistita resta esplicita:

```json
{
  "restReductionStrategy": "auto_after_successes"
}
```

Comportamento implementato:

- una nuova selezione Confirmed sull'esercizio attiva il toggle nella bozza prima di Salva;
- scegliere `Segui la routine` quando la routine è Confirmed è una nuova selezione effettiva;
- passare da Time a Reps dentro una routine Confirmed applica lo stesso default;
- una nuova selezione Confirmed sulla routine aggiorna soltanto gli esercizi Reps ereditanti;
- Time, cardio e override locali non vengono modificati dalla selezione della routine;
- un nuovo esercizio Reps aggiunto a una routine già Confirmed nasce automatico;
- un Confirmed legacy privo del campo resta manuale anche nel prossimo workout;
- `manual`, automatico e valori sconosciuti già presenti non vengono sovrascritti;
- una preferenza esplicita resta dormiente attraversando altre policy o modalità e riappare al
  ritorno in Confirmed;
- export/import, sync e target snapshot conservano il valore effettivo;
- nessun workout attivo o completato viene riscritto.

La strategia continua a fare parte della firma di progressione: passare davvero da manuale ad
automatico può separare la progressione futura, senza reinterpretare successi o recuperi storici.
La regola esistente resta invariata: riduzione di 30 secondi dopo quattro successi consecutivi
allo stesso recupero, mai sotto il valore iniziale.

#### Test validati

- decoder legacy mancante, `null` e sconosciuto → manuale;
- nuova selezione diretta, ereditata, routine e Time→Reps → automatico;
- matrice routine con Reps, Time, cardio e override;
- persistenza della preferenza manuale/automatica sotto una policy inattiva;
- import/export di automatico, manuale e legacy privo del campo;
- snapshot del workout e immutabilità dello storico;
- quattro successi, decremento di 30 secondi e limite base;
- regressione completa, build e sincronizzazione delle undici lingue.

### 5.6 Istanze dello stesso esercizio tra routine

#### Stato implementazione — 2026-08-27

Implementato e coperto da test automatici. La decisione UX finale applica la regola confermata
dall'utente: configurazioni equivalenti in routine diverse condividono automaticamente; una
differenza materiale separa la progressione futura; i duplicati nella stessa routine restano
indipendenti. La scheda mostra sempre lo stato effettivo `Progressione condivisa` oppure
`Progressione indipendente`, le routine compatibili e un avviso prima di un fork.

Non viene eseguito un merge automatico di due gruppi che possiedono già storici divergenti:
scegliere implicitamente quale storico mantenere sarebbe distruttivo e non spiegabile. Un fork
parte dalla configurazione modificata e dal carico operativo corrente, non riscrive i workout
completati e non legge le future sessioni dell'altro ramo.

Dettagli, comandi e risultati sono registrati in `OPEN_GYM_RELEASE_TEST_REPORT.md`.

#### Problema originario — risolto

Prima della Release A l'identità della progressione era il solo `exerciseId`:

- le entry della routine non avevano un ID stabile dell'occorrenza;
- `lastEntryFor`, `sessionsFor` e Confirmed cercavano `e.id === exerciseId`;
- `exWeights`, recovery reset e control erano globali per esercizio;
- con due occorrenze nello stesso workout `.find(...)` poteva usare soltanto la prima.

La correzione usa ora `routineExerciseId` e `progressionId` in `progression-scope.js`,
`workout-scope.js`, `history.js`, `progression.js`, `workout-records.js` e
`confirmedRepRangeRest.js`. L'hardening successivo impedisce inoltre al riepilogo di fine
esercizio di precompilare il record globale appartenente a un'altra routine o giornata.

Esempio problematico:

```text
Routine A: Panca 3×8–12, 70 kg, Confirmed
Routine B: Panca 5×3–5, 100 kg, Linear
```

Il carico e parte dello storico della routine più recente potevano diventare la baseline
dell'altra. Con due Panche nella stessa routine, progressione e best potevano persino leggere
occorrenze differenti. I test di isolamento introdotti con la Release A coprono entrambi i casi.

#### Modello implementato

Separare:

```text
exerciseId        = movimento del catalogo
routineExerciseId = occorrenza stabile nella routine
progressionId     = gruppo di storico condiviso dalla progressione
```

Esempio condiviso:

```json
{
  "id": "bench-press",
  "routineExerciseId": "slot-a1",
  "progressionId": "exercise:bench-press"
}
```

Esempio indipendente:

```json
{
  "id": "bench-press",
  "routineExerciseId": "slot-b1",
  "progressionId": "slot:slot-b1"
}
```

Ogni active/completed workout snapshotta entrambi gli ID. Peso operativo, target, streak e
recupero usano `progressionId`. PR, statistiche aggregate e alias continuano a usare
`exerciseId`.

#### Default UX consigliato

- Il primo inserimento usa il gruppo globale dell'esercizio, compatibile con il comportamento
  attuale.
- Quando l'esercizio esiste già altrove, openGym mostra `Progressione condivisa` e
  `Progressione indipendente`.
- Se policy, range, serie e semantica del carico coincidono, la scelta raccomandata è condivisa.
- Se sono materialmente diversi, la scelta raccomandata è indipendente e viene spiegato il
  rischio di condivisione.
- Due occorrenze nella stessa routine richiedono sempre una scelta esplicita o partono
  indipendenti.

#### Backward compatibility

- JSON senza i nuovi campi usa il gruppo legacy `exercise:<exerciseId>`.
- Gli slot ricevono un ID persistente al primo salvataggio utile, non calcolato dall'indice.
- Riordino o rinomina non rigenera l'ID.
- L'import di un piano crea nuovi `routineExerciseId`; conserva la volontà di condividere solo
  all'interno del piano importato, senza collidere con gli ID locali.
- I workout vecchi non vengono riscritti. Quando hanno `routineId`, il reader può usare routine e
  ordine delle occorrenze come fallback; i casi realmente ambigui restano nel gruppo legacy.
- I vecchi recovery control per exerciseId restano leggibili; un nuovo reset scrive sul
  `progressionId` scelto.

#### Test necessari

- due routine condivise continuano la stessa progressione;
- una routine isolata non cambia l'altra;
- duplicati nella stessa routine restano distinti;
- PR globale comune con prescrizioni separate;
- reset recupero limitato al progression group;
- riordino, rinomina, cancellazione, piano importato e JSON legacy;
- refresh, sync e round-trip non rigenerano ID.

### 5.7 Attrezzatura e pesi da caricare

#### Stato dell'implementazione

Implementato nella Release C con gate dedicati documentati in
`OPEN_GYM_RELEASE_TEST_REPORT.md`. La soluzione mantiene il catalogo come semplice suggerimento:
quando non esiste una corrispondenza univoca usa un override esplicito oppure non calcola il
carico, senza inventare una formula.

Il catalogo possiede un campo `eq` con categorie come barbell, olympic barbell, ez barbell,
trap bar, dumbbell, kettlebell e macchine. Non specifica però:

- peso a vuoto dell'attrezzo;
- inventario e quantità delle piastre;
- uno o due manubri;
- se il carico registrato è totale, per mano o per lato;
- attrezzo preciso per categorie generiche;
- attrezzatura dei custom exercise.

Quindi openGym può suggerire un tipo da `eq`, ma non può calcolare in modo sicuro senza
configurazione e override.

#### UX adottata

In Impostazioni:

1. creare profili, per esempio `Palestra`, `Casa`, `Hotel`;
2. definire gli attrezzi disponibili, tara, unità e inventario;
3. scegliere il profilo attivo per le prossime sessioni.

Nella configurazione dell'esercizio:

- mostrare il tipo suggerito dal catalogo;
- permettere override per `routineExerciseId`;
- dichiarare esplicitamente la convenzione del carico;
- mostrare anteprima della composizione.

Durante il workout, sopra la prossima serie non completata:

```text
✓ Target 70 kg · bilanciere 20 kg
  Carica 20 kg + 5 kg per lato
```

Il messaggio deve aggiornarsi subito se il peso della prossima serie cambia. Deve avere icona e
testo, non solo colore. Il verde deve usare un token `success` con contrasto verificato in tema
chiaro/scuro, non l'accento personalizzabile.

#### Modello dati adottato

```json
{
  "equipmentProfiles": [
    {
      "id": "gym-main",
      "name": "Palestra",
      "unit": "kg",
      "items": [
        {
          "id": "bar-main",
          "kind": "symmetric_bar",
          "label": "Bilanciere olimpico",
          "tareWeight": 20,
          "implementCount": 1,
          "denominations": [
            { "weight": 20, "count": 4 },
            { "weight": 10, "count": 4 },
            { "weight": 5, "count": 4 },
            { "weight": 2.5, "count": 4 },
            { "weight": 1.25, "count": 4 }
          ]
        }
      ]
    }
  ],
  "activeEquipmentProfileId": "gym-main"
}
```

Modalità minime:

- `symmetric_bar`: totale meno tara, diviso sui due lati;
- `loadable_dumbbell`: target per manubrio meno manico;
- `fixed_weight`: lista di manubri/kettlebell disponibili;
- `machine_stack`: pacco pesi/incrementi macchina;
- `plate_loaded_machine`: uno o due lati con eventuale tara;
- `custom`: spiegazione manuale.

Bodyweight, bande e macchine assistite richiedono adattatori diversi; non deve esistere una
formula generica che finga di coprire ogni attrezzo.

#### Calcolo adottato

- Precisione a centesimi.
- Rispetto di quantità e simmetria.
- Ricerca deterministica della combinazione, non semplice greedy.
- Target della progressione mai modificato automaticamente.
- Se il target non è componibile: `Non caricabile esattamente`, con combinazione inferiore e
  superiore più vicine.
- Target sotto tara: errore esplicito.
- Profilo kg e workout lb: conversione esplicita oppure nessun suggerimento.

Per i manubri la raccomandazione è che `sets[].w` indichi il peso di un singolo manubrio; il numero
di attrezzi usati resta un campo separato e modificabile per slot.

#### Snapshot immutabile

All'avvio copiare nell'active workout il profilo normalizzato e, su ogni entry, l'attrezzo e la
semantica risolti. Al finish copiare lo snapshot nel workout terminato.

Se il bilanciere passa da 20 a 15 kg:

- workout già terminati: restano a 20;
- workout attivo: resta a 20, anche dopo refresh;
- sessione successiva: usa 15.

Un esercizio aggiunto durante la sessione usa il profilo congelato all'avvio, non quello appena
modificato nelle impostazioni.

#### Test automatici e gate

- bilanciere 70/20, piastre frazionarie e quantità insufficienti;
- manubrio singolo/coppia e peso per mano;
- target impossibile, sotto tara e unità discordanti;
- override slot > mapping catalogo;
- stesso esercizio con attrezzi diversi;
- cambio profilo prima/durante/dopo sessione;
- refresh, backup, sync e Docker down/up;
- workout legacy senza snapshot;
- contrasto e comprensione del messaggio senza colore.

Risultato corrente dopo l'estensione 7A: **129 test mirati superati**, **635 test complessivi
superati**, build Vite riuscita, 11 locali sincronizzate con 873 chiavi ciascuna e contrasto
success misurato a **6,51:1** nel tema scuro e
**5,15:1** nel tema chiaro. Refresh/storage, export/import, cambio profilo prima/durante/dopo,
stesso esercizio in progression group diversi, corpo libero, unità discordanti e inventari
impossibili sono coperti automaticamente. Il solver coincide inoltre con un enumeratore
brute-force indipendente su **2.000 casi deterministici**. Un controllo riproducibile in Edge
headless a 320 px, esteso e rieseguito in Chromium 153, ha superato **29/29 controlli** su
schermate, cambio del meccanismo, editor dell'attrezzo, assenza di overflow, guida esatta,
semantica accessibile e temi chiaro/scuro. Docker/CasaOS, due browser autenticati, screen
reader e dispositivo fisico restano gate manuali esplicitati nel report, perché dipendono
dall'ambiente reale.

#### Estensione 7A — Cavi caricati a dischi e guida per punto/lato

**Stato: Completato e validato il 2026-09-23; commit dedicato pendente per lo stop concordato.**

##### Esito dell'implementazione

- L'editor espone `Macchina a cavo` come tipo guidato e obbliga a scegliere tra `Pacco pesi` e
  `Dischi sui perni`.
- Il pacco pesi riusa `machine_stack`; il cavo a dischi riusa `plate_loaded_machine`. Non sono
  stati aggiunti nuovi `kind`, campi persistenti obbligatori o migrazioni di schema.
- Per il cavo a dischi la UI usa `Punti da caricare`, permette uno o due punti e considera
  facoltativo l'inventario dei dischi.
- La guida calcola `(target - tara) / punti`, mostra target totale, massa totale dei dischi e
  carico fisico per punto. Dichiara sempre che il rapporto delle pulegge non è applicato.
- Il selettore dell'esercizio e l'elenco del profilo mostrano il meccanismo, così la scelta resta
  comprensibile anche dopo la chiusura dell'editor.
- Se più attrezzi corrispondono a `cable`, il resolver resta intenzionalmente ambiguo e richiede
  una scelta esplicita dello slot.
- Profili, workout attivi e workout conclusi mantengono gli snapshot già previsti dal requisito
  7: modificare tara, punti o attrezzo influenza soltanto workout futuri.

La copertura aggiunta comprende 18 test automatici nuovi nel totale di suite, 129 test mirati
di dominio/integrazione/UI, la regressione completa da 635 test, build, locale check, 2.000
confronti brute-force del solver e 29 controlli browser reali a 320 px.

##### Problema originario e comportamento precedente

`cable` nel catalogo identifica la categoria dell'esercizio, non il meccanismo fisico della
macchina. Un cavo può essere:

- selectorized, con pacco pesi e perno di selezione;
- plate-loaded, con dischi applicati a uno o due perni/punti di carico;
- composto da due torri indipendenti;
- soggetto a un rapporto di pulegge che non coincide necessariamente con il peso fisicamente
  caricato.

Prima della 7A `machine_stack` trattava correttamente i valori selezionabili del pacco pesi.
`plate_loaded_machine` sa già sottrarre la tara e dividere il residuo su uno o due punti, anche
senza censire l'inventario dei dischi. Il limite era soprattutto di UX e configurazione: non
esisteva un preset chiamato `Cavo caricato a dischi`, la voce `Cavo` poteva quindi essere
associata al pacco pesi e l'utente non vedeva subito quale meccanismo sarebbe stato usato.

Non si deve dedurre il meccanismo da `exercise.eq === "cable"`: due esercizi al cavo, o lo stesso
esercizio in due palestre, possono usare macchine differenti.

##### Decisione UX/UI raccomandata

Nell'editor del profilo attrezzatura aggiungere un flusso guidato:

```text
Attrezzo: Cavo

Come si carica?
( ) Pacco pesi con selettore
(•) Dischi su perni

Punti da caricare
[ Uno ] [ Due ]

Peso/resistenza a vuoto: 0 kg
Il peso registrato indica: Totale della macchina

Inventario dischi (facoltativo)
```

Le due scelte sono preset UX, non due interpretazioni nascoste dello stesso dato:

- `Pacco pesi con selettore` crea/configura un `machine_stack`;
- `Dischi su perni` riusa `plate_loaded_machine`, imposta il match catalogo `cable` e mostra
  `Punti da caricare` al posto del più ambiguo `Lati da caricare`;
- per i profili e JSON esistenti non cambia nulla;
- se nello stesso profilo esistono sia un cavo a pacco pesi sia uno a dischi, l'associazione
  automatica deve fermarsi come ambigua e l'esercizio deve far scegliere l'attrezzo esplicito.

Nella configurazione del singolo esercizio, il selettore `Attrezzatura di carico` deve rendere
visibile il meccanismo già nel nome o in un badge:

```text
Cavo Technogym        · Pacco pesi
Cavo plate-loaded     · Dischi · 2 punti
```

Subito sotto va mostrata un'anteprima numerica, per esempio `Target 60 kg → 30 kg per lato`.
Questo evita di scoprire la convenzione soltanto durante il workout.

Durante l'esecuzione non serve un nuovo popup: è preferibile estendere la guida verde già
presente sopra la prossima serie, con etichette complete e senza ellissi:

```text
Obiettivo registrato: 60 kg
Cavo plate-loaded · 2 punti di carico
Carica 30 kg su ciascun lato
Totale dischi: 60 kg · rapporto pulegge non applicato
```

Con una tara/resistenza a vuoto di 10 kg lo stesso obiettivo deve mostrare `25 kg per lato`.
Con un solo punto deve dire `Carica 50 kg sul perno`, non `per lato`. Se l'inventario dei dischi
è vuoto, la guida si ferma al valore numerico; se è censito, la composizione può comparire in una
riga secondaria o in un dettaglio espandibile.

##### Convenzione del peso e formula

Per l'MVP la convenzione raccomandata è esplicita e deterministica: il peso registrato in openGym
è il **totale della macchina**, comprensivo della tara configurata. La formula è:

```text
carico per punto = (peso registrato - tara) / numero di punti da caricare
```

Questa assunzione deve essere visibile sia nell'editor sia nella guida; non può restare implicita.
I vecchi `plate_loaded_machine` mantengono la semantica `total`, quindi non servono migrazioni.

Se l'utente registra invece il peso **già per lato/torre**, servirà una futura semantica esplicita
`per_loading_point`; non va simulata moltiplicando o dividendo silenziosamente lo storico. Fino a
quando quella variante non è implementata, il caso deve usare un'istruzione manuale.

Il rapporto delle pulegge non viene stimato nella 7A: numero di dischi, massa fisica caricata e
resistenza alla maniglia non sono equivalenti su tutte le macchine. Un'eventuale conversione
richiederà un rapporto dichiarato dall'utente o dal produttore, snapshotato nel workout. In sua
assenza la UI deve dire `rapporto pulegge non applicato`, non presentare il risultato come forza
effettiva.

##### Modello dati e backward compatibility

Il caso base riusa il modello già leggibile dal sistema:

```json
{
  "id": "cable-plate-loaded",
  "kind": "plate_loaded_machine",
  "label": "Cavo plate-loaded",
  "catalogEquipment": "cable",
  "tareWeight": 0,
  "sideCount": 2,
  "denominations": []
}
```

`sideCount` resta il nome persistito per compatibilità; la UI lo presenta come `Punti da
caricare`. Il profilo e la scelta per slot continuano a essere congelati in
`equipmentSnapshot`/`equipmentUse`, quindi un cambio palestra non modifica workout attivi o
terminati. Non è necessario introdurre un nuovo `kind` né riscrivere lo storico per il caso
totale a uno/due punti.

##### Criteri di accettazione e test

1. Il preset `Cavo · Pacco pesi` continua a mostrare il valore da selezionare, mai `per lato`.
2. `Cavo · Dischi`, target 60, tara 0 e due punti mostra 30 kg per lato.
3. Target 60, tara 10 e due punti mostra 25 kg per lato.
4. Target 60, tara 10 e un punto mostra 50 kg sul perno senza usare la parola `lato`.
5. Inventario vuoto produce comunque il calcolo aritmetico esatto, senza chiedere di censire i
   dischi.
6. Inventario presente aggiunge la composizione senza cambiare target o progressione.
7. Pacco pesi e plate-loaded entrambi associati a `cable` richiedono una scelta esplicita per lo
   slot e non usano il primo match trovato.
8. Lo stesso esercizio in routine/giorni diversi può usare due cavi differenti senza contaminare
   attrezzo, peso, guida o snapshot.
9. Cambio profilo o tara influenza soltanto workout avviati successivamente.
10. Target sotto tara, numero di punti invalido, unità discordanti e attrezzo rimosso producono
    un messaggio sicuro, non un valore inventato.
11. La guida dichiara che il rapporto pulegge non è applicato e non chiama il valore `resistenza
    effettiva`.
12. Preview e guida sono leggibili a 320 px, con tastiera/screen reader, tema chiaro/scuro e senza
    label troncate con `...`.

Test richiesti: normalizzazione preset, mapping ambiguo, formula uno/due punti, tara zero/non
zero, inventario assente/presente, snapshot e isolamento slot, round-trip JSON legacy, anteprima
configurazione, copy/accessibilità della guida e regressione completa del solver esistente.

##### Configurazione dopo la 7A

Nel profilo attrezzatura selezionare `Macchina a cavo`, quindi `Dischi sui perni`. Impostare la
resistenza a vuoto e uno o due punti da caricare; l'inventario può restare vuoto. Se il profilo
contiene più cavi associati alla stessa categoria, nella configurazione dello specifico esercizio
scegliere esplicitamente l'attrezzo desiderato. La guida del workout mostrerà il target totale,
quanto caricare su ogni punto e la massa totale dei dischi, senza convertire il rapporto delle
pulegge.

### 5.8 Recupero del peso da Withings

#### Fattibilità

È fattibile un'integrazione unidirezionale Withings → openGym. La Public API Withings è
disponibile anche a sviluppatori senza contratto e usa OAuth 2.0 Authorization Code server-side
([Public API integration guide](https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/public-health-data-api-overview/)).

Lo scope minimo è `user.metrics`. L'authorization code deve essere scambiato rapidamente; la
documentazione indica 30 secondi. Access token e refresh token devono restare esclusivamente nel
backend. L'access token dura circa tre ore; il refresh token ruota e la sostituzione deve essere
atomica
([Withings access and refresh tokens](https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/get-access/access-and-refresh-tokens-no-recover/)).

Il peso si recupera con `POST https://wbsapi.withings.net/measure`, action `getmeas`, misura di
tipo `1`. Il valore Withings usa `value × 10^unit` in kg. La deduplica deve usare il `grpid` e
conservare date di misura/modifica e provenienza.

#### Implementazione consigliata per CasaOS

Fase 1, senza OAuth:

- verificare una fixture reale dell'export CSV Withings con l'importatore esistente;
- riconoscere la sorgente come Withings, non Apple Health;
- documentare colonne, unità e duplicati.

Fase 2, OAuth con polling:

- `Connetti Withings` nelle impostazioni;
- `Sincronizza ora`, sync al login/boot e riconciliazione periodica;
- cursore `lastupdate`, avanzato solo dopo salvataggio atomico;
- backfill per dati modificati o notifiche perse.

Il webhook è opzionale. Withings richiede un callback pubblico HTTPS, porte 80/443, dominio
reale e risposta HEAD
([Withings notifications](https://developer.withings.com/developer-guide/v3/data-api/notifications/notification-subscribe/)).
Un CasaOS solo LAN non soddisfa questi requisiti senza dominio/tunnel; il polling rimane quindi
l'MVP più robusto.

#### Conflitti e modello

Lo stato attuale conserva una misura al giorno. Politica raccomandata:

- una nuova misura Withings può aggiornare solo una precedente misura Withings con lo stesso ID
  o giorno;
- un valore manuale dello stesso giorno non viene sovrascritto;
- il conflitto viene mostrato e l'utente sceglie;
- valore raw conservato in kg, visualizzazione convertita nell'unità del profilo.

```json
{
  "d": "2026-08-26",
  "w": 78.4,
  "t": 1787718600000,
  "source": "withings",
  "externalId": "withings-grpid",
  "measuredAt": 1787718600000,
  "modifiedAt": 1787718600000,
  "importedAt": 1787720000000,
  "rawKg": 78.4
}
```

Disconnect revoca token e sottoscrizioni. I dati già importati possono restare come snapshot con
provenienza, offrendo separatamente l'eliminazione dei dati importati.

#### Sicurezza e test

- client ID/secret da variabili ambiente dell'istanza self-hosted;
- token cifrati at-rest e mai in `state`, localStorage o log;
- `state` OAuth anti-CSRF, scadenza e protezione replay;
- refresh token ruotato atomicamente;
- fixture esponenti/unità, più misure e paginazione;
- webhook duplicato e `lastupdate` out-of-order;
- manual-wins, kg/lb e timezone;
- 401 con un solo refresh, revoca e disconnect;
- test E2E separato con account/demo ufficiale, nessuna rete nella suite ordinaria.

### 5.9 Sincronizzazione Polar Flow

#### Fattibilità e limite decisivo

La strada corrente è Polar AccessLink Dynamic API v4, OAuth2 server-side con scope minimo
`training_sessions:read`
([Polar AccessLink Dynamic API v4](https://www.polar.com/polar-api-v4/)).

Polar può fornire identificativo, start/stop, durata, timezone, sport, dispositivo, frequenza
cardiaca, calorie, zone e training load. I risultati strength possono contenere round/set,
intervalli temporali, tipo resistenza e movimento, ma non espongono in modo utilizzabile le
ripetizioni e il peso caricato.

Inoltre l'API pubblica è in lettura: non esiste un endpoint documentato per scrivere in Polar
Flow le serie openGym. Anche l'annuncio ufficiale la descrive come read-only
([Polar Open AccessLink](https://www.polar.com/blog/introducing-polar-open-accesslink-api/)).

Conclusione:

- Polar → openGym: sì, come arricchimento;
- openGym → tabella Polar con serie/reps/kg: no tramite API ufficiale disponibile;
- Polar non deve guidare Confirmed Rep-Range.

#### Modello raccomandato

Non creare un falso workout openGym. Salvare un'attività esterna collegata:

```json
{
  "provider": "polar",
  "externalId": "polar-session-uuid",
  "createdAt": "2026-08-26T17:00:00Z",
  "modifiedAt": "2026-08-26T17:05:00Z",
  "start": "2026-08-26T16:02:00Z",
  "end": "2026-08-26T17:11:00Z",
  "sport": "STRENGTH_TRAINING",
  "heartRate": { "average": 126, "maximum": 164 },
  "calories": 421,
  "trainingLoad": 74.2,
  "linkedWorkoutId": "open-gym-workout-id"
}
```

- Deduplica per UUID Polar.
- Aggiornamento solo se `modified` avanza.
- Primo collegamento confermato dall'utente.
- Auto-link solo con una corrispondenza univoca per data locale e sovrapposizione temporale.
- Casi ambigui nella coda `Da associare`.
- Attività senza workout rimane una card esterna separata.
- Dati Polar non modificano set, target, peso, streak o recupero.

Polling `Sincronizza ora`, post-workout e periodico è il primo rilascio consigliato. La reference
v4 non documenta webhook; la combinazione con il webhook v3 va trattata come spike da verificare,
non come requisito già garantito.

#### Test necessari

- sessioni con feature opzionali assenti;
- strength result senza reps/kg;
- multisport, timezone e DST;
- deduplica UUID e aggiornamento `modified`;
- linking esatto, ambiguo e nessun match;
- attività non associate;
- assert che progressione e storico serie non cambino;
- 401/refresh, 429/backoff e outage parziale;
- OAuth state/replay, token cifrati e contract test gated.

### 5.10 Alias degli esercizi e filtro

#### Stato attuale

Libreria e picker duplicano la logica di ricerca e controllano nome, target/body part,
attrezzatura e descrizione. Non esiste un campo alias. Riferimenti:
`frontend/src/views/Library.jsx:18-23` e `frontend/src/sheets.jsx:422-438`.

#### Modello e UX raccomandati

```json
{
  "exerciseAliases": {
    "bench-press": ["panca piana", "bench"],
    "romanian-deadlift": ["rdl", "stacco rumeno"]
  }
}
```

- Alias personali e globali per profilo, non per routine.
- Gestibili dal dettaglio di qualsiasi esercizio, anche built-in.
- Funzione unica `matchesExerciseQuery(exercise, query, state)` usata da Libreria e picker.
- Normalizzazione case-insensitive, Unicode/diacritici, spazi e punteggiatura.
- Deduplica all'interno dello stesso esercizio.
- Alias uguale per più esercizi consentito: la ricerca mostra entrambi.
- Se il match avviene soltanto via alias, mostrare `Alias: panca piana`.
- Il plan sharing non esporta gli alias personali; backup e sync completo sì.
- Cancellando un custom exercise si elimina anche la relativa voce alias.

Gli alias non devono essere usati automaticamente per importare workout ambigui: aiutano la
ricerca, non cambiano l'identità canonica.

#### Test necessari

- maiuscole, accenti, spazi e punteggiatura;
- JSON assente o malformato;
- stesso risultato in Libreria e picker;
- alias condiviso da più esercizi;
- backup, sync, cancellazione custom e plan sharing;
- stringhe HTML renderizzate come testo;
- input e chip accessibili da tastiera/screen reader.

### 5.11 Modifica manuale delle serie durante la sessione

#### Stato dell'implementazione

Implementato nella Release A con commit dedicato e gate completo documentato in
`OPEN_GYM_RELEASE_TEST_REPORT.md`. Il motore deriva ora `outcome` e `validatedReps` esclusivamente
dallo snapshot storico e dalle serie prescritte; due risultati anticipati al massimo valgono
come due conferme anche quando i target congelati erano 8 e 9. Serie mancanti, extra e carichi
misti hanno semantiche separate.

La UI etichetta le righe oltre `target.sets` come `Opzionale`, separa i relativi contatori e non
le usa per decidere se la prescrizione è completa. Aggiungere o rimuovere una riga resta locale
alla sessione; il comando esplicito `Usa N serie dal prossimo allenamento` aggiorna soltanto lo
slot di routine stabile e lascia immutato il target attivo. Se il numero di serie cambia, la
normalizzazione degli scope separa correttamente la progressione futura quando necessario.

#### Stato precedente alla Release A

La UI permette di cambiare peso e ripetizioni, aggiungere una serie e rimuovere l'ultima. Lo
snapshot `entry.target` conserva invece ciò che era stato prescritto. Confirmed valuta soltanto
le prime `target.sets`; le serie extra sono opzionali e non riscattano una serie prescritta
fallita.

Il caso richiesto oggi non funziona come atteso.

Configurazione:

```text
4 serie · minimo 8 · massimo 10 · 70 kg · incremento 2 kg
```

Facendo sempre `10/10/10/10`, il comportamento corrente è:

| Sessione | Target snapshot | Prossima prescrizione |
|---|---:|---|
| 1 | 8 | 70 kg × 9 |
| 2 | 9 | 70 kg × 10 |
| 3 | 10 | conferma 1/2 |
| 4 | 10 | 72 kg × 8 |

Il test `does not let extra completed reps skip an intermediate target` rende questo
comportamento esplicito. Per ottenere l'aumento dopo due sessioni a 10 serve cambiare la regola,
non soltanto aggiungere test.

#### RF-11.1 — Requisito approvato: validazione del livello effettivamente completato

La progressione Confirmed Rep-Range deve riconoscere il livello realmente dimostrato su tutte le
serie prescritte. Non deve obbligare l'utente a ripetere un livello intermedio quando la stessa
sessione dimostra già di averlo completato.

Per ogni sessione qualificabile si calcola:

```text
repsCompletate = minimo delle ripetizioni delle sole serie prescritte e completate
livelloValidato = massimo livello valido del range non superiore a repsCompletate
```

Per un normale range `8–10`, i livelli validi sono 8, 9 e 10. Per un esercizio con passo 2, per
esempio un target totale per lato, i livelli validi rispettano quel passo: 8, 10, 12. Le
ripetizioni oltre il massimo vengono limitate a `maxReps` ai soli fini della progressione.

Condizioni necessarie:

1. la strategia effettiva è Confirmed Rep-Range;
2. tutte le `target.sets` serie prescritte sono state completate;
3. nessuna serie prescritta è mancante o rimossa;
4. `repsCompletate` è almeno pari al target snapshot della sessione;
5. il working load qualificante è coerente su tutte le serie prescritte;
6. storico, range e carico appartengono allo stesso `progressionId`;
7. le serie opzionali oltre `target.sets` non partecipano al calcolo.

Effetti deterministici sotto il limite superiore:

- se il target era 8 e tutte le serie raggiungono almeno 8, viene validato il livello 8 e la
  prossima prescrizione è 9;
- se il target era 8 e tutte le serie raggiungono almeno 9, viene validato anche il livello 9 e la
  prossima prescrizione è 10;
- il valore determinante è sempre la serie prescritta con meno ripetizioni: una serie più alta non
  compensa una serie più bassa;
- una singola sessione può saltare uno o più livelli intermedi, ma rappresenta comunque una sola
  sessione e quindi una sola eventuale conferma del massimo.

Effetti al limite superiore:

- ogni sessione nella quale tutte le serie prescritte raggiungono almeno `maxReps` è un
  `topRangeSuccess`, anche se il target snapshot era più basso;
- il primo `topRangeSuccess` porta il prossimo target a `maxReps` e registra
  `topRangeStreak = 1`;
- il secondo `topRangeSuccess` consecutivo, con lo stesso `progressionId`, range e working load,
  completa la conferma;
- per un esercizio caricato, la seconda conferma applica esattamente l'incremento configurato e
  riporta il target a `minReps`;
- la conferma consumata viene azzerata (`topRangeStreak = 0`) dopo l'aumento;
- per il corpo libero puro, il riconoscimento del livello segue la stessa regola, mentre l'azione
  successiva alla conferma resta quella specifica già prevista dalla strategia e non introduce
  automaticamente una zavorra.

| Target | Serie reali | Livello validato | Prossima prescrizione attesa |
|---:|---|---:|---|
| 8 | 8/8/8/8 | 8 | 70 kg × 9 |
| 8 | 9/9/9/9 | 9 | 70 kg × 10 |
| 8 | 10/10/9/10 | 9 | 70 kg × 10 |
| 8 | 10/9/8/10 | 8 | 70 kg × 9 |
| 8 | 10/10/10/10 | 10 | 70 kg × 10, conferma 1/2 |
| 9 | 10/10/10/10 | 10 | 70 kg × 10, conferma 1/2 |
| 8 | 11/10/12/10 | 10 | 70 kg × 10, conferma 1/2 |
| 10 | 10/10/10/10 | 10 | 72 kg × 8 dopo la precedente conferma valida |
| 8 | 8/8/7/8 | nessuno | hold 70 × 8; vero fallimento successivo |
| 8 | 7/8/8/8 | nessuno | hold 70 × 8; prima serie fallita |

Esempi di accettazione principali:

```text
Configurazione: 4 serie, range 8–10, 70 kg, incremento 2 kg

Caso A
Sessione: target 8, risultato 9/9/9/9
Risultato: il livello 9 è validato; prossima prescrizione 70 kg × 10

Caso B, valido anche sui workout già presenti
Sessione 1: target storico 8, risultato 10/10/10/10 → conferma 1/2
Sessione 2: target storico 9, risultato 10/10/10/10 → conferma 2/2
Risultato: prossima prescrizione 72 kg × 8
```

Nel caso B non è necessario che il secondo target storico coincida con ciò che il nuovo algoritmo
avrebbe prescritto dopo la prima sessione. Il target 9 resta immutato nello snapshot: la nuova
regola usa i risultati reali per calcolare esclusivamente la prescrizione futura.

La rivalutazione dello storico è quindi intenzionale, ma non modifica i workout conclusi. Devono
essere usati range, numero di serie, carico e target congelati negli snapshot; un workout legacy
privo dei dati necessari non deve essere completato inventando valori dalla configurazione
corrente.

Il precedente test `does not let extra completed reps skip an intermediate target` è stato
sostituito: il salto è ora consentito fino al livello minimo raggiunto da tutte le serie
prescritte, mai in base al risultato di una sola serie.

#### Serie aggiunte/rimosse

Distinguere gli esiti:

```text
success          = tutte le serie prescritte raggiungono il target
topRangeSuccess  = tutte raggiungono il massimo
failed           = serie eseguita sotto target
incomplete       = serie prescritta non eseguita o rimossa
optional         = serie oltre il numero prescritto
```

- Una serie extra non modifica la routine e non influenza progressione/recupero.
- Una serie prescritta rimossa rende la sessione incompleta, ma non deve simulare un cedimento
  successivo e aumentare automaticamente il recupero.
- Se si vuole cambiare permanentemente il numero di serie, si usa il comando separato
  `Usa N serie dal prossimo allenamento`.
- Nessuna inferenza automatica deve riscrivere la configurazione della routine.
- Le serie extra devono avere una label `Opzionale`.

#### Carichi modificati manualmente

Prima della Release A, Confirmed usava il massimo fra le serie prescritte. Una singola serie più
pesante poteva quindi diventare il nuovo working load anche se le altre erano più leggere.

Regola implementata:

- se tutte le serie prescritte usano lo stesso carico modificato, quel carico può diventare la
  nuova baseline;
- se i carichi sono misti, la sessione non conferma un nuovo working load e non usa il massimo
  isolato;
- il target snapshot rimane visibile per spiegare lo scostamento;
- il peso di una serie opzionale non cambia la progressione.

#### Test automatici necessari

- matrice completa target 8/9/10, sotto/uguale/sopra;
- target 8 con 9/9/9/9 → prossimo target 10;
- target 8 con 10/10/9/10 → livello validato 9 e prossimo target 10;
- target 8 con 10/9/8/10 → livello validato 8 e prossimo target 9;
- due successi anticipati a 10 → 72 kg × 8;
- successo anticipato partendo sia da target 8 sia da target 9;
- ripetizioni sopra il massimo su tutte le serie equivalgono al raggiungimento del massimo;
- una sola serie sotto 10 non conferma il massimo;
- fallimento/incomplete o cambio di working load fra le due esposizioni interrompe la conferma;
- la seconda conferma azzera lo streak e riparte dal minimo con un solo incremento;
- extra set riuscita/fallita/incompleta neutra;
- serie prescritta rimossa → incomplete, nessun falso +30 secondi;
- set aggiunto e rimosso non cambia le serie future;
- modifica dopo check congelata al finish;
- routine modificata durante active non cambia snapshot;
- carichi misti non avanzano dal massimo isolato;
- passi di ripetizione diversi da 1 arrotondano al livello valido inferiore;
- due workout storici con target 8 e 9 ma risultato uniforme 10 vengono rivalutati come due
  conferme, senza alterarne gli snapshot;
- un workout legacy privo di range/target sufficienti non viene reinterpretato tramite la
  configurazione corrente;
- stesso esercizio in due progression group;
- duplicato nello stesso workout attribuito allo slot corretto;
- bodyweight e limite serie invariati.

### 5.12 Data e ora di inizio/fine sessione

#### Stato dell'implementazione

Implementato nella Release B con gate dedicati documentati in
`OPEN_GYM_RELEASE_TEST_REPORT.md`.

La soluzione conserva gli epoch numerici `start` e `end` e aggiunge metadati opzionali di
provenienza, precisione e fuso:

```json
{
  "start": 1787742000000,
  "end": 1787745600000,
  "d": "2026-08-26",
  "startTimeZone": "Europe/Rome",
  "endTimeZone": "Europe/Rome",
  "timeSource": "native",
  "timePrecision": "millisecond"
}
```

Non è richiesta alcuna migrazione. I nuovi workout nativi usano `timeSource: "native"` e
`timePrecision: "millisecond"`; gli import usano `timeSource: "import"` con precisione
`date-only`, `minute`, `second` o `millisecond` in base al dato sorgente.

#### Lifecycle deterministico

All'avvio `nativeWorkoutStart` legge una sola volta l'istante e deriva `d` da quello stesso epoch
nel fuso catturato. Questo elimina la possibile incoerenza a mezzanotte prodotta dalle precedenti
chiamate separate a `todayISO()` e `Date.now()`.

Alla conclusione `nativeWorkoutEnd` legge una sola volta l'istante finale, registra il fuso di
fine e preserva i metadati dello start. Un active workout legacy privo di metadati viene completato
come nativo senza modificarne start, target o serie. Lo scarto continua a eliminare soltanto
l'active locale e non crea un workout terminato.

#### UX/UI adottata

History, Recent workouts, le righe e i dettagli aperti dal Calendar, il dettaglio workout e
Admin mostrano:

```text
mer 26 ago 2026 · 18:05–19:12 · 1h 7m
```

Il riepilogo appena concluso mostra data completa e intervallo start–end sotto il titolo; la
durata resta nella tile dedicata. L'header del workout attivo non è stato appesantito: su 320 px
contiene già nome, elapsed, serie e due azioni, mentre l'elapsed comunica che la sessione è in
corso.

Il riepilogo mensile del Calendar somma soltanto durate conosciute: se contiene esclusivamente
import solo-data, omette la durata invece di mostrare un fuorviante `0 min`.

Se la sessione attraversa mezzanotte o termina in un altro fuso, l'intervallo include anche la
data finale. Se il cambio DST ripete la stessa ora, vengono mostrati gli offset, per esempio
`02:30 GMT+2–02:30 GMT+1 · 1h 0m`. Il formatter usa la lingua selezionata e non restituisce mai
`Invalid Date`.

#### Import e backward compatibility

- un import con orario conserva start, fine, data di fine e fuso locale di interpretazione;
- un ISO con `Z`/offset conserva l'epoch assoluto e gli eventuali secondi/millisecondi, quindi
  viene raggruppato e mostrato nel giorno corretto del fuso locale d'importazione;
- ogni epoch locale viene costruito separatamente, quindi un cambio DST non altera la durata;
- un wall clock locale inesistente nel salto DST primaverile viene scartato invece di essere
  spostato automaticamente di un'ora;
- un import solo-data conserva il fallback numerico tecnico per compatibilità, ma viene marcato
  `date-only` e in UI mostra esclusivamente la data;
- una riga con data/start impossibile viene scartata invece di normalizzarsi silenziosamente in
  un altro giorno; un end non valido viene ignorato senza perdere la serie valida;
- un workout legacy con `end > start` continua a mostrare il proprio intervallo reale;
- un legacy con `start === end` resta solo-data, perché quella forma identifica anche il vecchio
  fallback di import;
- timestamp o date corrotti vengono omessi in sicurezza; un fuso non valido usa un fallback
  sicuro. Il JSON storico non viene riscritto.

#### Persistenza e sincronizzazione

localStorage, backup JSON e mirror mobile conservano i nuovi campi senza schema migration. Un
active workout e il suo start sopravvivono a refresh/restart sullo stesso dispositivo.

Il server elimina intenzionalmente `state.active` durante `PUT /api/data`: un allenamento in
corso non viene quindi trasferito fra dispositivi. Questa policy di concorrenza resta fuori dal
requisito 12. Dopo il finish, il workout completo e tutti i metadati start/end entrano invece
nella sincronizzazione server ordinaria e persistono nel volume Docker.

Non esiste ancora una workout API pubblica: la serializzazione RFC 3339 resta parte del futuro
requisito 3/API v1. Lo storage corrente continua correttamente a usare epoch più provenance.

#### Test eseguiti

```text
29 file di test superati
550 test superati
0 test falliti
```

La matrice copre singola acquisizione start/end, wiring reale del lifecycle, finish idempotente,
scarto, stessa data, mezzanotte, cambio fuso, DST primaverile/autunnale, localizzazione italiana,
persistenza JSON/storage, import date-only/minute/second/millisecond, ISO con offset, wall clock
DST inesistente, fine il giorno successivo, date invalide, legacy e dati corrotti. Build, lingue e
diff sono inclusi nel report di rilascio; i gate browser/CasaOS reali restano manuali.

### 5.13 Riscaldamento specifico guidato verso la serie allenante

#### Stato e obiettivo

Nuovo requisito di backlog, **non ancora implementato**.

Durante l'esecuzione di un esercizio compatibile, l'utente deve poter richiamare manualmente un
popup **Riscaldamento** che costruisce una sequenza progressiva verso la prossima serie allenante.
La guida deve mostrare senza ambiguità:

- percentuale e ripetizioni di ogni tappa;
- carico teorico e, quando noto, carico realmente utilizzabile;
- peso totale;
- tara e peso da aggiungere per lato/punto di carico;
- peso del singolo manubrio e quantità di manubri;
- composizione delle piastre soltanto se l'inventario è stato censito;
- serie allenante di destinazione, separata visivamente dalle tappe di riscaldamento.

Si tratta del **riscaldamento specifico al carico dell'esercizio**, non di un programma completo
di riscaldamento generale, mobilità, riabilitazione o preparazione medica.

**Priorità proposta:** P1. **Dimensione:** media. **Dipendenze:** requisiti 1, 6, 7 e 11.

#### Decisione scientifica e limiti delle evidenze

La letteratura giustifica una preparazione specifica, progressiva e non affaticante, ma non
identifica una piramide universale valida per tutte le persone e tutti gli esercizi:

- il consenso internazionale 2026 descrive il warm-up come intervento contestuale e
  individualizzabile, composto da elementi generali e specifici;
- la review specifica sul resistance training trova risultati eterogenei e pochi studi;
- studi su squat, panca, leg press e lat pulldown indicano che avvicinarsi al carico allenante con
  volume contenuto può essere preferibile al solo lavoro molto leggero e voluminoso;
- altri studi non trovano differenze significative fra protocolli o rispetto al non eseguire un
  warm-up specifico;
- i campioni sono soprattutto piccoli gruppi di uomini giovani già allenati e gli esiti sono
  acuti: non dimostrano che una precisa piramide migliori ipertrofia o forza nel lungo periodo;
- non esiste evidenza sufficiente per presentare questo calcolatore come garanzia di prevenzione
  degli infortuni.

Perciò openGym deve chiamare la policy **evidence-informed**, non “scientificamente provata”. Le
percentuali sono una sintesi prudente, versionata e verificabile. Devono poter essere riviste in
una nuova versione senza reinterpretare workout o dati passati.

Le serie suggerite devono restare lontane dal cedimento. La UI indica come guardrail almeno
**4–5 RIR**, nessuna ripetizione lenta o forzata e l'interruzione in caso di dolore o difficoltà
inattesa. L'app non può misurare automaticamente questi segnali e non deve aumentare il carico per
“correggerli”.

#### Policy deterministica proposta: `specific_warmup_v1`

Il calcolo usa il carico allenante corrente `W`, non una stima implicita di 1RM. Il numero di
ripetizioni `R` serve soltanto a scegliere la quantità di ramp-up; non autorizza openGym a
diagnosticare automaticamente “forza” o “ipertrofia”.

| Profilo neutrale | Condizione | Tappe teoriche | Recupero indicativo |
|---|---:|---|---|
| Carico pesante | `R <= 5` | `40% W × 5`, `60% W × 3`, `75% W × 2`, `90% W × 1` | 60 s, 90 s, 120 s; poi 180 s |
| Carico moderato | `R = 6–12` | `40% W × 6`, `60% W × 4`, `80% W × 2` | 60 s, 90 s; poi 120 s |
| Carico leggero/alte reps | `R >= 13` | `50% W × 5`, `75% W × 3` | 60 s; poi 90 s |

I recuperi sono suggerimenti, non modificano né avviano automaticamente il timer openGym. Anche
il vincolo RIR è un guardrail euristico, non una dose universale convalidata.

Invarianti della policy:

1. stesso input e stessa versione producono sempre lo stesso piano;
2. i carichi sono strettamente crescenti dopo la normalizzazione;
3. nessuna tappa può essere uguale o superiore a `W`;
4. le ripetizioni non aumentano salendo di carico;
5. non vengono prodotti numeri negativi, `NaN` o infiniti;
6. le tappe duplicate dopo l'arrotondamento vengono fuse, conservando il numero di ripetizioni
   più alto necessario per la prima tappa equivalente;
7. se la granularità dell'attrezzo rende inutile una piramide, vengono mostrate meno tappe;
8. se non esiste alcun carico inferiore a `W`, non viene inventata una tappa: la UI spiega che il
   carico allenante è già il minimo praticabile;
9. una tappa non componibile non modifica mai la serie allenante.

Esempio normativo:

```text
Panca piana — prossima serie allenante: 100 kg × 8
Bilanciere: 20 kg

1. 6 rip. · 40% · totale 40 kg · 10 kg per lato
2. 4 rip. · 60% · totale 60 kg · 20 kg per lato
3. 2 rip. · 80% · totale 80 kg · 30 kg per lato
──────────────────────────────────────────────────
Serie allenante · totale 100 kg · 40 kg per lato
```

#### Sorgente autoritativa del calcolo

Il piano appartiene alla specifica entry del workout attivo. Non deve mai cercare il carico dal
record globale del solo `exerciseId`, da `exWeights` o da una sessione di un'altra routine.

La destinazione predefinita è la **prima serie prescritta non completata**, risolta con l'identità
dello slot e il numero di serie prescritte. Le serie opzionali aggiunte durante Confirmed
Rep-Range non diventano automaticamente la destinazione quando il blocco prescritto è già
terminato.

Input autoritativi:

- `routineExerciseId`/entry attiva e relativo snapshot target;
- peso e ripetizioni attualmente visibili nella serie di destinazione;
- modalità di carico e unità congelate nel workout;
- `active.equipmentSnapshot` ed `entry.equipmentUse`.

Se l'utente modifica manualmente peso o ripetizioni prima della serie, il popup ricalcola il
piano e dichiara sempre l'input usato. Se le serie future hanno carichi differenti, mostra quale
serie è la destinazione e non seleziona silenziosamente il massimo. Duplicati dello stesso
esercizio, routine diverse e giornate diverse restano isolati tramite l'entry corrente.

#### Attrezzatura, arrotondamento e carico per lato

Ogni tappa teorica deve riusare il resolver e il solver dell'attrezzatura esistenti, senza
duplicare formule in un nuovo componente.

- **Bilanciere simmetrico:** il target è il peso totale comprensivo della tara; per lato vale
  `(totale - tara) / 2`.
- **Bilanciere senza inventario dischi:** mostra comunque totale, tara e peso matematico per lato;
  la composizione resta manuale e la UI non dichiara che il valore sia esattamente componibile.
- **Bilanciere con inventario:** scegliere il massimo carico componibile non superiore alla tappa
  teorica e mostrare la composizione deterministica per lato.
- **Tappa teorica sotto tara:** usare l'attrezzo vuoto soltanto se resta inferiore a `W`, poi
  eliminare eventuali duplicati.
- **Manubrio fisso:** `W` conserva la semantica già decisa di peso del singolo manubrio; mostrare
  per esempio `2 × 20 kg` e, separatamente, `40 kg totali esterni`.
- **Manubrio caricabile:** mostrare tara del singolo manico e carico per ciascun lato del singolo
  manubrio, oltre alla quantità da preparare.
- **Pacco pesi:** scegliere un valore disponibile non superiore alla tappa teorica.
- **Macchina plate-loaded:** rispettare tara e uno/due punti di carico dello snapshot.
- **Attrezzo custom o mapping assente:** mostrare il target teorico e la spiegazione manuale,
  senza inventare un carico per lato.
- **Unità discordanti:** non convertire automaticamente kg e lb; mostrare un avviso e omettere la
  composizione pratica.

Quando esiste un inventario, la preferenza per il valore inferiore limita l'affaticamento e rende
il risultato riproducibile. Quando l'inventario non esiste, il desiderio dell'utente di comporre
i dischi manualmente è rispettato: resta disponibile il calcolo aritmetico per lato.

#### Casi non calcolabili in modo sicuro nella v1

- corpo libero puro: non si assume che il peso corporeo equivalga al carico meccanico del gesto;
- corpo libero zavorrato o esercizio assistito: la sola zavorra non rappresenta in modo affidabile
  una percentuale del carico totale;
- bande elastiche: la resistenza non è un peso costante;
- cardio, serie a tempo, peso nullo o target senza ripetizioni;
- configurazione con semantica del carico ambigua.

In questi casi openGym non genera chilogrammi fittizi. Mostra una spiegazione breve oppure non
mostra l'azione finché non esiste un adattatore specifico sicuro.

#### UX/UI del popup

- Azione secondaria con icona e testo visibile **Riscaldamento** dentro l'esercizio attivo.
- Apertura in una bottom sheet coerente con il resto dell'app; nessun popup automatico.
- Header con nome esercizio e `Calcolato sulla prossima serie: W × R`.
- Elenco verticale: numero tappa, reps, percentuale, teorico, praticabile e istruzione di carico.
- Serie allenante separata graficamente e mai confusa con una tappa preparatoria.
- Disclosure **Come viene calcolato** con sintesi della policy, limiti e fonti.
- Avvisi testuali, non affidati solo a colore o icona.
- Etichette complete su più righe: nessun `...` che nasconda totale, per lato o tara.
- Dialog nominato, focus confinato e restituito al trigger, chiusura con Escape/Indietro e layout
  senza overflow a 320 px e con reflow 200%.

L'app non deve dedurre che l'utente sia già riscaldato in base all'ordine, al nome o ai muscoli
dell'esercizio: openGym non possiede oggi una classificazione compound/isolation né una prova
affidabile dello stato di preparazione. Il popup è facoltativo e una futura modalità ridotta deve
essere una scelta esplicita, non un automatismo nascosto.

#### Dati, storico e backward compatibility

Per l'MVP il piano è **derivato e non persistito**. Target, attrezzatura e identità sono già
congelati nell'active workout; a parità di versione, la stessa funzione pura ricostruisce la
stessa guida dopo refresh.

Le tappe di riscaldamento:

- non entrano in `entries[].sets`;
- non modificano volume, PR, stima 1RM, progressione, `topRangeStreak`, recupero adattivo,
  completezza o statistiche;
- non vengono copiate nei workout completati e non costituiscono prova di esecuzione;
- non richiedono campi JSON, migrazioni, modifiche server o riscrittura dello storico;
- non avviano, fermano o azzerano automaticamente timer e recuperi.

La policy deve avere una costante di versione nel codice e test golden dedicati. Se in futuro si
vorrà registrare l'esecuzione reale, servirà un array distinto `warmupSets` con snapshot/versione,
sempre escluso dagli algoritmi delle serie allenanti. Questa estensione non appartiene alla v1.

#### Criteri di accettazione

1. Il popup è richiamabile dall'esercizio attivo senza modificare serie o timer.
2. Il target dichiarato coincide con la prima serie prescritta non completata dello specifico
   slot nel workout attivo.
3. Modificare manualmente quel peso o le reps produce un nuovo piano coerente alla riapertura.
4. Percentuali, reps e recuperi coincidono con `specific_warmup_v1`.
5. Le tappe sono deterministiche, crescenti, deduplicate e sempre inferiori al target.
6. `100 kg × 8` con bilanciere da 20 kg produce 40/60/80 kg totali e 10/20/30 kg per lato.
7. Senza dischi censiti continua a mostrare il valore numerico per lato.
8. Con inventario usa soltanto combinazioni disponibili e arrotonda per difetto.
9. Target vicino alla tara comprime il piano senza valori negativi o serie duplicate.
10. Il peso del manubrio resta per singolo manubrio; la quantità è mostrata separatamente.
11. Pacco pesi e macchine non mostrano impropriamente “per lato”.
12. Kg e lb restano separati; nessuna conversione silenziosa.
13. Corpo libero, bande, cardio e configurazioni ambigue non producono valori inventati.
14. Cambiare profilo nelle Impostazioni durante il workout non cambia lo snapshot usato.
15. Stesso esercizio in routine, giorni o slot diversi usa sempre la propria entry attiva.
16. Aprire/chiudere il popup non altera input non salvati, focus, timer o stato dell'esercizio.
17. Il piano non cambia progressione, PR, volume, recupero o outcome Confirmed Rep-Range.
18. JSON e workout legacy restano leggibili senza migrazione.
19. Il popup è comprensibile con tastiera/screen reader e a 320 px in entrambi i temi.
20. La guida di riscaldamento e la guida attrezzatura esistente non possono dare istruzioni
    contraddittorie per lo stesso carico.
21. Quando il carico praticabile differisce da quello teorico, il popup mostra entrambi e spiega
    l'arrotondamento senza modificare il target allenante.

#### Test richiesti

- unit test golden per tutte le soglie `R` e per i valori al confine 5/6/12/13;
- property test su determinismo, monotonicità, deduplica, numeri finiti e carichi `< W`;
- kg/lb, decimali, carichi minimi, pareggi e target sotto/vicino alla tara;
- tutti i tipi di attrezzatura, con/senza inventario e con inventario insufficiente;
- mapping assente, semantica manuale, unit mismatch e limite del solver;
- modifica manuale di peso/reps e serie future a carichi differenti;
- sole serie opzionali residue dopo il blocco prescritto;
- stesso esercizio in routine/giorni/slot differenti e duplicati nella stessa routine;
- profilo modificato prima, durante e dopo l'avvio del workout;
- test espliciti di non mutazione per set, storico, progressione, PR, volume e recupero;
- fixture legacy, refresh dell'active workout, build e sincronizzazione delle 11 locale;
- tastiera, screen reader, focus restore, temi, reflow 200% e viewport 320–640 px;
- gate manuale su dispositivo fisico e CasaOS/Docker.

File probabili: nuovo `frontend/src/lib/warmup.js` con relativo test, nuovo componente
`frontend/src/components/WarmupGuide.jsx`, `frontend/src/views/Workout.jsx`, `frontend/src/sheets.jsx`,
`frontend/src/lib/equipment-load.js`, `frontend/src/lib/workout-set-status.js`, `frontend/src/index.css`,
tutte le locale e i test di integrazione del lifecycle workout.

### 5.14 Richiesta del peso corporeo configurabile all'avvio

#### Stato dell'implementazione

**Completato** nella revisione `1963555`.

Nelle Impostazioni, sezione `Avvio allenamento`, lo switch `Richiedi il peso corporeo` controlla
il check-in mostrato prima di un nuovo workout:

- attivo: mantiene il comportamento storico e apre il popup bloccante;
- disattivo: avvia subito sia una routine pianificata sia un workout libero;
- riattivato: il popup torna dal workout successivo;
- la registrazione manuale del peso rimane sempre disponibile;
- saltare il popup non aggiunge, elimina o sostituisce misurazioni e salva `bw: null` nello
  snapshot del nuovo workout.

La preferenza `askBodyweightBeforeWorkout` appartiene allo stato sincronizzato. I profili e i
backup legacy che non contengono il campo ricevono `true`, così l'aggiornamento non modifica
silenziosamente il flusso esistente. Un `false` esplicito sopravvive a storage, backup, sync,
refresh e restart insieme alle altre impostazioni del profilo.

Evidenze principali: `frontend/src/store/useStore.js`, `frontend/src/views/Settings.jsx`,
`frontend/src/sheets.jsx`, `frontend/src/views/Home.jsx`, tutte le locale,
`frontend/src/lib/state-storage.test.js`, `frontend/src/views/Settings.test.jsx` e
`frontend/src/workout-lifecycle.integration.test.jsx`.

Scenari automatici validati: default legacy attivo, opt-out persistito, accessibilità dello
switch, avvio immediato routine/freestyle, nessuna mutazione delle misurazioni e riattivazione del
popup. Il gate manuale residuo è la verifica del flusso su dispositivo/CasaOS reale.

### 5.15 Funzionamento offline e sincronizzazione alla riconnessione

#### Stato attuale e rischio

**Non completato. Analisi pronta; sviluppo non autorizzato.**

openGym possiede già alcune fondazioni utili:

- lo stato applicativo e l'allenamento attivo vengono salvati in `localStorage`;
- il boot conserva la copia locale quando l'API non è raggiungibile;
- un service worker applica runtime cache alle risorse già visitate ed esclude correttamente le API;
- un push fallito imposta il flag booleano `gym_dirty`;
- la build mobile standalone è local-only e non dipende dal server.

Queste fondazioni permettono spesso di continuare in una scheda già aperta, ma non costituiscono
una modalità offline affidabile. L'audit ha rilevato i seguenti problemi:

1. il service worker non precachea l'app shell, quindi una riapertura a freddo con l'intero host
   fermo non è garantita;
2. non esistono probe dell'API, retry periodici con backoff o un trigger affidabile quando torna
   disponibile soltanto il server; l'evento browser `online` da solo non copre questo caso;
3. client e server si scambiano l'intero JSON con un `PUT` cieco, senza revisione, precondizione,
   idempotenza o merge;
4. `_ts` proviene dall'orologio del client e applica un last-write-wins globale: clock skew e due
   dispositivi possono causare perdita silenziosa di workout, routine o impostazioni;
5. richieste sovrapposte non sono serializzate e una risposta vecchia può cancellare il dirty flag
   di modifiche più recenti;
6. `gym_dirty` indica soltanto che esiste una differenza, non quale generazione sia stata
   confermata dal server;
7. il logout normale può eliminare la copia locale anche quando il push offline non è riuscito;
8. le chiavi locali non sono separate per account e possono contaminare due profili usati nello
   stesso browser;
9. una modifica del solo `active` genera oggi traffico e timestamp server anche se `active` viene
   poi rimosso dal payload persistito;
10. errori di rete, timeout, `401`, conflitto e storage pieno non hanno stati UX distinti.

Il rischio non è soltanto di usabilità: oggi un dispositivo rimasto offline può tornare online e
sovrascrivere integralmente dati più recenti presenti sul server. Per questo la priorità proposta
è **P0**, da validare prima di cambiare l'ordine di sviluppo già approvato.

#### Scope e limiti della prima release

Il requisito riguarda la web app/PWA self-hosted già aperta e autenticata almeno una volta sul
dispositivo. Durante un'assenza di rete, della sola API o dell'intero stack, il dispositivo già
inizializzato deve poter:

- aprire l'app da cold start quando l'app shell è stata installata in un contesto sicuro;
- consultare routine, catalogo testuale, storico, attrezzatura e impostazioni locali;
- iniziare, aggiornare, terminare o scartare un workout;
- registrare peso corporeo e modificare routine/configurazioni;
- ricaricare o chiudere l'app senza perdere l'allenamento attivo o le modifiche locali;
- esportare un backup locale;
- capire se i dati sono soltanto locali, in attesa, sincronizzati o in conflitto;
- sincronizzare automaticamente e senza duplicati quando l'API torna disponibile.

Restano esplicitamente fuori scope:

- primo accesso assoluto, registrazione e login con passkey senza server;
- Web Push o avvisi remoti mentre il server non è disponibile;
- sincronizzazione live del timer o dell'allenamento attivo tra dispositivi, che resta nel punto
  2B; la persistenza esatta del countdown dopo refresh resta nel punto 2A;
- precache dei circa 140 MB di immagini/animazioni: un media mai scaricato può mostrare un
  placeholder senza bloccare il workout;
- provider Withings/Polar, pannello amministratore offline e replica server multi-nodo;
- sync della build mobile standalone, oggi intenzionalmente local-only.

Il cold start PWA richiede un secure context. Su CasaOS aperto da telefono tramite semplice
`http://IP:porta` il browser non consente normalmente il service worker: l'app può continuare in
una scheda già aperta, ma la riapertura con il frontend spento non può essere promessa. La release
deve quindi documentare e verificare HTTPS tramite reverse proxy/certificato; `localhost` va
riconosciuto tramite `window.isSecureContext`, non con il solo controllo del protocollo.

#### Alternative valutate

| Soluzione | Vantaggi | Svantaggi | Decisione |
|---|---|---|---|
| Snapshot intero + `_ts` attuale | Minimo codice | Perde aggiornamenti, dipende dal clock, nessun conflitto spiegabile | **Scartata** |
| Solo listener `online` o Background Sync | Semplice e utile come ottimizzazione | Non rileva API down con rete attiva e non è supportato uniformemente | **Insufficiente** |
| Event sourcing/outbox di comandi di dominio | Merge e audit molto robusti | Richiede trasformare numerosi mutatori generici e ampliare molto la release | **Evoluzione futura** |
| CRDT per tutto lo stato | Convergenza distribuita | Complessità e semantica eccessive per dati con cancellazioni e conflitti di dominio | **Scartata** |
| Snapshot locale + revisione server CAS + merge a tre vie | Evita overwrite, riusa gli ID esistenti, rollout compatibile e verificabile | Richiede base snapshot e UX conflitti | **Raccomandata** |

La soluzione raccomandata è la più piccola che impedisce la perdita silenziosa senza riscrivere
subito tutti i mutatori come eventi. Background Sync può essere aggiunto, ma la correttezza non
deve dipendere dalla sua disponibilità.

#### Modello locale e protocollo raccomandati

La copia locale diventa la replica operativa. Una modifica è `salvata su questo dispositivo` solo
dopo una scrittura locale riuscita; è `sincronizzata` soltanto dopo l'ack del server per quella
precisa generazione.

Metadati locali, separati dal JSON di dominio e dai backup utente:

```json
{
  "syncProtocol": 1,
  "userId": "user-id",
  "deviceId": "stable-device-id",
  "localGeneration": 42,
  "acknowledgedGeneration": 39,
  "baseServerRevision": 17,
  "baseSnapshot": {},
  "pendingSnapshotHash": "sha256:...",
  "lastSyncAt": 1787742000000,
  "status": "pending"
}
```

Il nuovo storage deve essere namespaced per `userId`, con uno spazio guest separato. La base
snapshot può vivere in IndexedDB per non duplicare l'intero profilo nella quota ridotta di
`localStorage`. L'adozione completa di IndexedDB come storage transazionale è preferibile se i
test dimostrano che il cambio di hydration non regredisce l'avvio; in alternativa la prima fase
può usare un envelope locale atomico e versionato, mantenendo `gym_state_v1` come sorgente di
migrazione. In entrambi i casi:

- il dirty/pending deve essere durevole prima che la UI confermi il salvataggio;
- le mutazioni devono essere serializzate;
- un ack può pulire soltanto le generazioni incluse nella richiesta confermata;
- una modifica nata durante un push resta pending;
- quota o storage negato devono produrre un errore bloccante, mai una falsa conferma;
- il cambio account non può riassegnare dati pendenti a un altro utente;
- `active` resta device-local e una modifica soltanto ad `active` non incrementa la revisione
  server; il workout concluso entra invece nello stato sincronizzabile una sola volta.

Contratto server proposto:

```json
GET /api/data
{
  "syncProtocol": 1,
  "revision": 17,
  "state": {}
}

PUT /api/data
{
  "syncProtocol": 1,
  "baseRevision": 17,
  "clientId": "stable-device-id",
  "mutationId": "stable-retry-id",
  "state": {}
}
```

Il server assegna una revisione monotona per utente e accetta il `PUT` solo quando
`baseRevision` coincide con quella corrente, tramite `If-Match`/ETag o campo equivalente. Una
base obsoleta restituisce `412 Precondition Failed` con la revisione corrente; un
`mutationId` già applicato restituisce lo stesso ack senza duplicare né incrementare di nuovo la
revisione. `401` richiede riautenticazione, `413` segnala il limite payload, gli errori di
validazione non vengono ritentati all'infinito e i `5xx`/timeout restano transienti.

Il file server per utente può evolvere da stato raw a envelope
`{schemaVersion, revision, state, recentMutationIds}` con scrittura atomica. Un JSON legacy viene
letto come revisione zero e aggiornato pigramente, senza migrazione manuale né modifica dei workout
contenuti. Reader amministrativi e reminder devono leggere entrambi i formati. Client PWA legacy
privi di precondizione non devono poter aggirare il controllo: il vecchio `PUT` va rifiutato in
modo sicuro durante il rollout, conservando la copia locale finché il client non si aggiorna.

`_ts` resta leggibile per compatibilità storica, ma non decide più precedenza o conflitti.

#### Merge deterministico e conflitti

Quando il server risponde con una revisione più recente, il client calcola un merge puro a tre vie:

```text
merge(base confermata, copia locale, copia server)
```

Regole generali:

- se solo un lato differisce dalla base, vince quella modifica;
- se entrambi producono lo stesso valore, il valore viene accettato;
- modifiche su campi, record o chiavi differenti vengono unite;
- la stessa entità/campo modificata diversamente genera un conflitto esplicito;
- cancellazione contro copia invariata conferma la cancellazione;
- cancellazione contro modifica concorrente genera conflitto e non resuscita dati in silenzio;
- `_ts` viene ignorato/rigenerato e `active` non entra mai nel merge remoto;
- ordine di arrivo, clock del device e “ultimo JSON ricevuto” non risolvono conflitti.

| Area | Chiave/strategia | Conflitto |
|---|---|---|
| Workout conclusi | `workout.id`, union e ordinamento deterministico | stesso ID con contenuto diverso |
| Peso corporeo | data `d`/ID normalizzato | stessa data modificata diversamente |
| Routine | `routine.id`, slot tramite `routineExerciseId` | stesso campo/ordine divergente |
| Attrezzatura | ID profilo e item | stessa entità modificata o delete/edit |
| Esercizi custom | ID stabile | stessa entità modificata o delete/edit |
| `week` / `dayPlan` | giorno settimana / data ISO | stessa chiave divergente |
| Preferenze | merge campo per campo | stesso campo con due valori |
| Pesi/progressione | chiave di progressione | stessa chiave divergente |

Gli elementi nuovi con ID diversi convergono automaticamente. Le cancellazioni sono rilevate
confrontando la base; eventuali tombstone diventano necessarie soltanto se in futuro si passa a un
log di operazioni o si elimina la base snapshot. In caso di conflitto openGym conserva entrambe le
copie fino alla decisione dell'utente e permette prima di scaricare i due JSON.

#### Trigger e stato UX

La sincronizzazione viene tentata dopo hydration/boot, dopo una mutazione sincronizzabile, al
ritorno in foreground, su evento `online`, dopo una nuova autenticazione e tramite
`Sincronizza ora`. Finché esistono dati pending deve esistere anche un retry temporizzato con
backoff esponenziale e jitter, perché il server può tornare disponibile senza alcun cambio della
rete del browser. Un timeout esplicito impedisce richieste bloccate indefinitamente.

Stati minimi visibili e accessibili:

- `Offline — modifiche salvate su questo dispositivo`;
- `N modifiche da sincronizzare`;
- `Sincronizzazione in corso`;
- `Sincronizzato alle HH:MM`;
- `Conflitto da risolvere`;
- `Accesso richiesto per sincronizzare`;
- `Salvataggio locale non riuscito`.

Durante un workout lo stato resta compatto e non apre modal bloccanti. I conflitti vengono
risolti dopo l'allenamento con una vista per categoria/entità e le scelte `Questo dispositivo` o
`Server`; le modifiche non sovrapposte sono già unite. `navigator.onLine` è soltanto un indizio:
la fonte di verità è una richiesta API riuscita.

Logout, cambio profilo, reset e cancellazione cache con dati pending devono offrire
`Riprova sincronizzazione`, `Esporta copia locale` o una conferma esplicitamente distruttiva.
Una sessione scaduta conserva dati e coda, chiede l'accesso allo stesso account e non li associa
mai automaticamente a un profilo differente.

#### Requisiti funzionali verificabili

1. **RF-15.1 — Cold start:** dopo almeno una installazione online riuscita in secure context,
   l'app shell parte con frontend/API non raggiungibili.
2. **RF-15.2 — Local-first:** ogni azione supportata viene resa durevole localmente prima della
   conferma visiva.
3. **RF-15.3 — Continuità workout:** active workout e set sopravvivono a refresh/riapertura; il
   workout terminato viene sincronizzato una volta sola.
4. **RF-15.4 — Reconnect:** il ritorno dell'API attiva automaticamente la sincronizzazione anche
   se il browser è rimasto sempre online.
5. **RF-15.5 — Concorrenza:** nessun client può sovrascrivere una revisione server non letta.
6. **RF-15.6 — Idempotenza:** timeout, retry, crash o risposta persa non duplicano workout/pesate.
7. **RF-15.7 — Merge:** cambi non sovrapposti convergono; cambi incompatibili richiedono una scelta.
8. **RF-15.8 — Account:** storage, base e pending sono isolati per utente e dispositivo.
9. **RF-15.9 — Auth:** un `401` conserva i dati e richiede riautenticazione.
10. **RF-15.10 — Logout sicuro:** nessuna uscita elimina modifiche pending implicitamente.
11. **RF-15.11 — Stato spiegabile:** la UI distingue salvataggio locale, pending, sync e conflitto.
12. **RF-15.12 — API fuori cache:** service worker e cache non conservano risposte utente/API.
13. **RF-15.13 — Media degradabili:** media assenti mostrano placeholder senza bloccare il core.
14. **RF-15.14 — Legacy:** vecchi JSON client/server restano leggibili e vengono aggiornati
    progressivamente senza riscrivere workout terminati.
15. **RF-15.15 — Backup:** export/import contiene lo stato di dominio, non revisioni, device ID,
    base snapshot o coda; un import diventa una nuova modifica locale esplicita.
16. **RF-15.16 — Storage failure:** quota/corruzione/permesso negato non produce mai un falso
    `salvato` o `sincronizzato`.
17. **RF-15.17 — Singola replica server:** la prima versione documenta il vincolo; più processi
    richiedono database/lock esterno e non sono dichiarati supportati.

#### Test obbligatori prima del rilascio

- unit: state machine, backoff/timeout, serializzazione richieste, generazioni/ack fuori ordine,
  canonicalizzazione che esclude `active`, `_ts` e metadati sync;
- unit/property: matrice merge a tre vie, replay idempotente, delete/edit, ordini array e clock
  avanti/indietro;
- backend: lettura legacy come revisione zero, ETag/CAS, due `PUT` simultanei con un solo vincitore,
  retry dello stesso `mutationId`, auth/isolamento utente, limiti payload e disk error senza ack;
- integrazione: app/API giù, workout completo offline, refresh/force-close, reconnect senza evento
  `online`, risposta persa dopo commit e modifica locale durante una richiesta;
- multi-client: due workout distinti conservati, impostazioni/routine disgiunte unite, stesso campo
  in conflitto, delete-vs-edit, due tab e cambio account;
- auth/safety: sessione scaduta, utente disabilitato, logout con pending, export prima di discard;
- service worker: installazione e update atomici, app shell/locale disponibili, navigation fallback,
  nessuna API in cache, media mancante degradato a placeholder;
- persistenza: restart Docker/CasaOS senza rimozione volume conserva stato, revisione e deduplica;
- browser/accessibilità: stato sync a 320 px/reflow 200%, tastiera, screen reader, nessun modal
  durante il workout;
- no-regression completa: test frontend/backend, build, locale, import/export, progressione,
  attrezzatura, timer esistente e JSON legacy.

Scenari manuali minimi replicabili:

1. caricare e installare la PWA online, fermare solo l'API, completare un workout, riavviare l'API
   e verificare l'arrivo automatico dei dati;
2. fermare l'intero stack, chiudere e riaprire la PWA via HTTPS, completare un workout, riavviare
   Docker e verificare sync e storico;
3. modificare offline su A e online su B due entità differenti: entrambe devono restare;
4. modificare lo stesso campo su A e B: deve apparire un conflitto, non un overwrite;
5. perdere la risposta dopo l'applicazione server e ritentare: revisione e workout non raddoppiano;
6. scadere la sessione o tentare logout offline: la copia pending resta recuperabile.

File probabili: `frontend/src/store/useStore.js`, `frontend/src/lib/api.js`, nuovi moduli
`sync-state.js`, `sync-merge.js` e `sync-storage.js`, `frontend/src/App.jsx`, nuovo componente
`SyncStatus.jsx`, `frontend/src/views/Settings.jsx`, `frontend/src/main.jsx`, sorgente/build del
service worker, `api/server.js` o un nuovo modulo sync, reader amministrativi, locale, test e
script browser/Docker dedicati.

Il requisito va consegnato come release autonoma e reversibile. L'inserimento e questa analisi
**non autorizzano alcuna modifica al codice applicativo**.

### 5.16 Ultime quattro sessioni dell'esercizio durante il workout

#### Obiettivo e stato attuale

**Non completato. Analisi pronta; sviluppo non autorizzato.**

Durante l'esercizio openGym mostra già una riga sintetica `Ultima volta`, ricavata tramite
`lastEntryFor()`. L'informazione è utile ma non permette di capire l'andamento: manca il confronto
fra più esposizioni, non sono visibili obiettivo storico, esito, routine, effort e attrezzatura.

Con un solo tocco l'utente deve poter consultare le ultime **quattro** sessioni precedenti della
stessa progressione e vedere:

- carico realmente registrato in ogni serie;
- serie e ripetizioni, secondi oppure durata/velocità cardio;
- obiettivo congelato in quella sessione;
- RIR o RPE, quando registrati;
- esito della prescrizione;
- data/ora, routine e attrezzo storico disponibili;
- eventuale differenza fra peso eseguito e peso confermato a fine esercizio.

È una vista di sola lettura: non modifica workout passati, sessione attiva, progressione, timer o
sincronizzazione.

#### UX/UI raccomandata

La riga attuale diventa un vero pulsante compatto, senza aggiungere una tabella permanente nella
schermata già densa:

```text
Storico recente · Ultima volta 70 kg: 10 / 10 / 9 / 8   ›
```

Il click apre una bottom sheet verticale e scorrevole:

```text
Ultime sessioni — Panca piana

18 settembre · Push A
Obiettivo: 4 × 10 · 70 kg
Fatto: 70×10 · 70×10 · 70×9 · 70×8
Obiettivo non raggiunto · Bilanciere Decathlon
```

Le card sono al massimo quattro, dalla più recente alla meno recente. Su desktop possono
allargarsi, ma non diventano una tabella orizzontale; a 320 px restano leggibili senza label
troncate. Il solo colore non comunica mai l'esito.

Badge minimi per Confirmed Rep-Range:

- `Riuscita`;
- `Massimo raggiunto — conferma 1 di 2`;
- `Aumento peso maturato`;
- `Obiettivo non raggiunto`;
- `Sessione incompleta`;
- `Carico variato durante le serie`;
- `Esito non determinabile` per snapshot legacy insufficienti.

Per strategie diverse la vista mostra l'esito disponibile senza fingere che seguano le regole
Confirmed. Se non esistono risultati compatibili: `Nessuna sessione precedente per questa
progressione`.

La sheet non ferma il recupero o il timer di lavoro, non sposta l'esercizio corrente, non effettua
chiamate di rete e restituisce il focus al pulsante di apertura quando viene chiusa.

#### Identità e selezione dello storico

La chiave autoritativa è il `progressionId` congelato nell'entry attiva:

- il solo `exerciseId` contaminerebbe routine/istanze indipendenti;
- il solo `routineExerciseId` separerebbe routine che condividono intenzionalmente la stessa
  progressione;
- il solo `routineId` non gestirebbe duplicati e gruppi condivisi.

L'helper deve riusare `findWorkoutProgressionEntry()` e scorrere i workout al contrario fino a
quattro corrispondenze, senza introdurre un secondo algoritmo di associazione. Il nome della
routine resta sempre visibile, così una sessione proveniente da un gruppo condiviso non appare
come un'intrusione.

Regole:

- stesso esercizio con `progressionId` diversi: storico separato;
- stessa progressione condivisa fra routine compatibili: entrambe incluse;
- esercizio duplicato nella stessa routine/workout: soltanto l'occorrenza corretta;
- sessione attiva: mai inclusa;
- configurazione modificata dopo lo start: la vista continua a usare l'identità congelata;
- cambio fra corpo libero puro, zavorra e carico esterno: si rispettano i confini già adottati;
- serie opzionali: mostrate come tali, senza cambiare l'esito delle serie prescritte.

Le serie effettive sono la fonte principale; `topW` può apparire separatamente come
`Peso confermato`, ma non sostituisce ciò che è stato registrato. Per Confirmed va riusato
`confirmedRepRangeSession()`. Per le altre modalità si può riusare `readSession()` soltanto se lo
snapshot storico è sufficiente: non si giudica un vecchio workout con la configurazione corrente.

#### Legacy, dati e performance

Non servono nuovi campi persistenti. I dati esistono già in `S.workouts`, entry, target, set,
identità di progressione, timestamp ed equipment snapshot.

I workout precedenti alle identità stabili restano leggibili:

- se routine e posizione rendono l'attribuzione univoca, vengono associati;
- se rimangono una baseline condivisa non attribuibile, la UI lo dichiara come
  `Storico precedente alla separazione delle progressioni`;
- nessun workout viene riscritto o migrato;
- un obiettivo assente rimane `non determinabile`.

L'apertura esegue un solo scan inverso O(numero workout), si ferma a quattro risultati e non gira
a ogni tick del timer. La funzione usa lo stato locale, quindi opera anche offline e non aggiunge
endpoint o dati sincronizzati.

#### Requisiti funzionali e test

1. un click dall'esercizio attivo apre da zero a quattro sessioni precedenti, ordinate dalla più
   recente;
2. mostra valori eseguiti e target storici, mai una ricostruzione con la routine odierna;
3. gruppi indipendenti non si contaminano e gruppi condivisi sono esplicitamente riconoscibili;
4. reps, corpo libero, zavorra, time, cardio, unilateralità e RIR/RPE sono formattati correttamente;
5. incomplete, mixed load e legacy non vengono trasformate in successi;
6. timer, wake lock, serie, navigazione e stato globale non vengono mutati;
7. eliminando un workout, esso scompare dalla successiva apertura;
8. il dialog è accessibile con pulsante reale, target tattile di almeno 44 px, titolo associato,
   focus trap, Escape, pulsante Chiudi e focus restore.

Test unitari: 0/1/4/>4 risultati, ordinamento, scope indipendente/condiviso, duplicati nella stessa
routine, attribuzione legacy, cambio load mode, target insufficiente, tutti gli outcome Confirmed,
modalità reps/time/cardio, bodyweight, zavorra, effort e distinzione set/`topW`.

Test integrazione/UI: lunedì e giovedì con stesso esercizio ma scope diversi, routine compatibili,
apertura durante entrambi i timer, refresh, offline, routine storica rinominata/eliminata, custom
exercise eliminato, aggiornamento locale mentre la sheet è aperta, immutabilità dello stato,
320 px/reflow 200%, tastiera, screen reader, temi e suite completa di progressione/lifecycle.

File probabili: nuovo `frontend/src/lib/exercise-session-history.js`, relativo test,
`frontend/src/views/Workout.jsx`, nuovo componente o `frontend/src/sheets.jsx`,
`frontend/src/lib/progression-scope.js`, `progression.js`, `history.js`, eventualmente
`frontend/src/components/Modals.jsx` per l'accessibilità condivisa, CSS, locale e script browser.

### 5.17 Rilevazione dello stallo Confirmed e riduzione controllata del carico

#### Decisione scientifica e limite dell'automazione

**Non completato. Analisi pronta; sviluppo non autorizzato.**

Non esiste in letteratura una soglia validata del tipo “dopo esattamente N sessioni riduci il
carico del X%”. È difficile distinguere un plateau reale da una flessione breve; gli studi diretti
sul deload sono pochi e riguardano soprattutto volume, frequenza o interruzione, non il rollback
automatico di un singolo esercizio.

Sono invece ragionevolmente supportati questi principi:

- la progressione può avvenire aumentando ripetizioni oppure carico; non aumentare subito il peso
  non significa essere bloccati;
- arrivare sempre al cedimento non offre benefici consistenti e aumenta la fatica acuta;
- autoregolazione e dati di più esposizioni sono preferibili a una singola giornata negativa;
- RIR/RPE sono utili ma soggettivi e non dimostrano da soli una tecnica pulita;
- un deload riduce lo stress di allenamento e va individualizzato; non esiste una percentuale
  universale;
- prima di dichiarare uno stallo bisogna lasciare stabilizzare il recupero adattivo già presente.

La v1 deve quindi essere un **assistente decisionale**, mai un decremento silenzioso. openGym può
rilevare una mancata progressione numerica; soltanto l'utente può dichiarare che le ripetizioni
erano tecnicamente compromesse.

#### Stato attuale dell'algoritmo

Confirmed Rep-Range oggi:

- aumenta il target dopo una sessione riuscita e valida anche livelli superiori dimostrati da
  tutte le serie;
- richiede due conferme al massimo prima di aumentare peso e ripartire dal minimo;
- se una serie successiva fallisce dopo una prima serie riuscita, aumenta il recupero di 30 secondi;
- su qualsiasi fallimento mantiene carico/target indefinitamente;
- non usa il `stallCount` o il deload generico di Linear/Double;
- accetta già un carico manuale uniforme come nuova baseline, ma non dispone di un'epoca di
  regressione esplicita;
- non possiede un dato sulla qualità tecnica.

Applicare direttamente la regola generica “tre miss, −10%” sarebbe scorretto: confonderebbe
incomplete, mixed load, recupero ancora in adattamento, target/configurazioni differenti e
istanze omonime.

#### Policy proposta: `confirmed_stall_assistant_v1`

Una sessione è comparabile soltanto se:

- appartiene allo stesso `progressionId` e alla stessa `progressionKey` congelata;
- usa stesso carico uniforme, target, numero di serie, rep-range e load mode;
- tutte le serie prescritte sono concluse;
- non è legacy, incomplete, mixed load o modificata manualmente in modo non uniforme;
- il recupero prescritto è stabile nella finestra;
- attrezzatura e semantica del carico sono comparabili;
- non è terminata per dolore, malessere, tempo o problema attrezzatura.

Un successo, un cambio di carico/target/range/serie/load mode, un intervento manuale o una modifica
del recupero apre una nuova finestra. Serie opzionali sono neutrali. Una lunga pausa rende
l'evidenza informativa ma non deve produrre automaticamente un avviso.

Lo score prestazionale deriva solo dalle serie prescritte:

```text
1. livello minimo pulito dimostrato da tutte le serie
2. numero di serie che raggiungono il target
3. somma delle ripetizioni, con ogni serie limitata al target
```

Lo score è confrontato in quest'ordine. Un miglioramento reale apre una nuova osservazione anche
se il target completo non è ancora raggiunto.

Stati proposti:

| Evidenza comparabile | Stato | Comportamento |
|---|---|---|
| 1 sessione senza progresso | Variabilità normale | Mantieni prescrizione, nessun allarme |
| 2 sessioni consecutive senza progresso | Da osservare | Indicatore discreto e accesso ai dettagli |
| 3 sessioni consecutive senza progresso | Possibile stallo numerico | Proposta di regressione, mai applicazione automatica |
| 1 tecnica compromessa dichiarata | Avviso tecnico | Suggerisce di privilegiare esecuzione/valutazione |
| 2 tecniche compromesse consecutive | Possibile stallo tecnico | Proposta di regressione confermabile |

Le soglie `3` e `2` sono una scelta prudenziale di prodotto, non una prescrizione dimostrata da
uno studio. Devono essere costanti versionate, testate e spiegate all'utente.

Caso speciale post-aumento: se il nuovo peso non permette di completare neppure il minimo del
range in due esposizioni comparabili, la proposta è tornare all'ultimo peso riuscito. Anche questa
è una policy conservativa di prodotto e richiede conferma.

#### Interazione con recupero, tecnica e dolore

Se la prima serie raggiunge il target, le successive no e il recupero può ancora aumentare, ha
priorità la strategia di recupero. Ogni nuovo valore di recupero azzera la finestra di confronto.
La riduzione viene proposta soltanto dopo insuccessi con recupero stabile, normalmente già al
massimo, oppure quando il problema compare fin dalla prima serie e non è spiegabile dal recupero
intra-sessione.

Alla fine dell'esercizio, senza imporre un campo per ogni set, la UI può raccogliere:

```text
Qualità delle ripetizioni
[ Pulita ]  [ Compromessa ]  [ Non valutata ]
```

Valori proposti: `clean`, `degraded`, `unknown`; l'assenza equivale sempre a `unknown`, mai a
`clean`. RIR/RPE restano evidenza accessoria. Una tecnica `degraded` non può convalidare una
progressione Confirmed anche se i numeri raggiungono il target; apre l'outcome esplicito
`technique_failed` senza fingere che sia un normale miss di recupero.

Il dolore non è uno stallo e non deve produrre una prescrizione algoritmica: l'app invita a
interrompere e, se opportuno, rivolgersi a un professionista. Non formula diagnosi.

#### Quanto ridurre e come applicarlo

Ordine della proposta:

1. se esiste un aumento appena non consolidato, ritorno all'ultimo peso completato con tecnica
   pulita/valutabile nello stesso blocco;
2. altrimenti riduzione orientativa del **7,5%**, arrotondata verso il basso a un carico
   effettivamente selezionabile e comunque di almeno un incremento;
3. se attrezzatura/inventario non permette il 7,5%, mostrare il valore inferiore praticabile e la
   percentuale effettiva; l'utente può mantenere il peso.

Il 7,5% è il punto centrale di un intervallo prudenziale 5–10%, non un numero validato
sperimentalmente. Va mostrato come scelta di prodotto. Il solver attrezzatura suggerisce il
carico praticabile senza modificare il target scientifico/algoritmico in modo nascosto.

Accettare la proposta:

- influenza soltanto i workout futuri;
- apre una nuova epoca di carico per quella progressione;
- imposta il nuovo peso e riporta il target a `minReps`;
- azzera `topRangeStreak` del vecchio carico;
- non cambia recupero, rest epoch, incremento, numero serie, PR globale o workout passati;
- non scrive subito `progressionWeights`: la nuova baseline diventa operativa dopo una sessione
  completa e uniforme;
- impedisce che il vecchio storico più pesante faccia risalire immediatamente la prescrizione.

Corpo libero puro non riceve kg negativi: propone una variante più semplice, assistenza o una
revisione manuale. Nel corpo libero zavorrato si riduce soltanto il sovraccarico. Le macchine
assistite richiedono prima una semantica dedicata, perché un numero maggiore può significare meno
carico effettivo.

#### UX e modello dati

Durante la sessione non compare alcun popup bloccante. Una card compatta usa soltanto workout
precedenti:

```text
Possibile stallo
3 sessioni comparabili senza progresso a 70 kg.
Proposta per il prossimo allenamento: 66 kg · target 8
[Applica dal prossimo allenamento] [Mantieni] [Dettagli]
```

`Dettagli` apre le evidenze, idealmente riusando il requisito 16: risultati, tecnica, recupero,
formula e routine che condividono il `progressionId`. Se il gruppo è condiviso, la conferma deve
dire esplicitamente che la modifica varrà in tutte quelle routine. Un rifiuto sopprime lo stesso
assessment; nuove evidenze possono crearne uno nuovo.

Campi opzionali del nuovo workout:

```json
{
  "review": {
    "technique": "clean | degraded | unknown",
    "failureReason": "performance | technique | pain | equipment | time | null"
  },
  "target": {
    "loadEpochId": "load-epoch-id",
    "stallDetectionVersion": 1
  }
}
```

Controlli persistenti proposti, senza riscrivere lo storico:

```json
{
  "progressionControls": {
    "progression-id": {
      "confirmedRepRangeStall": {
        "assessmentId": "stall-id",
        "status": "proposed | accepted | dismissed | snoozed",
        "evidenceWorkoutIds": [],
        "reason": "numeric_stall | technique_stall | post_increase_failure",
        "fromWeight": 70,
        "proposedWeight": 66,
        "effectiveReductionPercent": 5.7
      },
      "confirmedRepRangeLoad": {
        "epochId": "load-epoch-id",
        "baselineWeight": 66,
        "resetAt": 1787742000000,
        "reason": "stall",
        "sourceWorkoutIds": []
      }
    }
  }
}
```

Il reset è pending finché nessun workout completo e uniforme contiene il nuovo `loadEpochId`;
avvio e discard non lo consumano. Il marker resta poi come confine storico auditabile. I vecchi
JSON senza review/versione rimangono leggibili come `unknown` e non devono generare un prompt
retroattivo: il rilevatore richiede evidenza raccolta dopo l'attivazione della v1.

#### Scenari e test obbligatori

Scenari rappresentativi:

- `9/9/9/9`, poi `10/10/10/10`: progresso, nessuno stallo;
- tre `9/9/9/9` con target 10, stesso carico/rest: proposta numerica;
- `8/8/8/8 → 9/9/9/9 → 9/9/9/9`: il miglioramento riapre la finestra;
- target numerico raggiunto ma tecnica compromessa due volte: proposta tecnica;
- prima serie riuscita, successive fallite, recupero ancora aumentabile: nessuna riduzione;
- 70 → 72 kg, minimo fallito due volte: proposta di ritorno a 70 kg;
- stesso esercizio lunedì/giovedì indipendente: nessuna contaminazione;
- gruppo condiviso: un'unica evidenza e disclosure di tutte le routine.

Test unitari: soglia−1/soglia, progress score, reset su miglioramento/successo/config/rest, outcome
tecnico, `unknown`, pain, incomplete/mixed/legacy/optional, idempotenza assessment, rounding
kg/lb/incrementi/carichi bassi, solver, zavorra e corpo libero puro.

Test integrazione: priorità del recupero adattivo, due conferme al massimo, accetta/rifiuta/snooze,
applicazione solo futura, target minimo e streak zero, rest invariato, start/discard/finish,
progression weight e PR, scope indipendenti/condivisi/duplicati, cambio range/serie/load mode,
refresh/restart/sync/Docker down-up, import e JSON legacy senza prompt retroattivo.

Test UX/accessibilità: card non bloccante, evidenze requisito 16, 320 px/reflow 200%, testi lunghi,
tastiera, screen reader, focus e copy che usa `possibile/suggerita`, mai una certezza medica.

File probabili: nuovo `frontend/src/lib/confirmedRepRangeStall.js`, `progression.js`,
`workout-prescription.js`, `workout-scope.js`, `Workout.jsx`, `sheets.jsx`, eventuale componente
dedicato, attrezzatura/solver, locale fallback e tutte le locale, test unitari/integrativi/browser,
backlog e report di rilascio.

## 6. Modello dati trasversale consigliato

La forma seguente mostra le nuove responsabilità senza imporre una migrazione immediata:

```json
{
  "askBodyweightBeforeWorkout": true,
  "exerciseAliases": {},
  "equipmentProfiles": [],
  "activeEquipmentProfileId": null,
  "routines": [
    {
      "id": "routine-id",
      "ex": [
        {
          "id": "exercise-id",
          "routineExerciseId": "slot-id",
          "progressionId": "slot:slot-id",
          "equipmentUse": {
            "itemId": "bar-main",
            "loadSemantics": "total"
          }
        }
      ]
    }
  ],
  "active": {
    "id": "workout-id",
    "start": 1787742000000,
    "equipmentSnapshot": {},
    "entries": [
      {
        "id": "exercise-id",
        "routineExerciseId": "slot-id",
        "progressionId": "slot:slot-id",
        "target": {},
        "equipmentUse": {}
      }
    ]
  },
  "externalActivities": []
}
```

Il requisito 13 non aggiunge campi a questo schema nella v1: il piano di riscaldamento è una vista
derivata dalla specifica `active.entries[]`, dal suo target e da `equipmentSnapshot`. Un eventuale
futuro tracciamento usa `warmupSets` separato, mai `entries[].sets`.

Anche il requisito 16 è interamente derivato dai workout: non aggiunge cache o copie persistenti
delle quattro sessioni. Il requisito 17 aggiunge soltanto review/marker opzionali e versionati,
descritti nella sua sezione; i record assenti restano `unknown` e nessun vecchio workout viene
riscritto.

Il requisito 15 separa nettamente tre livelli:

1. stato di dominio esportabile e sincronizzabile;
2. `active`, locale al dispositivo;
3. metadati tecnici locali di sync (`deviceId`, revisioni, base snapshot, generazioni e pending),
   esclusi da backup e payload di dominio.

Sul server il file legacy raw resta leggibile come revisione zero; il futuro envelope revisionato
è una responsabilità di persistenza, non un nuovo campo del profilo utente.

Token OAuth/PAT, refresh token e segreti provider non appartengono a questo stato sincronizzato:
devono vivere esclusivamente nel backend.

## 7. Priorità proposta per validazione

### Criteri usati

La priorità non segue l'ordine nel quale i requisiti sono stati annotati. È determinata da:

1. rischio che una prescrizione usi lo storico sbagliato;
2. dipendenze: evitare di costruire una funzione sopra un'identità o uno snapshot destinati a
   cambiare;
3. frequenza e valore nell'allenamento quotidiano;
4. possibilità di consegnare e verificare il requisito senza dipendenze esterne;
5. costo, rischio di sicurezza e necessità di hardware/account reali.

Definizioni:

- `P0`: correttezza del dominio; blocca le funzionalità che dipendono da progressione e storico;
- `P1`: esperienza quotidiana o fondazione tecnica ad alto valore;
- `P2`: epic avanzata, importante ma costruibile dopo il nucleo;
- `P3`: integrazione esterna, non necessaria per la correttezza dell'allenamento.

### Ordine raccomandato dei requisiti

| Ordine | ID originale | Stato | Priorità | Requisito | Motivo dell'ordine | Dipende da |
|---:|---:|---|---|---|---|---|
| 1 | 6 | **Completato** | P0 | Identità delle istanze tra routine | Evita contaminazioni di peso, target, streak e recupero fra configurazioni differenti | — |
| 2 | 11 | **Completato** | P0 | Validare il livello realmente completato (`RF-11.1`) | Corregge direttamente le prescrizioni, compreso lo storico 8/9 eseguito a 10 | 6 |
| 3 | 15 | **Non completato** | P0 proposta | Offline-first e sync senza perdita silenziosa | Il protocollo whole-state corrente può sovrascrivere dati fra device; serve una fondazione revisionata | identità stabili, storage locale |
| 4 | 1 | **Completato** | P1 | Corpo libero puro senza campi peso | Rimuove un'ambiguità frequente e impedisce carichi invisibili recuperati dallo storico | 6, distinzione puro/zavorrato |
| 5 | 5 | **Completato** | P1 | Auto-riduzione recupero attiva sulle nuove configurazioni Confirmed | Quick win ad alto valore; i JSON legacy restano manuali | 6 |
| 6 | 12 | **Completato** | P1 | Mostrare e qualificare data/ora di inizio e fine | Lifecycle deterministico, storico leggibile e base temporale per linking esterno | — |
| 7 | 14 | **Completato** | P1 | Rendere configurabile la richiesta del peso corporeo | Migliora l'avvio senza modificare misurazioni o compatibilità legacy | — |
| 8 | 2A | **Non completato** | P1 | Rendere il timer locale persistente e deterministico | Refresh/background non devono perdere o anticipare il countdown; è la base del watch | — |
| 9 | 7A | **Completato** | P1 | Cavo caricato a dischi con guida per punto/lato | Riusa il solver esistente e rimuove l'ambiguità quotidiana fra pacco pesi e dischi | 7 |
| 10 | 16 | **Non completato** | P1 | Ultime quattro sessioni nel workout | Migliora subito le decisioni in serie e rende verificabili anche i futuri avvisi di stallo | 6, 11 |
| 11 | 17 | **Non completato** | P1 proposta | Possibile stallo Confirmed e regressione controllata | Evita lavoro ripetutamente improduttivo senza introdurre un deload automatico non supportato | 5, 6, 11; 16 consigliato |
| 12 | 4 | **Non completato** | P1 | Navigazione scorrevole tra routine | Migliora un flusso frequente con rischio di dominio limitato | identità slot stabilizzata |
| 13 | 10 | **Non completato** | P1 | Alias esercizi e ricerca centralizzata | Migliora libreria e picker senza modificare l'identità canonica | identità slot stabilizzata |
| 14 | 7 | **Completato** | P2 | Profili attrezzatura, solver e snapshot | Profili per palestra, singolo manubrio, inventario, guida accessibile e nessuna retroattività | 1, 6, snapshot workout |
| 15 | 13 | **Non completato** | P1 proposta | Riscaldamento specifico guidato | Alto valore nel workout e nessun backend; riusa identità, snapshot e solver già validati | 1, 6, 7, 11 |
| 16 | 3 | **Non completato** | P2 | Documentazione API interna e API pubblica v1 sicura | Abilita pairing watch, Withings e Polar; richiede DTO, auth e concorrenza | modello dati stabilizzato |
| 17 | 2B | **Non completato** | P2 | Sincronizzazione timer server e multi-device | Richiede persistenza, revisioni, API e gestione dei conflitti | 2A, 3, fondazione 15 |
| 18 | 2C | **Non completato** | P2 | Controllo timer da smartwatch | Richiede pairing e un companion specifico per piattaforma | 2A, 2B, 3 |
| 19 | 8 | **Non completato** | P3 | Recupero peso da Withings | Utile ma dipende da OAuth, secret store e account reale | 3, 2B |
| 20 | 9 | **Non completato** | P3 | Arricchimento da Polar Flow | API in sola lettura e nessuna serie/peso importabile: valore inferiore rispetto a Withings | 3, 2B |

Gli ID `2A`, `2B` e `2C` non introducono un nuovo requisito: dividono il punto 2 in fondazione
locale, sincronizzazione server e companion smartwatch. Questa separazione evita di legare la
correttezza del timer alla disponibilità di un determinato modello di orologio.

Se viene validata la nuova priorità P0, il **prossimo requisito non completato** diventa **15 —
offline-first e sync senza perdita silenziosa**. In assenza di questa validazione, il prossimo
requisito già approvato resta **2A — timer locale persistente e deterministico**. Fra le due nuove
attività, la 16 è la prima implementabile: è read-only e può poi rendere trasparenti le evidenze
della 17. L'estensione 7A è già committata in `ca68f78`; i requisiti 8 e 9 restano fuori scope.

### Pacchetti di rilascio raccomandati

#### Release A — Correttezza della progressione

**Stato: Completata.**

1. Punto 6: identità slot e progression group.
2. Punto 11: livello validato, due conferme al massimo e rivalutazione controllata dello storico.
3. Gate obbligatorio: fixture legacy, routine condivise/indipendenti, import/export e matrice
   completa 4×8–10.

Non inizierei altre modifiche di progressione prima che questa release sia verde: recovery,
attrezzatura e suggerimenti userebbero altrimenti uno scope potenzialmente errato.

#### Release A.1 — Assistente allo stallo Confirmed

**Stato: Non iniziata; analisi pronta e sviluppo non autorizzato.**

1. Review opzionale di tecnica/motivo a livello esercizio.
2. Motore puro e versionato `confirmed_stall_assistant_v1`.
3. Priorità del recupero adattivo e comparabilità rigorosa per progression group.
4. Assessment persistente, proposta esplicita e nuova epoca di carico soltanto se accettata.
5. Target al minimo, streak azzerato, recupero e storico invariati.
6. Gate su vecchi JSON, routine condivise/indipendenti, attrezzatura e no-regression completa.

Il requisito 17 costituisce un solo rilascio/commit reversibile e non va accorpato alle regole del
recupero. Il requisito 16 può precederlo e fornire la vista delle evidenze.

#### Release B — Esperienza quotidiana

**Stato: Parziale — 4 requisiti su 8 completati.**

1. Corpo libero puro/zavorrato — completato e validato.
2. Default auto-riduzione sulle sole nuove selezioni Confirmed — completato e validato.
3. Orari start/end — completato e validato.
4. Richiesta del peso corporeo all'avvio configurabile — completata e validata.
5. Timer locale persistente — non completato.
6. Ultime quattro sessioni nello specifico scope — non completato.
7. Rail routine — non completato.
8. Alias e ricerca unica — non completato.

Questi requisiti possono essere consegnati in commit separati e verificati uno per volta.

#### Release B.1 — Continuità offline e sync resiliente

**Stato: Non iniziata; analisi pronta e sviluppo non autorizzato.**

1. `15A`: app shell precacheata, cold start offline e policy media/secure context.
2. `15A`: storage locale durevole, per account, e stato sync visibile.
3. `15B`: protocollo server revisionato, CAS, idempotenza e richieste serializzate.
4. `15C`: merge a tre vie, conflitti espliciti, logout/reauth sicuri e retry con backoff.
5. Gate con due client, due tab, server/API down-up, risposta persa, upgrade PWA e Docker/CasaOS.

Le fasi sono necessarie per rendere verificabile l'epic, ma la consegna finale deve restare un
rilascio dedicato e rollbackabile secondo il vincolo un requisito/un commit.

#### Release C — Attrezzatura

**Stato: Completata e committata.**

1. Profili palestra e semantica del carico — completato e validato.
2. Peso del singolo manubrio e quantità — completato e validato.
3. Solver piastre/pesi disponibili — completato e validato.
4. Snapshot immutabile e messaggio verde durante l'esercizio — completato e validato.
5. Preset cavo plate-loaded e guida esplicita per punto/lato — completato e validato (`7A`).

#### Release C.1 — Assistente al riscaldamento specifico

**Stato: Non iniziata; specifica pronta e autorizzazione allo sviluppo non ancora ricevuta.**

1. Motore puro e versionato `specific_warmup_v1`.
2. Risoluzione della prossima serie prescritta dello specifico slot.
3. Riutilizzo del solver attrezzatura per totale, per lato e carico praticabile.
4. Bottom sheet accessibile nel workout, senza registrare false serie eseguite.
5. Test property/golden, isolamento tra routine e no-regression completo.

Questa release resta un commit autonomo e reversibile. Non richiede modifiche backend né deve
essere accorpata a timer, API o integrazioni esterne.

#### Release D — Piattaforma e smartwatch

**Stato: Non iniziata.**

1. Documentare il protocollo interno corrente.
2. Stabilire DTO, API v1, autenticazione e pairing.
3. Sincronizzare timer con revisioni e gestione dei conflitti.
4. Realizzare il companion per la prima piattaforma scelta.

Prima del punto 4 deve essere indicata la piattaforma iniziale: Apple Watch/watchOS oppure Wear
OS. Supportarle entrambe nella prima release raddoppierebbe test, distribuzione e manutenzione.

#### Release E — Provider esterni

**Stato: Non iniziata e fuori dallo scope corrente.**

1. Withings in sola lettura con provenienza e deduplica.
2. Polar Flow in sola lettura come arricchimento del workout.

### Via libera richiesto per i requisiti analizzati ma non autorizzati

L'inserimento nel backlog non autorizza lo sviluppo:

- requisito 13: validare priorità e tabella `specific_warmup_v1`;
- requisito 15: validare la priorità P0 e lo scope HTTPS/PWA, CAS e conflitti;
- requisito 16: la specifica è pronta, ma questo turno autorizza soltanto documentazione;
- requisito 17: validare soglie prudenziali, review tecnica e riduzione proposta.

Ogni consegna dovrà essere un solo requisito/commit con codice, test automatici, report
aggiornato, scenari manuali replicabili e no-regression proporzionata al rischio.

## 8. Piano di sviluppo consigliato

### Fase 0 — specifica e test di caratterizzazione

**Stato: Parziale.** Le caratterizzazioni locali sono presenti; le fixture provider restano fuori
scope insieme ai requisiti 8 e 9.

1. Bloccare con test i comportamenti legacy di scope, timer, bodyweight e import.
2. Aggiungere fixture con stesso esercizio in due routine e duplicato nella stessa routine.
3. Caratterizzare sync whole-state, logout offline, richieste fuori ordine e service worker.
4. Caratterizzare le ultime quattro sessioni e le esposizioni Confirmed comparabili.
5. Aggiungere fixture Withings/Polar soltanto da payload ufficiali anonimizzati.

### Fase 1 — identità e progressione

**Stato: Completata.**

1. Introdurre `routineExerciseId` persistente.
2. Introdurre `progressionId` e reader legacy.
3. Spostare peso operativo/recovery control sul progression group.
4. Conservare PR/statistiche globali per exerciseId.
5. Implementare outcome `failed/incomplete/success/topRangeSuccess` e `livelloValidato`.
6. Accreditare il livello minimo completato da tutte le serie e le due conferme al massimo,
   compresa la rivalutazione richiesta del caso storico 4×8–10.

### Fase 1.1 — stallo Confirmed e regressione controllata

**Stato: Non iniziata; analisi pronta e sviluppo non autorizzato.**

1. Congelare outcome, recupero adattivo e comparabilità con test di caratterizzazione.
2. Introdurre review tecnica opzionale e ragioni che non vengono inferite dai numeri.
3. Implementare `confirmed_stall_assistant_v1` come funzione pura e versionata.
4. Persistenza di assessment/decisione e nuova epoca di carico senza riscrivere lo storico.
5. UI non bloccante, disclosure degli scope condivisi e applicazione solo futura.
6. Matrice completa di compatibilità, lifecycle, sync e regressione.

### Fase 2 — quick win e UX locale

**Stato: Parziale — 4 attività completate, 3 non completate.**

1. Separare corpo libero puro e zavorrato — completato e validato.
2. Attivare auto-riduzione soltanto sulle nuove selezioni Confirmed — completato e validato.
3. Mostrare orari start/end con provenance — completato e validato.
4. Rendere configurabile la richiesta del peso corporeo — completato e validato.
5. Mostrare le ultime quattro sessioni scoped nel workout — non completato.
6. Aggiungere rail routine accessibile — non completato.
7. Centralizzare la ricerca e aggiungere alias — non completato.

### Fase 2.1 — offline-first e sync resiliente

**Stato: Non iniziata; analisi pronta e sviluppo non autorizzato.**

1. Precache atomica della shell e definizione dell'offline readiness.
2. Storage per account, pending durevole e state machine UX.
3. Revisione server/CAS, idempotenza e serializzazione per utente.
4. Merge a tre vie e risoluzione esplicita dei conflitti.
5. Retry su boot/mutazione/focus/reconnect con timeout, backoff e reauth sicura.
6. Gate due client/tab, PWA HTTPS, API/stack down-up e Docker/CasaOS.

### Fase 3 — timer

**Stato: Non iniziata.** La deadline in memoria è una fondazione preesistente, non soddisfa 2A.

1. Estrarre un motore timer puro con clock iniettato.
2. Persistenza locale e revisioni.
3. Sincronizzazione tab e local notification nativa.
4. Fermarsi alla fondazione locale; server e companion vengono dopo API e pairing.

### Fase 4 — attrezzatura

**Stato: Completata e committata.**

1. Modello profili/attrezzi e convenzioni — completato.
2. Resolver catalogo + override per slot — completato.
3. Solver deterministico delle piastre — completato.
4. Snapshot nel workout — completato.
5. Messaggio success durante l'esecuzione — completato.
6. Distinguere cavo a pacco pesi e cavo plate-loaded con preview/guida per punto — completato e
   validato.

### Fase 4.1 — riscaldamento specifico

**Stato: Non iniziata.**

1. Congelare con test la risoluzione della prossima serie prescritta e la guida attrezzatura.
2. Implementare il motore puro `specific_warmup_v1` e i relativi invarianti/property test.
3. Adattare ogni tappa tramite lo snapshot e il solver dell'attrezzatura già esistenti.
4. Aggiungere il trigger testuale e la bottom sheet accessibile nel workout.
5. Verificare esplicitamente che nessuna tappa entri nelle serie allenanti o negli algoritmi di
   progressione, volume, PR e recupero.

### Fase 5 — API e integrazioni

**Stato: Non iniziata.** I requisiti provider 8 e 9 restano esclusi dallo sviluppo corrente.

1. Documentare senza ambiguità il protocollo interno esistente.
2. DTO/provenance, secret store e riuso del lock/revision per utente introdotto dal requisito 15.
3. API v1 read-only, PAT/pairing, OpenAPI e MD generato.
4. Endpoint timer revisionati e gestione dei conflitti.
5. Companion per la prima piattaforma smartwatch approvata.
6. Import CSV Withings verificato.
7. Withings OAuth polling; webhook opzionale.
8. Polar v4 read-only, linking e arricchimento.

Ogni fase deve lasciare suite, build, locale check, import/export e JSON legacy verdi. Docker/
CasaOS, OAuth reali e dispositivi mobili rimangono gate separati con credenziali di test dedicate.

## 9. Commit piccoli suggeriti

1. `test: characterize routine exercise history scopes`
2. `feat: add stable routine exercise identities`
3. `feat: isolate progression groups and recovery controls`
4. `test: define manual session outcome matrix`
5. `feat: credit the highest rep-range level completed by every set`
6. `fix: distinguish incomplete sets from failed sets`
7. `fix: separate pure bodyweight and added load`
8. `feat: default new confirmed configs to automatic rest reduction`
9. `feat: display workout start and end timestamps`
10. `feat: show four scoped exercise sessions during workouts` — requisito 16
11. `feat: detect confirmed stalls and offer a controlled load reset` — requisito 17
12. `feat: add accessible routine navigation rail`
13. `feat: add personal exercise aliases and shared search`
14. `feat: persist deterministic rest timers`
15. `feat: add equipment profiles and immutable loading guidance` — Release C, requisito 7 in un commit unico
16. `feat: distinguish selectorized and plate-loaded cable equipment` — estensione 7A
17. `feat: add evidence-informed warm-up loading guide` — Release C.1, requisito 13
18. `feat: add offline-first conflict-safe profile sync` — requisito 15, squash finale della release
19. `docs: describe internal api and add openapi contract`
20. `feat: add scoped personal access tokens and read api`
21. `feat: sync revisioned rest timers and pair trusted devices`
22. `feat: add the first smartwatch companion controls`
23. `feat: import withings weight with provenance`
24. `feat: link polar training enrichment`

Questa è una lista di unità di consegna, non un'autorizzazione a creare commit in questo turno.

## 10. File probabilmente coinvolti

| Area | File principali |
|---|---|
| Identità/progressione | `frontend/src/lib/history.js`, `progression.js`, `confirmedRepRangeRest.js` |
| Snapshot/lifecycle | `frontend/src/lib/workout-prescription.js`, `frontend/src/sheets.jsx` |
| Workout/timer | `frontend/src/views/Workout.jsx`, `frontend/src/store/useUI.js` |
| Stato/sync corrente | `frontend/src/store/useStore.js`, `frontend/src/lib/api.js`, `api/server.js` |
| Offline/sync 15 | `useStore.js`, `api.js`, `App.jsx`, `main.jsx`, service worker/build, nuovi `sync-state.js`, `sync-merge.js`, `sync-storage.js`, `SyncStatus.jsx`, `api/server.js`, reader admin e test Docker/browser |
| Routine | `frontend/src/views/Plan.jsx`, `frontend/src/views/RoutineEdit.jsx` |
| Corpo libero/config | `frontend/src/sheets.jsx`, `frontend/src/lib/history.js` |
| Avvio/peso corporeo | `frontend/src/views/Settings.jsx`, `frontend/src/sheets.jsx`, `frontend/src/store/useStore.js`, `frontend/src/views/Home.jsx` |
| Alias/ricerca | `frontend/src/lib/exercises.js`, `frontend/src/views/Library.jsx`, `frontend/src/sheets.jsx` |
| Storico recente 16 | nuovo `frontend/src/lib/exercise-session-history.js`, `Workout.jsx`, componente/sheet dedicata, `history.js`, `progression-scope.js`, `progression.js`, eventuale `Modals.jsx`, CSS, locale e test |
| Stallo Confirmed 17 | nuovo `frontend/src/lib/confirmedRepRangeStall.js`, `progression.js`, `workout-prescription.js`, `workout-scope.js`, `Workout.jsx`, `sheets.jsx`, solver attrezzatura, locale e test |
| Attrezzatura | `frontend/src/lib/equipment-load.js`, `frontend/src/views/Equipment.jsx`, `frontend/src/components/EquipmentGuide.jsx`, `sheets.jsx`, `Workout.jsx` e test dedicati |
| Cavo plate-loaded 7A | `frontend/src/lib/equipment-load.js`, `frontend/src/views/Equipment.jsx`, `frontend/src/components/EquipmentGuide.jsx`, `frontend/src/sheets.jsx`, locale e test attrezzatura/UI |
| Riscaldamento | nuovo `frontend/src/lib/warmup.js`, nuovo `frontend/src/components/WarmupGuide.jsx`, `Workout.jsx`, `sheets.jsx`, `equipment-load.js`, `workout-set-status.js` e test dedicati |
| Timestamp/import | `frontend/src/lib/format.js`, `frontend/src/lib/import-csv.js` |
| API/provider | `api/server.js`, nuovi moduli API/OAuth/provider, `docs/openapi.yaml`, `docs/API.md` |
| Presentazione | `frontend/src/index.css` e tutti gli 11 pacchetti locale |

## 11. Gate di test complessivi

### Automatici

- unit test di normalizzazione, scope, outcome, timer, storico recente, stall detector, merge sync,
  plate solver, warm-up e matching temporale;
- integration test di start → active → finish → storico;
- fixture JSON legacy e nuovi snapshot;
- import/export round-trip;
- API schema, auth, revisione/CAS, concorrenza, idempotenza, retry e route coverage;
- property/matrix test di merge, assessment stallo e applicazione futura del reset;
- service worker: install/update atomici, navigation fallback e nessuna API in cache;
- build produzione e sincronizzazione delle 11 locale;
- nessun test ordinario dipendente dalla rete.

### Browser e accessibilità

- 320/360/375/390/430/640 px e reflow 200%;
- tastiera e screen reader;
- tema chiaro/scuro e contrasto del messaggio verde;
- rail routine, alias chip e configurazione attrezzatura;
- cavo a pacco pesi/dischi, uno/due punti, preview e guida senza label troncate;
- storico delle quattro sessioni: sheet, target/esiti, focus restore e timer non interrotto;
- avviso stallo: evidenze, routine condivise, accetta/rifiuta e copy non prescrittivo;
- stato sync: offline/pending/syncing/conflict/auth/storage error senza modal durante il workout;
- popup riscaldamento: focus, testi non troncati, carico totale/per lato e nessun overflow;
- niente peso visibile nel corpo libero puro.

### Ambiente reale

- refresh, restart browser, API down/up e Docker down/up senza `-v`;
- cold start PWA HTTPS con intero host fermo e limite CasaOS HTTP documentato;
- due browser e due tab autenticati: merge disgiunto, conflitto, risposta persa e retry;
- iOS/Android background, force-close e risparmio energetico;
- OAuth demo/account reali Withings e Polar in suite gated;
- cambio palestra fra due sessioni con storico invariato;
- tre esposizioni Confirmed comparabili e due review tecniche compromesse, con reset soltanto
  futuro e recupero invariato;
- guida riscaldamento confrontata con i carichi fisicamente componibili dell'attrezzo reale;
- watch associato: visualizzazione, `+30 s`, stop/skip, conflitto di revisione e offline; la
  notifica best-effort deve essere verificata separatamente come fallback.

## 12. Decisioni di prodotto confermate

Decisioni confermate dall'utente il 2026-08-26:

1. `Timer orologio` significa controllo del countdown da smartwatch, non soltanto correttezza in
   background o sincronizzazione fra schede browser. L'implementazione deve quindi prevedere un
   vero companion/watch client o un'integrazione nativa equivalente; una semplice notifica resta
   solo un fallback esplicitamente dichiarato.
2. Quando lo stesso esercizio compare con configurazione identica, la progressione è condivisa per
   default. Se la configurazione diverge, la progressione diventa indipendente. Duplicati nella
   stessa routine devono comunque avere un'identità esplicita e non dipendere dal solo `exerciseId`.
3. Per i manubri il peso registrato rappresenta il singolo manubrio. Lo snapshot dell'attrezzatura
   deve includere anche la quantità usata, così la UI può mostrare senza ambiguità, per esempio,
   `2 manubri × 20 kg`.
4. In Confirmed Rep-Range viene validato il più alto livello del range raggiunto da tutte le serie
   prescritte, anche se superiore al target snapshot. Per esempio, target 8 con 9/9/9/9 valida il
   livello 9 e porta il target successivo a 10. Due sessioni consecutive che raggiungono tutte il
   massimo aumentano il carico e riportano il target al minimo, anche quando i loro target storici
   erano 8 e 9, secondo `RF-11.1`.
5. La richiesta del peso corporeo prima di ogni workout è configurabile per profilo. Il default
   legacy resta attivo; disabilitarla salta soltanto il popup e non modifica le misurazioni già
   registrate né impedisce la registrazione manuale.

### Decisione applicata per l'estensione 7A

La 7A implementa la convenzione analizzata il 2026-09-22: per il cavo plate-loaded il peso
registrato rappresenta il **totale della macchina** e openGym lo divide sui punti di carico dopo
avere sottratto la tara. Il rapporto delle pulegge non viene applicato e la UI lo dichiara. Se in
futuro il numero registrato dovrà rappresentare il peso già `per lato/torre`, verrà introdotta
una semantica separata `per_loading_point`, senza reinterpretare silenziosamente dati esistenti.

Polar non richiede una decisione tecnica sulla direzione: la scrittura openGym → Polar non è
offerta dall'API pubblica corrente. L'unica integrazione raccomandabile è Polar → openGym come
arricchimento.

### Decisioni proposte il 2026-09-26, ancora da validare prima dello sviluppo

1. Requisito 15: priorità P0; replica locale per account, revisione server CAS, idempotenza, merge
   a tre vie e conflitti espliciti. La PWA garantisce cold start offline soltanto dopo installazione
   riuscita in secure context.
2. Requisito 16: pulsante compatto nell'esercizio e bottom sheet verticale con al massimo quattro
   workout dello stesso `progressionId`; vista di sola lettura e nessun nuovo dato persistente.
3. Requisito 17: assistente manuale, non deload automatico; possibile stallo dopo tre esposizioni
   numeriche comparabili senza progresso oppure due review tecniche compromesse.
4. Il recupero adattivo ha precedenza sullo stallo; ogni cambio del recupero riapre la finestra.
5. Dopo un aumento non consolidato si propone l'ultimo peso riuscito; negli altri casi il default
   proposto è −7,5% arrotondato a un carico praticabile. Soglie e percentuale sono policy di
   prodotto dichiarate, non numeri clinicamente/scientificamente universali.
6. Un reset accettato vale dal workout successivo, riparte da `minReps`, azzera il top streak e
   non cambia recupero, storico, PR o workout già conclusi.

## 13. Fonti esterne consultate

### Piattaforma e provider

Consultate il 2026-08-26:

- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [Withings Public API integration guide](https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/public-health-data-api-overview/)
- [Withings OAuth web flow](https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/get-access/oauth-web-flow/)
- [Withings access and refresh tokens](https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/get-access/access-and-refresh-tokens-no-recover/)
- [Withings fetch after notification](https://developer.withings.com/developer-guide/v3/integration-guide/onsite-mode/data-api/fetch-data-example/)
- [Withings notification subscription](https://developer.withings.com/developer-guide/v3/data-api/notifications/notification-subscribe/)
- [Polar AccessLink Dynamic API v4](https://www.polar.com/polar-api-v4/)
- [Polar AccessLink API v3/webhooks](https://www.polar.com/accesslink-api/)
- [Polar API license agreement](https://www.polar.com/en/legal/polar-api-agreement)
- [Android AlarmClock intents](https://developer.android.com/reference/android/provider/AlarmClock)
- [Apple watchOS apps](https://developer.apple.com/documentation/watchos-apps/)
- [W3C High Resolution Time](https://www.w3.org/TR/hr-time-3/)
- [MDN Service Worker API — secure context, install e `waitUntil`](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [MDN Background Synchronization API — disponibilità limitata](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)
- [MDN `If-Match` — aggiornamenti condizionali](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-Match)

### Stallo, autoregolazione e deload

Consultate il 2026-09-26:

- [ACSM Position Stand 2026 — Resistance Training Prescription](https://pubmed.ncbi.nlm.nih.gov/41843416/)
- [ACSM Position Stand 2009 — Progression Models](https://pubmed.ncbi.nlm.nih.gov/19204579/)
- [Progressing load or repetitions produces similar adaptations (2022)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/)
- [Load and volume autoregulation: systematic review and meta-analysis (2022)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8762534/)
- [Training to failure vs non-failure: systematic review and meta-analysis (2022)](https://pubmed.ncbi.nlm.nih.gov/33497853/)
- [Acute fatigue from training to failure: systematic review and meta-analysis (2022)](https://pubmed.ncbi.nlm.nih.gov/34881412/)
- [Proximity to failure and hypertrophy: systematic review and meta-analysis (2023)](https://pubmed.ncbi.nlm.nih.gov/36334240/)
- [Accuracy of predicting repetitions to failure: review/meta-analysis (2022)](https://pubmed.ncbi.nlm.nih.gov/34542869/)
- [Full vs partial range of motion: systematic review/meta-analysis (2021)](https://pubmed.ncbi.nlm.nih.gov/34170576/)
- [The plateau in muscle growth with resistance training (2024)](https://pubmed.ncbi.nlm.nih.gov/37787845/)
- [International Delphi consensus on deloading (2023)](https://link.springer.com/article/10.1186/s40798-023-00633-0)
- [One-week deload/cessation trial (2024)](https://pubmed.ncbi.nlm.nih.gov/38274324/)
- [Reduced-volume/frequency deload trial (2026)](https://pubmed.ncbi.nlm.nih.gov/41730991/)
- [Inter-set rest intervals in resistance training: Bayesian meta-analysis (2024)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11349676/)

### Riscaldamento specifico e resistance training

Consultate il 2026-09-20:

- [International Expert Consensus on Warm-Up Protocols for Athletes (2026)](https://doi.org/10.1123/ijspp.2025-0647)
- [Acute Effects of Resistance Training Warm-Up and Re-Warm-Up on Dynamic Strength Performance: A Scoping Review (2026)](https://doi.org/10.1007/s42978-025-00361-9)
- [The effect of warm-up in resistance training and strength performance: a systematic review (2021)](https://doi.org/10.6063/motricidade.21143)
- [The Role of Specific Warm-up during Bench Press and Squat Exercises (2020)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7558980/)
- [High-load and low-volume warm-up increases performance in a resistance training session (2024)](https://pubmed.ncbi.nlm.nih.gov/39593476/)
- [Effect of warm-up protocols using lower and higher loads on multiple-set back squat volume-load (2024)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11243969/)
- [Warming up to improved performance? Effects of different specific warm-up protocols (2025)](https://doi.org/10.1016/j.smhs.2025.08.002)
- [Effects of Resistance Training to Muscle Failure on Acute Fatigue: systematic review and meta-analysis (2022)](https://pubmed.ncbi.nlm.nih.gov/34881412/)
- [Effects of warming-up on physical performance: systematic review with meta-analysis (2010)](https://pubmed.ncbi.nlm.nih.gov/19996770/)
- [A systematic review of the effects of upper body warm-up on performance and injury (2015)](https://pubmed.ncbi.nlm.nih.gov/25694615/)
- [The effect of muscle warm-up on force-time parameters: systematic review and meta-analysis (2025)](https://pubmed.ncbi.nlm.nih.gov/39864808/)

## 14. Conclusione

Il backlog non è un unico sviluppo. Contiene correzioni di dominio prioritarie, miglioramenti
locali dell'esperienza quotidiana e epic infrastrutturali separate.

Sono già completati e verificati: isolamento delle istanze (6), progressione dopo modifiche
manuali (11), corpo libero puro/zavorrato (1), default recupero automatico (5), timestamp (12),
attrezzatura con snapshot (7), distinzione dei cavi e guida per punto (7A) e richiesta del peso
corporeo configurabile (14).

La sequenza residua più sicura proposta è:

1. validare la priorità P0 del requisito 15 e, se approvata, eliminare prima il rischio di perdita
   dati con offline-first e sync revisionato; diversamente resta primo il timer locale 2A;
2. completare 2A, rendendo il timer locale persistente e deterministico;
3. realizzare la vista read-only delle ultime quattro sessioni (16), la più piccola e sicura fra
   le due nuove attività;
4. validare e poi implementare l'assistente allo stallo (17), riusando la vista 16 per rendere
   verificabile ogni evidenza e senza decremento automatico;
5. realizzare rail routine (4) e alias/ricerca centralizzata (10);
6. avviare il riscaldamento specifico (13) solo dopo l'autorizzazione esplicita;
7. creare documentazione/contratto API (3), quindi timer multi-device (2B) e companion (2C);
8. valutare Withings (8) e Polar (9) solo quando rientreranno nello scope.

Questa sequenza mantiene spiegabile ogni prescrizione, conserva i workout passati e impedisce
che integrazioni o cambi di palestra modifichino retroattivamente ciò che è già stato registrato.
Le aggiunte 15, 16 e 17 sono state analizzate e censite soltanto nel backlog: non è stato avviato
alcuno sviluppo applicativo.
