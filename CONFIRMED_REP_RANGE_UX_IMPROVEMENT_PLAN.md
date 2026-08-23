# Confirmed Rep-Range — Piano funzionale per incremento, target e UX

## Metadati

- Data analisi: 2026-08-23
- Stato: implementazione completata nel working tree e verificata con test automatici e browser
  headless; restano esplicitamente separati i gate CasaOS/Docker e assistivi manuali
- Branch analizzato: feature/confirmed-rep-range-progression
- Revisione di riferimento: 49bdd99 più modifiche non committate descritte nel presente documento
- Documento correlato: [report di implementazione e test corrente](CONFIRMED_REP_RANGE_TEST_REPORT.md)
- Ambito di questa modifica: dominio, snapshot, compatibilità JSON, UX responsive, test e documentazione

## 1. Scopo

Questo documento registra tre miglioramenti della strategia **Confirmed Rep-Range**, ne definisce
il comportamento atteso e traccia l’implementazione successivamente autorizzata:

1. rendere disponibile un incremento di 2 kg e applicarlo come delta esatto;
2. eliminare il campo **Target prima sessione**;
3. riprogettare la configurazione affinché label, valori e comandi rimangano leggibili su
   telefono, desktop, lingue diverse e testo ingrandito.

Il documento costituisce sia la specifica funzionale sia la matrice di accettazione verificabile.
La baseline storica resta nel report di test e la nuova esecuzione viene registrata separatamente,
senza riscrivere i risultati delle iterazioni precedenti.

### Fuori ambito

- classificazione automatica dell’esercizio come forza o ipertrofia;
- scelta automatica dell’incremento in base alla tipologia di esercizio;
- modifica della formula di deload;
- conversione automatica dei carichi quando il profilo passa da kg a lb o viceversa;
- reset automatici impliciti della progressione o del recupero;
- modifica retroattiva dei workout completati.

L’analisi precedentemente ipotizzata sulla tipologia di esercizio è stata rimossa dal piano di
implementazione su decisione esplicita.

## 2. Decisioni funzionali sintetiche

| ID | Decisione | Stato |
|---|---|---|
| CRRP-UX-001 | L’incremento di 2 kg deve essere selezionabile e deve significare sempre carico corrente + 2 kg | Implementata — Pass automatico/browser |
| CRRP-UX-002 | La prima sessione Confirmed parte dalle ripetizioni minime | Implementata — Pass automatico |
| CRRP-UX-003 | Ogni aumento di peso riporta il target alle ripetizioni minime | Implementata — Pass automatico |
| CRRP-UX-004 | Il campo configurabile Target prima sessione viene rimosso | Implementata — Pass automatico/browser |
| CRRP-UX-005 | Il campo generico Ripetizioni viene nascosto quando Confirmed è effettivamente attivo | Implementata — Pass browser |
| CRRP-UX-006 | Le label dei campi modificabili non possono essere troncate con i puntini | Implementata — Pass browser |
| CRRP-UX-007 | I controlli vengono organizzati in gruppi semantici responsive, al massimo due colonne | Implementata — Pass browser |
| CRRP-UX-008 | Configurazioni e snapshot legacy restano leggibili senza migrazione manuale | Implementata — Pass automatico con fixture legacy |

Le due scelte inizialmente raccomandate sono state autorizzate dalla richiesta di procedere con
gli sviluppi e validate sulle viewport previste. I limiti delle prove assistive/manuali restano
indicati nella matrice, senza trasformare un controllo non eseguito in un Pass.

## 3. Vocabolario e invarianti

### Incremento

Quantità relativa da sommare o sottrarre al carico corrente quando la strategia decide una
variazione. Non rappresenta una griglia assoluta di pesi caricabili.

### Ripetizioni minime

Sono contemporaneamente:

- il punto di ingresso nella progressione Confirmed;
- il target dopo ogni aumento di peso;
- il limite inferiore del range configurato.

### Ripetizioni massime

Sono il limite superiore del range. Al massimo sono richieste due sessioni riuscite consecutive
prima dell’aumento di peso.

### Target del prossimo workout

È un valore derivato dalla configurazione e dallo storico. Non è più un valore iniziale scelto
manualmente dall’utente.

### Snapshot del workout

È la fotografia della prescrizione realmente utilizzata da uno specifico allenamento. Deve
rimanere stabile anche se successivamente viene modificata la routine.

### Invarianti comuni

- Un workout passato non viene modificato da cambi futuri della routine.
- Un workout già avviato conserva carico, target e incremento ricevuti all’avvio.
- Il recupero adattivo e la progressione delle ripetizioni rimangono due stati distinti.
- Un fallimento non riporta automaticamente il target alle ripetizioni minime.
- La sola modifica dell’incremento non cambia il target corrente.
- La sola modifica del layout non cambia JSON, prescrizioni o storico.

## 4. CRRP-UX-001 — Gestione dell’incremento

### 4.1 Problema da risolvere

L’utente deve poter configurare una progressione di 2 kg e ottenere una sequenza realmente
incrementale:

~~~text
65 → 67 → 69 → 71 kg
72,5 → 74,5 → 76,5 kg
~~~

Il calcolo corrente riallinea alcuni risultati ai multipli assoluti dell’incremento. In termini
concettuali applica:

~~~text
arrotonda(peso corrente + incremento, alla griglia incremento)
~~~

Con incremento 2 può quindi produrre:

~~~text
65 + 2   → 68 invece di 67
72,5 + 2 → 74 invece di 74,5
~~~

Questo comportamento contraddice il significato mostrato all’utente.

### 4.2 Regola funzionale

Per ogni aumento ordinario:

~~~text
peso successivo = peso corrente + incremento configurato
~~~

Per un’eventuale diminuzione espressa in incrementi:

~~~text
peso successivo = peso corrente - numero incrementi × incremento configurato
~~~

La precisione supportata per nuovi carichi e incrementi è il centesimo dell’unità:

- input con al massimo due cifre decimali;
- calcolo a centesimi, evitando l’errore binario floating-point;
- serializzazione numerica senza zeri artificiali;
- visualizzazione con massimo due decimali e senza zeri finali.

Quindi 63,75 resta 63,75, mentre 64,00 viene mostrato come 64. Questa policy deve essere
implementata nel dominio e nel formatter specifico dei carichi, senza modificare alla cieca il
formatter numerico globale. L’incremento non deve essere riutilizzato come griglia assoluta di
arrotondamento.

### 4.3 Esempi obbligatori

| Peso corrente | Incremento | Risultato atteso |
|---:|---:|---:|
| 70 kg | 2 kg | 72 kg |
| 72 kg | 2 kg | 74 kg |
| 65 kg | 2 kg | 67 kg |
| 67 kg | 2 kg | 69 kg |
| 72,5 kg | 2 kg | 74,5 kg |
| 74,5 kg | 2 kg | 76,5 kg |
| 62,5 kg | 1,25 kg | 63,75 kg |
| 63,75 kg | 0,25 kg | 64 kg |

### 4.4 Significato di “incremento minimo”

Il valore 2 kg deve essere una scelta disponibile e immediata, ma **non diventa un limite minimo
globale**. Restano validi i microincrementi già configurabili, per esempio:

