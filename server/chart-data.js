const MAX_CHARTS = 6;
const MAX_POINTS = 120;
const MIN_POINTS = 2;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, max = 240) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function finiteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const valueText = value.trim();
  if (!valueText || valueText === ".") return null;
  const number = Number(valueText);
  return Number.isFinite(number) ? number : null;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function utcMillis(year, monthIndex, day) {
  // Date.UTC remaps years 0-99 to 1900-1999. setUTCFullYear keeps the
  // four-digit source year intact while still giving us UTC day arithmetic.
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function calendarDate(value) {
  const valueText = typeof value === "string"
    ? value.trim()
    : Number.isInteger(value) && value >= 1000 && value <= 9999
      ? String(value)
      : "";
  if (/^\d{4}$/.test(valueText)) return valueText === "0000" ? null : { label: valueText, key: valueText };
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(valueText);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] === undefined ? null : Number(match[3]);
  // The source adapters expose proleptic Gregorian calendar dates. Year 0000
  // is not a source date, so reject it before validation.
  if (year < 1) return null;
  if (month < 1 || month > 12) return null;
  if (day !== null) {
    const lastDay = new Date(utcMillis(year, month, 0)).getUTCDate();
    if (day < 1 || day > lastDay) return null;
  }
  return { label: valueText, key: valueText };
}

function sourceId(source) {
  const id = text(source?.id, 20);
  return /^R[1-6]$/.test(id) ? id : null;
}

function sourceList(evidence) {
  if (Array.isArray(evidence)) return evidence;
  return Array.isArray(evidence?.sources) ? evidence.sources : [];
}

function simpleRows(observations) {
  if (!Array.isArray(observations)) return [];
  const rows = [];
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    if (!isRecord(observation)) continue;
    const date = calendarDate(observation.date ?? observation.period ?? observation.label);
    if (!date) continue;
    rows.push({ key: date.key, label: date.label, value: finiteNumber(observation.value), index });
  }
  return dedupeSimpleRows(rows);
}

function dedupeSimpleRows(rows) {
  const byDate = new Map();
  for (const row of rows) {
    // Keep the first occurrence exactly as supplied by the source. In particular,
    // a source-provided null is not silently replaced by a later guess.
    if (!byDate.has(row.key)) byDate.set(row.key, row);
  }
  return [...byDate.values()].sort((left, right) => compareText(left.key, right.key) || left.index - right.index);
}

function durationDays(start, end) {
  if (!start || !end || start.key.length !== 10 || end.key.length !== 10) return null;
  const startParts = start.key.split("-").map(Number);
  const endParts = end.key.split("-").map(Number);
  const startTime = utcMillis(startParts[0], startParts[1] - 1, startParts[2]);
  const endTime = utcMillis(endParts[0], endParts[1] - 1, endParts[2]);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return null;
  return Math.floor((endTime - startTime) / 86400000) + 1;
}

function secFrequency(days) {
  if (!Number.isFinite(days)) return null;
  // Keep SEC period classes deliberately narrow. A duration that is merely
  // close to a quarter (for example 140 days) is not safely comparable to a
  // quarterly filing and must not be labelled as one.
  if (days >= 350 && days <= 380) return "annual";
  if (days >= 260 && days <= 290) return "nine-month";
  if (days >= 170 && days <= 195) return "semiannual";
  if (days >= 80 && days <= 100) return "quarterly";
  if (days >= 25 && days <= 35) return "monthly";
  if (days >= 6 && days <= 8) return "weekly";
  if (days >= 1 && days <= 2) return "daily";
  return null;
}

function secPeriod(row) {
  if (!isRecord(row)) return null;
  const end = calendarDate(row.end ?? row.instant ?? row.date);
  if (!end) return null;
  const hasStart = row.start !== undefined && row.start !== null && String(row.start).trim() !== "";
  if (!hasStart) return { kind: "instant", frequency: "instant", start: null, end, days: null };
  const start = calendarDate(row.start);
  const days = durationDays(start, end);
  const frequency = secFrequency(days);
  if (!start || !frequency) return null;
  return { kind: "duration", frequency, start, end, days };
}

