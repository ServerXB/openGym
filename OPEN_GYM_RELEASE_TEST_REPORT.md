# openGym — Report di test delle release

## 1. Scopo del documento

Questo documento registra, per ogni requisito rilasciato, cosa è stato verificato, con quali
comandi, quale risultato è stato ottenuto e come replicare i controlli. Non sostituisce il report
storico specifico di Confirmed Rep-Range: lo integra per il backlog ordinato in release descritto
in `OPEN_GYM_PRODUCT_BACKLOG_ANALYSIS.md`.

## 2. Ambiente di riferimento

- Data ultimo aggiornamento: 2026-09-08
- Repository: `https://github.com/ServerXB/openGym.git`
- Branch: `feature/confirmed-rep-range-progression`
- Base prima degli sviluppi applicativi del backlog: `f0f605b`
- Sistema usato per i test: Windows PowerShell
- Frontend: React 19, Vite 8, Vitest 4
- Stato baseline frontend: 18 file di test, 344 test superati
- Docker/CasaOS: non disponibile in questo ambiente di esecuzione

## 3. Comandi generali per replicare i gate

Dalla root del repository:

```powershell
cd frontend
npm.cmd ci
npm.cmd test -- --run
npm.cmd run build
node scripts/check-locales.mjs
```

Per controllare anche errori di whitespace nel diff:

```powershell
cd ..
git diff --check
```

`npm.cmd ci` serve soltanto quando le dipendenze non sono già installate. I test di questa
iterazione sono stati eseguiti su dipendenze già presenti e coerenti con `package-lock.json`.

---

## 4. Release A — Requisito 6: identità delle istanze e gruppi di progressione

### 4.1 Esito

**SUPERATO — commit dedicato creato.**

Gate finale del 2026-08-28:

```text
Test Files  24 passed (24)
Tests       406 passed (406)
Failed      0
```

Rispetto alla baseline sono presenti 62 test in più e 6 file di test in più. La build di
produzione è riuscita, 116 moduli sono stati trasformati e le 11 lingue risultano sincronizzate
con 698 chiavi ciascuna.

### 4.2 Comportamento verificato

Il modello separa ora tre concetti:

```text
exerciseId        → esercizio del catalogo, PR e statistiche globali
routineExerciseId → occorrenza stabile nella routine
progressionId     → gruppo che condivide peso operativo, target, streak e recupero
```

Sono stati verificati questi criteri:

1. configurazioni equivalenti dello stesso esercizio in routine diverse condividono il
   `progressionId`;
2. configurazioni materialmente diverse hanno gruppi indipendenti;
3. due occorrenze nella stessa routine rimangono sempre indipendenti;
4. rinomina e riordino non cambiano l'identità dello slot;
5. cancellazione e nuovo inserimento generano un nuovo `routineExerciseId` e non resuscitano lo
   storico dello slot eliminato;
6. active workout e workout completati congelano entrambi gli ID;
7. un active workout creato prima dell'aggiornamento viene concluso come storico legacy, senza
   inventare uno scope incompatibile;
8. durante un pull, un active workout locale viene riassociato alla routine tramite
   `routineId` + `routineExerciseId` quando il collegamento è certo;
9. gli allenamenti legacy non vengono riscritti;
10. quando `routineId` e ordine rendono certa l'attribuzione, lo storico legacy viene assegnato
    alla routine corretta; i casi realmente ambigui restano baseline condivisa;
11. in un workout misto viene preferita l'entry con `progressionId` esatto rispetto a una entry
    legacy che compare prima;
12. un PR globale non contamina il carico iniziale di due gruppi divergenti;
13. il PR globale non diminuisce, mentre il carico operativo scoped può diminuire dopo deload o
    correzione manuale;
14. reset recupero, recupero adattivo e top-range streak sono condivisi soltanto dallo stesso
    gruppo;
15. una modifica materiale a un gruppo condiviso separa soltanto il futuro, conserva il carico
    operativo corrente e non riscrive i workout completati;
16. la configurazione mostra in UI `Progressione condivisa` oppure `Progressione indipendente`,
    indica le routine compatibili e avvisa prima del salvataggio che provocherebbe un fork;
17. un piano condiviso non esporta ID runtime del mittente;
18. il token opaco del piano conserva gruppi condivisi e indipendenti senza esportare storico,
    pesi o recovery control;
19. l'import genera ID locali nuovi, non si fonde con gruppi già presenti e due import dello
    stesso file restano separati;
20. un errore di scrittura del backfill in `localStorage` non scarta un profilo letto
    correttamente;
21. gli esercizi custom vengono registrati prima di calcolare modalità e firma di compatibilità;
22. statistiche, top set, effort ed e1RM aggregano tutte le occorrenze dello stesso esercizio;
23. una sessione con duplicati produce al massimo un PR e un punto statistico globale per
    esercizio;
24. le configurazioni ereditate dalla routine e quelle esplicite equivalenti hanno la stessa
    firma;
25. serie, range, modalità, corpo libero, lato, peso, incremento, recupero e strategia di
    riduzione modificano la firma; target/streak/epoch runtime non la modificano.

### 4.3 Test automatici mirati

Comando conclusivo usato per il nucleo del requisito:

```powershell
cd frontend
npm.cmd test -- progression-scope.test.js progression-scope.integration.test.js `
  workout-scope.test.js workout-records.test.js state-storage.test.js `
  history.test.js progression.test.js confirmedRepRangeRest.test.js `
  plan-share.test.js exercise-stats.test.js onerm.test.js --run
```

Le suite introdotte o estese sono:

- `progression-scope.test.js`: normalizzazione, firme, ID, legacy, refresh e fork;
- `progression-scope.integration.test.js`: target, streak e recupero fra routine;
- `workout-scope.test.js`: avvio, serializzazione, refresh e completamento;
- `state-storage.test.js`: lettura robusta e custom exercise;
- `workout-records.test.js`: PR globale e peso operativo scoped;
- `exercise-stats.test.js`: aggregazione di occorrenze duplicate;
- `onerm.test.js`: e1RM su tutte le entry dello stesso esercizio;
- `history.test.js`: ultimo set e carico per scope;
- `progression.test.js`: selezione delle sessioni per gruppo;
- `confirmedRepRangeRest.test.js`: recovery control legacy e scoped;
- `plan-share.test.js`: privacy, partizioni e isolamento degli import.

### 4.4 Regressione completa

Comando:

```powershell
cd frontend
npm.cmd test -- --run
```

Risultato:

```text
Test Files  24 passed (24)
Tests       406 passed (406)
Duration    3.41 s
```

### 4.5 Build e lingue

Comandi:

```powershell
cd frontend
npm.cmd run build
node scripts/check-locales.mjs
```

Risultato:

- build Vite: **SUPERATA**;
- moduli trasformati: 116;
- lingue: **11 su 11 sincronizzate**;
- chiavi per lingua: 698;
- resta il warning non bloccante già noto sui chunk superiori alla soglia configurata.

### 4.6 Procedura manuale funzionale

#### Scenario A — Condivisione automatica

1. Creare due routine.
2. Inserire in entrambe lo stesso esercizio con identici serie, modalità, strategia, range, peso,
   incremento e recupero.
3. Aprire la configurazione dell'esercizio.
4. Verificare `Progressione condivisa` e l'elenco dell'altra routine.
5. Completare una sessione pulita nella prima routine.
6. Aprire la seconda routine e verificare che target, streak e recupero proseguano dallo stesso
   storico.

#### Scenario B — Separazione 70/100 kg

1. Configurare lo stesso esercizio a 70 kg con range 8–12 nella routine A.
2. Configurarlo a 100 kg con range 3–5 nella routine B.
3. Verificare `Progressione indipendente` in entrambe.
4. Registrare un PR globale nella routine B.
5. Avviare A e verificare che il carico proposto non diventi il PR di B.
6. Verificare nelle statistiche che il PR globale continui comunque a includere entrambe.

#### Scenario C — Fork di una configurazione condivisa

1. Partire dallo scenario A.
2. Modificare in una sola routine un parametro sostanziale, per esempio il range.
3. Prima di salvare verificare l'avviso di separazione.
4. Salvare e verificare `Progressione indipendente`.
5. Verificare che i workout completati non cambino.
6. Verificare che il prossimo workout parta dalla configurazione modificata e dal carico
   operativo corrente, senza leggere le sessioni future dell'altro gruppo.

#### Scenario D — Duplicato nella stessa routine

1. Inserire due volte lo stesso esercizio nella stessa routine con configurazioni diverse.
2. Completare entrambe le occorrenze nello stesso workout.
3. Verificare che il target successivo di ciascuna legga la propria entry.
4. Verificare che statistiche ed e1RM considerino entrambe, ma mostrino un solo punto/PR globale
   per il workout.

#### Scenario E — Persistenza e dati legacy

1. Eseguire un backup prima dell'aggiornamento.
2. Aggiornare openGym e aprire il profilo.
3. Verificare che routine e workout siano ancora presenti.
4. Fare refresh, logout/login e restart del container senza eliminare i volumi.
5. Verificare che gli ID delle routine non cambino e che il prossimo target sia invariato.
6. Se un workout era già attivo durante l'aggiornamento, completarlo e verificare che sia leggibile
   dalla progressione come baseline legacy.

#### Scenario F — Import di un piano

1. Esportare un piano contenente due routine condivise e una indipendente.
2. Importarlo in un profilo che possiede già lo stesso esercizio.
3. Verificare che le due routine importate restino condivise tra loro.
4. Verificare che la terza resti indipendente.
5. Verificare che nessuna si agganci allo storico locale precedente.
6. Importare di nuovo lo stesso file e verificare che il secondo import abbia gruppi nuovi.

### 4.7 Limiti e gate da eseguire sull'ambiente reale

Non sono stati eseguiti in questa postazione:

- Docker/CasaOS down/up reale;
- sincronizzazione autenticata fra due browser o dispositivi reali;
- WebView mobile con file mirror nativo;
- verifica visuale manuale a 320/360/390/430/640 px;
- screen reader e navigazione completa da tastiera.

Il codice relativo è coperto da test di serializzazione, store, import e build, ma questi controlli
restano obbligatori prima della pubblicazione in produzione su CasaOS.

---

## 5. Release A — Requisito 11: risultati manuali e livello Confirmed validato

### 5.1 Esito

**SUPERATO — implementazione validata e inclusa nel commit dedicato.**

Gate finale del 2026-08-27:

```text
Test Files  25 passed (25)
Tests       471 passed (471)
Failed      0
```

Rispetto al gate del requisito 6 sono presenti 65 test in più e un nuovo file di test. La build
di produzione è riuscita, 117 moduli sono stati trasformati e le 11 lingue risultano
sincronizzate con 717 chiavi ciascuna.

### 5.2 Regole di dominio verificate

Per le sole serie prescritte, cioè le prime `target.sets`, il reducer storico deriva ora:

```text
incomplete        una serie prescritta manca o non è completata
mixed_load        tutte le serie sono completate, ma i carichi non sono uniformi
failed            tutte sono completate a carico uniforme, almeno una è sotto il target
success           tutte raggiungono il target e validano un livello sotto il massimo
top_range_success tutte raggiungono il massimo del range
```

Sono stati verificati questi invarianti:

1. `validatedReps` è il più alto livello valido non superiore al minimo delle ripetizioni
   completate in tutte le serie prescritte;
2. ripetizioni oltre `maxReps` valgono al massimo `maxReps` e una sessione produce al massimo una
   conferma;
3. target 8 con `9/9/9/9` nel range 8–10 prescrive 10;
4. target 8 con `10/10/9/10` valida 9 e prescrive 10;
5. target 8 con `10/9/8/10` valida 8 e prescrive 9;
6. due workout congelati con target 8 e 9, entrambi eseguiti `10/10/10/10` a 70 kg, producono
   72 kg × 8 con incremento esatto di 2 kg;
7. lo streak richiede stesso `progressionId`, stesso range e stesso carico uniforme;
8. fallimento, incompletezza, successo non-top, range differente o cambio carico interrompono la
   conferma al massimo;
9. una serie successiva realmente eseguita sotto target può aggiungere 30 secondi; una serie
   mancante/rimossa non simula un fallimento e non aumenta il recupero;
10. una serie extra riuscita, fallita o non completata non modifica target, streak, recupero o
    working load;
11. tutte le serie prescritte allo stesso peso modificato possono stabilire la nuova baseline;
    carichi misti non promuovono il massimo isolato;
12. il PR globale può includere una serie opzionale, mentre `progressionWeights` usa soltanto il
    blocco prescritto uniforme;
13. i passi di ripetizione per lato arrotondano al livello valido inferiore e avanzano di due;
14. corpo libero e limite massimo di serie conservano il comportamento precedente;
15. un cambio strutturale del range apre un nuovo blocco al minimo senza riscrivere lo storico;
16. uno snapshot legacy privo del range mantiene l'avanzamento sequenziale conservativo, ma non
    riceve conferme accelerate inventate dalla configurazione corrente;
17. ogni nuovo snapshot Confirmed materializza `minReps`, `maxReps` e `rangeStep`;
18. serializzazione JSON e ricalcolo non mutano i workout completati;
19. un workout Confirmed interamente saltato interrompe lo streak senza simulare un fallimento;
20. un set isolato di una sessione incompleta e un blocco a carichi misti non possono diventare
    la baseline quando il vecchio snapshot non contiene il peso;
21. se il comando sul numero di serie separa un gruppo condiviso durante il workout, un blocco
    prescritto uniforme aggiorna sia il gruppo proprietario dello snapshot sia la baseline del
    suo esatto ramo futuro; una serie opzionale più pesante resta esclusa.

### 5.3 UX e lifecycle verificati

- le righe oltre `target.sets` mostrano la label testuale `Opzionale`;
- header, barra, heartbeat, completamento esercizio/superset e prompt finale contano separatamente
  serie prescritte e opzionali;
- una extra non spuntata non produce un falso `Termina in anticipo`;
- una serie prescritta rimossa resta mancante rispetto allo snapshot e produce una sessione
  incompleta;
- add/remove/edit/toggle invalidano un'eventuale conferma peso obsoleta;
- le modifiche limitate alle serie opzionali Confirmed conservano la conferma peso esplicita,
  perché restano fuori dal blocco prescritto; gli altri algoritmi mantengono il lifecycle storico;
- il foglio peso separa PR globale e baseline Confirmed;
- add/remove non modificano implicitamente la routine;
- il comando `Usa N serie dal prossimo allenamento` modifica soltanto lo slot stabile della
  routine per il futuro;
- la scelta futura resta visibile e può essere sostituita subito tornando al numero di righe
  precedente, senza un comando ridondante quando righe e futuro coincidono;
- il target del workout attivo resta congelato e una configurazione condivisa viene separata
  dalla normalizzazione soltanto quando il nuovo numero di serie diverge;
- freestyle e slot legacy ambigui non applicano aggiornamenti permanenti per exerciseId.

### 5.4 Test automatici mirati

Comando:

```powershell
cd frontend
npm.cmd test -- progression.test.js confirmed-rep-range.integration.test.js `
  confirmedRepRangeRestProgression.test.js `
  confirmedRepRangeAutoRest.integration.test.js `
  progression-scope.test.js progression-scope.integration.test.js `
  workout-prescription.test.js workout-records.test.js workout-set-status.test.js `
  workout-scope.test.js plan-share.test.js --run
```