- 0,25 kg;
- 0,5 kg;
- 1 kg;
- 1,25 kg;
- 1,5 kg.

I default esistenti non devono essere riscritti. Una routine che usa 2,5 kg o 5 kg continua a
usarli finché l’utente non effettua una modifica esplicita.

### 4.5 Strategie coinvolte

| Strategia | Comportamento con incremento 2 |
|---|---|
| Linear | Un successo che richiede aumento applica +2 |
| Double Progression | Al raggiungimento della condizione di aumento applica +2 e torna al minimo del range |
| Confirmed Rep-Range | Alla seconda conferma al massimo applica +2 e torna al minimo del range |
| Greyskull, aumento normale | Applica +2 |
| Greyskull, salto doppio | Applica +4 |
| Hold o fallimento | Non modifica il peso |
| Corpo libero senza zavorra | Non inventa un carico |
| Corpo libero zavorrato | Applica l’incremento alla zavorra |

Il deload percentuale conserva la propria formula e la propria logica di arrotondamento. Dopo un
deload, i successivi aumenti ordinari devono comunque tornare ad applicare il delta esatto.

### 4.6 Unità di misura

- In un profilo configurato in kg, incremento 2 significa 2 kg.
- In un profilo configurato in lb, incremento 2 significa 2 lb.
- Questa modifica non introduce una conversione automatica kg/lb.
- L’unità deve essere visibile sia nel campo sia nell’anteprima.

### 4.7 UX prevista

Il valore 2 deve essere raggiungibile senza digitazione manuale. Soluzione raccomandata:

- scelte rapide coerenti con l’unità, per esempio 2, 2,5 e 5 in kg;
- opzione **Personalizzato** per microincrementi e valori diversi;
- anteprima del risultato, per esempio **Prossimo aumento: 72,5 → 74,5 kg**;
- nessun cambiamento del peso corrente quando si cambia soltanto l’incremento.

L’anteprima deve partire dal peso effettivo derivato per il prossimo workout, non necessariamente
dal vecchio peso configurato nella routine.

I pulsanti meno/più del peso durante il workout devono usare l’incremento salvato nello snapshot:

~~~text
incremento 2:   70 → 72 → 74
incremento 2,5: 70 → 72,5 → 75
~~~

Lo snapshot deve catturare l’incremento **effettivo già risolto**, anche quando deriva dal default
perché **cfg.inc** manca. Copiare soltanto il campo opzionale della configurazione renderebbe il
workout attivo dipendente da default o routine modificati successivamente.

### 4.8 Validazione

- Un valore finito, almeno pari a 0,01 e con massimo due decimali è valido.
- I decimali con virgola immessi dall’utente devono continuare a essere accettati.
- Zero, numeri negativi, valori non numerici e infinito non sono configurazioni valide.
- Un nuovo valore con più di due decimali viene rifiutato con un messaggio esplicito, non
  troncato durante la digitazione.
- Se il valore manca o è invalido, si usa il default previsto per esercizio e unità.
- Se esistono sia il campo canonico **inc** sia il legacy **weightIncrement**, prevale **inc**.
- **weightIncrement** resta esclusivamente un fallback di lettura.

Un vecchio JSON con un incremento positivo più preciso di due decimali resta caricabile. Per le
prescrizioni future il resolver lo normalizza al centesimo più vicino e la UI mostra il valore
effettivo; i workout già snapshottati non vengono modificati. La configurazione non viene
riscritta finché l’utente non la salva esplicitamente. Questo caso deve avere un test e una nota
di rilascio.

### 4.9 Persistenza e compatibilità

Non è richiesta una migrazione manuale:

- **inc** è già parte della configurazione della routine;
- il valore deve attraversare salvataggio locale, server sync, refresh e Docker down/up;
- i piani condivisi devono mantenere il valore;
- i workout completati non vengono riscritti;
- un workout attivo usa il valore ricevuto al momento della sua creazione;
- configurazioni senza incremento continuano a usare il default;
- valori esistenti come 1,25, 2,5 e 5 non vengono normalizzati a 2.

## 5. CRRP-UX-002/003/004/005 — Rimozione di Target prima sessione

### 5.1 Problema da risolvere

Con i campi attuali l’utente può vedere contemporaneamente:

- Ripetizioni;
- Ripetizioni minime;
- Ripetizioni massime;
- Target prima sessione.

I quattro valori sembrano concorrenti e rendono difficile capire quale determinerà davvero il
prossimo workout. Il target iniziale aggiunge una scelta che non è necessaria alla progressione.

### 5.2 Decisione

Il campo **Target prima sessione** viene rimosso dalla configurazione Confirmed.

Le regole diventano:

~~~text
Prima sessione Confirmed = Ripetizioni minime
Dopo ogni aumento di peso = Ripetizioni minime
~~~

Quando Confirmed è effettivamente attivo, anche il normale campo **Ripetizioni** viene nascosto.
Ricompare con le altre strategie, dove conserva il proprio significato.

### 5.3 Configurazione risultante

~~~text
Serie:                   3
Ripetizioni minime:      8
Ripetizioni massime:    12
Peso iniziale:       70 kg
Incremento:           2 kg
~~~

Prima prescrizione:

~~~text
3 × 8 @ 70 kg
~~~

### 5.4 Sequenza completa di riferimento

Assumendo che tutte le sessioni riescano:

| Sessione | Peso | Target | Esito funzionale |
|---:|---:|---:|---|
| 1 | 70 kg | 8 | Primo ingresso al minimo |
| 2 | 70 kg | 9 | Progressione di una ripetizione |
| 3 | 70 kg | 10 | Progressione di una ripetizione |
| 4 | 70 kg | 11 | Progressione di una ripetizione |
| 5 | 70 kg | 12 | Prima conferma al massimo |
| 6 | 70 kg | 12 | Seconda conferma al massimo |
| 7 | 72 kg | 8 | Aumento esatto di 2 kg e ritorno al minimo |

Il minimo non è quindi ridondante: definisce il punto di partenza e il punto di ripartenza dopo
ogni incremento del carico.

### 5.5 Definizione di “prima sessione”

È una prima sessione Confirmed quando:

- non esiste uno storico Confirmed valido per quell’ambito di progressione.

Non è una prima sessione ogni nuovo allenamento. Se l’ultimo target Confirmed era 10:

- successo a 10 → prossimo target 11;
- fallimento a 10 → prossimo target ancora 10;
- eliminazione o chiusura dell’app → il target non torna a 8;
- modifica del solo incremento o recupero → il target non torna a 8.

Entrare in Confirmed dopo workout eseguiti esclusivamente con altre strategie porta il target al
minimo, ma non deve far regredire il carico:

- se esiste un ultimo carico operativo valido per l’esercizio, viene mantenuto;
- il peso configurato viene usato soltanto quando non esiste alcun carico storico applicabile.

Quindi “prima sessione Confirmed” riguarda il target delle ripetizioni, non equivale
automaticamente a “primo peso in assoluto”.

### 5.6 Regole della macchina a stati

