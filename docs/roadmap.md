# Dalla base reale al prodotto

Aggiornamento 19 settembre 2026: prima di ampliare le funzionalità, seguire lo [studio sulla qualità](../outputs/STUDIO-QUALITA-NESSO.md) e il [set iniziale di casi](../outputs/nesso-quality-cases.json). Priorità: nessi e obiezioni tipizzati, nucleo breve, espansione per ramo, verifica delle premesse e valutazione comparativa. Queste sono proposte da implementare e misurare, non capacità già disponibili.

## 1. Collegamento e valutazione del modello

- Scegliere provider/model ID e configurare la chiave server-side.
- Eseguire almeno tre tesi reali: generale, trading, input avversario. Misurare validità del grafo, qualità dei meccanismi, latenza e costo.
- Confrontare lo stesso set con un modello locale usando lo stesso contratto.
- Valutare estrazione progressiva dei rami e una seconda passata critica: l’effort oggi regola profondità e budget in una singola chiamata.

## 2. Tesi trading verificabili

- Dataset con licenza scelta: prezzi adjusted, fondamentali, filings, calendario eventi, stime disponibili alla data della tesi.
- Evidenze immutabili con data evento, data pubblicazione e data acquisizione; il dato revisionato non deve sovrascrivere quello conosciuto allora.
- Separare metriche del fenomeno, direzione del prezzo, timing e risultato economico di un’eventuale strategia. Una tesi corretta non equivale a profitto.
- Introduzione di baseline/benchmark, costi, spread e controlli di attribuzione solo dove pertinenti e con dati tracciabili.
- Schema di criteri con finestre temporali, fasce parziali, baseline, fonte primaria e policy esplicita sulle revisioni.

## 3. Interazione sul grafo

- Modifica e riespansione del singolo nodo con storia delle revisioni.
- Evidenze allegate a nodi e archi, assunzioni condivise, feedback temporali espliciti.
- Provenienza della singola affermazione e indicatori separati di dato mancante, conflitto e scadenza non raggiunta.

## 4. Monitoraggio e apprendimento

- Scheduler sul server per le fonti autorizzate; idempotenza, retry e registro degli eventi.
- Valutazioni proposte dall’AI ma calcolate dal motore deterministico sulle versioni fissate.
- Thinking Journal con analisi degli errori solo dopo un campione sufficiente; niente profili personali fittizi.

## 5. Distribuzione

- Repository remoto di sviluppo scelto dall’utente, CI e revisione dei cambiamenti.
- Autenticazione e isolamento per utente prima di esporre l’app in rete.
- Migrazioni schema, backup verificati, limiti di utilizzo e budget per provider.
- Eventuale runtime cloud separato dal servizio locale, senza esporre chiavi o inferenza privata al browser.

## Decisioni già prese

- Motore generale, profilo trading come estensione.
- Prima connessione preferita: API esterna.
- Chiavi solo nel backend; nessun fallback remoto implicito.
- Archivio locale SQLite e Git per il codice.
- Il sito pubblicato è una demo, non una fonte di dati reali.