Risultato:

```text
Test Files  11 passed (11)
Tests       285 passed (285)
Failed      0
```

Copertura introdotta o estesa:

- matrice target 8/9/10 sotto, uguale e sopra il livello richiesto;
- due conferme anticipate e incremento singolo esatto;
- fallimento reale contro incompletezza e relativo recupero;
- extra set neutral, carichi misti e baseline uniforme;
- range/per-side, bodyweight, cambio range/carico e automatic recovery;
- storico legacy completo/incompleto e immutabilità JSON;
- fallback del peso con snapshot incompleto/misto privo di carico e ultimo carico uniforme sicuro;
- condivisione e isolamento per `progressionId`, inclusi duplicati;
- passaggio della baseline al ramo futuro dopo un boundary esplicito sul numero di serie;
- snapshot normalizzato e lifecycle active → completed;
- contatori UI puri, serie rimossa, extra, annullamento e riapplicazione del comando futuro;
- distinzione tra PR globale e carico operativo scoped.

### 5.5 Regressione, build, lingue e diff

Comandi:

```powershell
cd frontend
npm.cmd test -- --run
npm.cmd run build
node scripts/check-locales.mjs
cd ..
git diff --check
```

Risultati:

- regressione completa: **25 file, 471 test superati, 0 falliti**;
- build Vite: **SUPERATA**, 117 moduli trasformati;
- lingue: **11 su 11 sincronizzate**, 717 chiavi ciascuna;
- diff check: **SUPERATO**; presenti soltanto avvisi informativi LF/CRLF;
- warning Vite sui chunk grandi: già noto e non bloccante.

### 5.6 Procedura manuale di replica

#### Scenario A — Due conferme anticipate

1. Configurare un esercizio Confirmed con 4 serie, range 8–10, 70 kg e incremento 2 kg.
2. Avviare la prima sessione e verificare target 8.
3. Registrare `10/10/10/10` allo stesso peso e terminare.
4. Verificare che la sessione successiva proponga 70 kg × 10 e mostri conferma 1/2.
5. Registrare di nuovo `10/10/10/10` a 70 kg.
6. Verificare che la sessione seguente proponga 72 kg × 8 e streak 0.

La variante storica con target congelati 8 e 9 è coperta dall'integration test: entrambi gli
snapshot restano byte-per-byte invariati, ma il futuro è 72 kg × 8.

#### Scenario B — Livello minimo realmente dimostrato

1. Con target 8 registrare `9/9/9/9`: il prossimo target deve essere 10.
2. Ripetere da un backup con `10/10/9/10`: il prossimo target deve essere 10.
3. Ripetere con `10/9/8/10`: il prossimo target deve essere 9.
4. Verificare che una singola serie più alta non compensi mai quella più bassa.

#### Scenario C — Fallimento contro incompletezza

1. Con target 8 e recupero 120 s registrare `8/7/8/8`: il prossimo recupero deve essere 150 s.
2. In una sessione equivalente, rimuovere o lasciare non eseguita una serie prescritta dopo avere
   completato la prima.
3. Terminare anticipatamente e verificare che il recupero resti 120 s: la sessione è incompleta,
   non fallita.

#### Scenario D — Serie opzionale

1. Durante un workout 4×8 aggiungere una quinta serie.
2. Verificare la label `Opzionale` e il contatore separato nell'header.
3. Lasciarla non spuntata e terminare: non deve comparire un falso avviso di serie prescritta
   mancante.
4. Ripetere completandola con poche ripetizioni o un peso maggiore: target, streak, recupero e
   baseline devono dipendere soltanto dalle prime quattro serie; il peso maggiore può comparire
   esclusivamente come PR globale.

#### Scenario E — Carichi manuali

1. Portare tutte le quattro serie prescritte da 70 a 72 kg e completarle: 72 kg diventa il carico
   operativo futuro.
2. In un'altra sessione usare `70/70/72/70`: la sessione non deve validare il livello né usare 72
   come baseline.
3. Aprire il foglio peso e verificare il testo che distingue record e working load Confirmed.

#### Scenario F — Numero di serie dalla sessione successiva

1. In una routine 4×8 aggiungere una quinta riga durante il workout.
2. Senza premere il comando permanente, ricaricare/terminare e verificare che la routine resti a
   quattro serie.
3. Ripetere, premere `Usa 5 serie dal prossimo allenamento` e verificare il messaggio di conferma.
4. Verificare che il workout attivo continui ad avere `target.sets = 4` e che la nuova quinta riga
   resti opzionale.
5. Avviare il workout successivo: deve prescrivere cinque serie.
6. Se lo stesso esercizio era condiviso con un'altra routine a quattro serie, verificare che solo
   lo slot modificato passi a cinque e che le progressioni future risultino separate.
7. Prima di terminare, rimuovere la quinta riga: devono restare visibili sia `Prossimo
   allenamento: 5 serie` sia il comando `Usa 4 serie dal prossimo allenamento`.
8. Riapplicare quattro serie: il comando scompare e resta il riepilogo futuro a quattro, mentre
   il target del workout attivo non cambia.
9. In una prova condivisa separata, eseguire le quattro serie prescritte tutte a 72 kg, una extra
   a 90 kg e applicare cinque serie: il prossimo workout del ramo nuovo deve partire da 72 kg,
   mai da 70 o 90; il gruppo originale conserva correttamente il risultato del workout attivo.

### 5.7 Gate manuali ancora necessari sull'ambiente reale

Non eseguiti in questa postazione:

- verifica visuale a 320/360/390/430/640 px e con font di sistema ingranditi;
- screen reader e navigazione completa da tastiera;
- refresh e sincronizzazione autenticata fra due browser reali durante un workout attivo;
- Docker/CasaOS down/up con volume persistente;
- WebView mobile e comportamento del foglio peso su dispositivo fisico.