| Stato corrente | Esito | Prossima prescrizione |
|---|---|---|
| Nessuno storico dell’esercizio | — | Peso configurato, target minimo |
| Storico soltanto di altre strategie | — | Ultimo peso operativo applicabile, target minimo |
| Target sotto il massimo | Successo | Stesso peso, target + uno step valido: 1 normalmente, 2 nella modalità totale per-lato |
| Qualsiasi target | Fallimento | Stesso peso e stesso target |
| Massimo, streak 0 | Successo | Stesso peso e stesso massimo; streak 1 |
| Massimo, streak 1 | Successo | Peso + incremento; target minimo; streak 0 |
| Massimo, streak 1 | Fallimento | Stesso peso e target; streak interrotto secondo le regole Confirmed |

Le ripetizioni extra non consentono di saltare livelli intermedi. Un target 8 completato con 12
ripetizioni è comunque una conferma del target 8 e il prossimo target è 9.

### 5.7 Range con minimo uguale al massimo

Il range 8–8 è valido. La prima sessione riuscita a 8 vale già come conferma 1/2; la seconda
sessione riuscita consecutiva vale come conferma 2/2, provoca l’aumento di peso e genera una nuova
prescrizione ancora a 8.

### 5.8 Campo generico Ripetizioni

Quando Confirmed è attivo:

- non deve essere mostrato come campo concorrente;
- **minReps** è la sorgente funzionale per la prima prescrizione;
- se parti generiche dell’app richiedono ancora **reps**, può essere mantenuto come mirror tecnico
  di **minReps**, ma non come seconda scelta utente;
- il riepilogo della routine deve mostrare **3 × 8–12**;
- il target derivato del prossimo workout va mostrato separatamente e in sola lettura.

Quando Confirmed non è attivo, il campo Ripetizioni ricompare e conserva il valore utile alle
altre strategie. La regola vale anche quando Confirmed è ereditato dalla routine e non selezionato
direttamente sull’esercizio.

Anche il riepilogo **3 × 8–12** deve risolvere la policy effettiva ereditata. Il formatter e il
relativo call-site devono quindi ricevere il contesto della routine o una configurazione già
risolta; non è sufficiente leggere soltanto la configurazione locale dell’esercizio.

### 5.9 Modello dati: configurazione e snapshot non sono la stessa cosa

Il nome **targetReps** può comparire in due contesti con significati differenti.

#### Configurazione della routine

Il target iniziale configurabile diventa obsoleto:

- i nuovi salvataggi non devono richiederlo;
- i nuovi export non devono emetterlo come opzione iniziale;
- se presente in un vecchio JSON, viene tollerato ma ignorato per la prima prescrizione.

#### Snapshot di uno specifico workout

Il target storico resta necessario:

~~~json
{
  "reps": 10,
  "targetReps": 10
}
~~~

In questo caso significa: “in quel workout erano prescritte 10 ripetizioni”. Non significa
“target della prima sessione”. Il valore:

- continua a essere letto;
- non viene cancellato dai workout passati;
- deve essere rispettato da un workout già attivo;
- consente di derivare correttamente il target successivo.

### 5.10 Backward compatibility

Vecchia configurazione:

~~~json
{
  "minReps": 8,
  "maxReps": 12,
  "targetReps": 10
}
~~~

Comportamento dopo l’aggiornamento:

- il JSON è ancora leggibile;
- senza storico Confirmed, la prima prescrizione diventa 8;
- con storico Confirmed, la progressione continua dal target registrato nello storico;
- il valore configurabile 10 viene ignorato;
- al successivo salvataggio può essere omesso;
- non è richiesta una migrazione manuale.

Il passaggio da 10 a 8 per una vecchia configurazione senza storico è una modifica semantica
intenzionale e deve essere indicata nelle note di rilascio.

Un vecchio piano condiviso con target configurabile continua a essere importabile. Un nuovo piano
condiviso non deve più dipendere da quel campo.

### 5.11 Modifica successiva del range

Una modifica di **minReps** o **maxReps** è strutturale e non deve reinterpretare artificialmente
un vecchio successo.

Esempio:

~~~text
Vecchio range: 8–12
Ultimo target riuscito: 8
Nuovo range: 10–15
~~~

Il comportamento desiderato è:

~~~text
prossimo target = 10
~~~

Non:

~~~text
vecchio target clampato a 10, considerato già riuscito, prossimo target = 11
~~~

La soluzione intuitiva sarebbe una nuova baseline futura al nuovo minimo, senza riscrivere lo
storico. Tuttavia questa soluzione **non fa parte dell’iterazione descritta dal presente
documento**, perché richiede prima di decidere se lo storico appartiene globalmente
all’esercizio o allo specifico slot della routine.

Fino a quella decisione:

- salvare un nuovo minimo o massimo non deve introdurre di nascosto un reset o un marker;
- il comportamento esistente va mantenuto e coperto da un test di non regressione;
- la UI non deve promettere “ripartenza dal minimo” per una semplice modifica del range;
- l’eventuale comando per iniziare una nuova baseline dovrà essere esplicito e analizzato
  separatamente.

Non creano in ogni caso una nuova baseline delle ripetizioni:

- modifica del solo incremento;
- modifica del recupero iniziale o massimo;
- reset manuale del recupero;
- attivazione o disattivazione della riduzione automatica del recupero.

### 5.12 Esercizi registrati per lato

Se il valore rappresenta ripetizioni totali di un esercizio per lato, minimo, massimo e target
derivato devono usare lo stesso passo semantico del normale campo Ripetizioni.

Esempio atteso:

~~~text
16 → 18 → 20
~~~

e non:

~~~text
16 → 17 → 18 → 19 → 20
~~~

Un minimo non valido per la modalità per-lato deve essere normalizzato o impedito dalla UI prima
del salvataggio.

### 5.13 Interazione con il recupero adattivo

La rimozione del target iniziale non deve:

- azzerare il recupero effettivo;
- consumare un reset manuale del recupero;
- cambiare il contatore dei successi necessario alla riduzione automatica;
- modificare **topRangeStreak**;
- creare un deload;
- modificare workout passati.

L’aumento del peso azzera soltanto il ciclo delle ripetizioni tornando al minimo. Il recupero
continua a seguire le proprie regole.

## 6. CRRP-UX-006/007 — Analisi approfondita UX/UI

### 6.1 Diagnosi dell’interfaccia corrente

Il problema delle label contratte non dipende soltanto dalla traduzione. È strutturale.

La configurazione Confirmed inserisce attualmente nella stessa riga flessibile:

1. incremento;
2. ripetizioni minime;
3. ripetizioni massime;
4. target iniziale;
5. recupero iniziale;
6. recupero massimo.

Il CSS assegna a ogni figlio la stessa quota di spazio, permette una larghezza minima pari a zero
e forza le label su una sola riga con ellissi. La presenza di **flex-wrap** non risolve il problema,
perché i figli possono comprimersi invece di andare a capo.

Spazio indicativo disponibile nel foglio:

| Viewport | Spazio utile | 6 controlli attuali | 5 controlli dopo il solo target removal |
|---:|---:|---:|---:|
| 320 px | circa 284 px | circa 41 px per controllo | circa 50 px |
| 375 px | circa 339 px | circa 50 px | circa 61 px |
| 430 px | circa 394 px | circa 59 px | circa 72 px |
| Desktop, sheet 640 px | circa 604 px | circa 94 px | circa 114 px |

Ogni Stepper contiene già due pulsanti da 30 px. Nelle larghezze inferiori a 60 px non resta
nemmeno spazio teorico sufficiente per il valore centrale. Inoltre:

~~~text
Ripetizioni minime
Ripetizioni massime
~~~

diventano entrambe visivamente:

~~~text
Ripetizioni...
~~~

La parte nascosta è esattamente quella che distingue i due campi.

La rimozione di Target prima sessione riduce il rumore, ma da sola non risolve il difetto.

### 6.2 Obiettivi UX

- Comprendere a colpo d’occhio che cosa viene configurato.
- Vedere sempre il nome completo di ogni campo.
- Evitare tocchi sul controllo sbagliato.
- Rendere evidente quale valore è configurato e quale è derivato.
- Far capire perché il prossimo workout usa un determinato target e recupero.
- Mantenere il modulo utilizzabile con traduzioni più lunghe e testo al 200%.
- Non aumentare il carico cognitivo con sigle o abbreviazioni non spiegate.

### 6.3 Architettura dell’informazione raccomandata

Il modulo non deve essere una riga piatta. Deve essere diviso in gruppi semantici.

Lo scope del nuovo layout è il foglio di configurazione dell’esercizio quando la policy
**effettiva** è Confirmed, inclusa l’ereditarietà dalla routine. I controlli Serie e Peso già
esistenti vengono riposizionati, non duplicati. Le modalità time, cardio e le altre strategie non
ricevono i fieldset Confirmed; beneficiano però delle correzioni accessibili del componente
Stepper condiviso e devono essere coperte da test di regressione.

#### Serie

- Serie previste.

#### Carico

- Peso iniziale o corrente, secondo il contesto.
- Incremento.
- Anteprima del prossimo aumento.

#### Range ripetizioni

- Minime.
- Massime.
- Spiegazione dinamica: “La prima sessione e ogni aumento di carico ripartono da 8.”

#### Recupero

- Recupero iniziale.
- Limite degli aumenti automatici.
- Riduzione automatica.
- Recupero effettivo del prossimo allenamento e relativa motivazione.
- Reset manuale, quando applicabile.

I gruppi dovrebbero essere implementati come **fieldset** con **legend**, non soltanto come titoli
visivi. Il contesto consente label brevi ma complete:

- gruppo **Range ripetizioni** + label **Minime** e **Massime**;
- gruppo **Recupero (secondi)** + label **Iniziale** e **Limite automatico**.

Mappatura del testo raccomandata:

| Campo attuale | Testo proposto | Nota |
|---|---|---|
| Serie | Serie | Resta visibile |
| Ripetizioni | Nascosto con Confirmed | Ricompare con le altre strategie |
| Step | Incremento (kg/lb) | Evita un termine tecnico ambiguo |
| Ripetizioni minime | Minime, nel gruppo Range ripetizioni | Il contesto conserva il significato completo |
| Ripetizioni massime | Massime, nel gruppo Range ripetizioni | Nessuna ellissi |
| Target prima sessione | Rimosso | Sostituito dalla regola deterministica |
| Recupero iniziale | Iniziale, nel gruppo Recupero (secondi) | È la baseline configurata |
| Recupero massimo | Limite automatico, nel gruppo Recupero (secondi) | Non promette di ridurre un valore effettivo già superiore |
| Riduzione automatica | Riduci di 30 s dopo 4 successi consecutivi | Copy esplicita, toggle opt-in |
| Recupero effettivo | Recupero prossimo allenamento | Valore derivato in sola lettura |

Il termine **Limite automatico** è intenzionale. Se il recupero effettivo è già 180 s e l’utente
abbassa il limite a 150 s, il valore effettivo non viene forzato retroattivamente a 150 s: resta
180 s finché una riduzione automatica o un reset manuale non lo modifica. La UI deve mostrare
entrambi i valori e spiegare questa differenza.

### 6.4 Wireframe proposto

Telefono con spazio sufficiente per due colonne:

~~~text
PROGRESSIONE

Regola
Confirmed Rep-Range                         >

SERIE

Serie
[ − | 3 | + ]

CARICO

Peso (kg)                  Incremento (kg)
[ − | 70 | + ]             [ − | 2 | + ]

Prossimo aumento: 70 → 72 kg

RANGE RIPETIZIONI

Minime                     Massime
[ − | 8 | + ]              [ − | 12 | + ]

La prima sessione e ogni aumento di carico
ripartono da 8 ripetizioni.

RECUPERO

Iniziale                   Limite automatico
[ − | 120 s | + ]          [ − | 240 s | + ]

Riduzione automatica                         [ ON ]

PROSSIMO ALLENAMENTO

3 × 8 @ 70 kg
Recupero: 120 s
Motivo: inizio del range configurato.
~~~

Viewport stretto o testo ingrandito:

~~~text
RANGE RIPETIZIONI

Minime
[ −          8          + ]

Massime
[ −         12          + ]
~~~

### 6.5 Regole responsive

- Utilizzare una griglia per ogni gruppo, non una singola griglia per tutto il modulo.
- Consentire due colonne soltanto quando ogni controllo conserva la propria larghezza minima.
- Sotto quella soglia passare automaticamente a una colonna.
- Impostare una larghezza minima per controllo di circa 150–160 px, da validare nel browser.
- A 320 px il risultato atteso è una colonna.
- A 360, 375, 390 e 430 px sono ammesse due colonne soltanto se label, valore e touch target
  rimangono interamente visibili.
- Nel foglio desktop mantenere al massimo due colonne per i campi verbosi; non ricreare una fila
  con cinque o sei controlli.
- Le label possono andare a capo; non possono usare ellissi.
- Non deve esistere scroll orizzontale.
- L’ordine visivo e l’ordine di tabulazione devono coincidere.

La soluzione tecnica preferita è una CSS Grid a larghezza minima garantita, accompagnata dai
gruppi semantici. Un breakpoint fisso può essere usato soltanto se i test con traduzioni e zoom
dimostrano che non comprime i contenuti.

### 6.6 Accessibilità obbligatoria

Lo Stepper corrente usa una label visiva non associata programmaticamente all’input e comandi
generici “Decrease” e “Increase”. Il nuovo componente deve garantire:

- elemento label realmente associato all’input;
- nome accessibile univoco per ogni valore;
- comandi localizzati e contestuali, per esempio “Diminuisci ripetizioni minime”;
- unità kg, lb e s disponibili anche nel nome o nella descrizione accessibile;
- pulsanti meno/più di almeno 44 × 44 px;
- focus da tastiera sempre visibile;
- contrasto di label e riepiloghi essenziali almeno 4,5:1;
- nessuna dipendenza da tooltip o attributo title per comprendere il campo;
- messaggi di errore associati al relativo input.

Abbreviazioni, caratteri più piccoli, tooltip e scorrimento orizzontale non sono soluzioni
accettabili al problema.

### 6.7 Anteprima e spiegazione del valore derivato

