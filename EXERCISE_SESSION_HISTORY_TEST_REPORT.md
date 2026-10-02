# Requisito 16 — Ultime quattro sessioni durante l'allenamento

Verifica: **2026-10-02**. Base codice: `198e827`.
Implementazione e test nel worktree; **nessun commit, push o deploy eseguito** per il requisito 16.
Nome proposto del commit: `feat: show four scoped exercise sessions during workouts`.

Aggiornamento all'avvio del requisito 2A (2026-10-02): il commit **`06d95a7`** con questo nome
è ora presente nel repository. La dicitura precedente registra la consegna originale senza
commit; questo report conserva i risultati ottenuti allora.

## Comportamento consegnato

Nell'esercizio attivo il pulsante **Storico recente** conserva l'anteprima dell'ultima sessione.
Un click apre una bottom sheet con al massimo quattro card, dalla più recente:

- nome storico della routine, data e orari disponibili;
- prescrizione congelata: serie, ripetizioni/tempo/cardio, carico e recupero;
- ogni serie registrata, compresi RIR/RPE, zero espliciti, serie non completate e opzionali;
- peso confermato a fine esercizio (`topW`) separato dai pesi delle serie;
- esito, conferme massime e attrezzatura storica, inclusa la tara disponibile.

Il pulsante è disponibile anche con zero risultati. Le card usano testo e badge, non soltanto
colore; non ci sono label con ellissi. Corpo libero, zavorra, unilateralità, secondi e cardio
mantengono le loro semantiche. Il carico per un singolo attrezzo è dichiarato quando il binding
storico lo contiene.

I dati provengono dallo stato locale. Aprire/chiudere la vista non modifica serie, progressione,
controlli di recupero/carico, PR, sincronizzazione o navigazione. Il recupero e il timer di lavoro
continuano: anche la scadenza e la callback di fine lavoro funzionano con la sheet aperta.
La lettura non richiede endpoint o campi persistenti aggiuntivi.

## Identità, dati legacy e aggiornamenti

La vista usa il `progressionId` dell'entry attiva e il reader esistente
`findWorkoutProgressionEntry()`. Routine indipendenti dello stesso esercizio restano separate;
routine condivise sono incluse con nome e disclosure. L'entry e il contesto sono copiati
all'apertura: modificare la routine o cambiare slot non sposta la sheet su un'altra progressione.

I workout e le routine locali sono osservati: nuove letture e una sheet già aperta recepiscono
cancellazioni/correzioni. Gli aggiornamenti dei timer non sono dipendenze della lettura.
L'ordinamento tiene conto delle date/istanti reali, anche se un import o un completamento offline
ha lasciato l'array fuori ordine; a parità di istante vale l'ordine di archiviazione.

Una scansione inversa O(numero workout) conserva quattro card candidate e fino a cinque
esposizioni Confirmed per verificare anche il predecessore della quarta card. Si scansiona
l'intero array per tollerare l'ordine degli import; non si riordina lo storico memorizzato.
Gli ID workout duplicati vengono contati una sola volta. Sono esclusi workout attivi, modalità
e load mode diversi e occorrenze duplicate non attribuibili univocamente.

I vecchi record senza identità sono attribuiti tramite la routine/posizione quando possibile.
Una baseline singola non attribuibile mostra **Storico precedente alla separazione delle
progressioni**; duplicati ambigui non vengono scelti arbitrariamente. Un obiettivo assente
rimane **non determinabile**, senza applicare la configurazione odierna.

Nome routine, unità e attrezzatura vengono letti dal workout storico. Se il nome non è stato
salvato la UI lo dichiara; non usa un nome rinominato oggi. Se manca l'unità storica, i numeri
sono mostrati nell'unità attuale con una nota esplicita, secondo la semantica esistente
dell'app che non converte retroattivamente i pesi. Tare o profili mancanti non vengono
ricostruiti dall'attrezzatura attuale. Non sono introdotte migrazioni o modifiche ai vecchi JSON.

## Esiti e conferme

Confirmed riusa `confirmedRepRangeSession()`. Serie opzionali restano neutrali; incomplete,
mixed load, tecnica compromessa e interruzioni mantengono esiti distinti. Per le altre strategie
si riusa `readSession()` solo quando lo snapshot è sufficiente: tutte le righe continuano a
contare, perché il concetto di serie opzionale nel dominio attuale è limitato a Confirmed.
Cardio mostra **Attività registrata**, senza inventare una regola di successo Confirmed.