Questi gate non sostituiscono i test automatici verdi e devono essere eseguiti prima della
pubblicazione in produzione su CasaOS.

---

## 6. Release B — Requisito 1: corpo libero puro e zavorrato

### 6.1 Esito

**SUPERATO — implementazione validata e inclusa nel commit dedicato.**

Gate conclusivo del 2026-08-28:

```text
Test Files  26 passed (26)
Tests       501 passed (501)
Failed      0
```

Non è stato introdotto un nuovo campo dati né è stata eseguita una migrazione. La modalità di
carico è derivata da `bodyweight` e `weight`; gli snapshot terminati restano immutati.

### 6.2 Comportamento funzionale verificato

1. vengono distinti `external`, `pure_bodyweight` e `added_bodyweight`;
2. nel corpo libero puro Reps mostra soltanto serie e ripetizioni;
3. nel corpo libero puro Time mostra serie e secondi senza il precedente doppio campo peso;
4. nel corpo libero puro Confirmed mostra serie, range e recupero, senza gruppo Carico;
5. `Aggiungi zavorra` rivela un unico campo `Peso aggiunto`; `Rimuovi zavorra` torna a zero;
6. una configurazione legacy `bodyweight: true` con peso positivo resta zavorrata;
7. uno snapshot moderno con `weight: 0` è autoritativo anche contro una riga anomala positiva;
8. uno snapshot precedente privo di `weight` può riconoscere una zavorra reale soltanto da una
   serie completata positiva;
9. `buildSets`, la prescrizione e lo snapshot finale forzano ogni nuova serie pura a `w = 0`;
10. storico, `exWeights` e `progressionWeights` di una modalità incompatibile non possono
    riapparire come carico invisibile;
11. un passaggio da carico esterno a zavorra esplicita parte dal peso aggiunto configurato, non
    dalla vecchia mappa operativa;
12. Reps e Confirmed puri progrediscono in ripetizioni/serie senza inventare carico;
13. lo streak Confirmed e il recupero adattivo non si combinano fra puro e zavorrato;
14. il corpo libero puro non produce PR/e1RM da righe anomale, badge Best o conferma top weight;
15. il corpo libero zavorrato conserva invece PR, working load e progressione normali;
16. aggiungere una serie durante un workout puro mantiene `w = 0` anche su un active snapshot
    legacy o malformato;
17. un incremento di carico nascosto non separa due scope Reps puri equivalenti;
18. l'incremento Time resta materiale perché indica secondi;
19. export/import del piano omette peso e incremento di carico puri, ma conserva peso e
    incremento della zavorra;
20. nessuna lettura o prescrizione riscrive retroattivamente i workout completati.

### 6.3 UX/UI introdotta

- stato puro: testo specifico per ripetizioni o durata e pulsante `Aggiungi zavorra`;
- stato zavorrato: un solo campo `Peso aggiunto`, incremento/preset quando applicabili e comando
  `Rimuovi zavorra`;
- workout puro: nessuna colonna peso, nessun badge Best e nessun foglio top weight;
- workout zavorrato: colonna etichettata `Peso aggiunto`, derivata dal target congelato e non dai
  valori temporanei delle righe;
- i controlli disclosure espongono testo, `aria-expanded` e `aria-controls`;
- le nuove stringhe sono disponibili nel fallback comune e tradotte in italiano.

### 6.4 Test automatici mirati

Comando:

```powershell
cd frontend
npm.cmd test -- exercise-load-mode.test.js history.test.js progression.test.js `
  progression-scope.test.js workout-prescription.test.js workout-scope.test.js `
  workout-records.test.js plan-share.test.js
```

Risultato:

```text
Test Files  9 passed (9)
Tests       321 passed (321)
Failed      0
```

La matrice comprende classificazione, Reps/Time/Confirmed, mappe operative, transizioni,
snapshot legacy, PR, scope, import/export, serie aggiunte e immutabilità dello storico.

### 6.5 Regressione, build, lingue e diff

Comandi:

```powershell
cd frontend
npm.cmd test
npm.cmd run build
node scripts/check-locales.mjs
cd ..
git diff --check
```

Risultati:

- regressione completa: **26 file, 501 test superati, 0 falliti**;
- build Vite: **SUPERATA**, 118 moduli trasformati;
- lingue: **11 su 11 sincronizzate**, 722 chiavi ciascuna;
- diff check: **SUPERATO**; presenti soltanto avvisi informativi LF/CRLF;
- warning Vite sui chunk grandi: già noto e non bloccante.

### 6.6 Procedura manuale di replica

#### Scenario A — Reps a corpo libero puro

1. Aprire una routine e configurare un push-up in modalità Reps con `Corpo libero` attivo.
2. Verificare che non compaiano `Peso`, `Peso aggiunto`, incremento o preset di carico.
3. Verificare che compaia soltanto il pulsante `Aggiungi zavorra`.
4. Salvare, avviare il workout e verificare che ogni serie contenga solo ripetizioni.
5. Completare l'esercizio: non devono apparire badge Best o richiesta di conferma peso.
6. Aggiungere una serie durante il workout e verificare, esportando il backup dopo il termine,
   che anche la nuova riga abbia `w: 0`.

#### Scenario B — Time a corpo libero puro

1. Configurare un plank con modalità Time e corpo libero attivo.
2. Verificare che siano visibili serie e secondi, senza alcun campo peso duplicato.
3. Attivare la progressione `Aggiungi tempo` e impostare un passo di 5 o 10 secondi.
4. Salvare e completare il workout: la durata deve progredire, il peso deve restare zero.

#### Scenario C — Confirmed puro, anche ereditato

1. Impostare `Confirmed Rep-Range` sulla routine e lasciare l'esercizio senza override locale.
2. Configurare un pull-up a corpo libero con range 8–10.
3. Verificare che il gruppo Carico sia assente e che range/recupero restino disponibili.
4. Eseguire due sessioni `10/10/10/10`: la sessione seguente deve aumentare le serie e ripartire
   da 8, senza proporre automaticamente una zavorra.

#### Scenario D — Aggiunta e rimozione della zavorra

1. Su un esercizio puro premere `Aggiungi zavorra`.
2. Verificare che appaia un solo campo `Peso aggiunto`; inserire 10 kg e salvare.
3. Riaprire la configurazione dopo refresh: il campo deve essere ancora visibile a 10 kg.
4. Avviare il workout: la colonna deve chiamarsi `Peso aggiunto`, e il normale flusso di carico
   e conferma peso deve essere disponibile.
5. Terminare, riaprire la configurazione e premere `Rimuovi zavorra`.
6. Salvare e avviare il workout successivo: tutte le righe devono partire da zero; il workout
   zavorrato precedente deve continuare a mostrare `+10` nello storico.

#### Scenario E — Protezione dalle mappe operative

1. Usare lo stesso slot come esercizio esterno con un carico alto e terminare una sessione.
2. Passarlo a corpo libero puro: il workout successivo deve essere a zero.
3. Premere poi `Aggiungi zavorra`, impostare 5 o 10 kg e salvare.
4. Il primo workout zavorrato deve partire dal valore appena configurato, non dal vecchio carico
   esterno; i workout precedenti non devono cambiare.

#### Scenario F — JSON legacy e piano condiviso

1. Esportare un piano contenente un corpo libero puro e uno con
   `bodyweight: true, weight: 10`.
2. Aprire il JSON: il puro non deve contenere un peso positivo né un incremento di carico; il
   secondo deve conservare `weight: 10`.
3. Importare il piano in un profilo di prova: il primo deve aprirsi puro, il secondo zavorrato.
4. Verificare nello storico un vecchio workout zavorrato: la label `+10` deve restare leggibile.

#### Scenario G — Routine condivise e indipendenti

1. Inserire lo stesso esercizio puro con configurazione equivalente in due routine compatibili:
   la preview deve indicare progressione condivisa.
2. Aggiungere zavorra soltanto in una routine e salvare: la preview deve indicare la separazione
   futura, senza modificare i workout completati dell'altra routine.
3. Allenare entrambe e verificare che target, streak, recupero e carico non si mescolino.

#### Scenario H — Persistenza CasaOS

1. Eseguire gli scenari puro e zavorrato, terminare i workout ed esportare un backup JSON.
2. Eseguire refresh e logout/login; verificare configurazioni e storico.
3. Riavviare i container con `docker compose down` e `docker compose up -d`, senza `-v`.
4. Verificare che la zavorra configurata e gli snapshot storici siano invariati.
5. Importare il backup in un profilo di prova e ripetere i controlli.

### 6.7 Gate manuali ancora necessari sull'ambiente reale

Non eseguiti in questa postazione:

- verifica visuale a 320/360/390/430/640 px e reflow 200%;
- screen reader e navigazione completa da tastiera;
- refresh e sincronizzazione autenticata fra due browser reali durante un workout attivo;
- Docker/CasaOS down/up con volume persistente;
- WebView mobile su dispositivo fisico.

I test automatici e la build sono verdi; questi gate restano necessari prima della pubblicazione
in produzione su CasaOS.

---

## 7. Release B — Requisito 5: auto-riduzione predefinita sulle nuove selezioni Confirmed

### 7.1 Esito

**SUPERATO — implementazione validata e inclusa nel commit dedicato.**

Gate conclusivo del 2026-08-29:

```text
Test Files  26 passed (26)
Tests       509 passed (509)
Failed      0
```

Non sono stati introdotti campi, migrazioni o reset automatici ulteriori. Il campo già esistente
`restReductionStrategy` viene materializzato soltanto in risposta a una nuova selezione; il
decoder dei dati storici continua a scegliere `manual` quando il campo non è affidabile.

### 7.2 Comportamento funzionale verificato

1. il decoder legacy interpreta campo assente, `null` o sconosciuto come `manual`;
2. una nuova selezione Confirmed sull'esercizio materializza `auto_after_successes` nella bozza;
3. la bozza mostra quindi `Riduzione automatica del recupero` già attiva prima di Salva;
4. scegliere `Segui la routine` da un override diverso applica il default se la routine è
   Confirmed;
5. passare da Time a Reps applica il default quando rende effettiva la policy Confirmed ereditata;
6. un nuovo esercizio Reps aggiunto a una routine già Confirmed nasce con il default automatico;
7. selezionare Confirmed sulla routine aggiorna soltanto gli esercizi Reps ereditanti;
8. esercizi Time, cardio e con override locale restano invariati;
9. un valore esplicito `manual` non viene mai sostituito dal nuovo default;
10. anche una scelta automatica esplicita sopravvive ai cambi temporanei;
11. una preferenza esplicita viene salvata come dato dormiente sotto un'altra policy o modalità e
    torna effettiva quando si rientra in Confirmed;
