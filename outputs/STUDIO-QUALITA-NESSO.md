# Come far ragionare meglio Nesso

Studio del 19 settembre 2026. Basato sul codice attuale, sulla prova AliExpress/Amazon osservata in questa sessione e sulle fonti indicate. È una proposta di progetto, non una funzionalità già implementata o un benchmark dei modelli.

## Diagnosi

Il sistema attuale traduce una frase in un diagramma. Una buona analisi dovrebbe invece identificare il passaggio che decide se la tesi regge, cercare cosa potrebbe smentirlo e scegliere il prossimo approfondimento utile.

Nel codice, `messages()` richiede una singola risposta con titolo, interpretazione, tutti i nodi, tutti gli archi e dettagli trading. `EFFORT` aumenta profondità, nodi e token; non aggiunge ricerca o revisione critica. Ogni nodo deve contenere la stessa scheda: assunzioni, domanda critica, falsificazione, dati. Questo favorisce ripetizioni. Lo streaming mostra prima le schede complete e poi gli archi, perché le due collezioni sono separate. Il validatore scopre i difetti globali soltanto alla fine.

Il modello non ha strumenti di ricerca: il prompt gli vieta di fingere accesso a dati, correttamente, ma non gli consente di verificare una premessa. Il fatto che esistano 20 test software superati non misura la qualità dell’analisi. Abbiamo osservato una sola prova reale: non basta per concludere che il modello configurato sia intrinsecamente inadatto.

Oggi le risposte respinte non entrano nell’archivio delle analisi: è corretto, ma manca un registro diagnostico separato per confrontare gli errori. Durante lo sviluppo servono tracce locali dei tentativi, senza credenziali, con errore preciso, conteggi, tempi e versione del prompt. Il contenuto delle tesi richiede conservazione esplicita e controllabile; non va inviato automaticamente a servizi esterni di telemetria. Non promuovere un tentativo fallito a snapshot valido per semplificare il debug.

Un limite concettuale è nello schema. Una tesi, una causa, un’obiezione e un’evidenza non sono la stessa cosa. Costringere tutte le alternative a essere discendenti causali della tesi può suggerire legami falsi. Il nodo principale contiene già l’intera conclusione, e i figli la ripetono per pezzi.

## Il risultato che avrei voluto sull’esempio

Prima risposta, breve e ancora provvisoria:

> Il passaggio più delicato sembra essere «la domanda persa da AliExpress diventa ricavo significativo per Amazon». Servono tre verifiche: quali vendite sono realmente colpite, dove si sposta la domanda e quanta parte dello spostamento diventa ricavo riconosciuto da Amazon. L’orizzonte della previsione non è ancora definito.

“Più delicato” è una priorità di ricerca, non una probabilità calcolata. La mappa iniziale dovrebbe avere pochi passaggi distinti, con le assunzioni sulle frecce:

1. **Misura applicabile e vendite esposte.** Quale provvedimento, quali categorie, quale logistica e quale decorrenza? Non chiamarlo automaticamente “dazio contro AliExpress”. La guida della Commissione descrive una misura sulle importazioni extra-UE di basso valore; precisa inoltre che la classificazione doganale conta nel calcolo. Va verificato il perimetro concreto prima di dedurre un vantaggio relativo fra piattaforme. [Commissione europea](https://taxation-customs.ec.europa.eu/news/guidance-and-legal-text-temporary-flat-fee-low-value-imports-which-will-apply-until-1-july-2028-2026-06-08_en)
2. **Variazione del prezzo relativo.** Il costo arriva al cliente? Quanto cambia il confronto a parità di prodotto, spedizione e tempi? Anche l’esposizione delle offerte concorrenti va accertata. Magazzini, assortimento, sconti e margini sono variabili da indagare, non fatti già dimostrati.
3. **Destinazione della domanda.** La spesa passa ad Amazon, a un altro concorrente, oppure non avviene? Occorrono dati di sostituzione; non basta vedere meno traffico su AliExpress.
4. **Ricavo incrementale riconosciuto.** Il bilancio Amazon distingue vendite di prodotti contabilizzate al lordo e servizi ai venditori terzi, incluse commissioni e servizi logistici. Quindi GMV trasferito e ricavi Amazon non sono intercambiabili. [Amazon, bilancio 2025, sezione Net Sales](https://www.sec.gov/Archives/edgar/data/1018724/000110465926041036/tm263815d4_ars.pdf)
5. **Rilevanza e osservabilità.** L’effetto sarebbe distinguibile da crescita ordinaria, cambio, mix e altre attività? Un aumento del fatturato totale non identifica la causa. Per arrivare a una tesi sul titolo servirebbe un passaggio ulteriore sulle aspettative già incorporate nel prezzo; non va aggiunto come se l’utente avesse previsto automaticamente un rialzo azionario.

Un modello quantitativo di lavoro, senza inserire numeri inventati:

`spesa trasferita = spesa esposta × quota abbandono × quota catturata da Amazon`

`ricavo attribuibile ≈ spesa trasferita × [quota vendite dirette + quota marketplace × ricavo riconosciuto per euro intermediato]`

È una decomposizione di scenario, non una stima: quote, orizzonte, valuta, resi e basi di misura devono essere coerenti. Le quote dirette e marketplace sommano a uno; il coefficiente marketplace richiede una definizione che eviti il doppio conteggio. I margini richiedono un modello separato. Senza osservazioni, i risultati restano “non stimati”.

Domanda successiva nel grafico: **«Vuoi mettere alla prova i ricavi Amazon o anche il prezzo del titolo?»** Solo se la distinzione serve all’obiettivo; nessun modulo iniziale aggiuntivo. L’utente può rispondere in testo libero oppure lasciare il punto aperto.

## Motore proposto

Partirei da un processo breve e controllabile. Anthropic descrive la scomposizione in passaggi e la revisione valutatore–generatore come opzioni utili quando esistono criteri chiari, segnalando il costo in latenza. È un riferimento progettuale, non una prova che molti agenti migliorerebbero Nesso. [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)

**1. Interpretare.** Estrarre affermazioni atomiche, obiettivo, orizzonte espresso, presupposti e ambiguità. Distinguere parole dell’utente da inferenze del sistema. Una preferenza personale non va trasformata a forza in previsione falsificabile.

**2. Costruire un nucleo breve.** Produrre il meccanismo essenziale e uno o due punti fragili specifici. Nessun obbligo di riempire il budget di nodi. Ogni nuovo ramo deve aggiungere una variabile, un meccanismo o un test discriminante, non parafrasare il genitore.

**3. Verificare selettivamente.** Cercare prima le premesse decisive e contestabili, con fonti primarie. Ogni evidenza conserva URL, passaggio rilevante, data del fenomeno, pubblicazione e acquisizione. Una fonte può essere reale ma non sostenere il nesso causale. Stato separato per affermazioni dell’utente, ipotesi del modello ed evidenze documentate. Se la ricerca non è disponibile, renderlo esplicito.

**4. Criticare e correggere.** Una passata distinta valuta i nessi: perché A cambia B, che cosa deve essere vero, quale alternativa spiega lo stesso dato, quale osservazione separa le spiegazioni? La critica deve poter confermare che un passaggio è adeguato; obiezioni obbligatorie generano rumore. Un solo tentativo di correzione mirata per errore strutturale; nessuna rigenerazione infinita.

**5. Espandere con l’utente.** Azioni nel nodo: “Perché?”, “Cerca evidenze”, “Se fosse falso?”, “Cambia ipotesi”. L’aggiornamento marca i discendenti interessati come da rivedere e modifica soltanto i rami dipendenti. Nessun ricalcolo numerico finto dove esistono solo relazioni qualitative.

## Struttura del grafo e streaming

Separare il contenitore “tesi da valutare” dal grafo dei fenomeni. Tipi di relazione: causa ipotizzata, condizione necessaria, sostegno, obiezione, misurazione. Il vincolo di aciclicità e la profondità si applicano ai percorsi causali temporalmente ordinati, non indistintamente a tutta la struttura argomentativa.

Ogni espansione invia una piccola operazione atomica: nuovi nodi insieme ai loro collegamenti tipizzati. Il server assegna gli ID e verifica riferimenti, budget e collegamento a un bersaglio esistente prima di mostrarla come accettata. I contenuti non validati possono apparire come bozza distinta. Un riferimento errato viene respinto e segnalato al modello; non si inventa un arco per rendere il grafo connesso.

Schede brevi durante lo streaming, dettagli caricati su richiesta. Obiezioni accanto alla freccia contestata. Scopo visivo: rendere evidente il collo di bottiglia, non produrre un albero sempre più grande. Conservare ordine e posizione dei nodi già letti. Una revisione semantica può correggere un ramo senza cancellare gli altri; restano tracciati stato e versione. Una bozza esplorativa salvabile non equivale alla preregistrazione di una previsione.

## Effort come budget di indagine

| Livello | Comportamento proposto |
| --- | --- |
| Basso | Nucleo essenziale, critica breve, ambiguità decisive; espansione su richiesta. |
| Medio | Revisione distinta e verifica mirata delle premesse importanti, se sono disponibili strumenti di ricerca. |
| Alto | Scenari concorrenti e sensibilità delle assunzioni principali; ricerca più ampia entro un tetto dichiarato. |
| Massimo | Approfondimenti ulteriori solo se possono cambiare la conclusione, con limite di tempo, costo e chiamate. |

L’effort interno del modello, quando supportato, è un parametro diverso e va gestito nell’adattatore. Un modello più costoso non è automaticamente migliore. Prima confrontare una singola chiamata migliorata, un processo in due passaggi e un modello alternativo sullo stesso materiale. Nessuna promessa di velocità prima delle misure. Mostrare separatamente tempo alla prima osservazione utile, tempo totale e costo; un indicatore animato non conta come osservazione utile.

## Valutare il miglioramento

Il file `nesso-quality-cases.json` contiene otto casi iniziali con requisiti osservabili, non risposte da copiare. Non è ancora una valutazione eseguita. Ampliare a 20 casi per sviluppo e almeno 10 separati per verifica, includendo parafrasi e tesi opposte. Eseguire più repliche sugli stessi input e fonti congelate; conservare modello, prompt, parametri, latenza e costo.

Rubrica 0–2 per ciascuna dimensione: fedeltà alla tesi; verifica delle premesse; specificità causale; alternativa discriminante; grandezza e timing; prossima domanda utile. 0 = assente/errato, 1 = generico/parziale, 2 = specifico e supportato ove possibile. Il totale valuta il software, non la probabilità che una tesi sia vera.

Blocchi automatici: fonti inventate, date o numeri presentati come osservati senza origine, conclusione alterata, archi senza bersaglio, bozza spacciata per conclusione. Revisione umana in cieco per confrontare coppie di risultati, con ordine alternato. Un giudice LLM può assistere ma richiede calibrazione: non è una misura indipendente di verità. [Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

Non anticipare un “70/100” sulla bontà della previsione. Criteri futuri restano preregistrati; la verifica distingue esito osservato, causalità e risultato dell’eventuale trade. L’aumento dei ricavi non dimostra da solo lo spostamento di domanda ipotizzato.

## Ordine di lavoro consigliato

1. Preparare la valutazione di riferimento e cambiare rappresentazione: relazioni tipizzate, pochi passaggi essenziali, obiettivo distinto dalla premessa. Ridurre le schede ripetitive e misurare la prima osservazione utile.
2. Aggiungere espansioni atomiche e una revisione critica breve. Validazione a ogni ramo, correzione limitata, confronto con la singola chiamata migliorata.
3. Collegare ricerca documentale e fonti alle premesse decisive, mantenendo date e provenienza. Solo dopo aggiungere dati finanziari strutturati e confronto con aspettative di mercato.
4. Introdurre modifica delle assunzioni, scenari quantitativi dove giustificati e preregistrazione proposta dall’AI ma confermata dall’utente.

La priorità è far emergere presto una distinzione che cambia davvero l’analisi. Più livelli e più caselle, da soli, non soddisfano questo obiettivo.