| Situazione storica | Etichetta |
| --- | --- |
| Target raggiunto senza massimo | Riuscita |
| Primo massimo al recupero base | Massimo raggiunto — conferma 1 di 2 |
| Due massimi compatibili al recupero base | Aumento peso maturato — conferma 2 di 2 |
| Massimo sopra il recupero base | Massimo raggiunto — conferma 0 di 2; recupero sopra la base |
| Dati insufficienti o ordine non dimostrabile | Massimo raggiunto — conferme non determinabili |
| Corpo libero dopo due massimi | Serie aggiuntiva o valutazione della variante; nessun aumento kg inventato |

La seconda conferma richiede il predecessore storico compatibile: range, serie, carico
uniforme, base/recupero, rest epoch e load epoch. Il contatore salvato all'avvio può essere
diventato obsoleto dopo una cancellazione/correzione e non viene usato come prova unica.
Unità esplicitamente differenti interrompono la conferma. Date inutilizzabili o un'esposizione
ambigua impediscono di certificare l'adiacenza. Nessuna etichetta modifica l'algoritmo numerico
o applica un aumento: descrive le evidenze ancora disponibili per quella sessione.

Una riduzione accettata successivamente non cancella le conferme delle vecchie card;
la nuova epoch parte separatamente. Un completamento a un nuovo peso ricomincia dalla prima
conferma. Il recupero maggiorato resta prioritario, compreso il ciclo di quattro successi prima
di tornare alla base e poi completare due nuovi massimi.

## Test automatici e risultati

| Gate | Risultato |
| --- | --- |
| Reader/outcome: selezione, identità, legacy, date, unità e conferme | 59 test PASS |
| Integrazione builder/lifecycle, recovery-first, reset, equipment e sync | 10 test PASS |
| UI/formatter/contesto/accessibilità SSR | 20 test PASS |
| Frontend completo, inclusi 89 nuovi test | **952/952**, 53 file, PASS |
| Backend HTTP, persistenza e packaging invariati | **23/23**, 3 suite, PASS |
| Build frontend production | PASS, 133 moduli |
| Traduzioni | PASS, 11 lingue con 988 chiavi; italiano completo e fallback inglese esplicito |
| Solver attrezzatura | PASS, 2.000 confronti deterministici |
| Browser requisito 16 | PASS, 30 controlli |
| Browser regressione requisito 17 | PASS, 28 controlli |
| Browser regressione recovery-first | PASS, 6 scenari |
| Browser regressione attrezzatura | PASS, 29 controlli |

Nessuna regressione rilevata nei test eseguiti. La build mantiene il warning già presente sui
chunk grandi. Un tentativo backend eseguito in parallelo a build/browser ha superato il timeout
di avvio del server di packaging: 20 PASS e 3 annullati. La riesecuzione completa successiva
ha dato 23/23 PASS senza cambiare timeout/assert né file backend. La causa del ritardo
occasionale non è determinata; era già segnalata nel report del requisito 17.

### Scenari verificati

| Area | Casi |
| --- | --- |
| Selezione | 0/1/4/>4, array fuori ordine, stesso giorno, ID duplicati, active escluso |
| Scope | Lunedì/giovedì indipendenti, condivisi, slot duplicati, cambio config dopo start, routine eliminata |
| Legacy | Attribuzione singola/per posizione, baseline dichiarata, duplicati scartati, target assente |
| Risultati | Target vs set vs topW, incomplete/mixed, optional, tecnica/malessere, valori assenti/zero |
| Modalità | Reps, corpo libero, zavorra, unilateralità, time, cardio, RIR/RPE |
| Conferme | Due massimi, nuovo carico, rest superiore/base, rest/load epoch, cancellazione/correzione, unità diverse, ordine ambiguo |
| Lifecycle | Prescrizione ereditata, JSON roundtrip, merge a tre vie, nuove epoch e immutabilità di PR/mappe/active |
| Attrezzatura | Snapshot prima di cambio palestra, nome/tara/unità storici, profilo/binding mancante |
| Browser | 320 px, testo 200%, temi, focus/Tab/Shift+Tab/Escape/restore, scorrimento verticale, refresh/offline |
| Timer/rete | Deadline invariata, conto alla rovescia e scadenza recupero/lavoro, callback una sola volta, zero API dalla vista |

### Problemi trovati e risolti

- Il solo `topRangeStreak` congelato poteva convalidare una seconda conferma dopo la modifica
  o cancellazione della prima prova: ora viene verificato il predecessore.
