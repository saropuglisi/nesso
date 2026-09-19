export const input = {
  thesis: "Una settimana più breve migliorerà la retention del team.",
  domain: "general",
  effort: "low",
  deadline: "2099-12-31",
  context: "",
};
export function graph() {
  const n = (id, kind, label) => ({
    id,
    kind,
    label,
    assumptions: ["Il carico di lavoro resta sostenibile."],
    challenge: "Quale altra causa può spiegare il cambiamento?",
    falsifier: "La retention non migliora nel gruppo osservato.",
    evidenceNeeded: ["Retention del gruppo di confronto, stesso periodo."],
  });
  return {
    focus: {
      claim:
        "La settimana breve deve ridurre le dimissioni senza concentrare un carico insostenibile.",
      why: "Il tempo libero aggiuntivo non garantisce da solo che le persone restino.",
      assumption:
        "Il carico resta sostenibile anche con meno giorni di lavoro.",
      test: "Confrontare retention e carico di lavoro con un gruppo simile nello stesso periodo; nessun miglioramento indebolirebbe il nesso.",
    },
    title: "Settimana breve e retention",
    summary: "Un’ipotesi da verificare con un gruppo di confronto.",
    interpretation: {
      domain: "general",
      deadline: "2099-12-31",
      horizon: "Entro il 2099",
      context: "",
      missing: [],
    },
    nodes: [
      n("root", "thesis", "Settimana breve"),
      n("retention", "consequence", "Migliore retention"),
      n("alternative", "alternative", "Carico concentrato e stress"),
    ],
    edges: [
      {
        from: "root",
        to: "retention",
        mechanism: "Più tempo libero potrebbe ridurre le dimissioni.",
      },
      {
        from: "root",
        to: "alternative",
        mechanism:
          "Le stesse attività in meno ore potrebbero aumentare lo stress.",
      },
    ],
    uncertainties: ["Effetto di selezione delle aziende."],
    trading: {
      instruments: [],
      catalysts: [],
      pricedIn: "",
      invalidation: "",
      timingRisks: [],
      marketVsThesis: "",
    },
  };
}
export const criterion = {
  id: "c1",
  name: "Retention",
  metric: "Quota di dipendenti della coorte iniziale rimasti dopo 12 mesi",
  source: "Registro HR coorte 2026, estrazione annuale",
  unit: "%",
  weight: 100,
  operator: "gte",
  threshold: 90,
  due: "2099-12-31",
};
