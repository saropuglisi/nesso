# Nesso

Laboratorio di pensiero critico: una tesi diventa una mappa causale, con assunzioni, alternative e condizioni di invalidazione. Ambito generale oppure profilo trading. **Prima base reale, locale e single-user**, con inferenza via API o modello locale; non è ancora un servizio pubblico multiutente.

## Avvio

Richiede Node.js >= 22.13 (verificato con 25.6). Nessuna dipendenza npm esterna. SQLite è quello incluso in Node; alcune versioni mostrano un avviso sperimentale.

1. Crea `.env` usando `.env.example` e configura provider, modello e chiave. Non inserire la chiave nel browser, in chat o nel repository.
2. `npm start`
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

L’AI non consulta fonti o prezzi live. Il contesto fornito dall’utente è non verificato. L’output del modello è un’ipotesi, anche quando è scritto con sicurezza. La validazione strutturale non verifica la verità dei contenuti.

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
- `server/store.js`: archivio append-only.
- `server/index.js`: HTTP locale e controlli di origine/host.
- `public/`: interfaccia bianca con mappa a tutto schermo e menu a scomparsa.
- `test/`: contratti, errori dei provider, scoring, persistenza e flusso HTTP.
- `docs/roadmap.md`: passaggi successivi.

Riferimenti implementativi: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Ollama Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs), [LM Studio Structured Output](https://lmstudio.ai/docs/developer/openai-compat/structured-output).
