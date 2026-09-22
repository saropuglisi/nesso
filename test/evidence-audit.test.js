import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEvidenceAudit } from '../server/evidence-audit.js';

const originalData = [
  { id: 'R1', kind: 'data', data: { observations: [{ date: '2024-01-01', value: 1 }] } },
  { id: 'R2', kind: 'document', data: { excerpts: [{ offset: 0, text: 'Testo originale del documento.' }] } },
];

test('evidence disabilitata conserva le affermazioni reali senza inventare claim', () => {
  const audit = buildEvidenceAudit({
    graph: {
      reasoning: {
        supporting: [{ claim: 'Affermazione senza fonte', sourceIds: [] }],
        opposing: [{ claim: 'Affermazione con fonte assente', sourceIds: ['R1'] }],
      },
    },
    evidence: null,
  });

  assert.equal(audit.researchStatus, 'disabled');
  assert.equal(audit.counts.uncitedClaims, 1);
  assert.equal(audit.counts.unresolvedClaims, 1);
  assert.equal(audit.claims.length, 2);
});

test('fonti FRED e documento leggibili sono citabili, anche tramite un grafico', () => {
  const audit = buildEvidenceAudit({
    graph: { reasoning: { supporting: [{ claim: 'Claim citato', sourceIds: ['R1'] }] } },
    evidence: { sources: originalData },
    charts: { version: 'nesso-charts-v1', items: [{ sourceIds: ['R2'] }] },
  });

  assert.equal(audit.researchStatus, 'collected');
  assert.equal(audit.counts.read, 2);
  assert.equal(audit.counts.cited, 2);
  assert.equal(audit.sources[1].citationCount, 1);
  assert.equal(audit.claims[0].citationState, 'cited');
});

test('solo discovery e dati metadata-only producono no-data', () => {
  const audit = buildEvidenceAudit({
    graph: { reasoning: { supporting: [{ claim: 'Claim non risolto', sourceIds: ['R3', 'R4'] }] } },
    evidence: {
      sources: [
        { id: 'R3', kind: 'discovery', data: { items: [{ title: 'Risultato' }] } },
        { id: 'R4', kind: 'data', data: { units: 'Percent', notes: 'descrizione' } },
      ],
    },
  });

  assert.equal(audit.researchStatus, 'no-data');
  assert.equal(audit.counts.read, 0);
  assert.equal(audit.counts.discovery, 1);
  assert.equal(audit.sources[0].available, false);
  assert.equal(audit.sources[1].available, false);
  assert.ok(audit.warnings.some((warning) => warning.includes('fonti di scoperta')));
  assert.ok(audit.claims[0].issues.includes('fonte di scoperta: R3'));
});

test('osservazioni tutte mancanti non diventano una fonte dati leggibile', () => {
  const audit = buildEvidenceAudit({
    evidence: {
      sources: [
        { id: 'R1', kind: 'data', data: { observations: [{ date: '2024-01-01', value: null }] } },
      ],
    },
  });

  assert.equal(audit.researchStatus, 'no-data');
  assert.equal(audit.counts.read, 0);
  assert.equal(audit.sources[0].available, false);
});

test('fonti duplicate non diventano leggibili per il solo fatto di avere contenuto', () => {
  const audit = buildEvidenceAudit({
    graph: { reasoning: { supporting: [{ claim: 'Claim', sourceIds: ['R1'] }] } },
    evidence: {
      sources: [originalData[0], { ...originalData[0], data: { observations: [{ date: '2024-02-01', value: 2 }] } }],
      warnings: ['Avviso di raccolta'],
    },
  });

  assert.equal(audit.researchStatus, 'no-data');
  assert.equal(audit.counts.read, 0);
  assert.equal(audit.counts.cited, 0);
  assert.equal(audit.claims[0].citationState, 'unresolved');
  assert.equal(audit.sources[0].available, false);
  assert.ok(audit.warnings.includes('Avviso di raccolta'));
});

test('la directory seguita da lettura non implica una ricerca fallita', () => {
  const audit = buildEvidenceAudit({
    evidence: { status: 'collected', sources: [
      { id: 'R3', kind: 'discovery', data: { series: [{ id: 'TEST' }] } },
      ...originalData,
    ] },
  });
  assert.equal(audit.researchStatus, 'collected');
  assert.equal(audit.counts.read, 2);
  assert.equal(audit.counts.discovery, 1);
  const partial = buildEvidenceAudit({ evidence: { sources: originalData, attempts: [{ status: 'error' }] } });
  assert.equal(partial.researchStatus, 'partial');
});

test('la copertura distingue XBRL e Form 4 da semplici metadati del filing', () => {
  const audit = buildEvidenceAudit({ evidence: { sources: [
    { id: 'R1', kind: 'data', data: { units: { USD: [{ val: 100, end: '2025-12-31' }] } } },
    { id: 'R2', kind: 'document', data: { form: '4', issuer: { issuerName: 'Test' }, transactions: [] } },
    { id: 'R3', kind: 'document', data: { form: '4', filed: '2026-01-01' } },
    { id: 'R4', kind: 'document', data: { form: '10-K', filed: '2026-01-01' } },
  ] } });
  assert.equal(audit.counts.read, 2);
  assert.equal(audit.sources[2].available, false);
  assert.equal(audit.sources[3].available, false);
});

test('riferimenti duplicati vengono segnalati senza duplicare la fonte visualizzata', () => {
  const audit = buildEvidenceAudit({
    graph: { reasoning: { supporting: [{ claim: 'Claim', sourceIds: ['R1', 'R1'] }] } },
    evidence: { sources: originalData },
  });
  assert.equal(audit.claims[0].citationState, 'unresolved');
  assert.deepEqual(audit.claims[0].sourceIds, ['R1']);
  assert.deepEqual(audit.claims[0].validSourceIds, []);
  assert.match(audit.claims[0].issues[0], /riferimento duplicato/);
});
