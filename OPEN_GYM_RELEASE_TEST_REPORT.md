# openGym — Report di test delle release

## 1. Scopo del documento

Questo documento registra, per ogni requisito rilasciato, cosa è stato verificato, con quali
comandi, quale risultato è stato ottenuto e come replicare i controlli. Non sostituisce il report
storico specifico di Confirmed Rep-Range: lo integra per il backlog ordinato in release descritto
in `OPEN_GYM_PRODUCT_BACKLOG_ANALYSIS.md`.

## 2. Ambiente di riferimento

- Data ultimo aggiornamento: 2026-08-27
- Repository: `https://github.com/ruvelro/openGym.git`
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

Gate finale del 2026-08-27:

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

## 5. Stato delle release successive

| Release | Requisiti | Stato |
|---|---|---|
| A | 6 — identità e gruppi | Implementato, validato e committato; push in attesa di autenticazione GitHub |
| A | 11 — risultati manuali e Confirmed | Non iniziato in questa iterazione |
| B | 1, 5, 12, 2A, 4, 10 | Non iniziata |
| C | 7 | Non iniziata |
| D | 3, 2B, 2C | Non iniziata |
| Esclusi | 8 Withings, 9 Polar | Fuori scope come richiesto |

Ogni riga verrà aggiornata dopo test automatici, regressione completa e commit dedicato.
