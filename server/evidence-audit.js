const VERSION = 'nesso-evidence-audit-v1';
const SOURCE_ID = /^R[1-6]$/;
const MAX_CLAIMS = 100;
const MAX_SOURCES = 100;
const MAX_REFS = 20;
const MAX_WARNINGS = 50;
const MAX_TEXT = 2000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clean(value, limit = MAX_TEXT) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}

function addUnique(list, value, limit) {
  if (value && !list.includes(value) && list.length < limit) list.push(value);
}

function warningsFrom(value) {
  const warnings = [];
  if (!Array.isArray(value)) return warnings;
  for (const item of value) addUnique(warnings, clean(item, 400), MAX_WARNINGS);
  return warnings;
}

function hasFredObservations(data) {
  if (!isRecord(data) || !Array.isArray(data.observations)) return false;
  // A row with a null value preserves a missing observation, but a payload
  // containing only missing rows has no original numeric data to read.
  return data.observations.some((item) => isRecord(item)
    && clean(item.date, 32)
    && typeof item.value === 'number' && Number.isFinite(item.value));
}

function hasSecUnits(data) {
  if (!isRecord(data) || !isRecord(data.units)) return false;
  return Object.values(data.units).some((values) => Array.isArray(values)
    && values.some((item) => isRecord(item)
      && typeof item.val === 'number' && Number.isFinite(item.val)));
}

function hasDataPayload(data) {
  return hasFredObservations(data) || hasSecUnits(data);
}

function hasDocumentPayload(data) {
  if (typeof data === 'string') return data.trim().length > 0;
  if (!isRecord(data)) return false;
  if (Array.isArray(data.excerpts) && data.excerpts.some((item) => isRecord(item)
    && clean(item.text) && Number.isFinite(item.offset))) return true;
  // Form 4 records can have no transactions while still being readable when
  // their issuer, owners, footnotes, or remarks are present.
  return ['4', '4/A'].includes(data.form) && ['issuer', 'owners', 'transactions', 'footnotes', 'remarks'].some((key) => {
    const value = data[key];
    return (typeof value === 'string' && value.trim().length > 0)
      || (isRecord(value) && Object.keys(value).length > 0)
      || (Array.isArray(value) && value.length > 0);
  });
}

function hasDiscoveryPayload(data) {
  if (typeof data === 'string') return data.trim().length > 0;
  if (Array.isArray(data)) return data.length > 0;
  return isRecord(data) && Object.keys(data).length > 0;
}

function sourceReadable(source, kind) {
  const data = kind === 'data' ? hasDataPayload(source.data)
    : (kind === 'document' ? hasDocumentPayload(source.data) : kind === 'discovery' && hasDiscoveryPayload(source.data));
  if (!data || !isRecord(source)) return { data: false, read: false };
  if (source.available === false || source.read === false || source.readSuccess === false || source.readable === false) {
    return { data: true, read: false };
  }
  if (['failed', 'error'].includes(source.readStatus) || ['failed', 'error'].includes(source.status)) {
    return { data: true, read: false };
  }
  const explicitSuccess = source.read === true || source.readSuccess === true || source.readable === true
    || ['read', 'success', 'ok'].includes(source.readStatus)
    || ['read', 'success', 'ok'].includes(source.status);
  const noMarker = source.read === undefined && source.readSuccess === undefined
    && source.readable === undefined && source.readStatus === undefined && source.status === undefined;
  return { data: true, read: explicitSuccess || noMarker };
}

function sourceInfo(evidence) {
  const values = isRecord(evidence) && Array.isArray(evidence.sources)
    ? evidence.sources.slice(0, MAX_SOURCES) : [];
  const records = [];
  const byId = new Map();
  const duplicateIds = new Set();

  for (const value of values) {
    if (!isRecord(value)) continue;
    const id = clean(value.id, 32);
    if (!id) continue;
    const kind = clean(value.kind, 40) || 'unknown';
    const readable = sourceReadable(value, kind);
    const record = { id, kind, data: readable.data, read: readable.read, duplicate: false };
    if (byId.has(id)) {
      duplicateIds.add(id);
      byId.get(id).duplicate = true;
      continue;
    }
    byId.set(id, record);
    records.push(record);
  }

  for (const record of records) {
    record.available = SOURCE_ID.test(record.id)
      && (record.kind === 'data' || record.kind === 'document')
      && record.data && record.read && !record.duplicate;
  }
  return { records, byId, duplicateIds };
}

function refsForClaim(value) {
  if (!isRecord(value) || !Array.isArray(value.sourceIds)) return [];
  // Preserve repeats here so they can be reported, then deduplicate display.
  return value.sourceIds.slice(0, MAX_REFS).map((item) => clean(item, 32)).filter(Boolean);
}

function refsForCharts(charts) {
  if (!isRecord(charts) || charts.version !== 'nesso-charts-v1' || !Array.isArray(charts.items)) return [];
  const refs = [];
  for (const item of charts.items.slice(0, MAX_CLAIMS)) {
    if (!isRecord(item) || !Array.isArray(item.sourceIds)) continue;
    for (const sourceId of item.sourceIds) addUnique(refs, clean(sourceId, 32), MAX_REFS * MAX_CLAIMS);
  }
  return refs;
}