- Pesi numericamente uguali ma con unità storiche diverse potevano essere accoppiati.
- Una data invalida poteva spostare un fallimento in fondo allo storico, creando falsa adiacenza.
- Saltare un'esposizione con duplicati ambigui poteva unire i due massimi ai suoi lati.
- Esaurita la piccola finestra di verifica, un indice mancante poteva puntare a una prova più
  recente: ora l'esito resta non determinabile.
- Nel primo browser test un'aspettativa cercava `Ultima volta`, mentre la traduzione esistente
  è `L'ultima volta`: corretto il test e attesa la lingua italiana prima degli assert.

I test preesistenti non sono stati allentati. L'algoritmo di progressione, i timer e il backend
non sono stati modificati per ottenere gli esiti verdi.

## Come replicare

Prerequisiti: dipendenze del checkout installate, Node locale usato **v26.3.0**, Windows.
Da PowerShell nella radice del repository (su Linux/macOS usare `npm`):

```powershell
cd frontend
npm.cmd test -- src/lib/exercise-session-history.test.js src/lib/exercise-session-history.integration.test.js src/components/ExerciseSessionHistory.test.jsx
npm.cmd test
npm.cmd run build
node scripts/check-locales.mjs
node scripts/check-equipment-solver.mjs
cd ..\api
npm.cmd test
cd ..
git diff --check
```

Browser test, in un terminale dedicato:

```powershell
cd frontend
npm.cmd run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

In un secondo terminale usare un profilo **temporaneo**, mai quello personale: lo script
scrive fixture guest nel profilo e chiude il browser alla fine, anche in caso di errore.

```powershell
$historyQaProfile = Join-Path ([IO.Path]::GetTempPath()) ('opengym-history-qa-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $historyQaProfile | Out-Null
Start-Process -FilePath 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' -WindowStyle Hidden -ArgumentList @('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9222',('--user-data-dir=' + $historyQaProfile),'about:blank')
cd frontend
node scripts/check-exercise-session-history-browser.mjs
```

Riavviare Edge con lo stesso comando prima di **ciascuna** regressione:

```powershell
node scripts/check-confirmed-stall-browser.mjs
node scripts/check-confirmed-recovery-browser.mjs
node scripts/check-equipment-browser.mjs
```

URL alternativi tramite `OPENGYM_APP_URL` e `OPENGYM_CDP_URL`. Se 4173 è occupata, verificare
che sia il proprio Vite del checkout; non terminare processi estranei. La prova offline
emula l'assenza di rete con la pagina già caricata: non sostituisce i test PWA cold start del
requisito 15. API e server dei media non devono essere avviati per le fixture guest del browser.

### Replica manuale sull'applicazione

1. Aprire un allenamento e toccare Storico recente: confrontare per ogni card i pesi delle serie
   con lo storico. Un peso confermato differente deve restare una voce separata.
2. Provare lo stesso esercizio in due routine indipendenti e in due routine condivise.
3. Aprire lo storico durante recupero e durante una serie a tempo: timer e fine conto devono
   continuare normalmente. Chiudere con Chiudi/Escape e controllare il focus sul pulsante.
4. Usare dati con recupero sopra base e con due massimi alla base; controllare 0/1/2 conferme.
5. Verificare corpo libero, zavorra, time, cardio e set opzionali; nessun target viene inventato
   quando manca lo snapshot storico.
6. Cambiare attrezzatura/nome routine dopo la sessione: i dati salvati restano visibili come erano.
7. Provare dopo refresh e senza rete, con meno di quattro sessioni o con nessuna.
8. Su telefono reale e con screen reader verificare scroll, testo ingrandito e lettura del titolo.

Non sono stati eseguiti test su CasaOS, Docker/Alpine/Node22 reali, telefono fisico o screen
reader reale. I test browser headless coprono viewport e tastiera. Le limitazioni dei dati legacy
sono dichiarate nella UI; il nuovo reader non recupera informazioni che non sono mai state salvate.

## File e consegna

- `frontend/src/lib/exercise-session-history.js` e test unitari/d'integrazione;
- `frontend/src/components/ExerciseSessionHistory.jsx` e test SSR;
- integrazione in `Workout.jsx`, CSS e locale/fallback;
- `frontend/scripts/check-exercise-session-history-browser.mjs`;
- questo report, backlog e report di rilascio aggiornati.

La consegna si ferma prima del commit per istruzione dell'utente. Il requisito 2A resta il
prossimo sviluppo separato; non viene iniziato in questa consegna.
