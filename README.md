# Nesso

Laboratorio di pensiero critico: una tesi diventa una mappa causale, con assunzioni, alternative e condizioni di invalidazione. Ambito generale oppure profilo trading. **Prima base reale, locale e single-user**, con inferenza via API o modello locale; non è ancora un servizio pubblico multiutente.

L’avvio richiede solo tesi ed effort. “Esplora” propone prima una breve osservazione critica e una domanda: puoi scegliere una risposta, precisare in testo libero o passare direttamente a “Crea mappa”. La tesi originale resta distinta dai chiarimenti e dalle ipotesi del modello. Durante la generazione nodi e relazioni arrivano in streaming. “Interrompi” annulla la richiesta; una mappa incompleta non viene registrata come analisi valida. Se il modello tenta una correzione, la prima mappa resta visibile finché la sostituzione non è stata convalidata. Una bozza fallita viene conservata nel browser e recuperata dopo un refresh, ma resta esplicitamente non salvata nel Diario. Ogni analisi completata è conservata nel Diario, anche senza criteri fissati. Cancellare i dati del browser rimuove le bozze locali, non il Diario SQLite.

Le nuove mappe distinguono causa ipotizzata, condizione necessaria, sostegno, obiezione e misurazione. Le vecchie mappe restano leggibili con le etichette originali. L’effort aumenta il budget massimo, senza imporre più caselle. La prima osservazione è una proposta del modello: non rappresenta una verifica delle fonti né un verdetto sulla tesi.