12. un Confirmed legacy già presente e privo del campo resta manuale senza richiedere migrazioni;
13. import/export conserva automatico e manuale, mentre non inventa il campo nei piani legacy;
14. il target immutabile del workout snapshotta la strategia effettivamente selezionata;
15. workout attivi e completati non vengono modificati né reinterpretati;
16. manuale e automatico continuano a essere impostazioni materiali per lo scope futuro;
17. la riduzione esistente resta di 30 secondi dopo quattro successi allo stesso recupero e non
    scende mai sotto il recupero iniziale.

### 7.3 UX/UI

Non è stato aggiunto un nuovo controllo: viene riutilizzato il toggle già presente nel gruppo
`Recupero` di Confirmed Rep-Range.

- nuova attivazione: toggle acceso;
- configurazione legacy senza campo: toggle spento;
- scelta manuale precedente: toggle spento e rispettato;
- l'utente può spegnerlo prima di salvare;
- cambiare temporaneamente policy o modalità non perde la scelta esplicita.

### 7.4 Test automatici mirati

Comando:

```powershell
cd frontend
npm.cmd test -- confirmedRepRangeConfig.test.js confirmed-rep-range.integration.test.js `
  confirmedRepRangeAutoRest.test.js confirmedRepRangeAutoRest.integration.test.js `
  plan-share.test.js workout-prescription.test.js progression-scope.test.js
```

Risultato:

```text
Test Files  7 passed (7)
Tests       97 passed (97)
Failed      0
```

La matrice copre decoder, evento di selezione, routine mista, ereditarietà, cambio modalità,
preferenza dormiente, import/export, snapshot, scope e motore di riduzione.

### 7.5 Regressione, build, lingue e diff

Comandi:

```powershell
cd frontend
npm.cmd test
npm.cmd run build
node scripts/check-locales.mjs
cd ..
git diff --check
```

Risultati:

- regressione completa: **26 file, 509 test superati, 0 falliti**;
- build Vite: **SUPERATA**, 118 moduli trasformati;
- lingue: **11 su 11 sincronizzate**, 722 chiavi ciascuna;
- diff check: **SUPERATO**; presenti soltanto avvisi informativi LF/CRLF;
- warning Vite sui chunk grandi: già noto e non bloccante.

### 7.6 Procedura manuale di replica

#### Scenario A — nuova selezione sull'esercizio

1. Aprire un esercizio Reps configurato con una policy diversa da Confirmed.
2. Selezionare `Confirmed Rep-Range` nel campo `Regola`.
3. Senza salvare, scorrere al gruppo Recupero.
4. Verificare che `Riduzione automatica del recupero` sia già attiva.
5. Salvare, aggiornare la pagina e riaprire: il toggle deve restare attivo.

#### Scenario B — selezione sulla routine e nuovo esercizio

1. Creare o aprire una routine non Confirmed contenente un esercizio Reps ereditante, un Time e
   un Reps con override locale.
2. Selezionare Confirmed come progressione della routine.
3. Verificare che il Reps ereditante sia automatico; Time e override devono restare invariati.
4. Aggiungere un nuovo esercizio Reps e aprirne la configurazione: il toggle deve essere già
   attivo prima del primo salvataggio.

#### Scenario C — JSON legacy

1. Importare o usare un backup precedente con routine Confirmed ma senza
   `restReductionStrategy`.
2. Aprire l'esercizio senza cambiare policy: il toggle deve risultare spento.
3. Avviare un workout e riesportare il backup: nessuna automazione deve essere stata abilitata
   implicitamente e i workout precedenti devono essere invariati.

#### Scenario D — scelta manuale persistente

1. In un nuovo Confirmed spegnere il toggle e salvare.
2. Passare a Linear o Time, salvare, poi tornare a Confirmed/Reps.
3. Verificare che il toggle resti spento e che non venga riattivato dal nuovo default.
4. Ripetere partendo da automatico: la scelta attiva deve sopravvivere allo stesso ciclo.

#### Scenario E — cambio eredità e modalità

1. In una routine Confirmed impostare un esercizio Reps con override Double.
2. Selezionare `Segui la routine`: il toggle deve diventare attivo.
3. Su un nuovo esercizio Time che segue la routine, passare a Reps: Confirmed diventa effettivo e
   il toggle deve risultare attivo.

#### Scenario F — riduzione effettiva e persistenza CasaOS

1. Portare il recupero effettivo sopra il valore iniziale con un fallimento di una serie
   successiva alla prima.
2. Completare quattro workout riusciti prescritti allo stesso recupero.
3. Verificare che il workout seguente proponga 30 secondi in meno, mai sotto il valore iniziale.
4. Eseguire refresh, logout/login e `docker compose down` / `docker compose up -d` senza `-v`.
5. Verificare che scelta, recupero e snapshot storici siano invariati.

### 7.7 Gate manuali ancora necessari sull'ambiente reale

Non eseguiti in questa postazione:

- interazione completa del toggle in un browser reale;
- refresh e sincronizzazione autenticata fra due browser;
- Docker/CasaOS down/up con volume persistente;
- WebView mobile su dispositivo fisico.

I test automatici e la build sono verdi; questi gate restano necessari prima della pubblicazione
in produzione su CasaOS.

---

## 8. Release B — Requisito 12: data e ora di inizio/fine workout

### 8.1 Esito

**SUPERATO — implementazione validata e inclusa nel commit dedicato di questo requisito.**

Gate conclusivo del 2026-09-05:

```text
Test Files  29 passed (29)
Tests       550 passed (550)
Failed      0
```

Il requisito non riscrive alcun workout esistente. I campi numerici `start` e `end` restano
compatibili con tutto lo storage precedente; i nuovi metadati opzionali spiegano se un orario è
nativo, importato oppure sconosciuto.

### 8.2 Comportamento funzionale verificato

1. `nativeWorkoutStart` usa una sola lettura temporale per costruire start e data;
2. la data `d` è derivata dallo stesso istante nel fuso catturato, senza race a mezzanotte;
3. `nativeWorkoutEnd` usa una sola lettura temporale per end e registra il fuso di fine;
4. start, end e metadati non mutano l'active passato alle funzioni di dominio;
5. un active workout legacy può essere concluso senza migrazione e riceve metadati nativi
   mancanti;
6. lo scarto dell'active continua a non creare un workout storico;
7. i nuovi dati sopravvivono al round-trip JSON e allo storage locale;
8. data, intervallo e durata sono localizzati e mostrati soltanto quando affidabili;
9. un intervallo oltre mezzanotte include esplicitamente la data finale;
10. un cambio di fuso include la data finale anche se il numero del giorno coincide;
11. la durata resta assoluta durante il passaggio DST;
12. l'ora ripetuta del DST autunnale mostra offset diversi e non appare come durata zero;
13. ISO con `Z`/offset mantengono epoch, secondi e giorno locale corretti;
14. un import con start ma senza end mostra soltanto lo start, non un falso intervallo a zero;
15. un import solo-data non mostra mai le 18:00 usate come fallback tecnico;
16. una riga con start impossibile viene scartata senza rollover silenzioso; un end non valido
    viene ignorato senza perdere la serie valida;
17. un wall clock inesistente nel salto DST primaverile viene scartato, non normalizzato avanti;
18. un end importato nel giorno successivo non viene più perso o ricondotto allo start;
19. workout legacy con intervallo positivo restano leggibili senza nuovi campi;
20. legacy con `start === end` restano solo-data, compatibili con il vecchio importer;
21. timestamp, date, locale o fusi corrotti non producono mai `Invalid Date`;
22. il wiring reale conserva lo start fino al finish, non duplica un doppio finish e lo scarto
    non crea storico;
23. il riepilogo mensile somma soltanto durate note e non trasforma import solo-data in `0 min`;
24. target, serie, peso, volume, PR, progressione e recupero non sono coinvolti.

### 8.3 Modello dati e backward compatibility

Nuovo workout nativo:

```json
{
  "d": "2026-08-29",
  "start": 1788019500000,
  "end": 1788023520000,
  "startTimeZone": "Europe/Rome",
  "endTimeZone": "Europe/Rome",
  "timeSource": "native",
  "timePrecision": "millisecond"
}
```

Matrice di lettura:

| Dato | Presentazione |
|---|---|
| Nativo nuovo | Data completa · start–end · durata |
| Import con orario | Data completa · start–end se noto · durata se positiva |
| Import solo-data | Solo data; nessun orario tecnico |
| Legacy con `end > start` | Intervallo storico e durata, senza migrazione |
| Legacy con `start === end` | Solo data |
| Timestamp/data non validi | Parti non affidabili omesse; mai `Invalid Date` |
| Fuso non valido | Fallback sicuro; mai `Invalid Date` |

Il formatter centrale è usato da History, Recent workouts, righe/dettagli aperti dal Calendar,
dettaglio workout e Admin.
Il riepilogo di fine mostra data e intervallo sotto il titolo, mantenendo la durata nella tile
esistente. L'header attivo non è stato ampliato perché a 320 px contiene già elapsed, serie e
azioni principali.

### 8.4 Import verificato

L'importer ora:

- valida anno, mese, giorno, ora, minuti e secondi dello start prima di accettare una riga; un
  end non valido viene ignorato senza scartare la serie valida;
- classifica la precisione come `date-only`, `minute`, `second` o `millisecond`;
- rispetta l'epoch di ISO con `Z`/offset e lo converte nel giorno del fuso locale d'importazione;
- interpreta separatamente start ed end nel fuso locale;
- non calcola più l'orario sommando millisecondi alla mezzanotte, operazione errata nei giorni
  con cambio DST;
- scarta un wall clock locale che non esiste nel salto DST primaverile;
- conserva la data completa dell'end, compreso il giorno successivo;
- continua a mantenere il fallback numerico delle 18:00 per compatibilità con statistiche e JSON,
  ma lo rende invisibile tramite provenance esplicita.

Un wall clock privo di offset nell'ora ripetuta del cambio autunnale è intrinsecamente ambiguo:
la piattaforma sceglie una delle due occorrenze. Quando il file fornisce `Z` o un offset, invece,
l'istante è univoco e viene conservato esattamente. Gli import effort esistenti sono stati inclusi
nel gate mirato per verificare che la modifica del parser non perda RPE/RIR, unità o set.

