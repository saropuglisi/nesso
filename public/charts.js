/*
 * The analysis dossier is deliberately a small, dependency-free renderer.
 * It only consumes the versioned chart contract emitted by the server; it
 * never infers a series from prose or executes model-provided code.
 */
const CHARTS_VERSION = "nesso-charts-v1";
const EVIDENCE_AUDIT_VERSION = "nesso-evidence-audit-v1";
const EXCERPT_LIMIT = 520;
const EXCERPT_COUNT = 3;
const effortLabels = { low: "Basso", medium: "Medio", high: "Alto", max: "Massimo" };
const effortGuidance = {
  low: "Essenziale: tesi, passaggio chiave e dati mancanti.",
  medium: "Verifica: tesi, fonti e controlli necessari.",
  high: "Confronto: argomenti a favore, contrari e assunzioni.",
  max: "Scenari e obiezioni: meccanismi alternativi e differenze osservabili.",
};

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function bodyOf(record) {
  return record && record.body && typeof record.body === "object"
    ? record.body
    : record && typeof record === "object"
      ? record
      : {};
}

function graphOf(body) {
  return body.graph && typeof body.graph === "object" ? body.graph : {};
}

function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePoints(points) {
  return list(points).map((point) => {
    const value = point && point.value;
    return {
      label: text(point?.label),
      value: value === null ? null : validNumber(value) ? value : null,
      invalid: value !== null && !validNumber(value),
    };
  });
}

function normalizeChart(item, index) {
  if (!item || typeof item !== "object") return null;
  const type = item.type === "bar" ? "bar" : item.type === "line" ? "line" : "";
  if (!type) return null;
  return {
    id: text(item.id) || `chart-${index + 1}`,
    title: text(item.title) || `Grafico ${index + 1}`,
    type,
    unit: text(item.unit),
    frequency: text(item.frequency),
    points: normalizePoints(item.points),
    sourceIds: list(item.sourceIds).filter((id) => typeof id === "string" && /^R[1-6]$/.test(id)),
    notes: list(item.notes).filter((note) => typeof note === "string" && note.trim()).map((note) => note.trim()),
  };
}

export function normalizeCharts(record) {
  const body = bodyOf(record);
  const charts = body.charts;
  if (!charts || typeof charts !== "object" || charts.version !== CHARTS_VERSION) return [];
  return list(charts.items).map(normalizeChart).filter(Boolean);
}

export function hasChartItems(record) {
  return normalizeCharts(record).length > 0;
}

function safeHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function sourceList(body) {
  const sources = body.research && Array.isArray(body.research.sources) ? body.research.sources : [];
  return sources.filter(
    (source) =>
      source &&
      typeof source === "object" &&
      typeof source.id === "string" &&
      /^R[1-6]$/.test(source.id),
  );
}

function sourceById(sources) {
  const counts = new Map();
  sources.forEach((source) => counts.set(source.id, (counts.get(source.id) || 0) + 1));
  return new Map(sources.filter((source) => counts.get(source.id) === 1).map((source) => [source.id, source]));
}

function sourceDate(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const raw = value.trim();
  if (/^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(raw)) return raw;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("it-IT") : "";
}

function sourceDateLabel(value) {
  return sourceDate(value) || text(value);
}

function firstSourceDate(source, keys) {
  const data = source?.data && typeof source.data === "object" ? source.data : {};
  for (const key of keys) {
    const value = source?.[key] ?? data[key];
    const label = sourceDateLabel(value);
    if (label) return label;
  }
  return "";
}

function sourceTiming(source) {
  const data = source?.data && typeof source.data === "object" ? source.data : {};
  const publication = firstSourceDate(source, [
    "publishedAt",
    "publicationDate",
    "publicationTime",
    "published",
  ]);
  const filing = firstSourceDate(source, ["filedAt", "filingDate", "filed"]);
  const observation = firstSourceDate(source, [
    "observedAt",
    "observationDate",
    "observationTime",
    "observed",
  ]);
  const observationLabels = list(data.observations)
    .map((row) => text(row?.date || row?.period || row?.label))
    .filter((label) => /^\d{4}(?:-\d{2}){0,2}$/.test(label))
    .sort();
  const observationRange = observationLabels.length > 1
    ? `osservazioni ${observationLabels[0]} – ${observationLabels[observationLabels.length - 1]}`
    : observationLabels.length === 1
      ? `osservata ${observationLabels[0]}`
      : "";
  const period = firstSourceDate(source, ["periodOfReport", "reportPeriod", "reportDate"]);
  const windowStart = firstSourceDate(source, ["observationStart", "startDate"]);
  const windowEnd = firstSourceDate(source, ["observationEnd", "endDate"]);
  const updated = firstSourceDate(source, ["updatedAt", "lastUpdated"]);
  const acquired = sourceDateLabel(source?.retrievedAt);
  return [
    publication ? `pubblicata ${publication}` : "",
    filing ? `depositata ${filing}` : "",
    observation ? `osservata ${observation}` : observationRange,
    period ? `periodo del report ${period}` : "",
    windowStart && windowEnd ? `finestra osservata ${windowStart} – ${windowEnd}` : "",
    updated ? `aggiornata ${updated}` : "",
    acquired ? `acquisita ${acquired}` : "",
  ].filter(Boolean);
}

