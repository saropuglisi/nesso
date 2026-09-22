import { XMLParser, XMLValidator } from "fast-xml-parser";
import { setTimeout as delay } from "node:timers/promises";
import { AppError, requireThat } from "./domain.js";

// No model-supplied host, API key, headers or arbitrary network requests.
const HOSTS = new Set(["www.sec.gov", "data.sec.gov", "api.stlouisfed.org", "api.worldbank.org"]);
const asArray = (x) => x == null ? [] : Array.isArray(x) ? x : [x];
const cut = (x, n = 2000) => String(x ?? "").slice(0, n);
const num = (x) => x === null || x === undefined || String(x).trim() === "" || x === "." || !Number.isFinite(Number(x)) ? null : Number(x);
const cik = (x) => {
  requireThat(/^\d{1,10}$/.test(x) && Number(x) > 0, "SEC: usa un CIK valido ottenuto dalla ricerca aziende.");
  return String(x).padStart(10, "0");
};
const code = (x, pattern, label) => {
  requireThat(typeof x === "string" && pattern.test(x), `${label}: identificatore non valido.`);
  return x;
};
const query = (x) => code(x, /^[^\x00-\x1f]{2,160}$/, "Ricerca");
function xml(text) {
  requireThat(!/<!DOCTYPE|<!ENTITY/i.test(text) && XMLValidator.validate(text) === true, "XML della fonte non valido.", 502);
  return new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false, removeNSPrefix: true }).parse(text);
}
function textOnly(html) {
  return html.replace(/<(script|style|ix:header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
}
function excerpts(text, search) {
  const terms = search.toLowerCase().split(/\s+/).filter((x) => x.length > 2).slice(0, 5);
  const starts = new Set([0]);
  for (const term of terms) {
    let at = text.toLowerCase().indexOf(term);
    for (let i = 0; at >= 0 && i < 2; i++) {
      starts.add(Math.max(0, at - 250));
      at = text.toLowerCase().indexOf(term, at + 1000);
    }
  }
  return [...starts].sort((a, b) => a - b).slice(0, 6).map((offset) => ({ offset, text: text.slice(offset, offset + 1800) }));
}
export function dataConfig(env = process.env) {
  return { secUserAgent: env.SEC_USER_AGENT || "", fredKey: env.FRED_API_KEY || "" };
}
export function sourceStatus(c) {
  return [
    { id: "sec", name: "SEC / EDGAR", ready: /\S+@\S+\.\S+/.test(c.secUserAgent) && !/[\r\n]/.test(c.secUserAgent), description: "Report 10-K, 10-Q, 8-K, dati XBRL e insider Form 4", setup: "SEC_USER_AGENT=Nesso nome@dominio.it" },
    { id: "fred", name: "FRED", ready: /^[a-f0-9]{32}$/i.test(c.fredKey), description: "Ricerca di serie macro e osservazioni con unità, frequenza e data", setup: "FRED_API_KEY (chiave gratuita)" },
    { id: "worldbank", name: "World Bank", ready: true, description: "Indicatori macro internazionali annuali, senza chiave", setup: "Nessuna chiave" },
  ];
}
export const WB_INDICATORS = {
  "NY.GDP.MKTP.CD": "GDP (current US$)",
  "NY.GDP.MKTP.KD.ZG": "GDP growth (annual %)",
  "NY.GDP.PCAP.CD": "GDP per capita (current US$)",
  "FP.CPI.TOTL.ZG": "Inflation, consumer prices (annual %)",
  "SL.UEM.TOTL.ZS": "Unemployment, total (% of total labor force), modeled ILO estimate",
  "SL.UEM.1524.ZS": "Youth unemployment (% ages 15-24), modeled ILO estimate",
  "SP.POP.TOTL": "Population, total",
  "NE.TRD.GNFS.ZS": "Trade (% of GDP)",
};
export const DATA_TOOLS = [
  { name: "sec_search", provider: "sec", description: "Trova aziende quotate USA per ticker o nome: query. Restituisce CIK, non evidenza sulla tesi." },
  { name: "sec_filings", provider: "sec", description: "Ultimi report di una società: identifier=CIK; metric=10-K,10-Q,8-K,20-F,6-K oppure 4 per insider. Non è una ricerca storica esaustiva." },
  { name: "sec_document", provider: "sec", description: "Legge un URL documento restituito da sec_filings in questa ricerca: identifier=URL esatto; query=parole da trovare in inglese. Per Form 4 estrae transazioni, codici e note." },
  { name: "sec_concept", provider: "sec", description: "Dati XBRL aziendali: identifier=CIK; metric=tag US-GAAP (es. Revenues, NetIncomeLoss, Assets). Conserva periodi, unità e revisioni; nessuna somma automatica." },
  { name: "fred_search", provider: "fred", description: "Cerca serie macro: query in inglese. Scegli poi la serie pertinente per paese, unità e frequenza." },
  { name: "fred_series", provider: "fred", description: "Legge metadati e le ultime 24 osservazioni: identifier=ID serie FRED. Non fornisce una vintage storica né quotazioni intraday." },
  { name: "wb_series", provider: "worldbank", description: `Serie annuale World Bank: identifier=codice paese ISO3 (ITA,USA,DEU...) o WLD; metric=codice indicatore. Indicatori iniziali: ${JSON.stringify(WB_INDICATORS)}. Si possono leggere altri codici ufficiali se noti; nessuna ricerca di notizie o aziende.` },
];
let secQueue = Promise.resolve();
let lastSecRequest = 0;
async function secThrottle(signal) {
  const next = secQueue.catch(() => {}).then(async () => {
    signal?.throwIfAborted();
    await delay(Math.max(0, 300 - (Date.now() - lastSecRequest)), undefined, { signal });
    lastSecRequest = Date.now();
  });
  secQueue = next;
  await next;
}

export function parseOwnership(text) {
  const doc = xml(text).ownershipDocument;
  requireThat(doc && ["4", "4/A"].includes(doc.documentType), "Il documento non è un Form 4.", 502);
  const val = (x) => x && typeof x === "object" ? x.value ?? null : x ?? null;
  const transactions = (rows, derivative) => asArray(rows).slice(0, 30).map((row) => ({
    derivative,
    security: val(row.securityTitle), date: val(row.transactionDate),
    code: row.transactionCoding?.transactionCode || null,
    shares: num(val(row.transactionAmounts?.transactionShares)),
    pricePerShare: num(val(row.transactionAmounts?.transactionPricePerShare)),
    acquiredDisposed: val(row.transactionAmounts?.transactionAcquiredDisposedCode),
    sharesAfter: num(val(row.postTransactionAmounts?.sharesOwnedFollowingTransaction)),
    ownership: val(row.ownershipNature?.directOrIndirectOwnership),
    details: row, // Retain derivative terms and footnote references, not just price.
  }));
  return {
    form: doc.documentType, periodOfReport: doc.periodOfReport, issuer: doc.issuer,
    owners: asArray(doc.reportingOwner).map((owner) => ({ identity: owner.reportingOwnerId, relationship: owner.reportingOwnerRelationship })),
    transactions: [...transactions(doc.nonDerivativeTable?.nonDerivativeTransaction, false), ...transactions(doc.derivativeTable?.derivativeTransaction, true)],
    footnotes: asArray(doc.footnotes?.footnote), remarks: doc.remarks || "",
    rule10b5_1: doc.aff10b5One || null,
    caveat: "Campione di transazioni dichiarate, non segnale di investimento. P/S non vanno confusi con assegnazioni A, esercizi M, donazioni G o trattenute F. Leggere note, derivati e piani 10b5-1. L'assenza di righe non prova assenza di operazioni.",
  };
}

export function createDataClient({ config = dataConfig(), fetchImpl = fetch, now = () => new Date().toISOString() } = {}) {
  const ready = new Set(sourceStatus(config).filter((s) => s.ready).map((s) => s.id));
  // This allowlist lasts only for one research run. URLs must originate in SEC metadata.
  const documents = new Map();
  async function get(url, signal, format = "json", maxBytes = 8_000_000) {
    const u = new URL(url);
    requireThat(u.protocol === "https:" && !u.username && !u.password && HOSTS.has(u.hostname) && !u.port, "Destinazione dati non consentita.");
    const isSec = u.hostname.endsWith("sec.gov");
    if (isSec) await secThrottle(signal);
    const timeout = AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(18000)]);
    let response;
    try {
      response = await fetchImpl(u, { redirect: "error", signal: timeout, headers: { accept: format === "json" ? "application/json" : "text/html,application/xml,text/xml", ...(isSec ? { "User-Agent": config.secUserAgent } : {}) } });
    } catch {
      signal?.throwIfAborted();
      throw new AppError(`Fonte ${u.hostname} non raggiungibile o timeout.`, 502);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(`Fonte ${u.hostname}: HTTP ${response.status}. Nessun dato sostitutivo inventato.`, 502);
    }
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        requireThat(size <= maxBytes, "Documento troppo grande per questa lettura.", 502);
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const body = Buffer.concat(chunks).toString("utf8");
    if (format !== "json") return body;
    try { return JSON.parse(body); } catch { throw new AppError(`Fonte ${u.hostname}: JSON non valido.`, 502); }
  }
  const fredUrl = (path, params) => {
    const url = new URL(`https://api.stlouisfed.org/fred/${path}`);
    url.search = new URLSearchParams({ ...params, api_key: config.fredKey, file_type: "json" });
    return url;
  };
  const evidence = (provider, title, url, data, kind = "data") => ({ provider, title: cut(title, 300), url, retrievedAt: now(), kind, data });
  function allowDocument(url, meta) {
    const u = new URL(url);
    requireThat(u.origin === "https://www.sec.gov" && /^\/Archives\/edgar\/data\/\d+\/\d{18}\/[-a-zA-Z0-9_.]+\.(?:htm|html|xml|txt)$/.test(u.pathname), "Percorso documento SEC non valido.", 502);
    documents.set(u.href, meta);
    return u.href;
  }
  return {
    tools: DATA_TOOLS.filter((t) => ready.has(t.provider)),
    async run(name, params, signal) {
      const tool = DATA_TOOLS.find((t) => t.name === name);
      requireThat(tool && ready.has(tool.provider), "Fonte non configurata o strumento non disponibile.", 503);
      const { query: q = "", identifier = "", metric = "" } = params || {};
      if (name === "sec_search") {
        query(q);
        const url = "https://www.sec.gov/files/company_tickers.json";
        const raw = await get(url, signal);
        const term = q.toLowerCase();
        const matches = Object.values(raw).filter((r) => r.ticker?.toLowerCase() === term || r.title?.toLowerCase().includes(term)).sort((a, b) => Number(b.ticker?.toLowerCase() === term) - Number(a.ticker?.toLowerCase() === term)).slice(0, 8);
        return evidence("sec", `Ricerca aziende: ${q}`, url, { matches: matches.map((r) => ({ cik: cik(String(r.cik_str)), ticker: r.ticker, name: r.title })), caveat: "Directory di aziende con ticker, non anagrafe completa di tutti i filer SEC." }, "discovery");
      }
      if (name === "sec_filings") {
        const id = cik(identifier);
        code(metric, /^(10-K|10-Q|8-K|20-F|6-K|4)$/, "Tipo report SEC");
        if (metric === "4") {
          const url = `https://www.sec.gov/cgi-bin/browse-edgar?${new URLSearchParams({ action: "getcompany", CIK: id, type: "4", owner: "only", count: "10", output: "atom" })}`;
          const feed = xml(await get(url, signal, "text")).feed;
          requireThat(feed, "Feed SEC non valido.", 502);
          const filings = asArray(feed.entry).filter((e) => ["4", "4/A"].includes(e.content?.["filing-type"])).slice(0, 4).map((e) => {
            const indexUrl = asArray(e.link).find((l) => l["@_href"]?.includes("/Archives/"))?.["@_href"];
            requireThat(indexUrl, "Link filing SEC mancante.", 502);
            const meta = { form: e.content?.["filing-type"], filed: e.content?.["filing-date"], accession: e.content?.["accession-number"], issuerCik: id, index: true };
            return { ...meta, url: allowDocument(indexUrl, meta), title: cut(e.title, 300) };
          });
          return evidence("sec", `Insider Form 4 · CIK ${id}`, url, { filings, coverage: "Al massimo quattro filing dal feed recente; non storico completo. Apri sec_document per leggere le operazioni." }, "discovery");
        }
        const url = `https://data.sec.gov/submissions/CIK${id}.json`;
        const raw = await get(url, signal), recent = raw.filings?.recent;
        requireThat(recent && Array.isArray(recent.form), "Elenco SEC non valido.", 502);
        const filings = [];
        for (let i = 0; i < recent.form.length && filings.length < 5; i++) {
          if (![metric, `${metric}/A`].includes(recent.form[i])) continue;
          const accession = code(recent.accessionNumber[i], /^\d{10}-\d{2}-\d{6}$/, "Accession SEC");
          const filename = code(recent.primaryDocument[i], /^[-\w.]+\.(htm|html|xml|txt)$/, "Documento SEC");
          const meta = { form: recent.form[i], filed: recent.filingDate[i], reportDate: recent.reportDate[i], accession, company: raw.name };
          filings.push({ ...meta, url: allowDocument(`https://www.sec.gov/Archives/edgar/data/${Number(id)}/${accession.replaceAll("-", "")}/${filename}`, meta) });
        }
        return evidence("sec", `${raw.name} · ${metric}`, url, { filings, coverage: "Solo filings.recent; nessun risultato non implica assenza di report storici." }, "discovery");
      }
      if (name === "sec_document") {
        requireThat(documents.has(identifier), "Apri soltanto un documento restituito da sec_filings in questa ricerca.");
        const meta = documents.get(identifier);
        let url = identifier;
        if (meta.index) {
          // Get original XML, not the SEC XSL presentation. No arbitrary href following.
          const html = await get(url, signal, "text");
          const match = [...html.matchAll(/href=["']([^"']+\.xml)["']/gi)].find((m) => m[1].includes("/Archives/edgar/data/"));
          requireThat(match, "XML Form 4 non trovato nel filing.", 502);
          const candidate = new URL(match[1].replace(/\/xsl[^/]+\//, "/"), url);
          const directory = new URL(identifier).pathname.replace(/[^/]+$/, "");
          requireThat(candidate.pathname.startsWith(directory), "XML esterno al filing SEC.", 502);
          url = allowDocument(candidate.href, { ...meta, index: false });
        }
        const raw = await get(url, signal, "text");
        if (meta.form === "4" || meta.form === "4/A") {
          const ownership = parseOwnership(raw);
          requireThat(Number(ownership.issuer?.issuerCik) === Number(meta.issuerCik), "Il Form 4 riguarda un emittente diverso.", 502);
          requireThat(JSON.stringify(ownership).length < 35000, "Form 4 troppo esteso per questa lettura.", 502);
          return evidence("sec", `Form ${meta.form} · ${ownership.issuer?.issuerName} · ${meta.filed}`, url, { ...meta, ...ownership }, "document");
        }
        const text = textOnly(raw);
        requireThat(text.length > 40, "Il report non contiene testo leggibile sufficiente.", 502);
        return evidence("sec", `${meta.company} · ${meta.form} · ${meta.filed}`, url, { ...meta, excerpts: excerpts(text, cut(q, 160)), totalCharacters: text.length, partial: true, caveat: "Estratti selezionati, non lettura integrale del report. Numeri in tabelle richiedono conferma XBRL del contesto e delle unità." }, "document");
      }
      if (name === "sec_concept") {
        const id = cik(identifier), tag = code(metric, /^[A-Za-z][A-Za-z0-9]{0,99}$/, "Tag US-GAAP");
        const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${id}/us-gaap/${tag}.json`;
        const raw = await get(url, signal);
        requireThat(raw.units && typeof raw.units === "object" && Object.values(raw.units).some((rows) => Array.isArray(rows) && rows.length), "Dati XBRL mancanti.", 502);
        const units = Object.fromEntries(Object.entries(raw.units).slice(0, 4).map(([unit, rows]) => [unit, rows.slice().sort((a, b) => String(b.filed).localeCompare(String(a.filed)) || String(b.end).localeCompare(String(a.end))).slice(0, 12)]));
        return evidence("sec", `${raw.entityName} · ${raw.label || tag}`, url, { cik: id, tag, description: cut(raw.description), units, caveat: "Campione per data di deposito; include periodi comparativi e rettifiche. Non sommare periodi sovrapposti; trimestri, esercizi fiscali, unità e istanti non sono intercambiabili." });
      }
      if (name === "fred_search") {
        query(q);
        const raw = await get(fredUrl("series/search", { search_text: q, limit: "6", order_by: "search_rank", sort_order: "desc" }), signal);
        requireThat(Array.isArray(raw.seriess), "Risposta ricerca FRED non valida.", 502);
        return evidence("fred", `Serie FRED: ${q}`, `https://fred.stlouisfed.org/searchresults/?${new URLSearchParams({ st: q })}`, { series: raw.seriess.map((r) => ({ id: r.id, title: r.title, units: r.units, frequency: r.frequency, seasonalAdjustment: r.seasonal_adjustment, observationEnd: r.observation_end })) }, "discovery");
      }
      if (name === "fred_series") {
        const id = code(identifier, /^[A-Za-z0-9_]{1,80}$/, "Serie FRED");
        const metadata = await get(fredUrl("series", { series_id: id }), signal);
        const series = metadata.seriess?.[0];
        requireThat(series, "Serie FRED non trovata.", 502);
        const raw = await get(fredUrl("series/observations", { series_id: id, sort_order: "desc", limit: "24" }), signal);
        requireThat(Array.isArray(raw.observations), "Osservazioni FRED mancanti.", 502);
        requireThat(raw.observations.some((r) => num(r.value) !== null), "FRED: nessun valore numerico disponibile nella finestra richiesta.", 502);
        return evidence("fred", series.title, `https://fred.stlouisfed.org/series/${id}`, {
          id, units: series.units, frequency: series.frequency, seasonalAdjustment: series.seasonal_adjustment,
          lastUpdated: series.last_updated, notes: cut(series.notes, 3000),
          realtimeStart: raw.realtime_start, realtimeEnd: raw.realtime_end,
          observations: raw.observations.map((r) => ({ date: r.date, value: num(r.value), realtimeStart: r.realtime_start, realtimeEnd: r.realtime_end })),
          caveat: "Ultime 24 osservazioni, vintage corrente: dati storici soggetti a revisione. Valore null significa mancante, non zero. Non è un feed intraday.",
        });
      }
      if (name === "wb_series") {
        const country = code(identifier, /^[A-Za-z]{3}$/, "Paese ISO3").toUpperCase();
        const indicator = code(metric, /^[A-Z][A-Z0-9_.]{2,99}$/, "Indicatore World Bank");
        const metadata = await get(`https://api.worldbank.org/v2/indicator/${indicator}?format=json`, signal);
        const info = metadata?.[1]?.[0];
        requireThat(info?.id === indicator, "Indicatore World Bank non trovato.", 502);
        const year = new Date().getUTCFullYear();
        const url = `https://api.worldbank.org/v2/country/${country}/indicator/${indicator}?format=json&date=${year - 12}:${year}&per_page=20`;
        const raw = await get(url, signal);
        requireThat(Array.isArray(raw?.[1]), "Paese o dati World Bank non disponibili.", 502);
        requireThat(raw[1].some((r) => num(r.value) !== null), "World Bank: nessun valore numerico disponibile nella finestra richiesta.", 502);
        return evidence("worldbank", `${info.name} · ${country}`, url, {
          country, indicator, name: info.name, unit: info.unit || "Vedi definizione dell’indicatore", definition: cut(info.sourceNote, 3000), source: info.sourceOrganization,
          lastUpdated: raw[0]?.lastupdated, frequency: "annual", observations: raw[1].slice(0, 13).map((r) => ({ date: r.date, value: num(r.value), country: r.country?.value })),
          caveat: "Serie annuale, possibile ritardo di pubblicazione e revisioni. Valori null non sono zero. Nessuna inferenza causale automatica.",
        });
      }
      throw new AppError("Strumento dati non implementato.");
    },
  };
}