function median(values) {
  const ordered = values.filter(Number.isFinite).slice().sort((left, right) => left - right);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function filedKey(row) {
  return calendarDate(row.filed)?.key || null;
}

function isNewerFiling(row, previous) {
  // A missing or malformed filing date carries no ordering information. Keep
  // the first row in that case (the SEC adapter already returns rows in filing
  // order) instead of silently replacing it with an arbitrary later row.
  if (!row.filed || !previous.filed) return Boolean(row.filed && !previous.filed);
  return row.filed > previous.filed || (row.filed === previous.filed && row.index > previous.index);
}

function secRows(rows) {
  const groups = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const period = secPeriod(row);
    if (!period) continue;
    const key = `${period.kind}:${period.frequency}`;
    if (!groups.has(key)) groups.set(key, { kind: period.kind, frequency: period.frequency, rows: [] });
    groups.get(key).rows.push({
      key: period.end.key,
      label: period.end.label,
      // SEC's canonical field is `val`. If it is present but null, preserve
      // that missing observation rather than filling it from a non-canonical
      // alias that may describe a different value.
      value: finiteNumber(row.val !== undefined ? row.val : row.value),
      start: period.start,
      days: period.days,
      filed: filedKey(row),
      index,
    });
  }

  return [...groups.values()]
    .sort((left, right) => compareText(`${left.kind}:${left.frequency}`, `${right.kind}:${right.frequency}`))
    .map((group) => {
      const dayValues = group.rows.map((row) => row.days).filter(Number.isFinite);
      const typicalDays = median(dayValues);
      // SEC fiscal years can be 364, 365 or 366 days and quarters can differ
      // by a few days. Reject outliers instead of mixing unlike periods.
      const tolerance = typicalDays === null ? 0 : Math.max(3, Math.ceil(typicalDays * 0.04));
      const comparable = typicalDays === null
        ? group.rows
        : group.rows.filter((row) => Math.abs(row.days - typicalDays) <= tolerance);
      const startsByEnd = new Map();
      for (const row of comparable) {
        if (!startsByEnd.has(row.key)) startsByEnd.set(row.key, new Set());
        startsByEnd.get(row.key).add(row.start?.key || "");
      }
      const ambiguousEnds = new Set(
        [...startsByEnd.entries()]
          .filter(([, starts]) => starts.size > 1)
          .map(([end]) => end),
      );
      const byPeriod = new Map();
      for (const row of comparable) {
        // If the same end date has different starts, retaining one would make
        // a silent choice between unlike periods. Drop every variant instead.
        if (ambiguousEnds.has(row.key)) continue;
        const periodKey = `${row.key}|${row.start?.key || ""}`;
        const previous = byPeriod.get(periodKey);
        if (!previous || isNewerFiling(row, previous)) {
          byPeriod.set(periodKey, row);
        }
      }
      const rowsForChart = [...byPeriod.values()].sort((left, right) => compareText(left.key, right.key) || left.index - right.index);
      return {
        ...group,
        rows: rowsForChart,
        rawCount: group.rows.length,
        comparableCount: comparable.length,
        typicalDays,
        outlierCount: group.rows.length - comparable.length,
        duplicateCount: comparable.filter((row) => !ambiguousEnds.has(row.key)).length - rowsForChart.length,
        ambiguousCount: ambiguousEnds.size,
      };
    });
}

function slug(value) {
  const result = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return result || "series";
}

function chartId(id, ...parts) {
  return `chart-${id.toLowerCase()}-${slug(parts.filter(Boolean).join("-"))}`;
}

