# Confirmed Rep-Range — Prima recupero base, poi conferme del massimo

- Data: 2026-09-28.
- Revisione finale della documentazione: 2026-09-29 (esiti automatici del 28 settembre).
- Segnalazione: `bug/photo_2026-09-28_19-12-53.jpg`.
- Base codice: `6279f0a`; correzione nel worktree, non ancora committata.
- Esito: implementazione e verifiche automatiche completate; nessuna regressione rilevata nei test eseguiti.
- Le modifiche offline/sync già presenti nel worktree restano separate da questa correzione.

## 1. Causa e decisione funzionale

La foto mostra una conferma massima 1/2 e contemporaneamente recupero 270 s con riduzione 1/4.
La regola precedente faceva avanzare i due contatori in parallelo: i test richiedevano persino
l'aumento del peso insieme alla riduzione del recupero, ancora sopra la base. Non era un conflitto
fra esercizi, ma una priorità funzionale diversa da quella richiesta dall'utente.

La nuova regola, approvata dall'utente, è **prima recupero base, poi due conferme al massimo**.
È una decisione di prodotto, non una nuova soglia scientificamente validata. Rimangono invariati
i quattro successi per ogni decremento di 30 s e le cautele scientifiche documentate in precedenza.

## 2. Regola implementata

1. Finché il recupero futuro supera la base, nessun aumento automatico di carico o serie:
   `topRangeStreak = 0`, anche se tutte le serie raggiungono `maxReps`.
2. Le ripetizioni possono continuare a progredire all'interno del range. Per ridurre il recupero
   bastano sessioni riuscite sul target prescritto: non è obbligatorio raggiungere il massimo.
3. Quattro successi consecutivi con lo stesso recupero prescritto/base/epoch producono −30 s,
   senza scendere sotto la base. Ogni gradino riparte da zero.
4. La sessione a recupero maggiorato che genera il ritorno alla base NON conta come prima
   conferma alla base.
5. Per aumentare servono due sessioni massime consecutive allo stesso carico, nello stesso blocco
   di progressione, con **recupero e base storici espliciti uguali alla base corrente**, nella
   stessa epoch del reset. Nessuna inferenza dalla configurazione odierna per metadati mancanti.
6. Dopo le due conferme, incremento esatto configurato e ritorno a `minReps`. Per corpo libero
   resta l'azione preesistente di aumento serie, con lo stesso vincolo sul recupero.
7. Il reset manuale mantiene carico operativo, target e storico, ma apre una nuova epoch e
   richiede nuove conferme del massimo. Le conferme precedenti non vengono trasferite.
8. Con riduzione automatica disattivata, la progressione sopra base resta sospesa: la UI indica
   di usare il reset manuale. Non viene attivata una riduzione implicita.
9. Se si abbassa la base, parte una nuova osservazione senza convertire i vecchi successi. Se si
   alza la base sopra il recupero corrente, il prossimo recupero viene portato almeno alla nuova
   base: questo evita un blocco permanente sotto il valore richiesto. Gli snapshot non cambiano.
10. Restano invariati isolamento per `progressionId`, serie opzionali, gestione carichi misti,
    altre strategie e regole di fallimento. Nessun deload o diminuzione automatica del carico.

La verifica riguarda il **recupero prescritto nello snapshot**, non i secondi realmente attesi
dopo `+15`, `−15` o Salta: la misura del tempo effettivo non fa parte di questa correzione.

### Esempio riprodotto

Il carico 93,75 kg, cinque serie da cinque e il recupero 270 s provengono dalla schermata.
**Base 240 s, range 3–5 e incremento 2 kg sono parametri del test**, non dedotti dalla foto.

| Sessioni concluse | Prossimo peso | Prossimo recupero | Conferme massime |
|---|---:|---:|---:|
| 1 successo a 270 s | 93,75 kg | 270 s, recupero 1/4 | 0/2, sospese |
| 2 successi a 270 s | 93,75 kg | 270 s, recupero 2/4 | 0/2, sospese |
| 4 successi a 270 s | 93,75 kg | 240 s | 0/2 |
| poi 1 massimo a 240 s | 93,75 kg | 240 s | 1/2 |
| poi 2 massimi consecutivi a 240 s | 95,75 kg × 3 | 240 s | ciclo completato |

## 3. Effetti sui dati esistenti e UX

