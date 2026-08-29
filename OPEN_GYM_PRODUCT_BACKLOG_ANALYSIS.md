# openGym — Analisi funzionale e architetturale del backlog prodotto

- Data: 2026-08-26
- Branch analizzato: `feature/confirmed-rep-range-progression`
- Revisione di partenza analizzata: `274ccdf`
- Stato: Release A implementata e validata; Release B requisiti 1 e 5 implementati e validati
- Ambito: requisiti 1–12 comunicati dopo l'implementazione Confirmed Rep-Range
- Ultimo aggiornamento funzionale: auto-riduzione attiva di default sulle sole nuove selezioni Confirmed
- Priorità di sviluppo: validate dall'utente; requisiti 8 e 9 esclusi dallo sviluppo corrente

## 1. Obiettivo

Questo documento trasforma i dodici appunti in requisiti verificabili, separando:

- difetti già presenti;
- nuove funzionalità locali;
- cambi di dominio che possono alterare la progressione;
- integrazioni che richiedono OAuth, segreti server e servizi esterni;
- decisioni ancora necessarie prima di scrivere codice.

Il principio guida rimane lo stesso usato per Confirmed Rep-Range: una sessione terminata è uno
snapshot immutabile. Una modifica successiva a routine, attrezzatura, palestra, alias o account
esterno può influenzare solo il futuro e non deve reinterpretare retroattivamente lo storico.

## 2. Risultato sintetico dell'analisi

| ID | Requisito | Riscontro | Priorità | Dimensione |
|---|---|---|---|---|
| 1 | Nascondere peso nel corpo libero | Implementato e validato: tre modalità di carico, zero-load invariants e disclosure zavorra | P1 | Media |
| 2 | Sincronizzare timer e orologio | Timer locale già basato su deadline; controllo smartwatch richiede fondazione e companion | P2 | Grande/Epic |
| 3 | Esporre e documentare API | Esistono endpoint interni, non una API pubblica sicura/versionata | P2 | Grande |
| 4 | Scorrere tra routine | Navigazione attuale richiede ritorno alla lista | P1 | Media |
| 5 | Auto-riduzione recupero attiva di default | Implementato e validato solo sugli eventi di nuova selezione; decoder legacy invariato | P1 | Piccola |
| 6 | Istanze dello stesso esercizio | Implementato e validato: slot stabili, gruppi compatibili, snapshot e reader legacy | P0 | Grande |
| 7 | Calcolo attrezzatura/piastre | Nuova epic; il catalogo non contiene abbastanza informazioni | P2 | Grande |
| 8 | Peso da Withings | Fattibile in lettura; OAuth/polling server-side | P3 | Grande |
| 9 | Dati Polar Flow | Fattibile solo come arricchimento in lettura | P3 | Grande |
| 10 | Alias esercizi | Nuova funzione locale e sincronizzabile | P1 | Media |
| 11 | Adattamento dopo modifiche manuali | Implementato e validato: livello dimostrato, outcome, serie opzionali e carico uniforme | P0 | Grande |
| 12 | Orario/data inizio e fine | Dati già salvati, ma l'ora non è mostrata | P1 | Piccola/Media |

Le due correzioni da affrontare per prime sono 6 e 11. Entrambe decidono quale storico appartiene
a una prescrizione; costruire sopra di esse attrezzatura, recovery reset o collegamento Polar
senza prima separare le istanze renderebbe più costosa una migrazione successiva.

## 3. Dipendenze consigliate

```text
Identità slot/progressione (6)
├── risultati manuali e Confirmed (11)
├── reset e recupero per istanza (5)
└── attrezzatura scelta per slot (7)

Timestamp completi (12)
└── collegamento temporale workout ↔ Polar (9)

DTO, provenance, segreti e API v1 (3)
├── Withings (8)
└── Polar Flow (9)

Timer locale persistente (2A)
└── eventuale timer multi-device/watch (2B/2C)
```

I punti 1, 4 e 10 possono procedere in parallelo dopo avere fissato il modello dello slot. Il
punto 5 è un quick win, purché non cambi il significato dei vecchi JSON.

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

#### Esito: problema confermato

Oggi l'identità della progressione è il solo `exerciseId`:

- le entry della routine non hanno un ID stabile dell'occorrenza;
- `lastEntryFor`, `sessionsFor` e Confirmed cercano `e.id === exerciseId`;
- `exWeights` è globale per esercizio;
- recovery reset e control sono globali per esercizio;
- con due occorrenze nello stesso workout `.find(...)` usa soltanto la prima.