### 8.5 Test automatici mirati

Comando:

```powershell
cd frontend
npm.cmd test -- workout-time.test.js import-time.test.js import-effort.test.js `
  state-storage.test.js workout-lifecycle.integration.test.jsx --run
```

Risultato:

```text
Test Files  5 passed (5)
Tests       57 passed (57)
Failed      0
```

La matrice include acquisizione singola, lifecycle reale, finish idempotente, scarto, persistenza,
locale italiano, date-only, start senza end, mezzanotte, cambio fuso, entrambi i passaggi DST,
ISO offset/secondi, wall clock DST inesistente, dati corrotti, leap year, end nel giorno successivo
e integrazione importer → formatter.

### 8.6 Regressione, build, lingue e diff

Comandi:

```powershell
cd frontend
npm.cmd test
npm.cmd run build
node scripts/check-locales.mjs
cd ..
git diff --check
```

Risultati:

- regressione completa: **29 file, 550 test superati, 0 falliti**;
- build Vite: **SUPERATA**, 119 moduli trasformati;
- lingue: **11 su 11 sincronizzate**, 722 chiavi ciascuna;
- diff check: **SUPERATO**; presenti soltanto avvisi informativi LF/CRLF;
- warning Vite sui chunk grandi: già noto e non bloccante.

### 8.7 Procedura manuale di replica

Gli scenari A–H seguenti sono procedure di accettazione da eseguire sull'ambiente reale; non
sono stati eseguiti in questa postazione e non vengono presentati come test E2E già superati.

#### Scenario A — workout nativo normale

1. Annotare data, ora e fuso del dispositivo.
2. Avviare un workout, completare almeno una serie e terminarlo.
3. Nel riepilogo verificare `data completa · ora inizio–ora fine` e la durata nella tile.
4. Aprire History, Recent workouts e dettaglio; dal Calendar toccare il giorno allenato e aprire
   la relativa riga/dettaglio. La stessa cronologia deve comparire in tutti questi punti.
5. Verificare che serie, peso, volume, PR e prescrizione successiva siano invariati.

#### Scenario B — refresh e chiusura sullo stesso dispositivo

1. Avviare un workout e attendere almeno un minuto.
2. Aggiornare la pagina oppure chiudere e riaprire il browser senza cancellare i dati del sito.
3. Verificare che il workout sia ancora attivo e che l'elapsed continui dallo start originale.
4. Terminarlo e verificare che l'ora di inizio sia quella precedente al refresh, non quella di
   riapertura.

#### Scenario C — import solo-data

1. Creare un CSV:

   ```csv
   Date,Exercise,Weight,Reps
   2026-08-29,Bench Press,60,10
   ```

2. Importarlo da Settings e aprire il workout nello storico.
3. Deve comparire la data completa, ma non `18:00`, un intervallo o `0 min`.
4. Se il mese contiene soltanto workout solo-data, anche il riepilogo Calendar deve omettere
   `0 min`.
5. Esportare il backup e verificare `timeSource: "import"` e
   `timePrecision: "date-only"`.

#### Scenario D — import con end dopo mezzanotte

1. Creare un CSV Hevy minimo:

   ```csv
   title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps
   Late,"29 Aug 2026, 23:30","30 Aug 2026, 00:45",Bench Press (Barbell),0,normal,60,10
   ```

2. Importarlo e aprire il workout.
3. Verificare start `23:30`, data finale `30 ago 2026`, end `00:45` e durata `1h 15m`.
4. Nel backup verificare `timeSource: "import"`, `timePrecision: "minute"` e i fusi.

#### Scenario E — storico legacy

1. Fare un backup dei dati reali prima dell'aggiornamento.
2. Dopo il deploy aprire un vecchio workout con start/end reali: deve mostrare data, intervallo e
   durata senza che il JSON venga migrato manualmente.
3. Aprire un vecchio import che mostrava durata ignota: deve mostrare solo la data.
4. Confrontare il backup prima/dopo: workout, serie, target e pesi storici devono essere identici.

#### Scenario F — discard e finish anticipato

1. Avviare un workout, registrare una serie e scegliere Scarta; il numero di workout in History
   non deve aumentare.
2. Avviarne un altro, registrare una serie e scegliere Termina in anticipo.
3. Confermare: deve essere creato un solo workout, con un solo end e cronologia leggibile.
4. Annullare invece il dialog in una terza prova: l'active deve restare aperto e senza end.

#### Scenario G — cambio fuso durante il workout

1. Su un dispositivo di prova avviare il workout in un fuso, annotando l'ora.
2. Cambiare il fuso del dispositivo e terminare il workout.
3. Lo storico deve mostrare start nel fuso iniziale, end nel nuovo fuso e la data accanto all'end;
   la durata deve dipendere dagli epoch, non dalla differenza fra gli orologi a parete.

#### Scenario H — persistenza CasaOS e sync

1. Terminare un workout e verificare la cronologia nel browser collegato a CasaOS.
2. Eseguire refresh, logout/login e aprire lo stesso profilo su un secondo browser: il workout
   completato deve conservare epoch, provenance, precisione e fusi.
3. Eseguire `docker compose down` e `docker compose up -d` senza `-v`.
4. Verificare nuovamente lo storico e confrontare un backup JSON.
5. Non aspettarsi che un workout ancora attivo compaia sul secondo dispositivo: il server
   elimina intenzionalmente `state.active`; lo start in corso è persistente solo localmente.

### 8.8 Gate manuali ancora necessari sull'ambiente reale

Non eseguiti in questa postazione:

- controllo visuale di righe cronologiche a 320/360/390/430/640 px e reflow 200%;
- refresh/restart in browser reale durante un workout attivo;
- cambio fuso reale durante una sessione e verifica DST su dispositivo;
- import tramite file picker reale e confronto con backup dell'utente;
- sincronizzazione autenticata fra due browser per un workout completato;
- Docker/CasaOS down/up con volume persistente;
- WebView mobile su dispositivo fisico.

I gate automatici sono verdi. Quelli sopra vanno eseguiti sull'ambiente reale prima della
pubblicazione definitiva; non indicano un fallimento del codice, ma coprono browser, storage e
infrastruttura non disponibili in questa postazione.

---

## 9. Release C — Requisito 7: profili attrezzatura e pesi da caricare

### 9.1 Esito

**SUPERATO — incluso nel commit dedicato del requisito 7.**

Gate finale del 2026-09-08:

```text
Test mirati
Test Files  10 passed (10)
Tests       97 passed (97)
Failed      0

Regressione completa
Test Files  33 passed (33)
Tests       593 passed (593)
Failed      0
```

La build di produzione è riuscita con 123 moduli trasformati. Le 11 lingue hanno 835 chiavi
ciascuna e sono sincronizzate. Il controllo del diff è superato; gli avvisi LF/CRLF sono
informativi e il warning Vite sulla dimensione dei chunk era già noto.

È inoltre superato il controllo browser riproducibile in Edge headless a 320 px per elenco
profili, editor e guida durante il workout, in tema scuro e chiaro.

### 9.2 Modello e regole funzionali verificate

Lo stato sincronizzabile contiene ora:

```json
{
  "equipmentProfiles": [
    {
      "schemaVersion": 1,
      "id": "equipment-profile:gym",
      "name": "Palestra",
      "unit": "kg",
      "items": [
        {
          "id": "bar-main",
          "kind": "symmetric_bar",
          "label": "Bilanciere olimpico",
          "catalogEquipment": "barbell",
          "tareWeight": 20,
          "sideCount": 2,
          "denominations": [
            { "weight": 20, "count": 2 },
            { "weight": 5, "count": 2 }
          ]
        }
      ]
    }
  ],
  "activeEquipmentProfileId": "equipment-profile:gym"
}
```

Sono state verificate queste regole:

1. si possono creare profili separati per palestra, casa o viaggio e sceglierne uno per i
   prossimi workout;
2. ogni attrezzo ha identità locale, tipo, nome, associazione opzionale alla categoria del
   catalogo, tara, lati e inventario con quantità;
3. sono supportati bilanciere simmetrico, manubrio caricabile, manubrio/kettlebell fisso,
   pacco pesi, macchina plate-loaded a uno o due lati e attrezzo con istruzione manuale;
4. l'override esplicito dello slot ha precedenza sul mapping del catalogo;
5. il mapping automatico avviene soltanto con una corrispondenza esatta e univoca; zero o più
   corrispondenze producono un messaggio esplicito e nessun calcolo inventato;
6. se un override viene eliminato dallo stesso profilo, non viene sostituito silenziosamente;
7. dopo il cambio profilo è ammesso soltanto il nuovo matching univoco per categoria, perché gli
   ID locali della palestra precedente non hanno significato nella nuova;
8. per bilancieri e macchine il peso registrato è totale; per manubri e kettlebell è il peso di
   un singolo attrezzo; gli attrezzi custom restano manuali;
9. per i manubri `sets[].w` continua quindi a rappresentare un singolo manubrio. La quantità
   usata è separata e può essere impostata a uno o più attrezzi senza moltiplicare il target;
10. corpo libero puro e cardio non ricevono suggerimenti di carico; un corpo libero zavorrato
    può invece associare l'attrezzatura alla zavorra;
11. la selezione di un attrezzo locale, il suo ID, la tara e l'inventario non modificano il
    `progressionId`; un cambio reale di significato `total`/`per_implement` separa invece la
    progressione futura;
12. i vecchi JSON senza i nuovi campi usano array vuoto e profilo nullo, senza migrazioni
    manuali e senza cambiare workout o prescrizioni esistenti.

### 9.3 Solver deterministico verificato

Il calcolo usa centesimi interi e una ricerca bounded subset-sum, non una scelta greedy. Sono
stati verificati:

- soluzione esatta non greedy;
- risultato indipendente dall'ordine nel quale è inserito l'inventario;
- tie-break deterministico: meno piastre, poi preferenza stabile per quelle più pesanti;
- quantità realmente disponibili e simmetria fra i due lati;
- divisione dell'inventario fra due lati e fra il numero di manubri usati;
- valori frazionari fino a 0,01 kg/lb;
- combinazione inferiore e superiore più vicina quando il target non è componibile;
- target uguale alla tara, target sotto tara e inventario insufficiente;
- selezione diretta per manubri fissi, kettlebell e pacchi pesi;
- macchine plate-loaded a uno o due lati;
- nessuna conversione implicita fra profilo in kg e workout in lb;
- nessuna formula inventata per attrezzatura custom o semantica incompatibile;
- limite di complessità fail-safe: un inventario patologico restituisce un errore esplicito e
  non una combinazione ottenuta da una ricerca parziale;
- il target della progressione non viene mai corretto dal solver. Se non è caricabile, la UI
  propone i vicini e lascia all'utente la scelta di cosa registrare.

Caso nominale verificato:

```text
Target workout:       70 kg
Bilanciere vuoto:     20 kg
Residuo:              50 kg
Carico per lato:      25 kg
Messaggio:            bilanciere 20 kg + 20 kg + 5 kg per lato
```

È stato eseguito anche un confronto deterministico fra il solver di produzione e un enumeratore
brute-force indipendente su 2.000 inventari piccoli generati con seed fisso. Per ogni caso sono
stati confrontati soluzione esatta, valore inferiore più vicino e valore superiore più vicino.

```powershell
cd frontend
node scripts/check-equipment-solver.mjs
```

```text
2000 deterministic brute-force solver comparisons passed
```

### 9.4 UX/UI verificata

Da `Impostazioni → Attrezzatura` sono disponibili:

- elenco dei profili e indicazione di quello attivo;
- creazione, attivazione ed eliminazione del profilo;
- unità kg/lb separata per profilo;
- editor di tipo, nome, match automatico, tara, lati, inventario/quantità e istruzione custom;
- testi espliciti che distinguono modifiche future da snapshot attivi o terminati.

Nella configurazione dell'esercizio sono disponibili:

- tipo suggerito dal catalogo;
- `Automatico`, `Nessun suggerimento` oppure attrezzo esplicito;
- significato visibile del peso registrato;
- quantità separata per manubri caricabili e pesi fissi;
- anteprima costruita sul prossimo peso Confirmed quando la strategia è attiva.

Durante il workout la guida è sopra le serie e segue la prossima serie non completata. Se il
peso di quella serie viene modificato manualmente, il messaggio viene ricalcolato immediatamente;
quando tutte le serie sono concluse scompare. Una composizione esatta usa il token semantico
`success`, mentre casi impossibili, ambigui o incoerenti usano un warning distinto.

Il significato non dipende dal colore: ogni box contiene icona, intestazione e testo, usa
`role="status"` e `aria-live="polite"`. Il contrasto del testo success sul relativo sfondo è
stato calcolato in sRGB:

| Tema | Colore testo | Sfondo composito | Contrasto | Esito WCAG AA testo normale |
|---|---|---|---:|---|
| Scuro | `#30d158` | `#1f3526` | 6,51:1 | Superato |
| Chiaro | `#137333` | `#e7f1eb` | 5,15:1 | Superato |

