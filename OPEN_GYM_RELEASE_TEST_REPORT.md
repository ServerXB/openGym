# openGym — Report di test delle release

## 1. Scopo del documento

Questo documento registra, per ogni requisito rilasciato, cosa è stato verificato, con quali
comandi, quale risultato è stato ottenuto e come replicare i controlli. Non sostituisce il report
storico specifico di Confirmed Rep-Range: lo integra per il backlog ordinato in release descritto
in `OPEN_GYM_PRODUCT_BACKLOG_ANALYSIS.md`.

## 2. Ambiente di riferimento

- Data ultimo aggiornamento: 2026-08-27
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

## 6. Stato delle release successive

| Release | Requisiti | Stato |
|---|---|---|
| A | 6 — identità e gruppi | Implementato, validato e committato; push in attesa di autenticazione GitHub |
| A | 11 — risultati manuali e Confirmed | Implementato, validato e incluso nel commit dedicato |
| B | 1, 5, 12, 2A, 4, 10 | Non iniziata |
| C | 7 | Non iniziata |
| D | 3, 2B, 2C | Non iniziata |
| Esclusi | 8 Withings, 9 Polar | Fuori scope come richiesto |

Ogni riga verrà aggiornata dopo test automatici, regressione completa e commit dedicato.