Riferimenti: `frontend/src/lib/history.js:166-228`, `frontend/src/lib/progression.js:184-191`,
`frontend/src/lib/progression.js:236-245` e `frontend/src/lib/confirmedRepRangeRest.js:11-20`.

Esempio problematico:

```text
Routine A: Panca 3×8–12, 70 kg, Confirmed
Routine B: Panca 5×3–5, 100 kg, Linear
```

Il carico e parte dello storico della routine più recente possono diventare la baseline
dell'altra. Con due Panche nella stessa routine, progressione e best possono persino leggere
occorrenze differenti.

#### Modello raccomandato

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

#### Stato attuale

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

#### UX raccomandata

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

#### Modello dati proposto

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

#### Calcolo

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

#### Test necessari

- bilanciere 70/20, piastre frazionarie e quantità insufficienti;
- manubrio singolo/coppia e peso per mano;
- target impossibile, sotto tara e unità discordanti;
- override slot > mapping catalogo;
- stesso esercizio con attrezzi diversi;
- cambio profilo prima/durante/dopo sessione;
- refresh, backup, sync e Docker down/up;
- workout legacy senza snapshot;
- contrasto e comprensione del messaggio senza colore.

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

#### Stato attuale

Il requisito è già soddisfatto a livello dati:

- `start: Date.now()` viene salvato in `beginWorkout`;
- `end: Date.now()` viene salvato al finish;
- localStorage, backup e sync serializzano entrambi.

Riferimenti: `frontend/src/sheets.jsx:1059-1072` e `frontend/src/sheets.jsx:1169-1189`.

La UI mostra però soltanto data e durata. Non esiste un formatter dedicato all'orario. Gli import
senza ora usano fallback tecnici che non devono essere mostrati come orari reali.

#### Decisione raccomandata

Conservare `start` e `end` numerici per compatibilità e aggiungere provenance opzionale:

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

Per un import senza ora: `timeSource: "import"`, `timePrecision: "date-only"`.

All'avvio usare un solo istante:

```text
startedAt = Date.now()
d = isoOf(new Date(startedAt))
```

Il dettaglio storico mostra, per esempio:

```text
26 ago 2026 · 18:05–19:12 · 1 h 07 min
```

Se la sessione attraversa mezzanotte o cambia fuso, mostrare anche la data di fine. Un workout
importato senza ora mostra soltanto la data, mai un'ora inventata.

#### Test necessari

- start scritto una volta e preservato da refresh/restart;
- end scritto una volta dopo la conferma finale;
- attraversamento mezzanotte e DST;
- `d` derivato dallo stesso istante di start;
- import date-only/minute e JSON legacy;
- nessun `Invalid Date`;
- scarto workout non crea una falsa sessione terminata;
- formato locale e API RFC 3339 coerenti.

## 6. Modello dati trasversale consigliato

La forma seguente mostra le nuove responsabilità senza imporre una migrazione immediata:

```json
{
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

| Ordine | ID originale | Priorità | Requisito | Motivo dell'ordine | Dipende da |
|---:|---:|---|---|---|---|
| 1 | 6 | P0 | Identità delle istanze tra routine | Evita contaminazioni di peso, target, streak e recupero fra configurazioni differenti | — |
| 2 | 11 | P0 | Validare il livello realmente completato (`RF-11.1`) | Corregge direttamente le prescrizioni, compreso lo storico 8/9 eseguito a 10 | 6 |
| 3 | 1 | P1 | Corpo libero puro senza campi peso | Rimuove un'ambiguità frequente e impedisce carichi invisibili recuperati dallo storico | 6, distinzione puro/zavorrato |
| 4 | 5 | P1 | Auto-riduzione recupero attiva sulle nuove configurazioni Confirmed — completato | Quick win ad alto valore; i JSON legacy restano manuali | 6 |
| 5 | 12 | P1 | Mostrare e qualificare data/ora di inizio e fine | Il dato esiste già; completa storico e prepara il linking temporale esterno | — |
| 6 | 2A | P1 | Rendere il timer locale persistente e deterministico | Refresh/background non devono perdere o anticipare il countdown; è la base del watch | — |
| 7 | 4 | P1 | Navigazione scorrevole tra routine | Migliora un flusso frequente con rischio di dominio limitato | identità slot stabilizzata |
| 8 | 10 | P1 | Alias esercizi e ricerca centralizzata | Migliora libreria e picker senza modificare l'identità canonica | identità slot stabilizzata |
| 9 | 7 | P2 | Profili attrezzatura, solver e snapshot | Forte valore in palestra, ma richiede modello e UI dedicati; nessuna retroattività | 1, 6, snapshot workout |
| 10 | 3 | P2 | Documentazione API interna e API pubblica v1 sicura | Abilita pairing watch, Withings e Polar; richiede DTO, auth e concorrenza | modello dati stabilizzato |
| 11 | 2B/2C | P2 | Sincronizzazione server e controllo da smartwatch | Richiede API/pairing e un companion specifico per piattaforma | 2A, 3 |
| 12 | 8 | P3 | Recupero peso da Withings | Utile ma dipende da OAuth, secret store e account reale | ID 3 e ID 12 |
| 13 | 9 | P3 | Arricchimento da Polar Flow | API in sola lettura e nessuna serie/peso importabile: valore inferiore rispetto a Withings | ID 3 e ID 12 |

Gli ID `2A`, `2B` e `2C` non introducono un nuovo requisito: dividono il punto 2 in fondazione
locale, sincronizzazione server e companion smartwatch. Questa separazione evita di legare la
correttezza del timer alla disponibilità di un determinato modello di orologio.

### Pacchetti di rilascio raccomandati

#### Release A — Correttezza della progressione

1. Punto 6: identità slot e progression group.
2. Punto 11: livello validato, due conferme al massimo e rivalutazione controllata dello storico.
3. Gate obbligatorio: fixture legacy, routine condivise/indipendenti, import/export e matrice
   completa 4×8–10.

Non inizierei altre modifiche di progressione prima che questa release sia verde: recovery,
attrezzatura e suggerimenti userebbero altrimenti uno scope potenzialmente errato.

#### Release B — Esperienza quotidiana

1. Corpo libero puro/zavorrato — completato e validato.
2. Default auto-riduzione sulle sole nuove selezioni Confirmed — completato e validato.
3. Orari start/end.
4. Timer locale persistente.
5. Rail routine.
6. Alias e ricerca unica.

Questi requisiti possono essere consegnati in commit separati e verificati uno per volta.

#### Release C — Attrezzatura

1. Profili palestra e semantica del carico.
2. Peso del singolo manubrio e quantità.
3. Solver piastre/pesi disponibili.
4. Snapshot immutabile e messaggio verde durante l'esercizio.

#### Release D — Piattaforma e smartwatch

1. Documentare il protocollo interno corrente.
2. Stabilire DTO, API v1, autenticazione e pairing.
3. Sincronizzare timer con revisioni e gestione dei conflitti.
4. Realizzare il companion per la prima piattaforma scelta.

Prima del punto 4 deve essere indicata la piattaforma iniziale: Apple Watch/watchOS oppure Wear
OS. Supportarle entrambe nella prima release raddoppierebbe test, distribuzione e manutenzione.

#### Release E — Provider esterni

1. Withings in sola lettura con provenienza e deduplica.
2. Polar Flow in sola lettura come arricchimento del workout.

### Primo via libera consigliato

Il primo sviluppo da autorizzare è soltanto la **Release A**. Al termine devono essere consegnati:

- codice e test automatici;
- report aggiornato con scenari replicabili;
- confronto prima/dopo sugli stessi JSON di prova;
- nessuna riscrittura retroattiva dei workout; la rivalutazione semantica richiesta deve cambiare
  soltanto la prescrizione futura;
- evidenza della nuova prescrizione futura derivata dallo storico reale.

La Release A è stata validata prima di avviare la Release B. Questa sequenza mantiene isolati gli
eventuali problemi del calcolo da quelli introdotti dalle successive modifiche UI.

## 8. Piano di sviluppo consigliato

### Fase 0 — specifica e test di caratterizzazione

1. Bloccare con test i comportamenti legacy di scope, timer, bodyweight e import.
2. Aggiungere fixture con stesso esercizio in due routine e duplicato nella stessa routine.
3. Aggiungere fixture Withings/Polar soltanto da payload ufficiali anonimizzati.

### Fase 1 — identità e progressione

1. Introdurre `routineExerciseId` persistente.
2. Introdurre `progressionId` e reader legacy.
3. Spostare peso operativo/recovery control sul progression group.
4. Conservare PR/statistiche globali per exerciseId.
5. Implementare outcome `failed/incomplete/success/topRangeSuccess` e `livelloValidato`.
6. Accreditare il livello minimo completato da tutte le serie e le due conferme al massimo,
   compresa la rivalutazione richiesta del caso storico 4×8–10.

### Fase 2 — quick win e UX locale

1. Separare corpo libero puro e zavorrato — completato e validato.
2. Attivare auto-riduzione soltanto sulle nuove selezioni Confirmed — completato e validato.
3. Mostrare orari start/end con provenance.
4. Aggiungere rail routine accessibile.
5. Centralizzare la ricerca e aggiungere alias.

### Fase 3 — timer

1. Estrarre un motore timer puro con clock iniettato.
2. Persistenza locale e revisioni.
3. Sincronizzazione tab e local notification nativa.
4. Fermarsi alla fondazione locale; server e companion vengono dopo API e pairing.

### Fase 4 — attrezzatura

1. Modello profili/attrezzi e convenzioni.
2. Resolver catalogo + override per slot.
3. Solver deterministico delle piastre.
4. Snapshot nel workout.
5. Messaggio success durante l'esecuzione.

### Fase 5 — API e integrazioni

1. Documentare senza ambiguità il protocollo interno esistente.
2. DTO/provenance, secret store e lock/revision per utente.
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
10. `feat: add accessible routine navigation rail`
11. `feat: add personal exercise aliases and shared search`
12. `feat: persist deterministic rest timers`
13. `feat: add equipment profiles and load semantics`
14. `feat: snapshot equipment and show loading guidance`
15. `docs: describe internal api and add openapi contract`
16. `feat: add scoped personal access tokens and read api`
17. `feat: sync revisioned rest timers and pair trusted devices`
18. `feat: add the first smartwatch companion controls`
19. `feat: import withings weight with provenance`
20. `feat: link polar training enrichment`

## 10. File probabilmente coinvolti

| Area | File principali |
|---|---|
| Identità/progressione | `frontend/src/lib/history.js`, `progression.js`, `confirmedRepRangeRest.js` |
| Snapshot/lifecycle | `frontend/src/lib/workout-prescription.js`, `frontend/src/sheets.jsx` |
| Workout/timer | `frontend/src/views/Workout.jsx`, `frontend/src/store/useUI.js` |
| Stato/sync | `frontend/src/store/useStore.js`, `api/server.js` |
| Routine | `frontend/src/views/Plan.jsx`, `frontend/src/views/RoutineEdit.jsx` |
| Corpo libero/config | `frontend/src/sheets.jsx`, `frontend/src/lib/history.js` |
| Alias/ricerca | `frontend/src/lib/exercises.js`, `frontend/src/views/Library.jsx`, `frontend/src/sheets.jsx` |
| Attrezzatura | nuovi `equipment-load.js`/test, `sheets.jsx`, `Workout.jsx` |
| Timestamp/import | `frontend/src/lib/format.js`, `frontend/src/lib/import-csv.js` |
| API/provider | `api/server.js`, nuovi moduli API/OAuth/provider, `docs/openapi.yaml`, `docs/API.md` |
| Presentazione | `frontend/src/index.css` e tutti gli 11 pacchetti locale |

## 11. Gate di test complessivi

### Automatici

- unit test di normalizzazione, scope, outcome, timer, plate solver e matching temporale;
- integration test di start → active → finish → storico;
- fixture JSON legacy e nuovi snapshot;
- import/export round-trip;
- API schema, auth, concorrenza, idempotenza e route coverage;
- build produzione e sincronizzazione delle 11 locale;
- nessun test ordinario dipendente dalla rete.

### Browser e accessibilità

- 320/360/375/390/430/640 px e reflow 200%;
- tastiera e screen reader;
- tema chiaro/scuro e contrasto del messaggio verde;
- rail routine, alias chip e configurazione attrezzatura;
- niente peso visibile nel corpo libero puro.

### Ambiente reale

- refresh, restart browser, Docker down/up senza `-v`;
- due browser autenticati e conflitti di sync;
- iOS/Android background, force-close e risparmio energetico;
- OAuth demo/account reali Withings e Polar in suite gated;
- cambio palestra fra due sessioni con storico invariato;
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

Polar non richiede una decisione tecnica sulla direzione: la scrittura openGym → Polar non è
offerta dall'API pubblica corrente. L'unica integrazione raccomandabile è Polar → openGym come
arricchimento.

## 13. Fonti esterne ufficiali consultate

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

## 14. Conclusione

Il backlog non è un unico sviluppo. Contiene due correzioni di dominio prioritarie, cinque
miglioramenti locali e tre epic infrastrutturali.

La sequenza più sicura è:

1. isolare le istanze e rendere corretta la progressione dopo modifiche manuali;
2. completare corpo libero, default recupero, timestamp, routine e alias;
3. rendere il timer persistente;
4. introdurre attrezzatura con snapshot;
5. creare API pubblica e secret store;
6. collegare Withings e Polar in sola lettura.

Questa sequenza mantiene spiegabile ogni prescrizione, conserva i workout passati e impedisce
che integrazioni o cambi di palestra modifichino retroattivamente ciò che è già stato registrato.