I controlli di inventario usano una griglia responsive, label sopra i campi e target tattili da
44 px. Sotto 360 px passano a una sola colonna per evitare label contratte con `…`.

### 9.5 Snapshot, persistenza, sync e privacy

All'avvio del workout viene acquisita una copia normalizzata del solo profilo attivo insieme
all'unità globale usata dalla sessione:

```json
{
  "active": {
    "equipmentSnapshot": {
      "schemaVersion": 1,
      "id": "equipment-profile:gym",
      "unit": "kg",
      "workoutUnit": "kg",
      "items": []
    },
    "entries": [
      {
        "equipmentUse": {
          "status": "resolved",
          "profileId": "equipment-profile:gym",
          "itemId": "bar-main",
          "loadSemantics": "total",
          "implementCount": 1
        }
      }
    ]
  }
}
```

Il lifecycle verificato è:

```text
configurazione futura
        ↓ beginWorkout (una sola copia)
active.equipmentSnapshot + entry.equipmentUse risolto
        ↓ refresh / modifica profilo / esercizio aggiunto
lo stesso snapshot resta autoritativo
        ↓ finish
workout.equipmentSnapshot + binding entry immutabili
```

In particolare:

1. modificare tara, piastre o profilo dopo lo start non cambia il workout attivo;
2. anche un esercizio aggiunto a metà sessione usa lo snapshot di avvio;
3. se la sessione è iniziata senza profilo, attivarne uno dopo non lo introduce a metà workout;
4. il workout terminato conserva snapshot e binding e può ricostruire la composizione originale;
5. la sessione successiva usa invece la configurazione aggiornata;
6. localStorage, backup JSON e mirror mobile mantengono i campi senza migrazione;
7. `equipmentProfiles` da solo conta come dato utente e viene quindi sincronizzato;
8. il server salva l'intero stato completato nel file utente/volume Docker. Come già previsto
   dall'architettura, `state.active` viene rimosso dal `PUT /api/data`: un workout in corso resta
   locale, mentre profili e workout terminati vengono sincronizzati;
9. un piano esportato conserva soltanto categoria, semantica e quantità portabili. ID profilo,
   ID attrezzo e inventario privato non escono dal dispositivo e vengono scartati anche da file
   importati o manomessi.

### 9.6 Test automatici mirati

Comando eseguito:

```powershell
cd frontend
npm.cmd test -- --run src/lib/equipment-load.test.js `
  src/components/EquipmentGuide.test.jsx src/views/Equipment.test.jsx `
  src/lib/workout-scope.test.js src/lib/workout-prescription.test.js `
  src/lib/progression-scope.test.js src/lib/plan-share.test.js `
  src/lib/state-storage.test.js src/store/useStore.test.js `
  src/workout-lifecycle.integration.test.jsx
```

Risultato:

```text
Test Files  10 passed (10)
Tests       97 passed (97)
Failed      0
```

Le suite coprono normalizzazione, solver, tutti i tipi di attrezzo, singolo/doppio manubrio,
risoluzione, errori espliciti, testo accessibile, schermate profilo, start/finish, refresh
serializzato, esercizi aggiunti, JSON legacy, progressioni condivise/indipendenti, prescrizione,
export/import e rilevamento dei dati sincronizzabili.

È stato eseguito anche un audit dei literal i18n usati dalle nuove schermate: tutte le chiavi sono
presenti nei dizionari. L'italiano ha traduzioni native; le altre lingue hanno un fallback inglese
esplicito e quindi non mostrano la chiave mancante o `undefined`.

### 9.7 Regressione, build, lingue e diff

Comandi eseguiti:

```powershell
cd frontend
npm.cmd test
npm.cmd run build
node scripts/check-locales.mjs
cd ..
git diff --check
```

Risultati:

- regressione completa: **33 file, 593 test superati, 0 falliti**;
- build Vite: **SUPERATA**, 123 moduli trasformati;
- lingue: **11 su 11 sincronizzate**, 835 chiavi ciascuna;
- confronto solver contro brute force: **2.000 casi superati, 0 divergenze**;
- audit chiavi letterali della nuova UX: **SUPERATO**;
- diff check: **SUPERATO**, con soli avvisi informativi LF/CRLF;
- warning Vite sui chunk grandi: già noto e non bloccante.

### 9.8 Controllo browser headless a 320 px

È stato eseguito un controllo end-to-end leggero con l'app servita da Vite ed Edge headless
reale. Il controllo usa un profilo browser temporaneo, prepara dati deterministici nello storage
locale, naviga le schermate effettive e chiude Edge al termine.

Comandi riproducibili su Windows, eseguiti in due terminali dalla radice del repository:

```powershell
cd frontend
npm.cmd run dev -- --host 127.0.0.1 --port 4173
```

```powershell
& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' `
  --headless=new --disable-gpu --remote-debugging-port=9222 `
  --user-data-dir='E:\Workspace\openGym\.edge-req7-audit' about:blank
cd frontend
node scripts/check-equipment-browser.mjs
```

Esito aggiornato al 2026-09-17: **18 controlli superati, 0 falliti**.

- elenco profili visibile e senza overflow orizzontale a 320 px;
- editor del profilo visibile, senza overflow e con label leggibili;
- apertura reale dell'editor del singolo attrezzo, senza overflow orizzontale;
- valore del nome e label `Name`, `Empty equipment weight`, `Weight` e `Quantity` presenti per
  esteso nell'editor (le chiavi italiane corrispondenti sono validate dall'audit locale);
- guida workout esatta: target 70 kg, bilanciere da 20 kg, 20 kg + 5 kg per lato;
- `role="status"` e `aria-live="polite"` presenti;
- nessun overflow orizzontale nel workout;
- colore success indipendente dal tema: `rgb(48, 209, 88)` scuro e
  `rgb(19, 115, 51)` chiaro;
- testo della guida ancora visibile dopo il cambio tema.
- editor a 320 px con `Inventario dischi (opzionale)` e spiegazione della modalità senza
  censimento;
- rimozione delle righe inventario dall'editor e persistenza effettiva dell'array vuoto;
- guida senza inventario: target 116,75 kg, bilanciere 9,75 kg e 53,5 kg per lato;
- guida manuale per lato ancora verde, accessibile e senza overflow orizzontale.

Il profilo `.edge-req7-audit` è soltanto un artefatto temporaneo di test e può essere eliminato
dopo l'esecuzione. Questo controllo non sostituisce screen reader, input tattile e collaudo sui
dispositivi reali elencati nei gate manuali.

### 9.9 Procedura manuale di replica

Gli scenari A–K sono procedure di accettazione per browser/CasaOS reali. Non vengono presentati
come E2E già eseguiti in questa postazione.

#### Scenario A — bilanciere da 70 kg

1. Aprire `Impostazioni → Attrezzatura` e creare il profilo `Palestra` in kg.
2. Aggiungere `Bilanciere olimpico`, tipo bilanciere simmetrico, tara 20 kg, match `barbell`.
3. Inserire almeno 2 piastre da 20 kg e 2 da 5 kg; attivare il profilo.
4. Configurare una Bench Press da 70 kg lasciando `Automatico` oppure scegliendo il bilanciere.
5. Avviare il workout.
6. Deve comparire un box verde con target 70 kg e `20 kg + 5 kg per lato`.
7. Il target delle serie deve restare 70 kg.

#### Scenario B — target impossibile e inventario insufficiente

1. Con lo stesso bilanciere impostare una prossima serie da 63,75 kg.
2. Verificare il warning `Non caricabile esattamente`, con alternativa inferiore e superiore.
3. Eliminare una delle due piastre necessarie dal profilo e avviare una nuova sessione.
4. Verificare che la simmetria venga rispettata e che non siano suggerite piastre inesistenti.
5. Inserire un target inferiore alla tara: deve comparire un errore esplicito.
6. In tutti i casi il target workout non deve cambiare automaticamente.

#### Scenario C — singolo manubrio e coppia

