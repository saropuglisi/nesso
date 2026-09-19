const $ = (s) => document.querySelector(s);
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let configuration,
  analysis,
  frozen,
  zoom = 0.9,
  pan = { x: 35, y: 30 },
  selected,
  drag;
const labels = { low: "Basso", medium: "Medio", high: "Alto", max: "Massimo" };
const isoDate = () => new Date().toISOString().slice(0, 10);
async function api(path, body, signal) {
  const r = await fetch(path, {
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Richiesta non riuscita.");
  return data;
}
function notice(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  setTimeout(() => $("#toast").classList.remove("visible"), 3500);
}
function closeDialog() {
  $("#dialog").close();
}
function modal(html, compact = false) {
  $("#dialog").classList.toggle("composer", compact);
  $("#dialogContent").innerHTML =
    '<button class="close" id="closeDialog" aria-label="Chiudi">×</button>' +
    html;
  $("#closeDialog").onclick = closeDialog;
  $("#dialog").showModal();
}
function closeMenu() {
  $("#menu").hidden = true;
  $("#menuButton").setAttribute("aria-expanded", "false");
}
function mapView() {
  closeMenu();
  $("#journal").hidden = true;
  $("#workspace").hidden = false;
}
function settings() {
  modal(
    `<span class="eyebrow">CONNESSIONE AI</span><h2>Un motore, diversi modelli.</h2><div class="callout">${configuration.ready ? "Configurazione presente; la prima analisi verificherà la connessione." : "Configurazione incompleta: scegli modello e credenziali nel file locale .env."}</div><p>Provider: <strong>${escape(configuration.provider)}</strong><br>Modello: <strong>${escape(configuration.model || "Non configurato")}</strong><br>Destinazione: <code>${escape(configuration.endpoint)}</code><br>Chiave: ${configuration.keyConfigured ? "presente sul server" : "non configurata"}</p><p>${configuration.local ? "L’inferenza è diretta a un servizio sul tuo computer." : "Tesi e contesto saranno inviati al provider indicato quando avvii l’analisi."}</p><p>Configura queste variabili nel file <code>.env</code>, poi riavvia il server:</p><pre>NESSO_PROVIDER=openai-compatible\nNESSO_BASE_URL=https://openrouter.ai/api/v1\nNESSO_MODEL=provider/modello\nNESSO_API_KEY=la-tua-chiave</pre><p>Per LM Studio usa <code>openai-compatible</code>; per Ollama usa <code>ollama</code>; per OpenAI Responses usa <code>openai</code>. Le chiavi non vengono mai inviate a questa interfaccia.</p>`,
  );
}
function newThesis() {
  closeMenu();
  const current = analysis?.body.input;
  modal(
    `<label class="composer-title" for="thesis">Che cosa pensi possa succedere?</label><textarea id="thesis" maxlength="6000" placeholder="Scrivi la tua idea, come la racconteresti a qualcuno…">${escape(current?.thesis || "")}</textarea><div class="composer-controls"><label for="effort">Effort</label><select id="effort" aria-label="Profondità dell’analisi">${Object.entries(
      labels,
    )
      .map(
        ([v, l]) =>
          `<option value="${v}" ${(current?.effort || "medium") === v ? "selected" : ""}>${l}</option>`,
      )
      .join(
        "",
      )}</select><button class="primary" id="analyze">Esplora →</button></div><div class="error" id="formError" role="alert"></div>`,
    true,
  );
  $("#thesis").focus();
  $("#analyze").onclick = async () => {
    const input = {
      thesis: $("#thesis").value.trim(),
      effort: $("#effort").value,
    };
    if (input.thesis.length < 15) {
      $("#formError").textContent = "Scrivi una tesi di almeno 15 caratteri.";
      return;
    }
    const controller = new AbortController();
    $("#dialog").addEventListener("close", () => controller.abort(), {
      once: true,
    });
    $("#analyze").disabled = true;
    $("#analyze").textContent = "Analisi in corso…";
    $("#formError").textContent = "";
    try {
      const generated = await api("/api/analyze", input, controller.signal);
      analysis = generated;
      frozen = null;
      selected = null;
      $("#inspector").hidden = true;
      pan = { x: 35, y: 30 };
      closeDialog();
      mapView();
      render();
      notice("Analisi generata e archiviata. Ora controlla le assunzioni.");
    } catch (e) {
      if ($("#dialog").open) {
        $("#formError").textContent =
          e.name === "AbortError" ? "Analisi annullata." : e.message;
        $("#analyze").disabled = false;
        $("#analyze").textContent = "Riprova analisi →";
      }
    }
  };
}
function render() {
  if (!analysis) return;
  const g = analysis.body.graph;
  $("#empty").hidden = true;
  $("#titleLabel").textContent = g.title;
  $("#effortLabel").textContent =
    "Effort: " + labels[analysis.body.input.effort];
  $("#saveButton").disabled = Boolean(frozen);
  $("#reviseButton").disabled = false;
  $("#status").textContent =
    (frozen ? "Versione fissata" : "Ipotesi generate") +
    " · " +
    analysis.body.provenance.model +
    " · " +
    g.nodes.length +
    " nodi";
  const grouped = {};
  g.nodes.forEach((n) => (grouped[n.depth] ??= []).push(n));
  const positions = new Map();
  Object.entries(grouped).forEach(([depth, rows]) =>
    rows.forEach((n, i) =>
      positions.set(n.id, { x: Number(depth) * 295 + 15, y: i * 210 + 45 }),
    ),
  );
  const width = (Math.max(...g.nodes.map((n) => n.depth)) + 1) * 295 + 50,
    height =
      Math.max(...Object.values(grouped).map((v) => v.length)) * 210 + 100;
  const edges = g.edges
    .map((e) => {
      const a = positions.get(e.from),
        b = positions.get(e.to);
      return `<path d="M${a.x + 235} ${a.y + 60} C${a.x + 270} ${a.y + 60},${b.x - 35} ${b.y + 60},${b.x} ${b.y + 60}" fill="none" stroke="#a8b9ae" stroke-width="1.2" marker-end="url(#arrow)"/>`;
    })
    .join("");
  $("#graph").style.width = width + "px";
  $("#graph").style.height = height + "px";
  $("#graph").innerHTML =
    `<svg width="${width}" height="${height}"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="none" stroke="#90a699"/></marker></defs>${edges}</svg>` +
    g.nodes
      .map(
        (n) =>
          `<button class="node ${n.kind} ${n.id === selected ? "selected" : ""}" data-node="${escape(n.id)}" style="left:${positions.get(n.id).x}px;top:${positions.get(n.id).y}px"><small>${n.kind === "thesis" ? "Tesi" : n.kind === "alternative" ? "Alternativa" : "Conseguenza"}<span>L${n.depth}</span></small><strong>${escape(n.label)}</strong><span>Ipotesi · da verificare</span></button>`,
      )
      .join("");
  document
    .querySelectorAll("[data-node]")
    .forEach((b) => (b.onclick = () => inspect(b.dataset.node)));
  transform();
}
function inspect(id) {
  selected = id;
  render();
  const g = analysis.body.graph,
    n = g.nodes.find((n) => n.id === id),
    incoming = g.edges.filter((e) => e.to === id);
  $("#inspector").hidden = false;
  $("#inspector").innerHTML =
    `<button class="close" id="closeInspector" aria-label="Chiudi dettaglio">×</button><span class="badge">Ipotesi non verificata</span><h3>${escape(n.label)}</h3><div class="callout">${escape(n.challenge)}</div><h4>Meccanismo causale</h4>${incoming.length ? incoming.map((e) => `<p>${escape(e.mechanism)}</p>`).join("") : "<p>Questa è la tesi iniziale.</p>"}${n.kind === "thesis" && g.interpretation ? `<h4>Dal tuo testo</h4><p>${g.interpretation.domain === "trading" ? "Trading e mercati" : "Ambito generale"} · ${escape(g.interpretation.horizon || "Orizzonte da chiarire")}</p>${g.interpretation.context ? `<p>${escape(g.interpretation.context)}</p>` : ""}${g.interpretation.missing.length ? `<h4>Da chiarire</h4><ul>${g.interpretation.missing.map((x) => `<li>${escape(x)}</li>`).join("")}</ul>` : ""}` : ""}<h4>Assunzioni</h4><ul>${n.assumptions.map((s) => `<li>${escape(s)}</li>`).join("")}</ul><h4>Che cosa la smentirebbe</h4><p>${escape(n.falsifier)}</p><h4>Dati da raccogliere</h4><ul>${n.evidenceNeeded.map((s) => `<li>${escape(s)}</li>`).join("")}</ul>${(g.interpretation?.domain || analysis.body.input.domain) === "trading" ? `<h4>Tesi e prezzo di mercato</h4><p>${escape(g.trading.marketVsThesis)}</p><h4>Già scontato nel prezzo?</h4><p>${escape(g.trading.pricedIn)}</p><h4>Catalizzatori</h4><ul>${g.trading.catalysts.map((s) => `<li>${escape(s)}</li>`).join("")}</ul><h4>Invalidazione</h4><p>${escape(g.trading.invalidation)}</p>` : ""}`;
  $("#closeInspector").onclick = () => {
    $("#inspector").hidden = true;
    selected = null;
    render();
  };
}
function transform() {
  $("#graph").style.transform =
    `translate(${pan.x}px,${pan.y}px) scale(${zoom})`;
  $("#zoomLabel").textContent = Math.round(zoom * 100) + "%";
}
let criteriaDraft = [];
function criterionForm(c, i) {
  return `<div class="criterion" data-index="${i}"><button class="close remove-criterion" data-index="${i}" aria-label="Rimuovi criterio">×</button><h4>Criterio ${i + 1}</h4><label>Nome<input data-field="name" value="${escape(c.name)}" placeholder="Esito da misurare"></label><label>Definizione operativa<input data-field="metric" value="${escape(c.metric)}" placeholder="Quale misura, quale universo e quale periodo?"></label><label>Fonte fissata<input data-field="source" value="${escape(c.source)}" placeholder="Dataset, documento o URL esatto"></label><div class="row"><label>Unità<input data-field="unit" value="${escape(c.unit)}" placeholder="%, EUR, numero…"></label><label>Peso (totale 100)<input data-field="weight" type="number" min="1" max="100" value="${c.weight}"></label><label>Condizione<select data-field="operator"><option value="gte" ${c.operator === "gte" ? "selected" : ""}>Maggiore o uguale a</option><option value="lte" ${c.operator === "lte" ? "selected" : ""}>Minore o uguale a</option></select></label><label>Soglia<input data-field="threshold" type="number" step="any" value="${c.threshold ?? ""}"></label><label>Data della misura<input data-field="due" type="date" value="${c.due}"></label></div></div>`;
}
function readCriteria() {
  document.querySelectorAll(".criterion").forEach((el) => {
    const c = criteriaDraft[+el.dataset.index];
    el.querySelectorAll("[data-field]").forEach(
      (f) =>
        (c[f.dataset.field] = ["weight", "threshold"].includes(f.dataset.field)
          ? f.value === ""
            ? null
            : Number(f.value)
          : f.value),
    );
  });
}
function saveDialog() {
  criteriaDraft = [
    {
      id: crypto.randomUUID(),
      name: "",
      metric: "",
      source: "",
      unit: "%",
      weight: 100,
      operator: "gte",
      threshold: null,
      due:
        analysis.body.graph.interpretation?.deadline ||
        analysis.body.input.deadline ||
        "",
    },
  ];
  modal(
    `<span class="eyebrow">PREREGISTRAZIONE</span><h2>Decidi adesso come giudicarla.</h2><p>Definisci criteri numerici prima dei risultati. Ogni criterio assegna il proprio peso se la soglia è raggiunta, altrimenti zero. Un dato mancante lascia il punteggio totale non calcolato.</p><div id="criteriaList"></div><button id="addCriterion">＋ Aggiungi criterio</button><p class="muted">La prima versione supporta una misura alla data esatta indicata. La fonte deve coincidere con quella fissata; le finestre temporali e i criteri qualitativi arriveranno in seguito.</p><label class="confirm"><input type="checkbox" id="confirm"><span>Confermo questi criteri e salvo una versione immutabile con la mappa, il contesto e il modello utilizzato.</span></label><div class="error" id="saveError"></div><div class="actions"><button class="primary" id="commitSnapshot">Fissa e salva</button></div>`,
  );
  function list() {
    $("#criteriaList").innerHTML = criteriaDraft.map(criterionForm).join("");
    document.querySelectorAll(".remove-criterion").forEach(
      (b) =>
        (b.onclick = () => {
          readCriteria();
          criteriaDraft.splice(+b.dataset.index, 1);
          list();
        }),
    );
  }
  list();
  $("#addCriterion").onclick = () => {
    readCriteria();
    criteriaDraft.push({
      id: crypto.randomUUID(),
      name: "",
      metric: "",
      source: "",
      unit: "%",
      weight: 0,
      operator: "gte",
      threshold: null,
      due:
        analysis.body.graph.interpretation?.deadline ||
        analysis.body.input.deadline ||
        "",
    });
    list();
  };
  $("#commitSnapshot").onclick = async () => {
    readCriteria();
    $("#commitSnapshot").disabled = true;
    try {
      frozen = await api("/api/snapshots", {
        analysisId: analysis.id,
        criteria: criteriaDraft,
        confirmed: $("#confirm").checked,
      });
      closeDialog();
      render();
      notice("Versione fissata nel diario locale.");
    } catch (e) {
      $("#saveError").textContent = e.message;
      $("#commitSnapshot").disabled = false;
    }
  };
}
async function journal() {
  closeMenu();
  $("#workspace").hidden = true;
  $("#journal").hidden = false;
  $("#journal").innerHTML = "<h1>Thinking Journal</h1><p>Caricamento…</p>";
  try {
    const data = await api("/api/journal");
    $("#journal").innerHTML =
      `<h1>Thinking Journal</h1><p>Versioni preregistrate ed evidenze inserite da te. Nessun risultato simulato.</p>${
        data.snapshots.length
          ? data.snapshots
              .map(
                (s) =>
                  `<article class="journal-card"><span class="badge">Criteri fissati</span><h3>${escape(s.body.graph.title)}</h3><small>${new Date(s.createdAt).toLocaleString("it-IT")} · ${s.body.criteria.length} criteri · ${escape(s.body.provenance.model)}</small><div class="actions"><button data-open="${s.id}">Apri mappa</button><button data-verify="${s.id}">Registra osservazioni</button><button data-export="${s.id}">Esporta JSON</button></div>${data.evaluations
                    .filter((e) => e.parentId === s.id)
                    .map(
                      (e) =>
                        `<div class="callout">${new Date(e.createdAt).toLocaleString("it-IT")} · ${e.body.score === null ? "Non valutato" : e.body.score + "/100"} · copertura ${e.body.coverage}%<br>Fonte: osservazioni manuali non validate automaticamente.</div>`,
                    )
                    .join("")}</article>`,
              )
              .join("")
          : '<div class="callout">Non hai ancora fissato una tesi. Genera una mappa, poi definisci i criteri.</div>'
      }`;
    document.querySelectorAll("[data-open]").forEach(
      (b) =>
        (b.onclick = () => {
          frozen = data.snapshots.find((s) => s.id === b.dataset.open);
          analysis = frozen;
          selected = null;
          mapView();
          render();
        }),
    );
    document
      .querySelectorAll("[data-verify]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            verifyDialog(
              data.snapshots.find((s) => s.id === b.dataset.verify),
            )),
      );
    document.querySelectorAll("[data-export]").forEach(
      (b) =>
        (b.onclick = () => {
          const r = data.snapshots.find((s) => s.id === b.dataset.export),
            url = URL.createObjectURL(
              new Blob([JSON.stringify(r, null, 2)], {
                type: "application/json",
              }),
            ),
            a = document.createElement("a");
          a.href = url;
          a.download = "nesso-" + r.id + ".json";
          a.click();
          URL.revokeObjectURL(url);
        }),
    );
  } catch (e) {
    $("#journal").textContent = e.message;
  }
}
function verifyDialog(snapshot) {
  modal(
    `<span class="eyebrow">EVIDENZE MANUALI</span><h2>Confronta previsione e osservazione.</h2><p>Inserisci soltanto misure che hai osservato. Lascia vuoto ciò che manca. La valutazione applica le soglie fissate e non dimostra da sola un nesso causale.</p>${snapshot.body.criteria.map((c, i) => `<div class="criterion"><h4>${escape(c.name)}</h4><p>${escape(c.metric)} · ${escape(c.unit)}<br>${c.operator === "gte" ? "≥" : "≤"} ${c.threshold} · ${c.weight} punti<br>Fonte: ${escape(c.source)}<br>Data fissata: ${c.due}</p><label for="obs-${i}">Valore osservato<input id="obs-${i}" type="number" step="any" placeholder="Vuoto = dato mancante"></label><label for="date-${i}">Data della misura<input id="date-${i}" type="date" value="${isoDate()}" max="${isoDate()}"></label><label for="note-${i}">Riferimento e nota sulla raccolta<input id="note-${i}" placeholder="Pagina, tabella, versione del dato…"></label></div>`).join("")}<label class="confirm"><input id="evidenceConfirm" type="checkbox"><span>Le misure provengono dalle fonti indicate nei criteri. Il sistema le conserva come evidenze inserite da me, non come dati autenticati.</span></label><div id="verificationResult"></div><div class="error" id="verifyError"></div><div class="actions"><button class="primary" id="verifySubmit">Registra e valuta</button></div>`,
  );
  $("#verifySubmit").onclick = async () => {
    if (!$("#evidenceConfirm").checked) {
      $("#verifyError").textContent =
        "Conferma la provenienza delle osservazioni.";
      return;
    }
    $("#verifySubmit").disabled = true;
    try {
      const observations = snapshot.body.criteria.map((c, i) => ({
        criterionId: c.id,
        value:
          $("#obs-" + i).value === "" ? null : Number($("#obs-" + i).value),
        observedAt: $("#date-" + i).value,
        source: c.source,
        note: $("#note-" + i).value,
      }));
      const r = await api("/api/evaluations", {
        snapshotId: snapshot.id,
        observations,
        confirmed: true,
      });
      $("#verificationResult").innerHTML =
        `<div class="scores"><div><strong>${r.body.score === null ? "—" : r.body.score + "/100"}</strong>${r.body.score === null ? "Dati insufficienti" : "Esito delle soglie"}</div><div><strong>${r.body.coverage}%</strong>Copertura dei criteri</div></div>${r.body.results.map((x) => `<p>${escape(snapshot.body.criteria.find((c) => c.id === x.id).name)}: ${escape(x.reason)}</p>`).join("")}`;
      $("#verifySubmit").textContent = "Valutazione registrata";
      journal();
    } catch (e) {
      $("#verifyError").textContent = e.message;
      $("#verifySubmit").disabled = false;
    }
  };
}
$("#menuButton").onclick = () => {
  $("#menu").hidden = !$("#menu").hidden;
  $("#menuButton").setAttribute("aria-expanded", String(!$("#menu").hidden));
};
$("#newButton").onclick =
  $("#emptyNew").onclick =
  $("#reviseButton").onclick =
    newThesis;