La configurazione deve separare chiaramente:

- **valori modificabili**: minimo, massimo, incremento, recupero base;
- **valori derivati**: target e recupero effettivo del prossimo workout.

Il riepilogo del prossimo workout deve essere in sola lettura e aggiornarsi mentre l’utente
modifica la bozza:

~~~text
Prossimo allenamento
3 × 8 @ 70 kg
Recupero 120 s
Perché: prima sessione Confirmed
~~~

Con storico:

~~~text
Prossimo allenamento
3 × 10 @ 70 kg
Recupero 150 s
Perché: ultimo target 9 riuscito; recupero aumentato dopo il fallimento precedente
~~~

La UI deve distinguere visivamente la bozza non ancora salvata dalla prescrizione persistita.

### 6.8 Lunghezza del foglio e azione Salva

I gruppi rendono il modulo più lungo ma più leggibile. Per evitare che la lunghezza diventi un
nuovo problema:

- ridurre l’altezza dell’immagine/GIF nel contesto di configurazione;
- valutare un footer con Salva sempre raggiungibile;
- mantenere sempre visibili i campi essenziali;
- rendere comprimibili soltanto spiegazioni o dettagli avanzati, non gli input;
- non attenuare eccessivamente il riepilogo del prossimo allenamento.

### 6.9 Alternative valutate

| Alternativa | Vantaggio | Limite | Decisione |
|---|---|---|---|
| Solo flex-basis minimo e label a capo | Hotfix piccolo | Modulo ancora piatto; ordine del wrap poco prevedibile | Non raccomandata come soluzione finale |
| CSS Grid generica | Elimina la compressione | Senza gruppi resta cognitivamente confusa | Base tecnica valida, da unire ai fieldset |
| Una riga per ogni campo | Massima leggibilità | Più scrolling | Usare automaticamente alle larghezze strette |
| Abbreviazioni o font più piccolo | Poco lavoro | Peggiora comprensione e accessibilità | Rifiutata |
| Tooltip sulle label troncate | Può aiutare con mouse | Non risolve touch o screen reader | Rifiutata |
| Scroll orizzontale | Conserva una sola riga | Nasconde campi e favorisce errori | Rifiutata |

## 7. Interazione completa fra le tre modifiche

Configurazione:

~~~text
Serie:                  3
Minimo:                 8
Massimo:               12
Peso:               70 kg
Incremento:          2 kg
Recupero base:       120 s
~~~

Flusso:

1. La UI non chiede Target prima sessione.
2. L’anteprima mostra 3 × 8 @ 70 kg.
3. Il primo workout viene snapshottato con target 8 e incremento 2.
4. I successi portano il target da 8 a 12, uno step per sessione.
5. Due conferme consecutive a 12 autorizzano l’aumento.
6. Il calcolo usa 70 + 2 = 72 senza riallineamento a una griglia.
7. Il workout successivo riparte da target 8.
8. Il recupero segue separatamente il proprio storico e non viene azzerato dall’aumento di peso.
9. Se la routine viene modificata dopo l’avvio del workout, lo snapshot già creato non cambia.

## 8. Modello dati consolidato

| Dato | Dove vive | Modificabile dall’utente | Persistente | Note |
|---|---|---:|---:|---|
| minReps | Configurazione esercizio/routine | Sì | Sì | Sorgente della prima prescrizione e del reset dopo aumento |
| maxReps | Configurazione esercizio/routine | Sì | Sì | Limite superiore |
| inc | Configurazione e snapshot | Sì | Sì | Nello snapshot è sempre il delta effettivo, anche se derivato dal default |
| targetReps nella configurazione | Legacy | No | Solo lettura legacy | Ignorato come target iniziale |
| targetReps nello snapshot | Workout | No | Sì | Prescrizione storica reale |
| topRangeStreak | Derivato dallo storico Confirmed applicabile | No | Tramite storico | Non viene mai filtrato dall’epoch del recupero |
| restSeconds | Configurazione | Sì | Sì | Baseline del recupero |
| recupero effettivo | Derivato da storico e reset | No | Riproducibile | Mostrato e motivato in UI |
| baseline del range | Non introdotta in questa iterazione | No | — | Tema aperto separato; nessun reset implicito |

L’epoch già introdotto per il reset del recupero filtra esclusivamente il recupero. Non deve
filtrare peso, target delle ripetizioni o **topRangeStreak**. Un eventuale futuro marker del range
sarebbe un concetto distinto e richiederebbe una specifica separata.

## 9. Matrice di compatibilità

| Scenario | Comportamento atteso |
|---|---|
| Configurazione nuova | Parte da minReps |
| Configurazione legacy con target iniziale e senza storico | Ignora il target legacy e parte da minReps |
| Configurazione legacy con storico Confirmed | Continua dal target storico |
| Workout attivo durante upgrade | Conserva target e incremento snapshottati |
| Workout completato | Non viene modificato |
| Configurazione senza inc | Usa il default esistente |
| Configurazione con inc 2,5 o microincremento | Conserva il valore |
| inc e weightIncrement entrambi presenti | Prevale inc |
| Vecchio piano condiviso con targetReps | Importabile; target configurabile ignorato |
| Nuovo piano condiviso | Non dipende dal target iniziale |
| Strategia Confirmed ereditata | Stesse regole della strategia impostata direttamente |
| Cambio del solo incremento | Target e recupero invariati |
| Cambio min/max | Nessun reset implicito; comportamento esistente preservato finché la baseline non viene progettata separatamente |
| Reset manuale recupero | Non modifica target, peso o storico passato |
| Refresh, server sync, Docker down/up | Configurazione e marker persistenti restano validi |

## 10. Criteri di accettazione funzionali

Gli stati seguenti si riferiscono all’esecuzione finale sul working tree basato su `49bdd99`.
**Pass automatico** indica un’asserzione ripetibile in Vitest; **Pass browser** indica la prova
headless reale; **Parziale** e **Blocked** mantengono visibile ciò che richiede infrastruttura o
strumentazione non disponibile.

### Incremento

| ID | Criterio | Stato |
|---|---|---|
| INC-001 | 65 kg + 2 kg produce 67 kg | Pass automatico |
| INC-002 | 72,5 kg + 2 kg produce 74,5 kg | Pass automatico |
| INC-003 | La sequenza 65 → 67 → 69 → 71 non devia | Pass automatico |
| INC-004 | 62,5 + 1,25 produce 63,75 senza perdita di precisione | Pass automatico |
| INC-005 | Linear applica il delta esatto | Pass automatico |
| INC-006 | Double Progression applica il delta esatto | Pass automatico |
| INC-007 | Confirmed applica il delta esatto alla seconda conferma | Pass automatico |
| INC-008 | Greyskull applica +2 o +4 secondo salto normale/doppio | Pass automatico |
| INC-009 | Quando l’esito è hold e non scatta un deload, il peso non cambia | Pass automatico |
| INC-010 | inc prevale sul fallback weightIncrement | Pass automatico |
| INC-011 | Incremento invalido usa il default esistente | Pass automatico |
| INC-012 | Salvataggio, refresh, sync e piano condiviso mantengono inc 2 | Parziale — JSON/fixture/piano Pass; sync autenticato e Docker Blocked |
| INC-013 | Il workout attivo conserva il proprio incremento snapshottato | Pass automatico |
| INC-014 | I pulsanti del peso nel workout usano l’incremento dello snapshot | Parziale — resolver/call-site Pass; click browser Blocked dal runner |
| INC-015 | Il deload non subisce regressioni | Pass automatico |
| INC-016 | Lo snapshot salva anche l’incremento effettivo derivato dal default | Pass automatico |
| INC-017 | Un legacy con più di due decimali viene normalizzato solo per il futuro e non riscrive workout passati | Pass automatico |

