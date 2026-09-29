# Sincronizzazione offline: modulo API mancante nell'immagine Docker

Data: 2026-09-29. Base codice: `2cbeaf7`.

Stato: fix e test automatici completati nel worktree, pronti per commit dedicato.
Nessun commit, push o rilascio CasaOS eseguito in questa attività. Requisito 17 sospeso.

## 1. Segnalazione e causa verificata

L'interfaccia passa da «Sincronizzazione in corso...» a «Offline — Modifiche salvate su questo dispositivo».

È stato individuato e riprodotto un difetto di packaging:

- `api/server.js` importa `./state-store.js`, necessario per la sincronizzazione revisionata;
- `api/Dockerfile` copiava solo `server.js`, oltre ai manifesti npm;
- nell'immagine così costruita manca il modulo e Node termina prima di aprire la porta API.

Il test, avviando il server con i soli file dichiarati dai `COPY` originali, ha prodotto:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../state-store.js'
imported from .../server.js
```

Questo spiega come il frontend possa aprirsi mentre la sincronizzazione non funziona:
nginx e/o la shell PWA possono essere disponibili senza un backend funzionante. Con API
non raggiungibile, nginx può restituire 502; il client classifica gli errori di rete,
timeout e HTTP 5xx come offline e pianifica nuovi tentativi.

**Distinzione importante:** il bug del pacchetto è confermato. Non abbiamo accesso ai log
dell'istanza CasaOS dell'utente, quindi non dichiariamo già verificato che sia l'unica causa
del suo incidente. La conferma sul target è `ERR_MODULE_NOT_FOUND` relativo a
`/app/state-store.js` nei log del servizio `api`.

## 2. Correzione e impatto sui dati

Il Dockerfile ora contiene:

```dockerfile
COPY server.js state-store.js ./
```

Non cambia il protocollo, il formato dei dati, l'autenticazione o la logica di progressione.
Non vengono riscritti workout, routine, snapshot o dati locali del browser. Il modulo
già presente nel repository viene finalmente incluso nell'immagine del server.

Non è necessario cancellare lo storico, reimportare JSON, eliminare cache/dati del sito,
reinstallare la PWA o fare logout. Le modifiche ancora pendenti sul dispositivo devono
essere conservate fino alla conferma di sincronizzazione.

## 3. Test di regressione aggiunto

File: `api/docker-packaging.test.js`, eseguito anche da `npm test` nella directory `api`.

La suite legge il Dockerfile reale e copia soltanto i file dichiarati nei `COPY` in una
directory temporanea. Avvia quindi `server.js` in un processo separato, con database,
utente, secret e porta di test. Non usa i dati dell'utente né il volume di produzione.
I moduli applicativi relativi devono esistere nella directory preparata; non possono
essere recuperati dalla directory sorgente per mascherare un'omissione.

| Scenario | Risultato atteso | Esito dopo fix |
| --- | --- | --- |
| Avvio dai file dichiarati dal Dockerfile | `/api/health` restituisce 200 e `ok: true` | PASS |
| Richiesta dati senza autenticazione | 401, nessuna esposizione dello stato | PASS |
| Account inizialmente vuoto | Revisione 0 e protocollo 1 | PASS |
| Invio di un workout precedentemente locale | Conferma revisione 1 e successiva rilettura identica | PASS |
| Ripetizione della stessa mutazione | ACK idempotente, nessun duplicato o incremento revisione | PASS |
| Scrittura diversa su revisione obsoleta | 412, workout già accettato preservato | PASS |
| Riavvio del processo con stessa directory dati | Workout e revisione ancora presenti | PASS |
| Retry della mutazione dopo il riavvio | Ricevuta persistente e ACK idempotente | PASS |

Le condizioni sono raggruppate in tre test. Prima del fix la suite falliva nel setup
per il modulo mancante (exit code 1; tre test cancellati perché il server non si avviava).
Dopo il fix tutti e tre i test passano. Non si tratta di un errore di progressione o
di una collisione tra esercizi: il crash precede qualsiasi lettura dei workout.

## 4. Regressione completa eseguita

| Controllo | Esito |
| --- | --- |
| Backend: state store, protocollo HTTP e packaging | 23/23 test, 3 suite, PASS |
| Frontend: intera suite, inclusi sync/offline e progressioni | 759/759 test, 47 file, PASS |
| Build frontend production | PASS, 128 moduli |
| Allineamento traduzioni | PASS, 11 lingue e 907 chiavi |
| Solver carichi contro ricerca esaustiva deterministica | PASS, 2.000 confronti |
| Revisione indipendente di fix, test e istruzioni rilascio | Nessun blocco rilevato |

La build segnala un warning non bloccante per chunk grandi. Nessuna modifica al codice
frontend è inclusa in questa correzione. Nessuna regressione rilevata nei test eseguiti.

### Replica locale

Da PowerShell, partendo dalla radice del repository:

```powershell
cd api
node --test docker-packaging.test.js
npm.cmd test
cd ..\frontend
npm.cmd test
npm.cmd run build
node scripts/check-locales.mjs
node scripts/check-equipment-solver.mjs
cd ..
git diff --check
```

Se mancano le dipendenze, eseguire prima `npm.cmd ci` in `api` e `frontend`.
Su Linux/macOS usare `npm` al posto di `npm.cmd`.

La prova negativa è stata eseguita aggiungendo prima il test, lasciando il Dockerfile
originale; solo dopo l'errore atteso è stato aggiunto `state-store.js` al `COPY`.
Per replicarla usare un checkout di prova separato, togliere quel solo file dal `COPY`
e avviare il test mirato: deve terminare con `ERR_MODULE_NOT_FOUND`. Ripristinare poi
il `COPY` corretto: deve passare. Non modificare il Dockerfile dell'istanza in uso.

### Limiti della verifica locale

Ambiente: Windows, Node **v26.3.0**. Docker non disponibile.
Il test usa le dipendenze installate in `api/node_modules` e il Node locale: non esegue
una vera build Docker, `npm install --omit=dev` in Alpine o il runtime Node 22 dell'immagine.
Il parser del test supporta la forma attuale del Dockerfile, non è un emulatore Docker;
un cambio di struttura/entrypoint richiede di aggiornare il test.
Nessun test end-to-end sul CasaOS o sul telefono reale è stato eseguito in questo ambiente.

## 5. Verifica e aggiornamento CasaOS

Usare la directory e lo stesso progetto/configurazione Compose già utilizzati
dall'installazione; eventuali file override o nome progetto vanno mantenuti.

Prima del rilascio:

1. Conservare i dati del browser; se disponibile, esportare anche una copia locale dei dati.
2. Fare un backup dell'intera directory/volume `data`, inclusi secret e metadati di sync;
   per una copia coerente fermare temporaneamente l'API durante il backup e poi riavviarla.
   Il backup server non contiene le modifiche ancora pendenti sul telefono.
3. Controllare `docker compose ps` e `docker compose logs --tail=100 api`: cercare
   l'errore sul modulo `/app/state-store.js`. Non condividere cookie, token o secret.
4. Dopo il commit/push della correzione, aggiornare il checkout CasaOS dal branch corretto.
   Verificare che il `COPY` in `api/Dockerfile` includa `state-store.js`.

Dal checkout aggiornato dell'installazione esistente:

```bash
docker compose config --quiet
docker compose build api web
docker compose up -d --no-deps --force-recreate api web
docker compose ps
docker compose logs --tail=100 api web
```

Eseguire ogni comando solo se il precedente è riuscito. `--no-deps` evita di rilanciare
il downloader media su questa installazione già configurata. Ricreare anche `web`
fa risolvere nuovamente a nginx l'indirizzo del container API.

Un semplice `git pull` non aggiorna i container già avviati. Non usare come sostituto
`docker compose pull`: i nomi immagine nel Compose puntano al registry upstream e
non garantiscono che contenga questa correzione. Non serve `down`, né cancellare volumi.

Collaudo sul target:

- Aprire `<URL abituale openGym>/api/health`: HTTP 200 e JSON con `ok: true`.
- Nei log API deve comparire l'avvio del server, senza cicli di crash per modulo mancante.
- Tornare alla stessa app/browser e allo stesso account; attendere il retry automatico
  (ritardo massimo ordinario 60 secondi), verificare che lo stato esca da Offline.
- Controllare che i workout pendenti siano presenti una sola volta, quindi ricaricare.
- Solo dopo sincronizzazione riuscita, verificare da un secondo dispositivo lo stesso storico.

Se health funziona ma la sincronizzazione continua a fallire, raccogliere lo status delle
richieste GET/PUT `/api/data` e i log API/proxy: health da solo non valida il protocollo
revisionato né la sessione autenticata. Non inviare i payload personali o i cookie.

## 6. Limite diagnostico adiacente, non modificato

La funzione `syncErrorKind` classifica come offline anche gli errori senza status HTTP.
Questo rende il messaggio poco specifico: può comparire anche con frontend nuovo e API
vecchia priva di `revision`, non solo per vera assenza di rete. Non ci sono evidenze
che questo secondo caso sia quello dell'istanza segnalata. La correzione resta limitata
al packaging confermato; non modifica la macchina a stati di sincronizzazione.

Esito: correzione pronta per commit; conferma dell'incidente e smoke test Docker sul
target ancora da eseguire. Non viene dichiarata già ripristinata l'istanza CasaOS.
