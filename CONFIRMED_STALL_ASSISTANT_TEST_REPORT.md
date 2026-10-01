# Requisito 17 — Assistente allo stallo Confirmed

Verifica finale: **2026-10-01**. Base di partenza: `5925ae6`.
Consegna: un requisito, un commit dedicato; il requisito 16 non è incluso.

## 1. Comportamento implementato

L'assistente usa soltanto allenamenti conclusi con snapshot `stallDetectionVersion: 1`.
Non modifica il passato e non interpreta retroattivamente i vecchi JSON come prove di stallo.

- Un insuccesso comparabile: nessun allarme.
- Due senza miglioramento: indicatore «Progressione da osservare».
- Tre senza miglioramento: «Possibile stallo» con proposta, mai decremento automatico.
- Una tecnica esplicitamente compromessa: invito a rivederla; due: proposta tecnica.
- Due insuccessi sotto il minimo dopo un aumento Confirmed effettivamente maturato:
  propone l'ultimo carico riuscito, se comparabile.
- Un miglioramento nello score o una sessione riuscita riaprono l'osservazione.
- Un cambio di recupero, carico, target, serie, range, epoch o attrezzatura interrompe la finestra.
- Una pausa maggiore di 28 giorni sospende il suggerimento; per i workout moderni contano
  gli istanti reali `end/start`, non soltanto il giorno sul calendario.

Lo score confronta, nell'ordine, minimo di ripetizioni delle serie prescritte, numero di serie
al target e somma delle ripetizioni limitate al target. Le serie opzionali sono neutrali.
Il miglioramento è valutato rispetto alla precedente esposizione della finestra comparabile.
`unknown` non viene trasformato in tecnica pulita; resta evidenza soltanto numerica.

Sono esclusi record legacy, incomplete, carichi misti, modifiche manuali non corrispondenti
al carico prescritto, date non utilizzabili, dolore/malessere, tempo o attrezzatura mancanti.
ID workout duplicati non moltiplicano le esposizioni; occorrenze ambigue dello stesso gruppo
in uno stesso workout non diventano prove selezionate arbitrariamente.

### Tecnica e recupero

La valutazione facoltativa è disponibile nell'esercizio, anche per corpo libero e interruzioni,
e nella conferma del peso: `Pulita / Compromessa / Non valutata`, più motivo facoltativo.
Le modifiche alle serie prescritte invalidano la review attiva; le serie opzionali no.

Una tecnica compromessa produce `technique_failed`: non convalida target o conferme massime,
né viene spacciata per fallimento che richieda +30 secondi. Dolore/malessere e interruzioni
producono `interrupted`; la UI invita a interrompere e chiedere un parere professionale adeguato.
Una segnalazione di dolore nell'esercizio attuale sopprime anche proposte storiche già disponibili.

Se la prima serie riesce e le successive no, ha precedenza l'aumento del recupero quando ancora
possibile. La regola già rilasciata «prima recupero base, poi due conferme» resta invariata.

### Riduzione suggerita e conferma

Senza un precedente aumento da annullare, riferimento del 7,5%, arrotondato per difetto
attraverso decrementi del passo configurato, partendo dal carico corrente (non da una griglia
assoluta a zero). Esempio: 70 kg, passo 2 kg → **64 kg**, riduzione effettiva **8,57%**.
Con inventario si usa il solver esistente per il valore inferiore componibile/selezionabile.
Senza inventario piastre resta disponibile la composizione manuale, senza obbligo di censire dischi.

Una proposta non positiva o non utilizzabile richiede valutazione manuale. In particolare,
azzerare la zavorra comporterebbe un cambio di modalità e non viene effettuato con un reset di
carico; resta una modifica esplicita della configurazione. Per corpo libero puro viene proposto
di valutare la variante/assistenza, mai kg negativi. Le semantiche di assistenza non supportate
non ricevono una prescrizione di carico automatizzata.

«Applica dal prossimo allenamento» apre una conferma con valore, ripetizioni e routine condivise.
«Mantieni» e «Ricordamelo più avanti» salvano rispettivamente `dismissed` e `snoozed`: la stessa
evidenza resta nascosta, anche dopo refresh. Nella v1 entrambe le scelte durano fino a evidenze
nuove/modificate, non fino a una scadenza oraria. Non viene avviato alcun timer di notifica.

Ogni conferma rivaluta lo stato corrente: una proposta diventata obsoleta non viene applicata.
Non si aprono popup obbligatori durante le serie. I dettagli mostrano soltanto le prove dello
stallo; non sostituiscono la futura vista generica delle ultime quattro sessioni (requisito 16).

## 2. Dati, persistenza e compatibilità

Campi opzionali:

- `entry.review`: tecnica e motivo dichiarati, conservati alla chiusura del workout;
- `entry.target.stallDetectionVersion`: attivazione prospettica del rilevatore;
- `entry.target.loadEpochId`: epoca di carico congelata all'avvio;
- `progressionControls[progressionId].confirmedRepRangeStall`: decisione e ID delle prove;
- `progressionControls[progressionId].confirmedRepRangeLoad`: nuova baseline, epoch, data,
  motivo, gruppo/configurazione compatibile e riferimenti alle prove.