### Target e range

| ID | Criterio | Stato |
|---|---|---|
| TARGET-001 | Nessuno storico: target uguale a minReps | Pass automatico |
| TARGET-002 | Solo storico di altre strategie: target al minimo e ultimo peso operativo conservato | Pass automatico |
| TARGET-003 | Successo sotto il massimo: target aumenta di uno step valido | Pass automatico |
| TARGET-004 | Fallimento: target invariato | Pass automatico |
| TARGET-005 | Prima conferma al massimo: peso e target invariati | Pass automatico |
| TARGET-006 | Seconda conferma: peso aumenta e target torna al minimo | Pass automatico |
| TARGET-007 | Range 8–8 richiede due conferme e riparte da 8 | Pass automatico |
| TARGET-008 | Ripetizioni extra non saltano livelli | Pass automatico |
| TARGET-009 | Il target configurabile legacy non influenza una prima sessione | Pass automatico con fixture |
| TARGET-010 | Uno snapshot storico a 10 continua a essere valutato a 10 | Pass automatico con fixture |
| TARGET-011 | Un workout attivo a 10 rimane a 10 durante l’upgrade | Pass automatico |
| TARGET-012 | Un nuovo export non richiede targetReps configurabile | Pass automatico |
| TARGET-013 | Un vecchio export con targetReps viene importato senza errore | Pass automatico con fixture e merge |
| TARGET-014 | Cambio min/max non crea reset o marker impliciti e non riscrive lo storico | Pass automatico; nuova baseline esplicita resta fuori ambito |
| TARGET-015 | Cambio incremento o recupero non crea una baseline rep | Pass automatico |
| TARGET-016 | Esercizio per lato usa uno step coerente | Pass automatico |
| TARGET-017 | Confirmed ereditato applica le stesse regole | Pass automatico sul ciclo completo |
| TARGET-018 | Recupero adattivo e relativo streak restano invariati | Pass automatico |
| TARGET-019 | Il riepilogo 3 × min–max funziona anche con policy ereditata | Pass automatico e browser |

### Layout e accessibilità

| ID | Criterio | Stato |
|---|---|---|
| LAYOUT-001 | Nessuna label modificabile usa ellissi | Pass browser |
| LAYOUT-002 | Nessun valore o controllo è tagliato a 320 px | Pass browser |
| LAYOUT-003 | Layout valido a 360, 375, 390, 430 e 640 px | Pass browser |
| LAYOUT-004 | Nessun overflow orizzontale in portrait e landscape | Pass browser, incluso 640 px |
| LAYOUT-005 | Testo al 200% non nasconde label o valori | Parziale — reflow/DPR equivalente Pass; text-size OS reale non eseguito |
| LAYOUT-006 | Italiano e una lingua con stringhe lunghe restano leggibili | Parziale — italiano Pass; seconda lingua browser Blocked |
| LAYOUT-007 | Ogni input è associato programmaticamente alla label | Pass automatico e browser |
| LAYOUT-008 | Comandi meno/più hanno nomi contestuali e localizzati | Pass automatico e browser |
| LAYOUT-009 | Touch target dei pulsanti meno/più almeno 44 × 44 px | Pass browser |
| LAYOUT-010 | Focus visibile e ordine di tabulazione coerente | Parziale — stile/semantica presenti; percorso tastiera manuale non eseguito |
| LAYOUT-011 | Contrasto delle informazioni essenziali almeno 4,5:1 | Blocked — misurazione assistiva non eseguita |
| LAYOUT-012 | Target prima sessione non compare con Confirmed | Pass browser |
| LAYOUT-013 | Ripetizioni generiche non concorrono con min/max | Pass browser |
| LAYOUT-014 | Il riepilogo mostra target e recupero derivati con motivazione | Pass automatico e browser |
| LAYOUT-015 | Weighted, bodyweight, per-lato, time e cardio non regrediscono | Pass automatico/build |
| LAYOUT-016 | Il solo refactoring UI non modifica JSON o prescrizioni | Pass automatico |
| LAYOUT-017 | Un recupero effettivo sopra il limite automatico è mostrato senza essere clampato o confuso col limite | Pass automatico e browser |

## 11. Piano dei test e procedura di replica

### 11.1 Test automatici richiesti

#### Dominio

- matrici dell’incremento per Linear, Double, Confirmed e Greyskull;
- microincrementi e precisione decimale;
- precedenza di inc sul campo legacy;
- fallback per valori assenti o invalidi;
- macchina a stati Confirmed dal minimo al massimo;
- fallimenti, extra reps, range fisso e modalità per lato;
- separazione fra configurazione legacy e snapshot storico;
- non regressione e assenza di reset implicito dopo modifica strutturale del range;
- nessuna regressione sul recupero adattivo e sul deload.

#### Persistenza e integrazione

- chiusura e riapertura della configurazione;
- round-trip JSON locale;
- server sync;
- export/import dei piani vecchi e nuovi;
- workout attivo prima e dopo la modifica della routine;
- strategia ereditata dalla routine;
- restart del frontend e Docker down/up in un ambiente abilitato.

#### UI e accessibilità

- presenza/assenza dei campi secondo la strategia;
- associazione label/input;
- nomi accessibili dei pulsanti;
- navigazione da tastiera;
- screenshot delle larghezze previste;
- verifica di tema chiaro e scuro;
- verifica con unità kg e lb.

Il progetto non dispone oggi di un runner browser/visual dedicato. Non va aggiunta una dipendenza
soltanto per comodità senza una decisione esplicita, in coerenza con l’approccio dependency-light:

- dominio, serializzazione e formatter restano coperti automaticamente da Vitest;
- layout, zoom, focus e screen reader sono gate manuali obbligatori nella prima iterazione;
- una visual regression automatica può essere aggiunta in un commit separato soltanto dopo
  approvazione del runner e del relativo costo di manutenzione.

### 11.2 Comandi da eseguire dopo l’implementazione

Da PowerShell:

~~~powershell
cd E:\Workspace\openGym\frontend
npm.cmd ci
npm.cmd test
node scripts/check-locales.mjs
npm.cmd run build
~~~

La suite CI deve essere verificata con Node 22, versione configurata nei workflow e nel container.
Un eventuale run locale con una versione diversa va registrato separatamente nelle evidenze.

Esecuzione locale finale del 2026-08-23 con Node 26.3.0:

~~~text
Test Files  18 passed (18)
Tests       344 passed (344)
11 locales, 688 keys each — in sync.
Vite production build: Pass, 111 moduli trasformati
~~~