$("#mapButton").onclick = mapView;
$("#journalButton").onclick = journal;
$("#settingsButton").onclick = settings;
$("#saveButton").onclick = saveDialog;
$("#zoomIn").onclick = () => {
  zoom = Math.min(1.5, zoom + 0.1);
  transform();
};
$("#zoomOut").onclick = () => {
  zoom = Math.max(0.25, zoom - 0.1);
  transform();
};
$("#centerButton").onclick = () => {
  pan = { x: 35, y: 30 };
  zoom = 0.9;
  transform();
};
$("#canvas").onpointerdown = (e) => {
  if (e.target.closest("button")) return;
  drag = { x: e.clientX, y: e.clientY, pan: { ...pan } };
  $("#canvas").setPointerCapture(e.pointerId);
};
$("#canvas").onpointermove = (e) => {
  if (drag) {
    pan = {
      x: drag.pan.x + e.clientX - drag.x,
      y: drag.pan.y + e.clientY - drag.y,
    };
    transform();
  }
};
$("#canvas").onpointerup = $("#canvas").onpointercancel = () => {
  drag = null;
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMenu();
    $("#inspector").hidden = true;
  }
});
try {
  configuration = await api("/api/config");
  $("#modelLabel").textContent =
    configuration.model || "Modello da configurare";
  $("#status").textContent = configuration.ready
    ? "Pronto per l’analisi · Archivio locale"
    : "Configura la connessione AI per iniziare";
} catch (e) {
  $("#modelLabel").textContent = "Server non disponibile";
  $("#status").textContent = e.message;
}