function issueFor(id, source, duplicateRef) {
  if (!SOURCE_ID.test(id)) return `identificativo fonte non valido: ${id}`;
  if (!source) return `fonte mancante: ${id}`;
  if (source.duplicate) return `fonte duplicata: ${id}`;
  if (duplicateRef) return `riferimento duplicato: ${id}`;
  if (source.kind === 'discovery') return `fonte di scoperta: ${id}`;
  if (source.kind !== 'data' && source.kind !== 'document') return `tipo fonte non utilizzabile: ${id}`;
  if (!source.data) return `contenuto fonte vuoto: ${id}`;
  if (!source.read) return `lettura fonte non riuscita: ${id}`;
  if (!source.available) return `fonte non disponibile: ${id}`;
  return '';
}

function claimsFrom(graph, info) {
  const reasoning = isRecord(graph) && isRecord(graph.reasoning) ? graph.reasoning : null;
  if (!reasoning) return [];
  const claims = [];

  for (const side of ['supporting', 'opposing']) {
    const values = Array.isArray(reasoning[side]) ? reasoning[side] : [];
    let index = 0;
    for (const value of values) {
      if (claims.length >= MAX_CLAIMS) break;
      if (!isRecord(value)) continue;
      const claim = clean(value.claim);
      if (!claim) continue;
      const rawRefs = refsForClaim(value);
      const duplicateRefs = new Set(rawRefs.filter((id, i) => rawRefs.indexOf(id) !== i));
      const sourceIds = [...new Set(rawRefs)];
      const validSourceIds = [];
      const issues = [];
      for (const id of sourceIds) {
        const issue = issueFor(id, info.byId.get(id), duplicateRefs.has(id));
        if (issue) addUnique(issues, issue, MAX_REFS);
        if (info.byId.get(id)?.available && !duplicateRefs.has(id)) addUnique(validSourceIds, id, MAX_REFS);
      }
      const citationState = sourceIds.length === 0
        ? 'uncited' : (issues.length ? 'unresolved' : 'cited');
      claims.push({
        id: `${side}-${index}`,
        side,
        claim,
        sourceIds,
        validSourceIds,
        citationState,
        issues,
      });
      index += 1;
    }
  }
  return claims;
}

function statusFor(evidence, info, claims, chartRefs, warnings) {
  if (evidence === null || evidence === undefined) return 'disabled';
  const usable = info.records.some((record) => record.available);
  if (!usable) return 'no-data';
  // A directory followed by a successful read is normal, not a failed source.
  const sourceErrors = info.records.some((record) => record.kind !== 'discovery' && !record.available)
    || info.duplicateIds.size > 0;
  const retrievalErrors = isRecord(evidence) && (
    ['partial', 'no-data'].includes(evidence.status)
    || (Array.isArray(evidence.attempts) && evidence.attempts.some((attempt) => attempt?.status === 'error'))
  );
  const chartErrors = chartRefs.some((id) => !info.byId.get(id)?.available);
  const claimErrors = claims.some((claim) => claim.citationState === 'unresolved');
  return warnings.length || sourceErrors || retrievalErrors || chartErrors || claimErrors ? 'partial' : 'collected';
}

function addLimitations(warnings, status, info, claims) {
  const discovery = info.records.some((record) => record.kind === 'discovery');
  const usable = info.records.some((record) => record.available);
  if (status !== 'disabled' && !usable) {
    addUnique(warnings, discovery
      ? 'Sono disponibili solo fonti di scoperta; non sono conteggiate come citazioni utilizzabili.'
      : 'Non sono disponibili dati originali.', MAX_WARNINGS);
  }
  if (claims.some((claim) => claim.citationState === 'uncited')) {
    addUnique(warnings, 'Alcune affermazioni non hanno citazioni.', MAX_WARNINGS);
  }
  if (claims.some((claim) => claim.citationState === 'unresolved')) {
    addUnique(warnings, 'Alcune citazioni non corrispondono a fonti originali utilizzabili.', MAX_WARNINGS);
  }
}

export function buildEvidenceAudit({ graph, evidence, charts } = {}) {
  const info = sourceInfo(evidence);
  const claims = claimsFrom(graph, info);
  const chartRefs = refsForCharts(charts);
  const warnings = warningsFrom(isRecord(evidence) ? evidence.warnings : []);
  const citationCounts = new Map();
  const cited = new Set();
  const countReference = (id) => {
    if (info.byId.has(id)) citationCounts.set(id, (citationCounts.get(id) || 0) + 1);
    if (info.byId.get(id)?.available) cited.add(id);
  };
  for (const claim of claims) claim.sourceIds.forEach(countReference);
  chartRefs.forEach(countReference);
  const status = statusFor(evidence, info, claims, chartRefs, warnings);
  addLimitations(warnings, status, info, claims);

  return {
    version: VERSION,
    researchStatus: status,
    counts: {
      retrieved: info.records.length,
      read: info.records.filter((record) => record.available).length,
      discovery: info.records.filter((record) => record.kind === 'discovery').length,
      cited: cited.size,
      uncitedClaims: claims.filter((claim) => claim.citationState === 'uncited').length,
      unresolvedClaims: claims.filter((claim) => claim.citationState === 'unresolved').length,
    },
    claims,
    sources: info.records.map((record) => ({
      id: record.id,
      citationCount: citationCounts.get(record.id) || 0,
      kind: record.kind,
      available: Boolean(record.available),
    })),
    warnings,
  };
}