La build emette il solo warning non bloccante sui chunk maggiori di 1.500 kB. La baseline di
questa iterazione era `16 file / 265 test`; i risultati completi e i limiti ambientali sono nel
report collegato.

I risultati devono essere aggiunti al
[report di test](CONFIRMED_REP_RANGE_TEST_REPORT.md) come nuova esecuzione, senza sovrascrivere la
baseline storica dei 265 test.

### 11.3 Fixture legacy obbligatorie

L’implementazione ha aggiunto le seguenti fixture complete e versionate, evitando istruzioni
vaghe come “creare uno storico reale”:

- frontend/src/test/fixtures/confirmed-rep-range-legacy-no-history.json;
- frontend/src/test/fixtures/confirmed-rep-range-legacy-history-target-10.json;
- frontend/src/test/fixtures/confirmed-rep-range-legacy-plan-target-10.json.

Le prime due sono backup openGym completi; la terza è un piano condiviso completo. I test caricano
i file reali, verificano il target iniziale legacy ignorato, lo snapshot storico a 10 mantenuto,
il workout attivo immutabile, il merge del piano e la successiva esportazione canonica senza
`targetReps` configurabile né `weightIncrement`.

Percorso di replica del backup, in un profilo usa-e-getta:

~~~text
Impostazioni → Importa backup → seleziona fixture → conferma Importa
~~~

L’import sostituisce i dati correnti: non va eseguito sul profilo personale senza un backup.

Percorso di replica del piano:

~~~text
Routine → menu condivisione piano → Importa file del piano → seleziona fixture
~~~

### 11.4 Procedura manuale: incremento

1. Creare un esercizio Confirmed con 3 serie, range 8–12, peso 65 kg e incremento 2 kg.
2. Verificare che l’anteprima mostri 3 × 8 @ 65 kg.
3. Completare la progressione fino alla seconda conferma a 12.
4. Verificare che la prescrizione successiva sia 3 × 8 @ 67 kg.
5. Ripetere e verificare 69 kg, non 68 o 70.
6. Configurare 72,5 kg con incremento 2 e verificare 74,5 kg.
7. Avviare un workout, poi cambiare la routine: il workout attivo deve mantenere il vecchio
   incremento; il workout successivo deve usare quello nuovo.
8. Eseguire refresh e sincronizzazione e verificare che l’incremento resti invariato.

### 11.5 Procedura manuale: target

1. Creare una nuova configurazione Confirmed 8–12.
2. Verificare che Target prima sessione e Ripetizioni generiche non siano presenti.
3. Verificare che la prima prescrizione sia 8.
4. Completare con successo e verificare 9.
5. Fallire la sessione a 9 e verificare che la successiva rimanga 9.
6. Arrivare a 12: la prima conferma deve mantenere peso e 12.
7. Confermare nuovamente: il peso deve aumentare e il target tornare a 8.
8. Importare **confirmed-rep-range-legacy-no-history.json** da Impostazioni: il target legacy 10
   deve essere ignorato e la prima prescrizione deve essere 8.
9. Importare **confirmed-rep-range-legacy-history-target-10.json**: il target registrato nello
   storico deve rimanere 10.
10. Registrare un workout con un’altra strategia a 80 kg, poi attivare Confirmed 8–12: la prima
    prescrizione Confirmed deve usare target 8 ma conservare 80 kg.

### 11.6 Procedura manuale: responsive e accessibilità

Ripetere almeno a 320, 360, 375, 390, 430 e 640 px:

1. Aprire la configurazione di un esercizio weighted con Confirmed.
2. Verificare tutte le label senza puntini, sovrapposizioni o tagli.
3. Verificare che a 320 px i campi possano disporsi su una colonna.
4. Verificare assenza di scroll orizzontale.
5. Ripetere in portrait e landscape.
6. Impostare zoom/testo al 200% e ripetere.
7. Cambiare lingua dall’italiano a una locale con stringhe più lunghe.
8. Navigare soltanto con tastiera: il focus deve essere visibile e sequenziale.
9. Con screen reader, verificare che ogni input e pulsante annunci campo, azione e unità.
10. Ripetere con tema chiaro e scuro.
11. Ripetere i controlli principali con bodyweight, zavorra, per-lato, time e cardio.
12. Con recupero effettivo 180 s e limite automatico 150 s, verificare che entrambi siano visibili
    e che il prossimo workout resti a 180 s fino a reset o riduzione prevista.

Per ogni prova manuale vanno registrati:

- data e commit;
- browser, versione e sistema operativo;
- viewport e orientamento;
- lingua, unità e livello di zoom;
- risultato atteso e risultato osservato;
- screenshot in caso di errore;
- ID del criterio di accettazione;
- esito Pass, Fail o Blocked.

### 11.7 Docker e CasaOS

In un ambiente Docker abilitato, dalla root del repository:

~~~powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps
curl.exe --fail http://localhost:8080/api/health
curl.exe --fail --head http://localhost:8080/
~~~

Dopo avere salvato incremento e configurazione Confirmed:

1. eseguire **docker compose down** senza opzione **-v**;
2. eseguire **docker compose up -d**;
3. riaprire l’applicazione;
4. verificare configurazione, target derivato e anteprima;
5. ripetere il controllo dopo sincronizzazione da un secondo browser.