function formatValue(value, unit = "") {
  if (!validNumber(value)) return "GAP";
  let number;
  try {
    number = new Intl.NumberFormat("it-IT", { maximumSignificantDigits: 12 }).format(value);
  } catch {
    number = String(value);
  }
  // Do not let a very small, non-zero observation become a displayed zero.
  if (value !== 0 && Number(value) !== 0 && /^[-+]?0(?:[,.]0+)?$/.test(number)) {
    number = value.toExponential(6).replace(".", ",");
  }
  return unit ? `${number} ${unit}` : number;
}

function formatAxisValue(value) {
  if (!validNumber(value)) return "—";
  const magnitude = Math.abs(value);
  if ((magnitude > 0 && magnitude < 0.001) || magnitude >= 1000000) {
    return value.toExponential(3).replace("e+", "e");
  }
  try {
    return new Intl.NumberFormat("it-IT", { maximumSignificantDigits: 4 }).format(value);
  } catch {
    return String(value);
  }
}

function parseDateLabel(label) {
  const value = text(label);
  let match = /^(\d{4})$/.exec(value);
  if (match) return Date.UTC(Number(match[1]), 0, 1);
  match = /^(\d{4})-(\d{2})$/.exec(value);
  if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12)
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const date = new Date(timestamp);
    if (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    )
      return timestamp;
  }
  return null;
}

function safeId(value, fallback) {
  const id = String(value || fallback).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return id.replace(/^-+|-+$/g, "") || fallback;
}

function sourceAnchor(id) {
  return `source-card-${safeId(id, "source")}`;
}

function sourceRefMarkup(ids, sources) {
  const byId = sourceById(sources);
  return list(ids)
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => {
      const source = byId.get(id);
      if (!source) return `<span class="source-ref-missing">${escape(id)} · fonte non presente o ambigua</span>`;
      const title = text(source.title) || `Fonte ${id}`;
      return `<a href="#${escape(sourceAnchor(id))}"><span class="source-id">${escape(id)}</span> · ${escape(title)}</a>`;
    })
    .join(" · ");
}