L'assessment proposto è derivato deterministicamente; la scelta dell'utente è persistita.
L'accettazione cambia solo il controllo futuro: target al minimo e zero conferme del vecchio
carico. Non cambia allenamento attivo, storico, PR, recupero, rest epoch, incremento o serie.
Non aggiorna subito `progressionWeights`.

Il reset resta pending dopo avvio, scarto, incomplete o carichi misti. Dopo una sessione
completa e uniforme nella nuova epoch il carico registrato diventa operativo; il marker resta
per impedire il riuso delle vecchie conferme. Anche un carico uniforme corretto manualmente
nella nuova epoch può diventare la baseline, senza promuovere massimi isolati.

Un workout iniziato prima del reset e concluso/sincronizzato dopo mantiene il proprio storico
e gli eventuali PR, ma non ripristina la vecchia baseline. Il recupero continua a usare la propria
storia/epoch separata: una riduzione di carico non costituisce un reset implicito del recupero.

I controlli passano attraverso la sync esistente; due riduzioni concorrenti incompatibili
producono un conflitto esplicito. Import/export completo conserva i campi. Un piano condiviso,
invece, non può importare l'epoch privata o attivare retroattivamente prove di un'altra persona.

## 3. Base scientifica e limiti

Le soglie 3/2, la pausa di 28 giorni e il riferimento del 7,5% sono **policy versionate di
prodotto**, non valori dimostrati universalmente da uno studio. Il consenso Delphi sul deload
descrive un ambito con ricerca limitata e un approccio individualizzato: non convalida questo
specifico algoritmo. [Bell et al., 2023](https://link.springer.com/article/10.1186/s40798-023-00633-0).

L'app non diagnostica stallo fisiologico, tecnica scorretta o dolore dai soli numeri.
La review tecnica è dichiarata dall'utente; RIR/RPE non sono usati come diagnosi della tecnica.
Gli altri riferimenti della precedente analisi restano nella sezione 13 del backlog.

## 4. Risultati automatici

| Gate | Risultato |
| --- | --- |
| Detector, arrotondamento e decisioni pure | 53 test PASS |
| Integrazione epoch, lifecycle, snapshot, scope, sync/import | 35 test PASS |
| Componenti UI, callback, review, copy | 16 test PASS |
| Frontend completo, inclusi i 104 nuovi test sopra | **863/863**, 50 file, PASS |
| Backend HTTP, state store e packaging | **23/23**, 3 suite, PASS |
| Build frontend production | PASS, 131 moduli |
| Traduzioni | PASS, 11 lingue/954 chiavi; italiano completo, fallback inglese esplicito |
| Solver attrezzatura | PASS, 2.000 confronti deterministici |
| Browser requisito 17 | PASS, 28 controlli |
| Browser regressione recovery-first | PASS, 6 scenari |
| Browser regressione attrezzatura | PASS, 29 controlli |

La build mantiene il warning non bloccante sui chunk grandi. Nessuna regressione rilevata
nei test eseguiti; non è una garanzia su tutti i dispositivi o configurazioni possibili.

Nella riesecuzione finale del 1 ottobre, un avvio del server di packaging ha superato il timeout
di 10 secondi: 20 test backend passati e 3 annullati, senza un errore applicativo nel log.
Due riesecuzioni successive hanno dato **23/23 PASS**, anche dopo l'ultimo aggiornamento della
fixture. Timeout e assert non sono stati allentati; la causa del ritardo iniziale non è stata
determinata. Il timeout occasionale dell'harness resta segnalato, distinto dagli esiti finali verdi.

### Scenari coperti

| Area | Casi verificati |
| --- | --- |
| Soglie | 1/2/3 miss, 1/2 tecniche compromesse, incremento score, successo, target anticipato |
| Comparabilità | Config, serie, range, rest/base/epoch, load mode, equipment, legacy, incomplete/mixed/manual, optional |
| Tempo | Date assenti/future, pause lunghe, soglia 28 giorni ±1 minuto, `end/start` reali |
| Carico | kg/lb, passi 2 kg, microcarichi, offset non multiplo del passo, zero/negativi, inventario e tare |
| Post-aumento | Due massimi alla base prima dell'aumento, due fallimenti del minimo, niente rollback di un aumento manuale arbitrario |
| Identità | Routine indipendenti/condivise, nomi identici, workout duplicati, slot ambigui |
| Decisioni | Accetta/rifiuta/rimanda, idempotenza, nuova prova, dialogo obsoleto, dolore sopraggiunto |
| Lifecycle | Start/discard, incomplete/mixed, chiusura uniforme, secondo reset, completamento tardivo da epoch precedente |
| Persistenza | JSON roundtrip, merge setting+reset, conflitti tra reset, GET/PUT/ACK e riavvio reale del processo API |
| Immutabilità | Snapshot attivi/passati, PR e mappe non riscritti dall'accettazione; controllo rest preservato |
| UI | 320 px, reflow testo dettagli al 200%, temi, focus, Tab/Shift+Tab, Escape, conferma singola, timer non riavviato |

La fixture del test di packaging contiene ora review, versione, epoch, decisione e controllo
di recupero: GET/PUT e replay dopo riavvio verificano che il backend li conservi integralmente.

### Problemi trovati e risolti durante lo sviluppo

- confronto attrezzatura tra snapshot grezzi e profili normalizzati;
- rischio di interpretare un risultato zero come cambio implicito da zavorra a corpo libero;
- data delle evidenze visualizzata inizialmente come `Invalid Date`;
- focus sottratto al dialogo dal doppio effetto React StrictMode;
- passaggio dettagli→conferma con più dialoghi attivi;
- utilizzo del solo giorno anziché `end/start` per la finestra temporale;
- alias importato `illness` non allineato all'outcome di interruzione;
- alias `illness` non visualizzato dalla review: ora mostra l'opzione combinata dolore/malessere
  e il cambio della sola tecnica conserva il motivo originale, senza riabilitare la proposta
  (test SSR e due controlli browser dedicati).

Sono state corrette anche aspettative/fixture iniziali dei nuovi test (nome helper di merge,
ordine degli attributi HTML, snapshot fixture condiviso per riferimento). I test preesistenti
non sono stati allentati per ottenere un risultato verde.

## 5. Come replicare

Prerequisiti: dipendenze installate con `npm.cmd ci` in `frontend` e `api`; Node locale usato
per la verifica: **v26.3.0**, Windows. Su Linux/macOS usare `npm`.

Da PowerShell, radice del repository:

```powershell
cd frontend
npm.cmd test -- src/lib/confirmedRepRangeStall.test.js src/lib/confirmedRepRangeStall.integration.test.js src/components/ConfirmedStallAssistant.test.jsx
npm.cmd test
npm.cmd run build
node scripts/check-locales.mjs
node scripts/check-equipment-solver.mjs
cd ..\api
npm.cmd test
cd ..
git diff --check
```

Per i browser test, in un terminale dedicato:

```powershell
cd frontend
npm.cmd run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

In un secondo terminale, avviare un profilo **temporaneo, mai quello personale**:

```powershell
$stallQaProfile = Join-Path ([IO.Path]::GetTempPath()) ('opengym-stall-qa-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stallQaProfile | Out-Null
Start-Process -FilePath 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' -WindowStyle Hidden -ArgumentList @('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9222',('--user-data-dir=' + $stallQaProfile),'about:blank')
cd frontend
node scripts/check-confirmed-stall-browser.mjs
```

Lo script semina soltanto dati guest nel profilo di test e chiude il browser. Per gli altri
due script riavviare Edge con il medesimo comando, poi eseguire, uno alla volta:

```powershell
node scripts/check-confirmed-recovery-browser.mjs
# Riavviare Edge prima del test successivo.
node scripts/check-equipment-browser.mjs
```

Le porte possono essere configurate con `OPENGYM_APP_URL` e `OPENGYM_CDP_URL`.
Se 4173 è già occupata, verificare che sia il Vite di questo checkout; non terminare processi
estranei. In caso di cache Vite obsoleta riavviare il proprio processo con `--force`.

## 6. Gate manuali sul target e rollback

Non sono stati eseguiti Docker/Alpine/Node22 reali, CasaOS, screen reader reale, touch su telefono
fisico o due dispositivi reali. Il test di packaging usa i file del Dockerfile ma Node e npm
locali. I test browser simulano viewport/reflow: non equivalgono al collaudo di ogni telefono.

Prima del rilascio: backup completo del volume `data` e copia/esportazione del profilo locale
se contiene modifiche non sincronizzate. Non cancellare il browser né fare logout per testare.

Collaudo CasaOS consigliato:

1. Un vecchio profilo si apre senza migrazioni e senza suggerimenti retroattivi.
2. Nuove sessioni comparabili generano la proposta; un successo o recupero cambiato la interrompe.
3. Accettare durante un workout: le serie attuali restano invariate; il prossimo parte al nuovo
   peso/minimo. Scartarlo e riavviarlo non deve consumare il reset.
4. Controllare una routine condivisa e una indipendente dello stesso esercizio.
5. Refresh, chiusura/riapertura app e restart/down-up senza eliminare `data`: decisione mantenuta.
6. Offline, salvare review/decisione; tornato online, verificare sincronizzazione senza duplicati.
7. Ripetere su due dispositivi, inclusa una sessione iniziata prima della riduzione e finita dopo.
8. Verificare lettura del dialogo con screen reader e navigazione touch/tastiera reali.

Rollback codice tramite revert del commit dedicato, dopo backup e verifica delle modifiche
locali pendenti. Le vecchie build leggono i JSON con campi opzionali, ma non applicano il nuovo
vincolo delle epoch o della tecnica: il rollback **non garantisce la stessa prescrizione futura**.
Non cancellare manualmente campi o workout per simulare un rollback dei dati.

Il requisito 16 rimane la prossima consegna separata, dopo la pausa al commit del 17.