- Nessuna migrazione e nessuna scrittura nei workout completati. I vecchi JSON restano leggibili.
- Le **nuove prescrizioni derivate** cambiano immediatamente: una conferma sopra base o un aumento
  non ancora eseguito può essere sospeso. Non significa riscrivere il risultato storico.
- Le conferme già documentate alla base corrente e nell'epoch corrente restano utilizzabili.
- Se mancano `restSeconds` o `restBaseSeconds` validi nello snapshot, non si inventa credito:
  servono nuove sessioni con snapshot completo. Valori null/vuoti/booleani non diventano zero.
- I carichi già eseguiti restano la baseline operativa: nessuna riduzione per annullare un aumento passato.
- Un workout già avviato conserva il proprio `plan`, target, timer e serie: può mostrare ancora
  il messaggio precedente fino alla chiusura. La nuova regola governa le prescrizioni successive.
- Modificati messaggi del workout, descrizione strategia, avviso reset e aiuto sulla base.
  Le vecchie chiavi di traduzione restano per gli snapshot aperti con la precedente versione.
- Italiano tradotto; altre lingue usano il fallback inglese esistente. Tutti i dizionari hanno
  lo stesso insieme di 907 chiavi.

## 4. Matrice dei test nuovi e aggiornati

`confirmedRepRangeRecoveryFirst.integration.test.js`: **29 test**, tutti superati.

| Area | Scenari | Esito |
|---|---|---|
| Foto e blocco | 1, 2, 3 massimi a 270 s non aumentano né confermano il carico | PASS |
| Ciclo completo | 4 successi → base; due nuovi massimi → +2 kg/minReps; nessun doppio incremento | PASS |
| Gradini | Base 120, 230 non multiplo del passo e base esplicita 0; quattro successi per gradino | PASS |
| Ripetizioni | Avanzamento 8→9→10→11→12 durante il rientro, senza richiedere massimi per ridurre | PASS |
| Manuale | Auto OFF bloccato, spiegazione reset, nuova epoch e due nuove conferme | PASS |
| Reset alla base | Anche una conferma valida nella vecchia epoch non passa nella nuova | PASS |
| Fallimenti | Prima serie, serie successiva e incompleta interrompono le conferme; recupero coerente | PASS |
| Modifica base | Base alzata al recupero corrente, sopra il corrente o abbassata; nessun credito retroattivo | PASS |
| Legacy | Durata/base mancanti, null, vuota o booleana; lettura conservativa e recupero con nuovi snapshot | PASS |
| Persistenza | Round-trip JSON, storico e active immutati; carico già aumentato non viene ridotto | PASS |
| Range | 8–8 e 8–10 raggiungibili senza bypass del recupero | PASS |
| Corpo libero | Nessuna zavorra inventata; aggiunta serie solo dopo conferme alla base | PASS |
| Identità | Routine indipendenti isolate; gruppi compatibili condivisi | PASS |
| Ereditarietà | Stessa regola con strategia ereditata dalla routine | PASS |
| Serie/carichi | Extra opzionali ignorati; carichi misti nelle serie prescritte non danno conferme | PASS |

In più: **5 nuovi test copy** e aggiornamento delle aspettative incompatibili con la nuova regola.
Le fixture dei test di conferma già esistenti ora dichiarano la base storica, come gli snapshot
prodotti dall'app; i casi privi di tale dato hanno test legacy dedicati, non vengono ignorati.

## 5. Verifica finale e non regressione

Esecuzione sul worktree finale del 2026-09-28:

| Gate | Risultato |
|---|---|
| Frontend completo | 47 file, **759 passati**, 0 falliti |
| Gate mirato progressione/snapshot/timer/copy | 10 file, **284 passati**, 0 falliti; sottoinsieme dei 759 |
| Backend protocollo/persistenza | 2 suite, **20 passati**, 0 falliti |
| Browser nuovo, Edge headless 320 px | **6 scenari passati**, messaggi, prescrizione e nessun overflow |
| Browser regressione attrezzatura | **29 controlli passati**, 0 falliti |
| Build produzione | PASS, 128 moduli; warning chunk >1.500 kB già noto |
| Localizzazioni | PASS, 11 lingue × 907 chiavi |
| Solver attrezzatura | PASS, 2.000 confronti deterministici |
| `git diff --check` | PASS |

