# Nesso — prima base reale

L’app è avviabile dalla cartella del progetto con `npm start` e si apre su <http://127.0.0.1:4180>.

La prima integrazione scelta è **OpenRouter**. La configurazione locale `.env` è stata creata con endpoint e provider pronti. Completa sul tuo computer:

```dotenv
NESSO_MODEL=provider/modello
NESSO_API_KEY=la-tua-chiave-OpenRouter
```

Il modello scelto deve supportare Structured Outputs / JSON Schema. Non incollare la chiave in chat. Riavvia il server dopo aver modificato il file.

## Implementato

- Interfaccia bianca con mappa dinamica, menu a scomparsa e selettore effort.
- Adattatori OpenRouter/API compatibili, OpenAI Responses e Ollama.
- Ambito generale o trading con catalizzatori, invalidazione e aspettative già scontate.
- Archivio SQLite locale, snapshot immutabili, criteri numerici preregistrati.
- Valutazione deterministica su evidenze manuali, con dati mancanti distinti da zero.
- Esportazione dello snapshot JSON e diario persistente.

La prima verifica usa criteri binari alla data esatta indicata. Non sono ancora collegati dati di mercato, ricerca web o monitoraggio automatico. Nessun ordine viene eseguito. I test usano dati fittizi isolati; il tuo archivio reale parte vuoto.

## Git

Ramo: `codex/real-inference-foundation`. Il codice della demo precedente è preservato in `dist/`; l’app reale è in `public/` e `server/`. Chiavi e database sono esclusi da Git. Il remoto GitHub di sviluppo è ancora da scegliere.

Documentazione completa nel `README.md` del progetto e percorso di sviluppo in `docs/roadmap.md`.