function candidate({ id, sourceId: provenanceId, title, type, unit, frequency, points, sampleNote, extraNotes = [] }) {
  if (!Array.isArray(points)) return null;
  const ordered = points
    .filter((point) => point && typeof point.label === "string" && point.label)
    .map((point) => ({ label: point.label, value: finiteNumber(point.value) }))
    .sort((left, right) => compareText(left.label, right.label));
  if (ordered.length < MIN_POINTS) return null;
  const limited = ordered.length > MAX_POINTS ? ordered.slice(-MAX_POINTS) : ordered;
  const numericCount = limited.filter((point) => point.value !== null).length;
  if (limited.length < MIN_POINTS || numericCount < MIN_POINTS) return null;
  const missingCount = limited.filter((point) => point.value === null).length;
  const notes = [
    text(sampleNote, 500) || `Campione: ${ordered.length} osservazioni autentiche restituite dalla fonte.`,
    ...extraNotes.map((note) => text(note, 500)).filter(Boolean),
    `Periodi: ${limited[0].label} → ${limited[limited.length - 1].label}; punti ordinati cronologicamente.`,
    `Unità: ${text(unit, 160) || "non specificata"}; frequenza: ${text(frequency, 80) || "non specificata"}.`,
    missingCount
      ? `Valori mancanti: ${missingCount}; mantenuti come null. Nessuna interpolazione o riempimento.`
      : "Valori mancanti: nessuno nella finestra mostrata; nessuna interpolazione o riempimento.",
  ];
  if (ordered.length > MAX_POINTS) {
    notes.unshift(`La fonte contiene ${ordered.length} punti; mostrati gli ultimi ${MAX_POINTS} per rispettare il limite del grafico.`);
  }
  return {
    id,
    title: text(title, 300) || id,
    type: type === "bar" ? "bar" : "line",
    unit: text(unit, 160),
    frequency: text(frequency, 80),
    points: limited,
    sourceIds: [provenanceId].filter((value) => typeof value === "string" && value),
    notes,
  };
}

function sourceNotes(source) {
  const values = [source?.caveat, source?.data?.caveat]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => `Nota della fonte: ${value.trim()}`);
  return [...new Set(values)].map((value) => text(value, 700));
}