Durante lo sviluppo sono state aggiornate le vecchie aspettative di avanzamento simultaneo,
intenzionalmente incompatibili con la nuova decisione. Il nuovo harness ha richiesto correzioni
di import/parametrizzazione e, nel browser, escaping e attesa del separatore decimale già usato
dalla UI. Gli esiti sopra sono quelli delle esecuzioni finali, non dei primi tentativi.

Non eseguiti: deploy/down-up CasaOS, prova touch sul telefono, screen reader fisico. I browser
automatici usano un profilo temporaneo senza account o dati reali; API e media server assenti.

## 6. Come replicare

Dipendenze già installate; in caso contrario eseguire prima `npm.cmd ci` in frontend e api.
Dalla root:

```powershell
cd frontend
npm.cmd test -- src/lib/confirmedRepRangeRecoveryFirst.integration.test.js src/lib/confirmedRepRangeCopy.test.js

npm.cmd test -- src/lib/progression.test.js src/lib/confirmedRepRangeAutoRest.test.js src/lib/confirmedRepRangeAutoRest.integration.test.js src/lib/confirmedRepRangeRestProgression.test.js src/lib/confirmedRepRangeRecoveryFirst.integration.test.js src/lib/confirmed-rep-range.integration.test.js src/lib/progression-scope.integration.test.js src/lib/confirmedRepRangeCopy.test.js src/lib/workout-prescription.test.js src/lib/workout-timer.test.js

npm.cmd test
npm.cmd run build
node scripts/check-locales.mjs
node scripts/check-equipment-solver.mjs
cd ..\api
npm.cmd test
cd ..
git diff --check
```

Browser, primo terminale dalla root:

```powershell
cd frontend
npm.cmd run dev -- --host 127.0.0.1 --port 4173 --force
```

Secondo terminale dalla root: usare **solo un profilo temporaneo dedicato**, mai quello personale.
La porta 9222 deve essere libera. Il test scrive esclusivamente fixture nel profilo e chiude Edge.

```powershell
$qaProfile = Join-Path ([IO.Path]::GetTempPath()) ('opengym-recovery-qa-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $qaProfile
$edgePath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$edgeArgs = @('--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9222',
  ('--user-data-dir="' + $qaProfile + '"'), 'about:blank')
Start-Process -FilePath $edgePath -ArgumentList $edgeArgs -WindowStyle Hidden
cd frontend
node scripts/check-confirmed-recovery-browser.mjs
# Per la regressione attrezzatura riaprire Edge: il test precedente lo ha chiuso.
Start-Process -FilePath $edgePath -ArgumentList $edgeArgs -WindowStyle Hidden
node scripts/check-equipment-browser.mjs
```

### Collaudo manuale prima del rilascio

Su un profilo di collaudo, non modificando lo storico reale:

1. Configurare 5 serie, range 3–5, 93,75 kg, incremento 2 kg, base 240 s, limite 300 s, auto ON.
2. Completare una sessione fallendo una serie successiva alla prima: ottenere recupero 270 s.
3. Eseguire quattro sessioni con tutte le cinque serie a 5 ripetizioni. A 270 s deve apparire
   progressione sospesa e mai una conferma 1/2; dopo la quarta il recupero futuro è 240 s.
4. Eseguire due nuove sessioni massime a 240 s. Prima: 1/2; seconda: prossimo workout 95,75 kg × 3.
5. Ripetere con reset manuale dopo un massimo a 270 s: la prossima sessione parte a 240 s con
   zero conferme, non aumenta il carico dopo un solo nuovo massimo.
6. Verificare un workout precedente e un workout già aperto durante l'aggiornamento: nessuno
   snapshot viene riscritto. Verificare separatamente i gruppi condivisi e indipendenti.

## 7. File e consegna

- Motore: `frontend/src/lib/progression.js`.
- UX: `frontend/src/sheets.jsx`, fallback Confirmed e `frontend/src/locales/it.js`.
- Test: nuovo file recovery-first, copy e suite Confirmed/scope aggiornate.
- Browser: `frontend/scripts/check-confirmed-recovery-browser.mjs`.
- Documentazione: questo report, backlog e indice report release aggiornati.

Pronto per commit correttivo dedicato; nessun commit/push eseguito in questa attività. Non includere
automaticamente nello stesso commit l'hardening offline/sync preesistente o la foto dell'utente.
