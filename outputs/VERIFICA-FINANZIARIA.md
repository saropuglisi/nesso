# Verifica finanziaria Nesso — 19 settembre 2026

Prove dirette via OpenRouter e audit con operai GPT-5.6 Luna, effort massimo. Dati sintetici: nessun prezzo reale né ricerca finanziaria automatica. Il modello configurato resta DeepSeek V4.1 Flash. Le risposte grezze selezionate sono in `financial-evaluation/final/`.

## Risultati verificati

| Caso | Risultato ottenuto | Esito |
|---|---|---|
| Sconto 20%, volumi 1000→1300 | Ricavi 100.000→104.000; utile operativo 20.000→6.000; soglia 2.000 unità | Corretto sul caso sintetico |
| GMV 100 milioni, marketplace70%, commissione15% | 10,5M commissioni +30M diretto =40,5M ricavi | Corretto sul caso sintetico |
| EPS1,10 vs1; guidance4 vs5 | +10% trimestrale e −20% annuale, senza confronto tra periodi né verdetto sul titolo | Corretto sul caso sintetico |
| Duration7, prezzo100, yield−50bp | Formula +3,5 e prezzo103,5 approssimato; yield invariato100 | Corretto nell’ultima prova, con citazione del rendimento del bond |
| Dazi→AliExpress→Amazon→acquisto titolo | Distingue alcune grandezze, ma inventa un ordine di grandezza sui ricavi e inverte un falsificatore | **Non superato** |

Le ultime prove dei quattro casi quantitativi hanno richiesto circa 12–30 secondi ciascuna. 45 test automatici e controllo sintattico superati. Il qualitativo ha richiesto circa98 secondi. Sono osservazioni singole, non latenze garantite. Costi e token ricevuti dal provider sono nei JSON; non costituiscono una riconciliazione della fatturazione complessiva.

## Cosa è stato cambiato

- Estrazione separata da calcoli: quattro famiglie finanziarie complete usano formule e conclusioni deterministiche. Le altre tesi mantengono il ragionamento generale in due fasi.
- Citazioni originali e valori estratti consultabili nell’interfaccia; blocco di valori senza riscontro numerico e delle scale milioni/miliardi incoerenti. Il segno e l’associazione economica possono ancora essere interpretati male.
- Per i bond, la citazione deve riguardare il rendimento, non solamente il tasso della banca centrale. Nei test il modello aveva scelto il numero corretto dalla frase sbagliata: ora tale estrazione viene respinta.
- Archi derivati da indici di genitori validati: nessun riferimento a ID inventati.
- Parser aritmetico senza esecuzione di codice; errori espliciti; provenienza per ciascuna fase.

## Approcci provati e scartati

Il prompt originale ha prodotto solo1 grafo strutturalmente valido su4. Il nuovo collegamento tramite indici ha prodotto4/4 grafi validi in una prova, ma ciò non dimostrava correttezza finanziaria.

Aggiungere soltanto una calcolatrice lasciava contraddizioni tra il conto e il testo. Anche GPT-5.4 Mini e Claude Sonnet4.6 hanno commesso errori: inversione del segno ricavi/profitto, confronto tra EPS trimestrale e guidance annuale, “dimezzamento” di un profitto calato del70%. Il revisore automatico ha introdotto nuovi errori ed è escluso dal percorso applicativo. Non è stato promosso un modello più costoso sulla base di pochi esempi.

## Limiti e prossima priorità

Questi sono casi di sviluppo, non un test indipendente né una misura dell’accuratezza nel trading. Le formule non prevedono la domanda e non verificano fatti di mercato. L’estrazione rimane probabilistica e può fallire; i controlli lessicali non certificano il significato economico. Le quattro famiglie non coprono qualsiasi problema finanziario.

La tesi qualitativa richiesta dall’utente resta il limite principale. Prima di considerarla affidabile servono fonti verificabili e una valutazione separata di ogni legame causale, delle alternative e dei falsificatori, con casi nuovi non usati per scrivere i prompt. Un grafo valido non viene contato come analisi finanziaria corretta. I punteggi del diario restano legati ai criteri preregistrati, non a queste prove del modello.