Non usare **docker compose down -v**, perché elimina intenzionalmente i dati persistenti. Su
CasaOS la stessa prova va eseguita fermando e riavviando l’app senza eliminare volumi o dati. Le
evidenze seguono il modello già presente nel
[report di test](CONFIRMED_REP_RANGE_TEST_REPORT.md#evidence-template).

## 12. File coinvolti nell’implementazione

| File | Motivo |
|---|---|
| frontend/src/lib/progression.js | Delta esatto e prima prescrizione al minimo |
| frontend/src/lib/progression.test.js | Matrici di progressione e regressioni |
| frontend/src/lib/confirmedRepRangeConfig.js | Rimozione del target configurabile e normalizzazione |
| frontend/src/lib/confirmedRepRangeConfig.test.js | Configurazioni nuove e legacy |
| frontend/src/sheets.jsx | Nuovo modulo, campi condizionali, anteprima e salvataggio |
| frontend/src/components/ui.jsx | Stepper accessibile e label associate |
| frontend/src/index.css | Fieldset, grid responsive, touch target e focus |
| frontend/src/views/RoutineEdit.jsx | Policy ereditata e riepilogo serie × range |
| frontend/src/views/Workout.jsx | Step del peso ricavato dallo snapshot |
| frontend/src/lib/workout-prescription.js | Coerenza dello snapshot |
| frontend/src/lib/workout-prescription.test.js | Stabilità del workout attivo |
| frontend/src/lib/history.js | Riepilogo serie × range |
| frontend/src/lib/history.test.js | Riepiloghi vecchi e nuovi |
| frontend/src/lib/plan-share.js | Export senza target iniziale e import legacy |
| frontend/src/lib/plan-share.test.js | Round-trip piani |
| frontend/src/lib/format.js | Precisione di visualizzazione dei carichi, se necessaria |
| frontend/src/lib/confirmedRepRangeLocaleFallback.js | Nuove stringhe di fallback |
| frontend/src/lib/confirmed-rep-range.integration.test.js | Flusso end-to-end del dominio Confirmed |
| frontend/src/lib/confirmedRepRangeAutoRest.integration.test.js | Non regressione del recupero adattivo |
| frontend/src/lib/confirmedRepRangeAutoRest.test.js | Fixture esistenti che contengono targetReps |
| frontend/src/test/fixtures/confirmed-rep-range-legacy-*.json | Backup e piani legacy replicabili da aggiungere |
| frontend/src/locales/*.js | Label, spiegazioni e nomi accessibili localizzati |
| README.md | Documentazione utente dopo l’implementazione |
| CONFIRMED_REP_RANGE_TEST_REPORT.md | Evidenze della nuova esecuzione dei test |

L’elenco è probabilistico: prima di ogni commit va verificata la responsabilità effettiva di ogni
modulo, evitando cambi non necessari.

## 13. Piano di implementazione in commit piccoli

1. **test: codificare il delta esatto**
   - aggiungere i casi 65 + 2, 72,5 + 2 e microincrementi;
   - coprire tutte le strategie senza cambiare ancora la UI.

2. **fix: separare delta di progressione e arrotondamento**
   - correggere il calcolo degli aumenti;
   - mantenere separata la formula del deload;
   - rendere coerente la precisione.

3. **test: definire il target derivato dal minimo**
   - aggiungere prima sessione, storico, fallimento, doppia conferma e legacy.

4. **refactor: rimuovere il target iniziale configurabile**
   - aggiornare normalizzazione e prescrizione;
   - conservare i target negli snapshot storici;
   - non cambiare ancora il layout oltre il necessario.

5. **feat: preservare incremento e target nello snapshot**
   - usare l’incremento corretto nei controlli del workout;
   - garantire stabilità ai workout già attivi.

6. **feat: semplificare i campi Confirmed**
   - nascondere Ripetizioni generiche;
   - rimuovere Target prima sessione;
   - aggiungere scelta rapida 2 e anteprima.

7. **refactor: introdurre gruppi responsive e Stepper accessibile**
   - fieldset e legend;
   - grid a una/due colonne;
   - label complete, touch target, focus e ARIA contestuale.

8. **test: integrazione, locale e verifica responsive**
   - persistenza, import/export, responsive, zoom e accessibilità.

9. **docs: aggiornare guida e report**
    - aggiornare README;
    - aggiungere comandi, risultati e prove manuali al report storico.

Ogni commit deve lasciare la suite verde e non deve mescolare refactoring visivo, cambio del
dominio e migrazione di compatibilità nello stesso passaggio.

## 14. Rischi e dipendenze da risolvere

### Identità dello storico

Se lo storico Confirmed è ricercato soltanto per exerciseId, lo stesso esercizio in due routine
con range diversi può condividere risultati che non appartengono alla stessa configurazione.
L’eventuale futura baseline dopo una modifica strutturale richiede una decisione esplicita:

- mantenere la semantica globale per esercizio e inserire un marker temporale; oppure
- introdurre un’identità stabile dello slot nella routine.

La scelta tecnica non deve modificare i workout passati e deve restare leggibile nei vecchi JSON.
È registrata come miglioramento separato e non blocca i tre interventi di questo documento.

### Precisione dei carichi

Correggere il delta senza adeguare formatter e input può calcolare 63,75 ma mostrare 63,8. Calcolo,
serializzazione e presentazione devono essere verificati insieme.

### Altezza del modulo

Eliminare la compressione aumenta lo spazio verticale. Il foglio deve rimanere scorrevole e
l’azione Salva deve essere sempre raggiungibile, anche con tastiera virtuale aperta.

### Traduzioni

La nuova struttura non deve dipendere dalla brevità dell’italiano. Le locale vanno validate con
lo script già presente e con una prova visiva su stringhe lunghe.

## 15. Definition of Done

L’autorizzazione a procedere con gli sviluppi ha approvato anche CRRP-UX-005 e CRRP-UX-007. La
parte applicativa è completata quando:

- tutti i criteri INC, TARGET e LAYOUT applicabili risultano Pass;
- nessuna configurazione richiede più Target prima sessione;
- il target derivato è sempre spiegabile dallo storico;
- incremento 2 produce delta esatti anche da carichi non multipli di 2;
- workout attivi e passati restano immutabili;
- i vecchi JSON e piani condivisi sono leggibili senza interventi manuali;
- refresh, sync e restart non perdono lo stato;
- nessuna label essenziale viene troncata;
- la configurazione è utilizzabile a 320 px e con testo al 200%;
- test automatici, build, locale check e prove manuali sono documentati;
- README e report storico sono aggiornati con la revisione effettivamente testata.

Il gate applicativo e responsive è superato. Persistenza Docker/CasaOS, sincronizzazione reale tra
due profili autenticati, screen reader, contrasto assistivo e text-size del sistema operativo
restano gate di rilascio separati quando l’infrastruttura corrispondente è disponibile; non sono
presentati come test superati in questo documento.

## 16. Registro del documento

| Data | Revisione | Modifica |
|---|---|---|
| 2026-08-23 | 1 | Prima analisi funzionale dei tre miglioramenti; nessun codice modificato |
| 2026-08-23 | 2 | Implementazione completata; test automatici, fixture legacy, build, API e browser responsive registrati |

## 17. Esito dell’implementazione

Sono stati implementati:

- incremento esatto a centesimi con preset 2 / 2,5 / 5 e validazione esplicita dei nuovi input;
- prima prescrizione e ripartenza dopo aumento sempre da `minReps`;
- rimozione del target iniziale dalla configurazione e dai nuovi piani condivisi, conservandolo
  soltanto negli snapshot storici;
- snapshot dell’incremento effettivo e uso stabile nei workout già iniziati;
- gruppi UX Serie, Carico, Range di ripetizioni e Recupero, con label complete e touch target;
- riepilogo `serie × minimo–massimo`, anche con policy ereditata;
- compatibilità con JSON legacy tramite resolver e fixture reali;
- formatter a due decimali dedicato ai carichi, senza cambiare velocità, effort o peso corporeo;
- mantenimento delle serie aggiunte dalla progressione a corpo libero nei workout successivi.

Evidenze principali:

| Verifica | Esito |
|---|---|
| Suite frontend completa | Pass — 18 file, 344 test |
| Build Vite produzione | Pass — 111 moduli; solo warning chunk-size |
| Invariante localizzazioni | Pass — 11 locale, 688 chiavi ciascuna |
| Sintassi e avvio API + `/api/health` | Pass |
| Preview bundle + root frontend | Pass — HTTP 200 |
| Browser 320/360/375/390/430/640 px | Pass — nessun overflow, 1/2 colonne corrette |
| Reflow equivalente 200% | Pass headless; text-size OS reale non eseguito |
| Docker Compose / CasaOS | Blocked — comando Docker non disponibile nell’ambiente |

Le istruzioni complete per replicare test automatici, browser, API e CasaOS sono mantenute nel
[report di test](CONFIRMED_REP_RANGE_TEST_REPORT.md).