function sourceDataDetails(source) {
  const data = source?.data && typeof source.data === "object" ? source.data : {};
  const extracts = list(data.excerpts)
    .map((part) => (typeof part === "string" ? part : text(part?.text)))
    .filter(Boolean)
    .slice(0, EXCERPT_COUNT)
    .map((part) => part.slice(0, EXCERPT_LIMIT));
  const observations = list(data.observations)
    .filter((row) => row && typeof row === "object")
    .slice(0, 4)
    .map((row) => {
      const date = text(row.date || row.period || row.label) || "Periodo non indicato";
      const value = row.value === null || row.value === undefined ? "mancante" : String(row.value).slice(0, 120);
      return `${date}: ${value}`;
    });
  const observationMeta = [
    text(data.units) || text(data.unit) ? `Unità: ${text(data.units) || text(data.unit)}` : "",
    data.frequency ? `Frequenza: ${data.frequency}` : "",
    data.seasonalAdjustment ? `Aggiustamento: ${data.seasonalAdjustment}` : "",
  ].filter(Boolean).map((value) => String(value).slice(0, EXCERPT_LIMIT));
  const transactions = list(data.transactions)
    .filter((row) => row && typeof row === "object")
    .slice(0, 4)
    .map((row) => `${text(row.date) || "Data non indicata"}: ${text(row.code) || "codice non indicato"}, quantità ${row.shares ?? "non indicata"}`.slice(0, EXCERPT_LIMIT));
  const xbrl = data.units && typeof data.units === "object" && !Array.isArray(data.units)
    ? Object.entries(data.units).slice(0, 2).flatMap(([unit, rows]) => list(rows).slice(0, 2).map((row) => `${row?.start ? row.start + " → " : ""}${row?.end || "Periodo non indicato"}: ${row?.val ?? row?.value ?? "valore non indicato"} ${unit}${row?.filed ? " · deposito " + row.filed : ""}`.slice(0, EXCERPT_LIMIT)))
    : [];
  const descriptions = [data.caveat, data.coverage, data.description, data.definition, data.notes]
    .filter((value) => typeof value === "string" && value.trim())
    .slice(0, 2)
    .map((value) => value.trim().slice(0, EXCERPT_LIMIT));
  if (source.kind === "discovery") {
    const detail = [...descriptions, ...observationMeta, ...observations, ...transactions, ...xbrl].slice(0, EXCERPT_COUNT);
    return `<div class="analysis-source-details"><strong>Elenco della ricerca</strong><p>Risultato di ricerca: è solo un elenco, non una fonte letta e non costituisce evidenza.</p>${detail.length ? `<ul>${detail.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>` : ""}</div>`;
  }
  if (!extracts.length && !observations.length && !descriptions.length && !observationMeta.length && !transactions.length && !xbrl.length) return "";
  return `<div class="analysis-source-details"><strong>Estratti originali della fonte</strong><p>Estratti e dati ricevuti; non sono verificati dal dossier e non dimostrano la tesi.</p>${extracts.map((part) => `<blockquote>${escape(part)}</blockquote>`).join("")}${observationMeta.length ? `<ul>${observationMeta.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>` : ""}${observations.length ? `<ul>${observations.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>` : ""}${transactions.length ? `<ul>${transactions.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>` : ""}${xbrl.length ? `<ul>${xbrl.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>` : ""}${descriptions.map((part) => `<p>${escape(part)}</p>`).join("")}</div>`;
}

function sourceCardMarkup(source) {
  const id = text(source.id);
  const title = text(source.title) || `Fonte ${id}`;
  const href = safeHttps(source.url);
  const label = href
    ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(title)} ↗</a>`
    : escape(title);
  const timing = sourceTiming(source);
  const kind = source.kind === "discovery" ? "ELENCO DI RICERCA" : "FONTE RECUPERATA";
  return `<article class="analysis-source-card" id="${escape(sourceAnchor(id))}" tabindex="-1"><span class="eyebrow">${escape(id)} · ${escape(text(source.provider))} · ${kind}</span><h3>${label}</h3>${timing.length ? `<p class="analysis-source-meta">${escape(timing.join(" · "))}</p>` : ""}${!href && source.url ? `<small>URL non collegato: non è un HTTPS sicuro.</small>` : ""}${sourceDataDetails(source)}</article>`;
}

function sourceCardsMarkup(sources) {
  if (!sources.length) return "";
  const seen = new Set();
  const cards = sources
    .filter((source) => {
      if (seen.has(source.id)) return false;
      seen.add(source.id);
      return true;
    })
    .map(sourceCardMarkup)
    .join("");
  return `<section class="analysis-section analysis-sources" id="analysis-sources"><span class="eyebrow">FONTI ESTRATTI</span><h2>Fonti presenti nel dossier</h2><p class="muted">Le fonti sono mostrate come materiale ricevuto. La presenza o la citazione non prova pertinenza, autenticità o nesso causale.</p>${cards}</section>`;
}

function sourceLinks(chart, sources) {
  const byId = sourceById(sources);
  if (!chart.sourceIds.length) {
    return `<p class="analysis-missing">Nessuna fonte associata a questo grafico: il dato non è disponibile per una verifica.</p>`;
  }
  return `<ul class="analysis-source-list">${chart.sourceIds
    .map((id) => {
      const source = byId.get(id);
      if (!source) return `<li><span class="source-id">${escape(id)}</span> · Fonte non presente o ambigua nel dossier.</li>`;
      const title = text(source.title) || `Fonte ${id}`;
      const provider = text(source.provider);
      const href = safeHttps(source.url);
      const label = `<a href="#${escape(sourceAnchor(id))}">${escape(title)}</a>`;
      const meta = [
        provider,
        source.kind === "discovery" ? "risultato di ricerca, non evidenza recuperata" : "",
        ...sourceTiming(source),
      ]
        .filter(Boolean)
        .join(" · ");
      return `<li><span class="source-id">${escape(id)}</span> · ${label}${meta ? `<small>${escape(meta)}</small>` : ""}${!href && source.url ? `<small>URL esterno non collegato: non è un HTTPS sicuro.</small>` : ""}</li>`;
    })
    .join("")}</ul>`;
}

function pointsTable(chart) {
  return `<div class="analysis-table-wrap"><table class="analysis-data-table"><caption>Dati di ${escape(chart.title)} · ordine originale</caption><thead><tr><th scope="col">Periodo</th><th scope="col">Valore${chart.unit ? ` (${escape(chart.unit)})` : ""}</th></tr></thead><tbody>${chart.points.length
    ? chart.points
        .map(
          (point) =>
            `<tr><th scope="row">${escape(point.label || "Periodo non indicato")}</th><td class="${point.value === null ? "gap" : ""}">${point.value === null ? "GAP · dato mancante" : escape(formatValue(point.value, chart.unit))}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="2" class="gap">GAP · nessun punto disponibile</td></tr>`}</tbody></table></div>`;
}

function chartRange(chart) {
  const values = chart.points.filter((point) => validNumber(point.value)).map((point) => point.value);
  if (!values.length) return null;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (chart.type === "bar") {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    const padding = Math.abs(min) * 0.12 || 1;
    min -= padding;
    max += padding;
  }
  return { min, max };
}

function chartSvg(chart, index) {
  const range = chartRange(chart);
  const svgId = `analysis-chart-${safeId(chart.id, `item-${index + 1}`)}-${index + 1}`;
  const titleId = `${svgId}-title`;
  const descriptionId = `${svgId}-description`;
  const width = 760;
  const height = 300;
  const padding = { top: 25, right: 22, bottom: 52, left: 66 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = chart.points;
  const temporalValues = chart.type === "line" ? values.map((point) => parseDateLabel(point.label)) : [];
  const temporal = temporalValues.length > 1 && temporalValues.every((value) => value !== null) && new Set(temporalValues).size > 1;
  const temporalMin = temporal ? Math.min(...temporalValues) : 0;
  const temporalMax = temporal ? Math.max(...temporalValues) : 0;
  const slot = chart.type === "bar" && values.length ? plotWidth / values.length : 0;
  const barCenter = (pointIndex) => padding.left + slot * pointIndex + slot / 2;
  const valueX = (pointIndex) => {
    if (chart.type === "bar") return barCenter(pointIndex);
    if (temporal) return padding.left + ((temporalValues[pointIndex] - temporalMin) / (temporalMax - temporalMin)) * plotWidth;
    return padding.left + (values.length <= 1 ? plotWidth / 2 : (pointIndex / (values.length - 1)) * plotWidth);
  };
  const valueY = (value) => padding.top + ((range.max - value) / (range.max - range.min)) * plotHeight;
  const finiteCount = values.filter((point) => validNumber(point.value)).length;
  const rangeText = range ? `${formatValue(range.min, chart.unit)} – ${formatValue(range.max, chart.unit)}` : "nessun valore numerico";
  const sparseStep = Math.max(1, Math.ceil(values.length / 7));
  const labelIndexes = values
    .map((_, pointIndex) => pointIndex)
    .filter((pointIndex) => pointIndex % sparseStep === 0 || pointIndex === values.length - 1);
  const grid = range
    ? [0, 0.5, 1]
        .map((fraction) => {
          const y = padding.top + plotHeight * fraction;
          const value = range.max - (range.max - range.min) * fraction;
          return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="analysis-grid-line"/><text x="${padding.left - 9}" y="${y + 4}" text-anchor="end" class="analysis-axis-label">${escape(formatAxisValue(value))}</text>`;
        })
        .join("")
    : "";
  const xLabels = labelIndexes
    .map((pointIndex) => {
      const x = valueX(pointIndex);
      const label = values[pointIndex]?.label || "";
      return `<text x="${x}" y="${height - 17}" text-anchor="middle" class="analysis-x-label">${escape(label)}</text>`;
    })
    .join("");
  const verticalTicks = values
    .map((_, pointIndex) => `<line x1="${valueX(pointIndex)}" y1="${height - padding.bottom}" x2="${valueX(pointIndex)}" y2="${height - padding.bottom + 5}" class="analysis-tick"/>`)
    .join("");
  let marks = "";
  if (range) {
    if (chart.type === "line") {
      const segments = [];
      let current = [];
      values.forEach((point, pointIndex) => {
        if (validNumber(point.value)) current.push(`${valueX(pointIndex)},${valueY(point.value)}`);
        else if (current.length) {
          segments.push(current.join(" "));
          current = [];
        }
      });
      if (current.length) segments.push(current.join(" "));
      marks += segments
        .map((segment) => `<polyline points="${segment}" class="analysis-line" fill="none"/>`)
        .join("");
      marks += values
        .map((point, pointIndex) =>
          validNumber(point.value)
            ? `<circle cx="${valueX(pointIndex)}" cy="${valueY(point.value)}" r="4" class="analysis-point"><title>${escape(point.label || "Periodo non indicato")}: ${escape(formatValue(point.value, chart.unit))}</title></circle>`
            : "",
        )
        .join("");
    } else {
      const barSlot = values.length ? plotWidth / values.length : plotWidth;
      const barWidth = Math.max(3, Math.min(48, barSlot * 0.64));
      const zeroY = valueY(0);
      marks += values
        .map((point, pointIndex) => {
          if (!validNumber(point.value)) return "";
          const y = valueY(point.value);
          const x = padding.left + barSlot * pointIndex + (barSlot - barWidth) / 2;
          const barY = Math.min(y, zeroY);
          const barHeight = point.value === 0 ? 0 : Math.max(1, Math.abs(zeroY - y));
          return `<rect x="${x}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="3" class="analysis-bar"><title>${escape(point.label || "Periodo non indicato")}: ${escape(formatValue(point.value, chart.unit))}</title></rect>`;
        })
        .join("");
    }
  }
  const empty = !range
    ? `<div class="analysis-chart-gap" role="status">GAP · nessun valore numerico disponibile. Il dato mancante non viene trattato come zero.</div>`
    : finiteCount < values.length
      ? `<div class="analysis-chart-note">${values.length - finiteCount} periodo/i senza valore: mostrati come GAP, non come zero.</div>`
      : "";
  const axisDescription = chart.type === "line"
    ? temporal
      ? "Asse temporale proporzionale alle date presenti."
      : "Asse categoriale: l’ordine segue i punti ricevuti."
    : "Asse categoriale: l’ordine segue i punti ricevuti.";
  const description = `${chart.type === "line" ? "Grafico a linee" : "Grafico a barre"}. Unità: ${chart.unit || "non indicata"}. Intervallo visibile: ${rangeText}. ${axisDescription} ${finiteCount} valori numerici su ${values.length} punti. Serie ricevuta, non una previsione.`;
  return `<figure class="analysis-chart" data-chart-id="${escape(chart.id)}"><div class="analysis-chart-heading"><h3>${escape(chart.title)}</h3><div class="analysis-chart-meta">${chart.frequency ? `<span>Frequenza: ${escape(chart.frequency)}</span>` : ""}${chart.unit ? `<span>Unità: ${escape(chart.unit)}</span>` : ""}</div></div>${empty}<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId} ${descriptionId}"><title id="${titleId}">${escape(chart.title)}</title><desc id="${descriptionId}">${escape(description)}</desc><g aria-hidden="true">${grid}<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" class="analysis-axis"/>${verticalTicks}${marks}${xLabels}</g></svg><figcaption>${escape(description)}</figcaption>${pointsTable(chart)}${chart.notes.length ? `<div class="analysis-notes"><strong>Note del dossier</strong><ul>${chart.notes.map((note) => `<li>${escape(note)}</li>`).join("")}</ul></div>` : ""}<div class="analysis-chart-provenance"><strong>Fonti citate dal dossier</strong>${sourceLinks(chart, chart._sources || [])}</div></figure>`;
}

function itemList(items, emptyMessage, renderer) {
  return items.length
    ? `<ul class="analysis-item-list">${items.map(renderer).join("")}</ul>`
    : `<p class="analysis-empty-inline">${escape(emptyMessage)}</p>`;
}

function normalizeReasoning(body, graph) {
  const reasoning = body.graph?.reasoning && typeof body.graph.reasoning === "object" ? body.graph.reasoning : {};
  const supporting = list(reasoning.supporting)
    .filter((item) => item && typeof item === "object" && text(item.claim))
    .map((item) => ({ ...item, sourceIds: list(item.sourceIds).filter((id) => typeof id === "string") }));
  const opposing = list(reasoning.opposing)
    .filter((item) => item && typeof item === "object" && text(item.claim))
    .map((item) => ({ ...item, sourceIds: list(item.sourceIds).filter((id) => typeof id === "string") }));
  const assumptions = list(reasoning.assumptions).filter((item) => item && typeof item === "object" && text(item.claim));
  const scenarios = list(reasoning.scenarios).filter((item) => item && typeof item === "object" && text(item.name));
  const nextChecks = list(reasoning.nextChecks).filter((item) => item && typeof item === "object" && text(item.question));
  const limitations = list(reasoning.limitations).filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
  const uncertainties = list(graph.uncertainties).filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
  const fallbackFocus = graph.focus && typeof graph.focus === "object" ? graph.focus : {};
  const fallbackFinancial = graph.financial && typeof graph.financial === "object" ? graph.financial : {};
  const conclusion = text(reasoning.provisionalConclusion) || text(graph.summary) || text(fallbackFocus.claim) || text(fallbackFinancial.conclusion) || "Nessuna conclusione provvisoria disponibile.";
  return {
    question: text(reasoning.question) || text(body.input?.thesis) || "Quale conseguenza della tesi è davvero osservabile?",
    conclusion,
    supporting,
    opposing,
    assumptions: assumptions.length ? assumptions : uncertainties.map((claim) => ({ claim, howToTest: "Definire una misura e una fonte prima di trarre conclusioni." })),
    scenarios,
    nextChecks: nextChecks.length
      ? nextChecks
      : fallbackFocus.test
        ? [{ question: fallbackFocus.test, whyItMatters: fallbackFocus.why || "È il passaggio indicato come decisivo.", sourceHint: "Fonte da fissare." }]
        : [],
    limitations: limitations.length
      ? limitations
      : [
          "La mappa organizza ipotesi e verifiche; non dimostra da sola un nesso causale.",
          ...(fallbackFocus.assumption ? [`Assunzione da verificare: ${fallbackFocus.assumption}`] : []),
        ],
  };
}

function normalizeEvidenceAudit(body) {
  const audit = body.evidenceAudit;
  if (!audit || typeof audit !== "object" || audit.version !== EVIDENCE_AUDIT_VERSION) {
    return { available: false, counts: {}, claims: [], sources: [], warnings: [] };
  }
  const rawCounts = audit.counts && typeof audit.counts === "object" ? audit.counts : {};
  const counts = Object.fromEntries(
    ["retrieved", "read", "discovery", "cited", "uncitedClaims", "unresolvedClaims"].map((key) => [
      key,
      Number.isInteger(rawCounts[key]) && rawCounts[key] >= 0 ? rawCounts[key] : 0,
    ]),
  );
  const claims = list(audit.claims)
    .filter((claim) => claim && typeof claim === "object")
    .slice(0, 80)
    .map((claim) => ({
      id: text(claim.id),
      side: claim.side === "opposing" ? "opposing" : "supporting",
      claim: text(claim.claim),
      sourceIds: list(claim.sourceIds).filter((id) => typeof id === "string").slice(0, 8),
      validSourceIds: list(claim.validSourceIds).filter((id) => typeof id === "string").slice(0, 8),
      citationState: ["cited", "uncited", "unresolved"].includes(claim.citationState) ? claim.citationState : "unresolved",
      issues: list(claim.issues).filter((issue) => typeof issue === "string" && issue.trim()).map((issue) => issue.trim().slice(0, 240)).slice(0, 5),
    }));
  const sources = list(audit.sources)
    .filter((source) => source && typeof source === "object")
    .slice(0, 20)
    .map((source) => ({
      id: text(source.id),
      citationCount: Number.isInteger(source.citationCount) && source.citationCount >= 0 ? source.citationCount : 0,
      kind: text(source.kind),
      available: source.available === true,
    }));
  const warnings = list(audit.warnings)
    .filter((warning) => typeof warning === "string" && warning.trim())
    .map((warning) => warning.trim().slice(0, 400))
    .slice(0, 12);
  return { available: true, counts, claims, sources, warnings };
}

function evidenceAuditMarkup(body) {
  const audit = normalizeEvidenceAudit(body);
  if (!audit.available) {
    return `<section class="analysis-section analysis-evidence-audit"><span class="eyebrow">COPERTURA DELLE EVIDENZE</span><h2>Che cosa è stato letto</h2><p class="analysis-audit-unavailable">Report di copertura non disponibile per questo record precedente.</p></section>`;
  }
  const { counts } = audit;
  const facts = [
    ["Fonti recuperate", counts.retrieved],
    ["Fonti lette", counts.read],
    ["Risultati solo elenco", counts.discovery],
    ["Fonti citate", counts.cited],
    ["Ipotesi senza citazione", counts.uncitedClaims],
    ["Riferimenti irrisolti", counts.unresolvedClaims],
  ];
  const uncited = audit.claims.filter((claim) => claim.citationState === "uncited");
  const unresolved = audit.claims.filter((claim) => claim.citationState === "unresolved" || claim.issues.length || claim.sourceIds.some((id) => !claim.validSourceIds.includes(id)));
  const unavailable = audit.sources.filter((source) => source.id && !source.available);
  const unavailableListing = unavailable.filter((source) => source.kind === "discovery");
  const unavailableOther = unavailable.filter((source) => source.kind !== "discovery");
  const availabilityText = [
    unavailableListing.length ? `Non citabili come evidenza (solo elenco): ${unavailableListing.map((source) => source.id).join(", ")}.` : "",
    unavailableOther.length ? `Fonti non disponibili: ${unavailableOther.map((source) => source.id).join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  return `<section class="analysis-section analysis-evidence-audit"><span class="eyebrow">COPERTURA DELLE EVIDENZE</span><h2>Che cosa è stato letto</h2><div class="analysis-audit-grid">${facts.map(([label, value]) => `<div><strong>${escape(String(value))}</strong><span>${escape(label)}</span></div>`).join("")}</div><p class="muted">Le fonti lette e quelle citate sono conteggi tecnici: la disponibilità non dimostra la correttezza della tesi.</p>${uncited.length ? `<h3>Ipotesi senza citazione</h3><ul class="analysis-audit-list">${uncited.slice(0, 8).map((claim) => `<li>${escape(claim.claim || claim.id || "Ipotesi non descritta")}</li>`).join("")}</ul>` : ""}${unresolved.length ? `<h3>Riferimenti da risolvere</h3><ul class="analysis-audit-list">${unresolved.slice(0, 8).map((claim) => `<li>${escape(claim.claim || claim.id || "Riferimento non risolto")}${claim.issues.length ? `<small>${escape(claim.issues.join(" · "))}</small>` : ""}</li>`).join("")}</ul>` : ""}${availabilityText ? `<p class="muted">${escape(availabilityText)}</p>` : ""}${audit.warnings.length ? `<div class="analysis-audit-warnings"><strong>Avvertenze del report</strong><ul>${audit.warnings.map((warning) => `<li>${escape(warning)}</li>`).join("")}</ul></div>` : ""}</section>`;
}

function investigationQuestion(item, kind) {
  const value = kind === "assumption" ? text(item?.howToTest) || text(item?.claim) : text(item?.question);
  return value.slice(0, 900);
}

function investigationButton(kind, index, label) {
  return `<button type="button" class="analysis-investigate" data-investigate-kind="${escape(kind)}" data-investigate-index="${index}">${escape(label)} →</button>`;
}

function thesisFrom(body, graph) {
  const thesis = text(body.input?.thesis);
  if (thesis) return thesis;
  const node = list(graph.nodes).find((item) => item && item.kind === "thesis");
  return text(node?.label) || "Tesi originale non disponibile.";
}

function deepeningMarkup(body) {
  const effort = text(body.input?.effort).toLowerCase();
  const status = text(body.provenance?.deepening?.status);
  const reason = text(body.provenance?.deepening?.reason);
  const statusLabel = {
    complete: "Approfondimento completato",
    skipped: "Approfondimento non richiesto",
    unavailable: "Approfondimento non disponibile",
  }[status];
  const title = statusLabel || `Effort ${effortLabels[effort] || "non indicato"}`;
  return `<section class="analysis-deepening"><span class="eyebrow">PROFONDITÀ DELL’ESPLORAZIONE</span><strong>${escape(title)}</strong>${effortGuidance[effort] ? `<p>${escape(effortGuidance[effort])}</p>` : ""}${reason ? `<small>${escape(reason)}</small>` : ""}<small>L’effort orienta il lavoro del dossier e non garantisce accuratezza o validità scientifica.</small></section>`;
}

function sourceSummary(sources) {
  const usefulSources = sources.filter((source) => source.kind !== "discovery");
  if (!usefulSources.length) {
    const detail = sources.length ? "Sono presenti solo risultati di ricerca, non fonti recuperate utilizzabili come evidenza." : "Questa analisi non contiene fonti recuperate nel dossier.";
    return `<div class="analysis-notice analysis-warning"><strong>Fonti o dati mancanti.</strong><p>${escape(detail)} Le conclusioni restano ipotesi da verificare.</p>${sources.length ? sourceLinks({ sourceIds: sources.map((source) => source.id) }, sources) : ""}</div>`;
  }
  return `<div class="analysis-notice"><strong>Fonti citate, causalità non dimostrata.</strong><p>${usefulSources.length} ${usefulSources.length === 1 ? "fonte recuperata" : "fonti recuperate"} presenti nel dossier. Sono riferimenti del modello: la loro citazione non dimostra pertinenza o nesso causale.</p>${sourceLinks({ sourceIds: sources.map((source) => source.id) }, sources)}</div>`;
}

function plannerNotesOf(body) {
  const notes = [];
  const add = (candidate) => {
    if (!Array.isArray(candidate)) return;
    candidate.forEach((note) => {
      if (typeof note === "string" && note.trim()) notes.push(note.trim().slice(0, 1000));
    });
  };
  add(body?.plannerNotes);
  add(body?.research?.plannerNotes);
  add(body?.evidence?.plannerNotes);
  return [...new Set(notes)].slice(0, 8);
}

function plannerNotesMarkup(body) {
  const notes = plannerNotesOf(body);
  if (!notes.length) return "";
  return `<section class="analysis-section analysis-planner-notes"><span class="eyebrow">LIMITI PROPOSTI DAL MODELLO · NON VERIFICATI</span><details><summary>Limiti proposti dal modello · non verificati (${notes.length})</summary><p class="muted">Note prodotte durante la ricerca: possono essere superate dalle letture successive. Non sono dati o fonti, non dimostrano la tesi e non sostituiscono una verifica.</p><ul class="analysis-item-list">${notes.map((note) => `<li>${escape(note)}</li>`).join("")}</ul></details></section>`;
}

function financialMarkup(graph) {
  const financial = graph.financial && typeof graph.financial === "object" ? graph.financial : null;
  if (!financial) return "";
  const calculations = list(financial.calculations).filter(
    (calculation) =>
      calculation &&
      typeof calculation === "object" &&
      calculation.arithmeticValid === true &&
      validNumber(calculation.result),
  );
  const assumptions = list(financial.assumptions)
    .map((assumption) => {
      if (typeof assumption === "string") return assumption.trim();
      return text(assumption?.claim);
    })
    .filter(Boolean);
  if (!text(financial.conclusion) && !calculations.length && !assumptions.length) return "";
  return `<section class="analysis-section analysis-financial"><span class="eyebrow">CALCOLI E ASSUNZIONI</span><h2>Che cosa segue dai numeri</h2>${financial.conclusion ? `<p>${escape(financial.conclusion)}</p>` : ""}${calculations.length ? `<div class="analysis-calculations">${calculations.map((calculation) => `<article><strong>${escape(text(calculation.label) || "Calcolo verificato")}</strong><p>${escape(text(calculation.expression) || "Espressione non indicata")} = <b>${escape(formatValue(calculation.result, text(calculation.unit)))}</b></p><small>Base: ${escape(text(calculation.basis) || "Non indicata")}</small></article>`).join("")}</div>` : `<p class="analysis-empty-inline">Nessun calcolo numerico convalidato nel dossier.</p>`}${assumptions.length ? `<h3>Assunzioni numeriche</h3><ul class="analysis-item-list">${assumptions.map((assumption) => `<li>${escape(assumption)}</li>`).join("")}</ul>` : ""}${financial.limitation ? `<p class="muted">Limite: ${escape(financial.limitation)}</p>` : ""}<p class="muted">Sono mostrati solo risultati marcati come aritmeticamente validi; la scelta della formula e il nesso causale restano da verificare.</p></section>`;
}

export function renderAnalysisView(container, record, options = {}) {
  if (!container) return;
  const onInvestigate = typeof options?.onInvestigate === "function" ? options.onInvestigate : null;
  const body = bodyOf(record);
  const graph = graphOf(body);
  const charts = normalizeCharts(record);
  const sources = sourceList(body);
  const reasoning = normalizeReasoning(body, graph);
  const thesis = thesisFrom(body, graph);
  const sourceBy = sourceById(sources);
  const reasoningSourceIds = [...reasoning.supporting, ...reasoning.opposing].flatMap((item) =>
    list(item.sourceIds).filter((id) => typeof id === "string" && /^R[1-6]$/.test(id)),
  );
  const evidenceIds = new Set([...charts.flatMap((chart) => chart.sourceIds), ...reasoningSourceIds]);
  const citedSources = [...evidenceIds].filter((id) => sourceBy.has(id));
  const title = text(graph.title) || "Analisi e grafici";
  const financial = financialMarkup(graph);
  const allSourceIds = charts.flatMap((chart) => chart.sourceIds);
  const missingSourceRefs = [...new Set([...allSourceIds, ...reasoningSourceIds])].filter((id) => !sourceBy.has(id));
  const usefulSources = sources.filter((source) => source.kind !== "discovery");
  const missingData = charts.some((chart) => !chart.points.some((point) => validNumber(point.value))) || !usefulSources.length;
  const chartMarkup = charts.map((chart, index) => chartSvg({ ...chart, _sources: sources }, index)).join("");
  const investigationItems = [
    ...reasoning.assumptions.map((item, index) => ({ kind: "assumption", index, item })),
    ...reasoning.nextChecks.map((item, index) => ({ kind: "nextCheck", index, item })),
  ];
  container.innerHTML = `<div class="analysis-view" data-chart-version="${CHARTS_VERSION}"><div class="analysis-view-header"><div><span class="eyebrow">DOSSIER · ANALISI E GRAFICI</span><h1>${escape(title)}</h1><p class="analysis-lede">Una lettura strutturata della tesi, dei dati presenti e di ciò che resta da verificare.</p></div>${deepeningMarkup(body)}</div><section class="analysis-thesis"><span class="eyebrow">TESI ORIGINALE</span><blockquote>${escape(thesis)}</blockquote><p><span class="badge">Ipotesi non verificata</span> La tesi è il punto di partenza del dossier, non un risultato già dimostrato.</p></section>${sourceSummary(sources)}${plannerNotesMarkup(body)}${evidenceAuditMarkup(body)}<section class="analysis-section"><span class="eyebrow">RAGIONAMENTO</span><h2>Che cosa stiamo valutando</h2><p class="analysis-question">${escape(reasoning.question)}</p><h3>Conclusione provvisoria</h3><div class="analysis-conclusion">${escape(reasoning.conclusion)}</div><p class="muted">Conclusione provvisoria: va distinta da una prova e può cambiare con dati migliori.</p></section>${financial}<div class="analysis-columns"><section class="analysis-section"><span class="eyebrow">A FAVORE</span><h2>Elementi di sostegno</h2>${itemList(reasoning.supporting, "Nessun elemento a favore è stato fornito dal dossier.", (item) => `<li><strong>${escape(item.claim)}</strong>${item.sourceIds?.length ? `<small>Fonti citate: ${sourceRefMarkup(item.sourceIds, sources)}</small>` : ""}</li>`)}</section><section class="analysis-section"><span class="eyebrow">CONTRO</span><h2>Obiezioni e confronto</h2>${itemList(reasoning.opposing, "Nessuna obiezione esplicita nel dossier: l’assenza non equivale a conferma.", (item) => `<li><strong>${escape(item.claim)}</strong>${item.sourceIds?.length ? `<small>Fonti citate: ${sourceRefMarkup(item.sourceIds, sources)}</small>` : ""}</li>`)}</section></div><section class="analysis-section"><span class="eyebrow">ASSUNZIONI</span><h2>Che cosa deve essere vero</h2>${itemList(reasoning.assumptions, "Nessuna assunzione esplicita; chiarirle è il prossimo controllo.", (item, index) => `<li><strong>${escape(item.claim)}</strong>${item.howToTest ? `<span>Come testarla: ${escape(item.howToTest)}</span>${investigationButton("assumption", index, "Prepara questa verifica")}` : ""}</li>`)}</section>${reasoning.scenarios.length ? `<section class="analysis-section"><span class="eyebrow">SCENARI</span><h2>Meccanismi alternativi</h2><div class="analysis-scenario-grid">${reasoning.scenarios.map((item) => `<article><h3>${escape(item.name)}</h3>${item.mechanism ? `<p><strong>Meccanismo</strong><br>${escape(item.mechanism)}</p>` : ""}${item.observableDifference ? `<p><strong>Differenza osservabile</strong><br>${escape(item.observableDifference)}</p>` : ""}</article>`).join("")}</div></section>` : ""}<section class="analysis-section"><span class="eyebrow">PROSSIMI CONTROLLI</span><h2>Che cosa verificare ora</h2>${itemList(reasoning.nextChecks, "Nessun controllo successivo esplicito; definisci una misura e una fonte.", (item, index) => `<li><strong>${escape(item.question)}</strong>${item.whyItMatters ? `<span>Perché conta: ${escape(item.whyItMatters)}</span>` : ""}${item.sourceHint ? `<small>Fonte suggerita: ${escape(item.sourceHint)}</small>` : ""}${investigationButton("nextCheck", index, "Prepara questo controllo")}</li>`)}</section><section class="analysis-section"><span class="eyebrow">LIMITI</span><h2>Che cosa il dossier non può concludere</h2><ul class="analysis-item-list">${reasoning.limitations.map((item) => `<li>${escape(item)}</li>`).join("")}</ul></section><section class="analysis-section analysis-charts-section"><div class="analysis-section-heading"><div><span class="eyebrow">DATI</span><h2>Grafici disponibili</h2></div><span class="badge">${charts.length} ${charts.length === 1 ? "serie" : "serie"}</span></div>${charts.length ? chartMarkup : `<div class="analysis-empty-chart"><h3>Nessun grafico disponibile</h3><p>Nessuna serie numerica sufficiente nelle fonti recuperate. Non vengono inventati grafici da nodi, voti o probabilità.</p></div>`}</section>${citedSources.length ? `<section class="analysis-section"><span class="eyebrow">PROVENIENZA</span><h2>Fonti citate nel dossier</h2><p class="muted">Riferimenti citati dal modello; non certificano il nesso causale.</p>${sourceLinks({ sourceIds: citedSources }, sources)}</section>` : ""}${sourceCardsMarkup(sources)}${missingSourceRefs.length ? `<div class="analysis-notice analysis-warning"><strong>Riferimenti non disponibili.</strong><p>Il dossier cita ${escape(missingSourceRefs.join(", "))}, ma la fonte corrispondente non è presente nei dati ricevuti.</p></div>` : ""}${missingData ? `<div class="analysis-notice analysis-warning"><strong>Copertura incompleta.</strong><p>I GAP indicano periodi senza valore. Un dato mancante non viene trasformato in zero e non sostiene una conclusione.</p></div>` : ""}</div>`;
  if (container.__nessoAnalysisInvestigationCleanup) container.__nessoAnalysisInvestigationCleanup();
  if (typeof container.addEventListener === "function" && typeof onInvestigate === "function") {
    const handler = (event) => {
      const button = event.target?.closest?.("[data-investigate-kind][data-investigate-index]");
      if (!button || !container.contains?.(button)) return;
      const kind = button.dataset.investigateKind;
      const index = Number(button.dataset.investigateIndex);
      const entry = investigationItems.find((item) => item.kind === kind && item.index === index);
      if (!entry) return;
      const question = investigationQuestion(entry.item, kind);
      if (!question) return;
      onInvestigate({ kind, question, thesis, context: text(body.input?.context), record });
    };
    container.addEventListener("click", handler);
    container.__nessoAnalysisInvestigationCleanup = () => container.removeEventListener("click", handler);
  }
}