Streaming: OpenRouter/API compatibili via SSE, OpenAI Responses via eventi SSE, Ollama via NDJSON. Riferimento: [documentazione streaming OpenRouter](https://openrouter.ai/docs/api/reference/streaming). I test usano stream controllati, senza chiamate a pagamento.

## Avvio

La generazione richiede un **passaggio decisivo**: nesso specifico, motivazione, assunzione necessaria e verifica discriminante. Questo oggetto viene validato e trasmesso prima dei nodi quando il provider rispetta l’ordine richiesto. È visibile sul canvas e apribile durante la generazione. È una priorità di ricerca proposta dal modello, non un fatto verificato. La ricerca tramite API e il confronto critico separato sono descritti sotto; la qualità semantica va comunque valutata su casi reali. Le analisi precedenti senza questi campi restano leggibili.

Richiede Node.js >= 22.13 (versione usata nello sviluppo: 25.6). Le dipendenze npm includono il parser XML usato per SEC. SQLite è quello incluso in Node; alcune versioni mostrano un avviso sperimentale.

1. Crea `.env` usando `.env.example` e configura provider, modello e chiave. Non inserire la chiave nel browser, in chat o nel repository.
2. Installa le dipendenze con `npm ci`, poi esegui `npm start`.
3. Apri <http://127.0.0.1:4180>.

La configurazione è letta all’avvio. Dopo le modifiche a `.env`, riavvia il processo.

### API esterna — percorso iniziale scelto

OpenAI Responses:

```dotenv
NESSO_PROVIDER=openai
NESSO_BASE_URL=https://api.openai.com/v1
NESSO_MODEL=identificatore-esatto-del-modello
NESSO_API_KEY=chiave-personale
```

Endpoint compatibile OpenAI (anche OpenRouter, se modello e provider supportano JSON Schema):

```dotenv
NESSO_PROVIDER=openai-compatible
NESSO_BASE_URL=https://openrouter.ai/api/v1
NESSO_MODEL=provider/modello
NESSO_API_KEY=chiave-personale
```

Il modello deve supportare output JSON Schema. Non viene selezionato né acquistato un modello automaticamente. Ogni clic su Analizza può generare costi del provider. Tesi e contesto sono inviati solo all’endpoint configurato; nessun fallback silenzioso. Per OpenRouter vengono impostati `require_parameters: true` e `allow_fallbacks: false`, secondo la [documentazione Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs).

### Inferenza locale

Ollama nativo:

```dotenv
NESSO_PROVIDER=ollama
NESSO_BASE_URL=http://127.0.0.1:11434
NESSO_MODEL=nome-esatto-da-ollama-list
```

LM Studio: `NESSO_PROVIDER=openai-compatible`, `NESSO_BASE_URL=http://127.0.0.1:1234/v1`, `NESSO_MODEL=identificatore-caricato`. Il server di inferenza deve già essere avviato. Nessun download automatico di modelli.

## Cosa funziona

- Testo libero → inferenza vera → JSON validato → grafo dinamico con ID arbitrari.
- Effort basso/medio/alto/massimo: budget di 2/3/4/5 livelli e 6/10/16/24 nodi. È una guida semantica e un limite di output, **non** il parametro interno `reasoning_effort` del provider, né una probabilità di correttezza.
- Ogni nodo ha assunzioni, domanda critica, falsificatore e dati richiesti. Ogni arco esplicita il meccanismo.
- Trading: catalizzatori, aspettative già incorporate nel prezzo, invalidazione e distinzione tra fenomeno e prezzo. Nessun broker o esecuzione ordini.
- Criteri numerici definiti dall’utente e confermati prima dei risultati, soglie e pesi fissati.
- Snapshot immutabili e valutazioni append-only in SQLite, con digest SHA-256 e provenienza del modello/prompt/schema.
- Verifica deterministica su osservazioni manuali; dati mancanti ≠ zero, niente rinormalizzazione sui soli dati disponibili.
- Diario persistente e download dello snapshot JSON.

## Confini della prima versione

L’AI può consultare le API pubbliche descritte sotto, su richiesta, ma non ha ricerca web generica né prezzi intraday. Il contesto fornito dall’utente è non verificato. L’output del modello è un’ipotesi, anche quando cita una fonte. La validazione strutturale non verifica la verità dei contenuti o la causalità.

## Analisi approfondita e grafici

La vista «Analisi e grafici» affianca la mappa: raccoglie tesi originale, conclusione provvisoria, argomenti favorevoli e contrari, assunzioni da verificare, scenari concorrenti e prossime verifiche. Non è una trascrizione del ragionamento privato del modello: sono risultati sintetici da poter discutere e controllare. Una citazione indica una fonte consultata, non una relazione causale dimostrata. Le vecchie analisi senza dossier mostrano sintesi, passaggio decisivo e calcoli già salvati.

Il dossier include un riepilogo deterministico della copertura: fonti recuperate, dati o documenti letti, elenchi di ricerca, riferimenti citati e affermazioni senza fonte o con riferimenti irrisolti. È un controllo della presenza del materiale, non della verità o della pertinenza: non viene assegnato un voto di qualità. Un ID duplicato, un risultato di sola ricerca o una fonte senza contenuto utilizzabile non sono evidenze citabili. Il riepilogo è prodotto sul server, non dal modello, e salvato insieme all’analisi; le analisi precedenti non vengono riscritte.

I riferimenti degli argomenti favorevoli e contrari portano ai dettagli delle fonti nel dossier. Gli estratti restano parziali e distinti dai commenti del modello; la data di acquisizione non è la data di pubblicazione o del periodo misurato. Dai prossimi controlli e dalle assunzioni si può preparare un approfondimento conservando la tesi originale e il contesto: il pulsante apre una conferma modificabile, senza avviare ricerche o inferenze automaticamente. Il limite del contesto è 12000 caratteri; un testo più lungo viene segnalato, non tagliato in silenzio.

Con effort basso non viene aggiunta un’altra chiamata. Con medio/alto/massimo, dopo l’estrazione dei calcoli, un passaggio separato prepara il confronto critico prima della mappa. L’effort cambia il budget e la profondità del confronto, senza imporre più nodi. Il passaggio ha un tetto di 45/60/90 secondi, con una riserva di tempo per generazione e correzione della mappa; tutto resta entro il timeout originale dell’analisi. Se il dossier non supera i controlli o non c’è tempo, la mappa continua senza conclusioni aggiuntive inventate e l’assenza dell’approfondimento viene dichiarata. I quattro scenari finanziari deterministici mantengono il percorso a formule, senza far riscrivere al modello i risultati.

I grafici sono costruiti dal software a partire dai valori delle fonti lette, mai da punti inventati dal modello. Supportano serie FRED e World Bank; i dati SEC XBRL sono utilizzabili solo quando periodi e unità sono confrontabili. Ogni grafico conserva unità, frequenza, fonti e limiti del campione, con una tabella dei valori. Le osservazioni mancanti producono interruzioni, non zeri o interpolazioni. Elenchi di ricerca, estratti narrativi e campioni Form 4 non diventano automaticamente serie temporali. Se i dati non bastano, non viene disegnato un grafico fittizio. Il dossier e i grafici vengono salvati con l’analisi; nessuna migrazione delle tesi già archiviate.

**Verifica del 21 settembre 2026:** dopo l’autorizzazione ai test, eseguiti suite automatica, controlli di sintassi e prove reali sui connettori FRED, World Bank e SEC e sul modello locale configurato. Le prove applicative usano un database temporaneo separato dal Diario dell’utente. Il resoconto e i limiti osservati sono in `outputs/VERIFICA-2026-09-21.md`. Il superamento dei controlli tecnici non certifica la correttezza economica o causale delle risposte; modello e chiavi non vengono modificati.

## API pubbliche su richiesta

Attiva «Consulta API pubbliche» prima di creare la mappa. Un pianificatore sul modello configurato sceglie gli strumenti pertinenti, ne legge i risultati e può fare un passo successivo (es. ticker → CIK → report → documento). Massimo tre turni, sei chiamate logiche e 90 secondi aggiuntivi; una chiamata può richiedere più richieste HTTP. Non è un crawler, non costruisce un archivio preventivo e non interroga motori di ricerca. Si salvano con l’analisi soltanto le fonti recuperate e i tentativi; «Fonti e dati» mostra anche errori e limiti. Spegnendo l’opzione non vengono contattate le API dati.

Le chiamate già tentate vengono riconosciute anche quando cambiano campi inutilizzati, spazi esterni o padding del CIK: non sono rieseguite e non consumano un altro slot. Se il pianificatore ripete soltanto richieste precedenti, la ricerca si ferma. Il record conserva il motivo di arresto, i turni, le chiamate eseguite e i duplicati evitati. Esaurire il budget o ricevere un piano vuoto non certifica una ricerca esaustiva; limiti, errori e assenza di letture restano visibili.

Le note del pianificatore sono conservate separatamente in `plannerNotes` e mostrate come limiti proposti dal modello, non verificati. Non sono avvisi tecnici né fonti e non autorizzano affermazioni numeriche. Un’informazione non recuperata non è necessariamente assente dal servizio.

| Fonte | Supporto iniziale | Configurazione |
| --- | --- | --- |
| SEC / EDGAR | Ticker e CIK, ultimi 10-K/10-Q/8-K/20-F/6-K, estratti dei report, concetti XBRL US-GAAP, feed recente Form 4 e lettura XML delle operazioni | `SEC_USER_AGENT=Nesso nome@dominio.it`, con contatto reale; nessuna chiave |
| FRED | Ricerca serie, metadati, ultime 24 osservazioni con unità/frequenza/destagionalizzazione | `FRED_API_KEY`, chiave gratuita personale |
| World Bank | Serie annuali per paese e codice indicatore, definizione e data aggiornamento | Nessuna chiave |

Imposta le variabili nel `.env` locale e riavvia `npm start`. «Fonti e dati» mostra quali connettori sono configurati, senza esporre contatti o chiavi. Il modello riceve soltanto i risultati selezionati: le credenziali non sono incluse nel prompt o nei record. Le richieste di ricerca FRED escono verso FRED; quelle SEC e World Bank contengono gli identificatori necessari. L’inferenza resta sul provider configurato (locale o remoto).

I documenti SEC possono essere bloccati dal servizio anche con un User-Agent corretto: Nesso mostra l’errore, non aggira il blocco. Le richieste SEC sono distanziate almeno 300 ms nello stesso processo, senza retry aggressivi. Host HTTPS fissi, redirect disabilitati, download limitati, XML senza DTD/entità; i documenti apribili devono provenire dai risultati SEC dello stesso lavoro. Gli estratti HTML sono parziali: non garantiscono di comprendere tutte le tabelle. I numeri strutturati vanno verificati via XBRL quando possibile.

Limiti: Form 4 è un campione recente (quattro filing), non uno storico esaustivo; sono conservati codici delle operazioni, derivati e note, senza segnali di acquisto/vendita. L’assenza di risultati non prova assenza di operazioni. XBRL conserva unità, periodi fiscali e revisioni, senza sommare righe sovrapposte. FRED usa la vintage corrente; World Bank è annuale e può avere ritardi. Un valore mancante resta `null`, mai zero.

Ogni nodo può citare `sourceIds` esistenti; i risultati di sola ricerca non sono citabili come evidenza. I numeri nei nodi devono apparire nelle fonti citate, negli input o nei calcoli. Questo controllo non dimostra che un valore sia stato interpretato correttamente: paese, periodo, segno, causalità e pertinenza richiedono verifica. Le formule deterministiche sui quattro scenari finanziari restano basate sulle ipotesi dell’utente: le fonti raccolte non ne sostituiscono automaticamente gli input. Un fallimento di ricerca non impedisce una mappa ipotetica, ma viene segnalato.

Gli identificativi R1–R6 e i metadati di trasporto (URL, data di acquisizione, titolo della fonte) non valgono come osservazioni numeriche. I riferimenti inline devono corrispondere alle citazioni dichiarate, anche se scritti in minuscolo. Nel solo `evidenceNeeded`, cioè il piano di raccolta, è consentito chiedere una serie mancante per periodi già presenti nelle osservazioni disponibili, senza inventare una fonte per quella serie. Le affermazioni del nodo restano soggette al controllo delle fonti. Gli errori indicano campo e numero problematici per guidare l’unico tentativo di correzione.

Documentazione ufficiale: [SEC APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [SEC fair access e RSS](https://www.sec.gov/about/developer-resources), [chiave FRED](https://fred.stlouisfed.org/docs/api/api_key.html), [World Bank API](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures).

I criteri v1 sono binari: soglia raggiunta → peso pieno, altrimenti 0. La misura deve avere la **data esatta** e la **fonte** preregistrate. La data non può essere futura al momento della verifica. Manca un dato → totale `null` con copertura esplicita. Le evidenze manuali non sono autenticate; il punteggio è supporto ai criteri, non probabilità di successo, causalità o redditività di un trade.

Gli hash e i trigger SQLite proteggono l’integrità applicativa: non costituiscono una marca temporale indipendente o una protezione contro il proprietario del computer che altera il database. Backup di `data/` a server fermo; nessun backup cloud automatico.

La demo pubblicata rimane in `dist/`, indipendente. L’app reale è in `public/` e `server/`: il servizio Node locale non può essere pubblicato come archivio statico di Sites. Per il cloud serviranno storage, autenticazione e adattamento del runtime; per raggiungere un modello sul proprio PC servirà una connessione esplicita.

## Git e sviluppo

Ramo di lavoro: `codex/real-inference-foundation`. La cronologia precedente contiene le versioni grafiche della demo. `.env`, chiavi e `data/` sono esclusi. Nessun repository GitHub è stato creato e non è configurato un remote di sviluppo; il repository usato da Sites per la demo è un canale separato di pubblicazione.

```sh
npm test
npm run check
npm run dev
```

I test usano provider HTTP simulati e database temporanei. Non consumano API a pagamento. La prova end-to-end con un vero provider richiede la configurazione della chiave e del modello scelti.

## Struttura

- `server/domain.js`: contratti, validazione semantica, criteri e scoring.
- `server/provider.js`: adattatori e prompt versionato.
- `server/thesis-dialogue.js`: osservazione iniziale, domanda e validazione delle risposte suggerite.
- `server/analysis.js`: generazione con tesi e chiarimenti separati, relazioni tipizzate e un solo tentativo di correzione per risposte non valide.
- `server/reasoning.js`: confronto critico strutturato, con citazioni e controlli sui dati disponibili.
- `server/chart-data.js`: trasformazione deterministica delle fonti in serie confrontabili per i grafici.
- `server/evidence-audit.js`: copertura documentale e risoluzione delle citazioni, senza punteggio di verità.
- `server/store.js`: archivio append-only.
- `server/index.js`: HTTP locale e controlli di origine/host.
- `public/`: interfaccia bianca con mappa a tutto schermo e menu a scomparsa.
- `public/charts.js`: grafici SVG e tabelle accessibili, senza servizi esterni.
- `test/`: contratti, errori dei provider, scoring, persistenza e flusso HTTP.
- `docs/roadmap.md`: passaggi successivi.

Riferimenti implementativi: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Ollama Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs), [LM Studio Structured Output](https://lmstudio.ai/docs/developer/openai-compat/structured-output).

## Verifiche finanziarie e prove sui modelli

L’analisi ora separa estrazione dei dati, calcoli e costruzione del ragionamento. Quattro famiglie con dati completi (prezzo/volumi/costi, marketplace, EPS e guidance, duration obbligazionaria) usano formule e conclusioni nel codice. I valori estratti conservano citazioni del testo, visibili nel dettaglio e nella provenienza. La corrispondenza numerica non garantisce che il modello abbia interpretato correttamente periodo, segno o significato: controllare gli input resta necessario.

Per tesi diverse o senza numeri rimane un percorso generale di estrazione e costruzione della mappa, con il confronto critico intermedio descritto sopra quando l’effort e il tempo lo consentono. I controlli finanziari distinguono materialità, aspettative e causalità. Le formule generate vengono eseguite da un parser aritmetico senza `eval`; questo verifica il conto, non la correttezza economica della formula. Gli archi sono costruiti da genitori dichiarati e validati, evitando ID arbitrari inesistenti. I controlli verificano struttura, numeri presenti nell’input o nei calcoli e uso delle relazioni dalla radice; una risposta respinta riceve un solo tentativo di correzione entro lo stesso timeout. Questi controlli non garantiscono la correttezza semantica di ogni frase. Il budget effort vale per l’espansione generale; un calcolo supportato non viene allungato artificialmente all’aumentare dell’effort.

Il revisore sperimentale in `server/review.js` **non è usato dal percorso applicativo**: nelle prove ha introdotto errori semantici. Non è stato cambiato il modello configurato in `.env`.

Il tentativo di correzione copre anche gli errori durante lo streaming (per esempio un `parentIndex` che punta al nodo stesso): interrompe lo stream errato, azzera l’anteprima e chiede al modello una nuova mappa usando l’output parziale e il motivo del rifiuto. Non modifica arbitrariamente i collegamenti. Errori di rete, annullamento e timeout non attivano una nuova generazione; dopo due mappe invalide non viene salvata alcuna analisi. I consumi totali rimangono sconosciuti (`null`) se uno stream interrotto non ha fornito i dati d’uso.

Prove API esplicite, potenzialmente a pagamento, su quattro casi sintetici:

```sh
node --env-file=.env scripts/evaluate-finance.mjs test/evals/financial-cases.json work/evaluation
```

Il comando registra risposte, errori, latenza e costi comunicati dal provider. Non è un benchmark indipendente: sono casi di sviluppo con risultati attesi, non una validazione su mercati reali. Per il resoconto vedere `outputs/VERIFICA-FINANZIARIA.md`.