1. Creare un manubrio caricabile con manico 2 kg e quantità reali di piastre.
2. Associarlo a un esercizio e lasciare `Numero di attrezzi usati = 1`.
3. Con target 20 kg, verificare che il testo parli di un singolo manubrio da 20 kg.
4. Portare la quantità a 2: il target deve rimanere 20 kg per manubrio, mentre l'inventario
   richiesto deve raddoppiare.
5. Se le piastre non bastano per due manubri, deve comparire il warning senza moltiplicare o
   riscrivere il peso registrato.

#### Scenario D — cambio palestra non retroattivo

1. Attivare un profilo con bilanciere da 20 kg e avviare un workout da 70 kg.
2. Senza terminare, modificare il bilanciere corrente a 15 kg oppure attivare un altro profilo.
3. Tornare al workout: il messaggio deve continuare a usare la tara da 20 kg.
4. Fare refresh e verificare di nuovo la tara da 20 kg.
5. Terminare il workout e controllare nel backup che lo snapshot storico contenga 20 kg.
6. Avviare una nuova sessione: deve usare 15 kg o il nuovo profilo.

#### Scenario E — esercizio aggiunto durante la sessione

1. Avviare un workout con un profilo attivo.
2. Modificare il profilo in un'altra scheda o prima di tornare all'active workout.
3. Usare `Aggiungi esercizio` nel workout già attivo.
4. La configurazione e la guida devono usare attrezzi e inventario congelati allo start.
5. Ripetere partendo senza profilo e attivandolo dopo: l'active workout non deve adottarlo.

#### Scenario F — unità discordanti

1. Impostare il profilo attrezzatura in kg e l'account/workout in lb.
2. Avviare un workout caricato.
3. Deve comparire `Nessun suggerimento` con entrambe le unità e l'indicazione che non viene
   effettuata alcuna conversione automatica.
4. Non deve comparire una composizione numerica ottenuta reinterpretando kg come lb.

#### Scenario G — corpo libero, cardio e disattivazione per slot

1. Aprire un esercizio a corpo libero puro: la sezione attrezzatura e il peso non devono apparire.
2. Aggiungere una zavorra: la sezione attrezzatura deve diventare disponibile.
3. Aprire un esercizio cardio: non deve comparire alcun calcolo piastre.
4. Su un esercizio caricato scegliere `Nessun suggerimento`, salvare e avviare il workout: il
   peso resta registrabile, ma il box di composizione non deve apparire.

#### Scenario H — stesso esercizio in routine diverse

1. Inserire lo stesso esercizio con configurazione equivalente in due routine e verificare che
   la progressione resti condivisa.
2. Selezionare due bilancieri locali diversi ma con la stessa semantica totale: la progressione
   deve rimanere condivisa.
3. Cambiare realmente la semantica del peso in una delle due configurazioni: la UI deve indicare
   la separazione futura del gruppo.
4. Workout e snapshot già terminati non devono cambiare.

#### Scenario I — backup, sync e CasaOS

1. Prima del deploy scaricare un backup JSON e conservarne una copia.
2. Dopo il deploy creare profilo/attrezzo, terminare un workout e scaricare un nuovo backup.
3. Verificare nel JSON `equipmentProfiles`, `activeEquipmentProfileId`,
   `workout.equipmentSnapshot` ed `entry.equipmentUse`.
4. Eseguire refresh e logout/login; poi aprire lo stesso utente in un secondo browser.
5. Profili e workout terminato devono ricomparire. L'active workout non è atteso sul secondo
   browser perché resta intenzionalmente device-local.
6. Eseguire `docker compose down` e `docker compose up -d` senza `-v`.
7. Verificare nuovamente profili/snapshot e confrontare il backup; nessun workout precedente deve
   essere riscritto.

#### Scenario J — privacy del piano condiviso

1. Esportare una routine che usa un attrezzo esplicito.
2. Aprire il file del piano come testo.
3. Deve contenere al massimo categoria, semantica e quantità; non deve contenere ID del profilo,
   ID dell'attrezzo, tara o inventario.
4. Importarlo in un profilo differente: deve usare il matching locale univoco oppure mostrare un
   errore esplicito, senza riferimenti alla palestra del mittente.

#### Scenario K — responsive e accessibilità

1. Ripetere editor profilo, configurazione esercizio e workout a 320/360/390/430/640 px e con
   reflow/zoom 200%.
2. Verificare che label e valori vadano a capo senza ellissi o sovrapposizioni.
3. Navigare con tastiera e screen reader: selettori, switch e pulsanti elimina devono avere un
   nome; il box carico deve essere annunciato come stato.
4. Provare tema chiaro/scuro e tutti gli accenti: il verde success deve restare semantico e non
   seguire il colore scelto dall'utente.
5. Coprire il colore o usare modalità monocromatica: icona e testo devono continuare a distinguere
   successo, warning e istruzione manuale.

### 9.10 Estensione — calcolo per lato senza censimento dischi

Data verifica: **2026-09-17**

Stato: **implementata, validata, pronta per commit**

L'inventario dei dischi è ora opzionale per bilancieri, manubri caricabili e macchine caricate a
dischi. Se l'utente configura soltanto la tara, openGym calcola il peso esatto da aggiungere a
ogni lato e lascia la composizione manuale. Non viene aggiunto alcun campo persistente né rimossa
la modalità completa:

- inventario vuoto: calcolo aritmetico per lato, box verde e composizione lasciata all'utente;
- inventario compilato: solver bounded invariato, con composizione esatta oppure vicini
  inferiore/superiore;
- target uguale alla tara: uso dell'attrezzo vuoto;
- target sotto la tara: warning invariato;
- obiettivo e peso registrato non vengono mai modificati dal suggerimento.

Caso reale verificato:

```text
Obiettivo totale:          116,75 kg
Bilanciere vuoto:            9,75 kg
Residuo totale:             107,00 kg
Carico manuale per lato:     53,50 kg
```

Messaggio italiano risultante:

```text
Obiettivo 116,75 kg · Bilanciere Decathlon
Aggiungi 53,5 kg di dischi per lato al bilanciere da 9,75 kg.
Componi il carico manualmente con i dischi disponibili.
```

La divisione viene mantenuta fino a tre decimali: ad esempio un residuo di 1,01 kg produce
0,505 kg per lato e non viene arrotondato in modo da alterare il totale. Lo snapshot già previsto
congela tara e inventario all'avvio: aggiungere dischi al profilo non cambia il workout attivo o
quelli completati; una nuova sessione torna automaticamente alla composizione dettagliata.

Test eseguiti:

```text
Suite mirate attrezzatura   10 file, 104 test superati, 0 falliti
Regressione completa        34 file, 602 test superati, 0 falliti
Build Vite                  superata, 123 moduli trasformati
Locali                      11 lingue, 843 chiavi ciascuna, sincronizzate
Edge headless 320 px        18 controlli superati, 0 falliti
git diff --check            superato, soli avvisi LF/CRLF
```

La copertura nuova verifica il caso 116,75/9,75, il bilanciere vuoto, il target sotto tara, la
precisione al millesimo, la permanenza del solver quando l'inventario esiste, il testo italiano e
inglese, bilancieri/manubri/macchine a dischi, salvataggio reale dell'inventario vuoto
dall'editor, colore/accessibilità, assenza di overflow e immutabilità dello snapshot fra
sessioni.

Procedura manuale:

1. Aprire `Impostazioni → Attrezzatura → Bilanciere Decathlon`.
2. Impostare la tara a 9,75 kg e lasciare vuoto `Inventario dischi (opzionale)`.
3. Avviare un nuovo workout con obiettivo 116,75 kg.
4. Verificare il box verde con 53,5 kg per lato e nessun warning di carico non componibile.
5. Terminare o scartare la sessione, censire in seguito i dischi e avviarne una nuova.
6. Verificare che la nuova sessione mostri la composizione calcolata o le alternative più vicine,
   mentre snapshot e workout precedenti conservino la configurazione con la quale erano iniziati.

### 9.11 Gate manuali ancora necessari sull'ambiente reale

Non eseguiti in questa postazione:

- test visuale e interattivo umano a 360/390/430/640 px e zoom/reflow 200%; il controllo
  automatico in Edge headless a 320 px è stato eseguito con esito positivo;
- screen reader e tastiera reali, oltre alla struttura semantica coperta automaticamente;
- refresh/restart di un active workout in browser reale;
- sincronizzazione autenticata fra due browser;
- Docker/CasaOS down/up con il volume dati reale;
- mirror/WebView mobile e dispositivo fisico;
- verifica con l'inventario reale dell'utente in palestra.

I gate automatici sono verdi. Questi controlli restano separati perché dipendono da browser,
account, volume Docker e hardware non disponibili nella sessione di test; non vengono dichiarati
come superati senza evidenza.

---

## 10. Stato delle release successive

| Release | Requisiti | Stato |
|---|---|---|
| A | 6 — identità e gruppi | Implementato, validato e committato |
| A | 11 — risultati manuali e Confirmed | Implementato, validato e incluso nel commit dedicato |
| B | 1 — corpo libero puro/zavorrato | Implementato, validato e incluso nel commit dedicato |
| B | 5 — auto-riduzione predefinita per nuove selezioni Confirmed | Implementato, validato e incluso nel commit dedicato |
| B | 12 — data e ora start/end | Implementato, validato e incluso nel commit dedicato |
| B | 2A, 4, 10 | Non iniziata |
| C | 7 | Implementato, validato e incluso nel commit dedicato |
| D | 3, 2B, 2C | Non iniziata |
| Esclusi | 8 Withings, 9 Polar | Fuori scope come richiesto |

Ogni riga verrà aggiornata dopo test automatici, regressione completa e commit dedicato.

---

## 11. Verifica incidente: massimo registrato e conferme tra routine

Data verifica: **2026-09-16**

Stato: **analisi conclusa, correzione pronta, test superati, commit non ancora creato**

### 11.1 Evidenza analizzata

L'analisi è partita dalle due schermate presenti nella cartella `bug/`:

- `galleryContent8808946448639486412.jpg`: Dumbbell Seated Shoulder Press, ultima sessione
  `19×12, 19×12, 19×12`, nuova prescrizione `19×12`, messaggio `Conferma al massimo: 1 / 2`;
- `galleryContent5061745906332079591.jpg`: Dumbbell Lateral Raise, ultima sessione
  `8×15` per quattro serie, nuova prescrizione `8×15`, stesso messaggio `1 / 2`.

È stato poi analizzato in sola lettura anche il backup completo
`state-RuyIVpkH8ixov1pP.json`:

- dimensione: `307073` byte;
- SHA-256: `76887E227B271E1EAA92742AFD6ED66F170EDF8502D6D179B9FDE311566BD429`;
- contenuto utile all'audit: 6 routine, 20 workout e 34 slot esercizio;
- il file è rimasto immutato e la cartella `bug/` resta esclusa dalla modifica da committare.

Le schermate non mostrano una sessione ignorata. Nel reducer Confirmed il messaggio `1 / 2`
può essere prodotto soltanto quando l'ultima sessione selezionata nello stesso gruppo ha esito
`top_range_success`. Inoltre la riga `L'ultima volta` e il piano Confirmed interrogano entrambi lo
storico tramite lo stesso `progressionId`: la sessione del 27 agosto visibile nelle schermate è
quindi proprio la prima conferma già conteggiata.

Il comportamento di dominio resta quello approvato:

1. primo massimo consecutivo: stesso peso, target al massimo, conferma `1 / 2`;
2. secondo massimo consecutivo con stesso gruppo, range e carico uniforme: incremento del peso e
   ritorno alle ripetizioni minime;
3. una sessione fallita, incompleta, non al massimo, con carico misto o appartenente a un altro
   gruppo interrompe/non completa la sequenza.

### 11.2 Risultato del replay sul backup reale

La cronologia completa elimina il dubbio lasciato dalle sole immagini. Per entrambi gli esercizi
la prima conferma è stata registrata il 27 agosto, la seconda il 3 settembre e l'aumento è stato
applicato il 10 settembre:

| Data | Shoulder Press (`0405`) | Lateral Raise (`0334`) | Effetto |
|---|---|---|---|
| 27 agosto | `19 kg × 12 × 3` | `8 kg × 15 × 4` | primo massimo valido, streak `1 / 2` |
| 3 settembre | `19 kg × 12 × 3` | `8 kg × 15 × 4` | secondo massimo valido |
| 10 settembre | prescrizione `20 kg × 10 × 3` | prescrizione `9 kg × 13 × 4` | incremento configurato e ritorno al minimo |

Il messaggio mostrato nella schermata era quindi corretto: le 12 o 15 ripetizioni erano state
riconosciute come **prima** conferma, non ignorate. La successiva cronologia dimostra anche che la
seconda conferma ha prodotto esattamente l'aumento atteso.

Il recupero a 120 secondi dello Shoulder Press non è stato aumentato dalla sessione al massimo.
Nel backup è presente un reset manuale legacy a 120 secondi, registrato il 24 agosto alle
10:24:52 locali (`restEpochId=mt6z088eweazd`); lo snapshot del 27 agosto dichiara infatti
`restSource=manual_reset`. Il timer era già a 120 secondi prima di quel workout.

Per il Lateral Raise di PUSH 2, il primo snapshot legacy conserva invece 90 secondi pur avendo
una base di 60. È un residuo del vecchio comportamento globale per ID esercizio, precedente al
rilascio degli scope: il workout del 27 agosto è ancora senza `progressionId`, mentre dal 3
settembre gli snapshot sono correttamente scoped. Lo storico non viene riscritto; i nuovi workout
non possono più contaminare l'omonimo esercizio di PUSH 1.

Il replay con il codice corrente produce oggi per PUSH 2:

- Shoulder Press: prossima prescrizione `20 kg × 11`, recupero 120 secondi, riduzione automatica
  a `3 / 4` successi;
- Lateral Raise: prossima prescrizione `9 kg × 14`, recupero 90 secondi, riduzione automatica a
  `3 / 4` successi.

Con un altro successo valido, il piano seguente ridurrà il rispettivo recupero di 30 secondi,
senza scendere sotto la base configurata.

### 11.3 Audit del possibile conflitto tra esercizi uguali

Sono stati controllati:

- creazione e normalizzazione di `routineExerciseId` e `progressionId`;
- snapshot degli ID all'avvio e al termine del workout;
- lookup dell'ultima entry e delle sessioni Confirmed;
- condivisione fra configurazioni equivalenti in routine diverse;
- isolamento di configurazioni materialmente diverse e duplicati nella stessa routine;
- range congelato, `setBaselineId`, modalità di carico e uniformità del peso;
- salvataggio locale, pull server e ordine di append dei workout.

Nel backup non risultano ID di routine, slot o workout duplicati; non risultano slot senza
`routineExerciseId`, `progressionId` o firma persistita, né gruppi attuali con firme
incompatibili. Le configurazioni omonime di PUSH 1 e PUSH 2 sono intenzionalmente indipendenti:

- Shoulder Press: PUSH 1 usa `4 × 8–10`, 24 kg, recupero base 120 e strategia manuale; PUSH 2 usa
  `3 × 10–12`, 19 kg, recupero base 90 e riduzione automatica;
- Lateral Raise: PUSH 1 usa `4 × 10–12`, 12 kg, incremento 2 e base 90; PUSH 2 usa
  `4 × 13–15`, 8 kg, incremento 1 e base 60.

Poiché serie, range, carichi e recuperi sono materialmente diversi, combinarne lo storico sarebbe
un errore. Gli ID distinti presenti nel backup impediscono proprio questa combinazione.

Il test d'integrazione ora verifica esplicitamente questa sequenza tra due routine equivalenti:

```text
Routine A: target 8, risultato 10/10/10 -> Routine B vede 70 kg × 10 e prima conferma registrata
Routine B: target 9, risultato 10/10/10 -> Routine A vede 72 kg × 8 e streak azzerato
```

Non è emersa contaminazione o perdita fra routine compatibili. È stato inoltre generato il piano
con il codice corrente per tutti i 34 slot del backup: ogni prescrizione è stata risolta con ID e
numero di serie coerenti, senza mutare la cronologia.

La normalizzazione del backup con il codice corrente produce 33 aggiornamenti tecnici, tutti e
soli dentro `progressionSignature`: 31 firme materializzano `equipmentLoadSemantics`, mentre due
esercizi a corpo libero canonicalizzano l'incremento da `default` a `not_applicable`. Un diff
ricorsivo conferma zero modifiche fuori dalle firme: restano identici tutti i 34 `progressionId`
e `routineExerciseId`, le 31 `progressionWeights`, i 20 workout, i due controlli di progressione,
lo stato attivo e ogni altro dato funzionale. Una seconda normalizzazione è idempotente.

### 11.4 Correzione applicata

Il difetto confermato era di comprensibilità: `Conferma al massimo: 1 / 2` non dichiarava che il
massimo precedente fosse già stato acquisito e poteva sembrare un mancato riconoscimento.

Per un esercizio caricato il nuovo messaggio italiano è:

```text
Massimo raggiunto nell'ultimo allenamento: prima conferma registrata (1 / 2).
Ripetilo un'altra volta con lo stesso peso per aumentare il carico.
```

Per il lavoro senza carico viene usata una variante che parla di completare il passo di
progressione e non promette un aumento di peso. La modifica riguarda soltanto la spiegazione del
piano futuro: algoritmo, workout completati, target, peso, streak, recupero e formato JSON non
vengono modificati.

### 11.5 Test automatici e no-regression

Test mirati finali:

```powershell
cd frontend
npm.cmd test -- progression.test.js progression-scope.integration.test.js `
  confirmedRepRangeCopy.test.js --run
```

Esito:

```text
Test Files  4 passed (4)
Tests       195 passed (195)
Failed      0
```

Il pattern `progression.test.js` include anche la suite di scope omonima; per questo il riepilogo
riporta quattro file. La copertura aggiunta verifica:

- prima conferma a carico esterno con peso invariato e spiegazione esplicita;
- testo distinto per progressione senza carico;
- prima conferma trasferita da routine A a routine B quando le configurazioni sono equivalenti;
- seconda conferma in B, incremento esatto e reset al minimo quando si torna in A;
- copia italiana e fallback inglese.

Sul backup reale sono stati eseguiti anche tre test di audit temporanei, rimossi dopo l'uso per non
versionare dati personali:

- replay completo della progressione per i quattro scope omonimi interessati: superato;
- costruzione della prossima prescrizione e della relativa entry per tutti i 34 slot: superata;
- confronto ricorsivo prima/dopo normalizzazione e secondo passaggio idempotente: superato, con le
  sole 33 canonicalizzazioni di firma descritte sopra.

Regressione completa:

```powershell
cd frontend
npm.cmd test -- --run
```

```text
Test Files  34 passed (34)
Tests       595 passed (595)
Failed      0
```

Gate ulteriori:

- build Vite: **SUPERATA**, 123 moduli trasformati;
- Vite segnala il limite dimensionale di alcuni chunk già generati, avviso non bloccante e non
  collegato alla logica Confirmed Rep-Range;
- locale check: **SUPERATO**, 11 lingue con 836 chiavi ciascuna;
- `git diff --check`: **SUPERATO**, soli avvisi informativi LF/CRLF;
- cartella `bug/`: lasciata intatta e non inclusa nella modifica.

### 11.6 Anomalie separate rilevate nel backup

Tre workout presentano durate anomale:

- 3 settembre, PUSH 2: 23,56 ore;
- 5 settembre, LEGS / CORE: 9,24 ore;
- 12 settembre, LEGS / CORE: 39,82 ore, con chiusura il 14 settembre.

Questi record non falsano il conteggio delle conferme Confirmed Rep-Range, ma possono alterare le
statistiche di durata. Non contengono inoltre i nuovi campi di provenienza/precisione temporale.
Il dato è compatibile sia con sessioni lasciate aperte sia con un client CasaOS non ancora
aggiornato alla gestione timestamp: senza sapere come sono state chiuse non è corretto riscriverle
o attribuire automaticamente la causa. Va aperto un incidente separato se l'utente conferma di
averle terminate normalmente.

### 11.7 Replica manuale

1. Configurare lo stesso esercizio Confirmed in due routine con gli stessi valori materiali:
   serie, minimo/massimo, peso, incremento, recupero, modalità e strategia di riduzione.
2. Nell'editor verificare `Progressione condivisa` e il nome dell'altra routine.
3. Avviare la routine A, completare tutte le serie al massimo del range con peso uniforme e
   terminare il workout.
4. Avviare la routine B: il peso deve essere invariato e il messaggio deve dichiarare
   `prima conferma registrata (1 / 2)` e chiedere di ripetere lo stesso carico.
5. Completare di nuovo tutte le serie al massimo e terminare.
6. Avviare A o B: il peso deve aumentare dell'incremento configurato e il target deve tornare al
   minimo del range.
7. Ripetere con due configurazioni materialmente diverse: l'editor deve indicare
   `Progressione indipendente` e le conferme non devono essere combinate.