function sourceCandidate(source, id) {
  if (!isRecord(source) || source.kind === "discovery" || !isRecord(source.data)) return [];
  const provider = text(source.provider, 40).toLowerCase();
  const data = source.data;

  if (provider === "fred") {
    const unit = text(data.units);
    const frequency = text(data.frequency);
    const observations = Array.isArray(data.observations) ? data.observations : [];
    if (!unit || !frequency) return [];
    const points = simpleRows(observations).map(({ label, value }) => ({ label, value }));
    const seasonalAdjustment = text(data.seasonalAdjustment || data.seasonal_adjustment, 180);
    const lastUpdated = text(data.lastUpdated || data.last_updated, 180);
    const extraNotes = [
      ...sourceNotes(source),
      seasonalAdjustment ? `Aggiustamento stagionale dichiarato: ${seasonalAdjustment}.` : "Aggiustamento stagionale: non specificato dalla fonte.",
      lastUpdated
        ? `Ultimo aggiornamento dichiarato dalla fonte: ${lastUpdated}; le osservazioni possono essere riviste.`
        : "La serie FRED può essere soggetta a revisioni; la risposta è una finestra della vintage corrente.",
    ];
    const item = candidate({
      id: chartId(id, "fred", data.id || source.title || "series"),
      sourceId: id,
      title: text(source.title) || text(data.title) || `FRED · ${text(data.id) || "serie"}`,
      type: "line",
      unit,
      frequency,
      points,
      sampleNote: `Campione FRED: ${observations.length} osservazioni nella finestra restituita; non è una serie storica completa.`,
      extraNotes,
    });
    return item ? [item] : [];
  }

  if (provider === "worldbank") {
    const unit = text(data.unit);
    const frequency = text(data.frequency);
    const observations = Array.isArray(data.observations) ? data.observations : [];
    if (!unit || !frequency) return [];
    const points = simpleRows(observations).map(({ label, value }) => ({ label, value }));
    const definition = text(data.definition, 700);
    const unitPlaceholder = /^vedi definizione/i.test(unit);
    const extraNotes = [
      ...sourceNotes(source),
      definition ? `Definizione World Bank: ${definition}` : "Definizione World Bank: non presente nella risposta.",
      unitPlaceholder
        ? "L'unità è un placeholder della fonte (vedi definizione dell'indicatore), non una conversione applicata dal grafico."
        : "Unità mantenuta esattamente come restituita dalla definizione dell'indicatore.",
    ];
    const item = candidate({
      id: chartId(id, "worldbank", data.country || "country", data.indicator || "indicator"),
      sourceId: id,
      title: text(source.title) || `${text(data.name) || text(data.indicator) || "World Bank"}${text(data.country) ? ` · ${text(data.country)}` : ""}`,
      type: "line",
      unit,
      frequency,
      points,
      sampleNote: `Campione World Bank: ${observations.length} osservazioni ${frequency.toLowerCase()} nella finestra restituita; dati soggetti a revisioni.`,
      extraNotes,
    });
    return item ? [item] : [];
  }

  if (provider !== "sec" || !isRecord(data.units)) return [];
  const baseTitle = text(source.title) || `SEC XBRL · ${text(data.tag) || "concept"}`;
  const result = [];
  for (const [rawUnit, rawRows] of Object.entries(data.units).sort(([left], [right]) => compareText(left, right))) {
    const unit = text(rawUnit, 160);
    if (!unit || !Array.isArray(rawRows)) continue;
    for (const group of secRows(rawRows)) {
      const points = group.rows.map(({ label, value }) => ({ label, value }));
      const duplicateCount = group.duplicateCount;
      const extraNotes = [
        ...sourceNotes(source),
        `Campione SEC XBRL del concept ${text(data.tag) || "non indicato"}; ${group.rawCount} righe candidate, ${group.rows.length} periodi confrontabili.`,
        group.kind === "instant"
          ? "Periodi: osservazioni istantanee alla data di fine; non sono durate di esercizio."
          : `Periodi: durate classificate come ${group.frequency}${group.typicalDays ? ` (circa ${Math.round(group.typicalDays)} giorni)` : ""}; durate diverse non sono state mescolate.`,
        group.outlierCount
          ? `${group.outlierCount} riga/e con durata fuori dalla classe ${group.frequency} sono state scartate; nessun periodo è stato ricostruito.`
          : "Nessuna durata fuori dalla classe del periodo è stata inclusa.",
        group.ambiguousCount
          ? `${group.ambiguousCount} data/e finali con start diversi sono state scartate interamente: il grafico non sceglie tra periodi ambigui.`
          : "Nessuna ambiguità start/end rilevata.",
        duplicateCount
          ? `${duplicateCount} revisione/i con lo stesso periodo esatto sono state ridotte alla filing più recente disponibile.`
          : "Nessuna revisione duplicata dello stesso periodo esatto.",
      ];
      const item = candidate({
        id: chartId(id, "sec", data.tag || "concept", unit, group.frequency),
        sourceId: id,
        title: `${baseTitle} · ${unit} · ${group.frequency}`,
        type: "bar",
        unit,
        frequency: group.frequency,
        points,
        sampleNote: `Campione SEC XBRL: ${group.rows.length} punti numerici o mancanti per l'unità ${unit}.`,
        extraNotes,
      });
      if (item) result.push(item);
    }
  }
  return result;
}

/**
 * Build deterministic, single-series chart data from already retrieved evidence.
 * This function never fetches data, derives values, interpolates gaps, or uses URLs.
 */
export function buildCharts(evidence) {
  const items = [];
  const sources = sourceList(evidence);
  const totals = new Map();
  for (const source of sources) {
    const id = sourceId(source);
    if (id) totals.set(id, (totals.get(id) || 0) + 1);
  }
  for (const source of sources) {
    const id = sourceId(source);
    // A citation must resolve to exactly one original source. Separate chart
    // IDs cannot disambiguate two documents both cited as R1 in the UI.
    if (!id || totals.get(id) !== 1) continue;
    items.push(...sourceCandidate(source, id));
    if (items.length >= MAX_CHARTS) break;
  }
  return { version: "nesso-charts-v1", items: items.slice(0, MAX_CHARTS) };
}
