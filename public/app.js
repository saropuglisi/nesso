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
let liveController,
  liveMessage = "";
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
  if (liveController) return;
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
    closeDialog();
    await startLiveAnalysis(input);
  };
}
async function startLiveAnalysis(input) {
  const controller = new AbortController();
  liveController = controller;
  frozen = null;
  selected = null;
  $("#graph").replaceChildren();
  $("#inspector").hidden = true;
  pan = { x: 35, y: 30 };
  liveMessage = "Esploro i nessi della tua tesi…";
  analysis = {
    draft: true,
    body: {
      input,
      provenance: { model: configuration.model },
      graph: {
        title: "La tua tesi prende forma",
        summary: "",
        edges: [],
        uncertainties: [],
        trading: {
          catalysts: [],
          pricedIn: "",
          invalidation: "",
          marketVsThesis: "",
        },
        nodes: [
          {
            id: "__input",
            kind: "thesis",
            label: input.thesis,
            depth: 0,
            assumptions: [],
            evidenceNeeded: [],
            challenge: "Sto analizzando la tua tesi…",
            falsifier: "In elaborazione",
          },
        ],
      },
    },
  };
  mapView();
  $("#liveBar").hidden = false;
  $("#stopAnalysis").hidden = false;
  $("#retryAnalysis").hidden = true;
  $("#stopAnalysis").onclick = () => controller.abort();
  $("#retryAnalysis").onclick = () => startLiveAnalysis(input);
  $("#newButton").disabled = $("#journalButton").disabled = true;
  render();
  let complete = false;
  const started = Date.now();
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, configuration.timeoutMs || 240000);
  const progressClock = setInterval(() => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    const waiting =
      nodes.size === 0 && !analysis.body.graph.focus && seconds >= 30
        ? "Il modello non ha ancora inviato caselle. Puoi interrompere e riprovare con effort basso."
        : liveMessage;
    $("#liveMessage").textContent = `${seconds}s · ${waiting}`;
  }, 1000);
  const nodes = new Map(),
    edges = [];
  function event(frame) {
    if (frame.type === "error") throw new Error(frame.data.message);
    if (frame.type === "stage") {
      liveMessage = frame.data.message;
      render();
      return;
    }
    if (frame.type === "financial") {
      analysis.body.graph.financial = frame.data;
      if ($("#closeFocus")) inspectFocus();
      return;
    }
    if (frame.type === "focus") {
      const f = frame.data;
      if (
        !f ||
        !["claim", "why", "assumption", "test"].every(
          (k) => typeof f[k] === "string" && f[k].trim() && f[k].length <= 800,
        )
      )
        return;
      analysis.body.graph.focus = f;
      liveMessage = "Passaggio decisivo individuato · costruisco i nessi…";
      render();
      return;
    }
    if (frame.type === "complete") {
      analysis = frame.data;
      complete = true;
      $("#liveBar").hidden = true;
      render();
      if ($("#closeFocus")) inspectFocus();
      if (selected && analysis.body.graph.nodes.some((n) => n.id === selected))
        inspect(selected);
      return;
    }
    if (frame.type === "node") {
      const n = frame.data;
      if (
        !n ||
        typeof n.id !== "string" ||
        typeof n.label !== "string" ||
        !["thesis", "consequence", "alternative"].includes(n.kind) ||
        !Array.isArray(n.assumptions) ||
        !Array.isArray(n.evidenceNeeded)
      )
        return;
      nodes.set(n.id, { ...n, depth: n.kind === "thesis" ? 0 : 1 });
      if (selected === "__input") {
        selected = null;
        $("#inspector").hidden = true;
      }
    } else if (frame.type === "edge") {
      const e = frame.data;
      if (!e || typeof e.from !== "string" || typeof e.to !== "string") return;
      edges.push(e);
    } else return;
    if (!nodes.size) return;
    const g = analysis.body.graph;
    g.nodes = [...nodes.values()];
    g.edges = edges.filter(
      (e) => nodes.has(e.from) && nodes.has(e.to) && e.from !== e.to,
    );
    // Bounded relaxation keeps an invalid partial cycle from blocking the UI.
    for (let i = 0; i < nodes.size; i++) {
      for (const e of g.edges) {
        const a = nodes.get(e.from),
          b = nodes.get(e.to);
        if (b.kind !== "thesis")
          b.depth = Math.min(nodes.size, Math.max(b.depth, a.depth + 1));
      }
    }
    liveMessage = `${nodes.size} caselle · ${g.edges.length} nessi · continuo a esplorare…`;
    render();
    if (selected && nodes.has(selected)) inspect(selected);
  }
  try {
    const response = await fetch("/api/analyze/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        (await response.json()).error || "Analisi non disponibile.",
      );
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (line) event(JSON.parse(line));
        }
      }
      if (!complete)
        throw new Error(
          "Connessione interrotta. La bozza non è stata salvata.",
        );
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    notice(
      "Mappa completata. Puoi esplorare le assunzioni e fissare i criteri.",
    );
  } catch (e) {
    liveMessage = timedOut
      ? "Tempo limite raggiunto. La bozza non è stata salvata: riprova con effort basso o un modello più rapido."
      : controller.signal.aborted
        ? "Analisi interrotta · bozza non salvata"
        : e.message;
    $("#stopAnalysis").hidden = true;
    $("#retryAnalysis").hidden = false;
    render();
  } finally {
    clearTimeout(deadline);
    clearInterval(progressClock);
    liveController = null;
    $("#newButton").disabled = $("#journalButton").disabled = false;
    render();
  }
}
function render() {
  if (!analysis) return;
  const g = analysis.body.graph;
  $("#focusSummary").hidden = !g.focus;
  $("#focusClaim").textContent = g.focus?.claim || "";
  $("#focusSummary").onclick = inspectFocus;
  $("#canvas").classList.toggle("has-focus", Boolean(g.focus));
  $("#empty").hidden = true;
  $("#titleLabel").textContent = g.title;
  $("#effortLabel").textContent =
    "Effort: " + labels[analysis.body.input.effort];
  $("#saveButton").disabled = Boolean(frozen) || Boolean(analysis.draft);
  $("#reviseButton").disabled = Boolean(liveController);
  $("#status").textContent =
    (analysis.draft
      ? "Bozza · non salvata"
      : frozen
        ? "Versione fissata"
        : "Ipotesi generate") +
    " · " +
    analysis.body.provenance.model +
    " · " +
    g.nodes.length +
    " nodi";
  $("#liveMessage").textContent = liveMessage;
  $("#liveBar").classList.toggle("running", Boolean(liveController));
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
  let svg = $("#graph svg");
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    $("#graph").prepend(svg);
  }
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  const drawing = `<defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="none" stroke="#90a699"/></marker></defs>${edges}`;
  if (svg.innerHTML !== drawing) svg.innerHTML = drawing;
  const existing = new Map(
    [...document.querySelectorAll("[data-node]")].map((el) => [
      el.dataset.node,
      el,
    ]),
  );
  for (const n of g.nodes) {
    let button = existing.get(n.id);
    if (!button) {
      button = document.createElement("button");
      button.dataset.node = n.id;
      button.classList.add("arriving");
      button.addEventListener(
        "animationend",
        () => button.classList.remove("arriving"),
        { once: true },
      );
      button.onclick = () => inspect(n.id);
      $("#graph").append(button);
    }
    existing.delete(n.id);
    button.classList.add("node");
    for (const kind of ["thesis", "consequence", "alternative"])
      button.classList.toggle(kind, n.kind === kind);
    button.classList.toggle("selected", n.id === selected);
    button.style.left = positions.get(n.id).x + "px";
    button.style.top = positions.get(n.id).y + "px";
    const content = `<small>${n.kind === "thesis" ? "Tesi" : n.kind === "alternative" ? "Alternativa" : "Conseguenza"}<span>L${n.depth}</span></small><strong>${escape(n.label)}</strong><span>${analysis.draft ? "In costruzione · provvisorio" : "Ipotesi · da verificare"}</span>`;
    if (button.innerHTML !== content) button.innerHTML = content;
  }
  for (const el of existing.values()) el.remove();
  transform();
}
function financialDetail() {
  const f = analysis?.body.graph.financial;
  if (!f?.conclusion) return "";
  const inputs = analysis?.body.provenance?.extractedScenario;
  const evidence = inputs
    ? `<h4>Dati estratti dal tuo testo</h4>${Object.entries(inputs.sources)
        .map(
          ([key, quote]) =>
            `<p><strong>${escape(String(inputs.values[key]))}</strong> · «${escape(quote)}»</p>`,
        )
        .join(
          "",
        )}<p class="muted">Controlla l’interpretazione dei dati: il modello può ancora sbagliare l’estrazione.</p>`
    : "";
  return `${evidence}<h4>Che cosa segue dai numeri</h4><p>${escape(f.conclusion)}</p>${(f.calculations || []).map((c) => `<div class="callout"><strong>${escape(c.label)}</strong><p>${escape(c.expression)} = ${c.arithmeticValid ? escape(new Intl.NumberFormat("it-IT", { maximumSignificantDigits: 8 }).format(c.result)) + " " + escape(c.unit) : "calcolo non verificabile"}</p><small>${escape(c.basis)}</small></div>`).join("")}<p class="muted">L’aritmetica è calcolata dal software. La scelta della formula e le ipotesi restano da verificare.</p><h4>Limite della conclusione</h4><p>${escape(f.limitation)}</p>`;
}
function inspectFocus() {
  const f = analysis?.body.graph.focus;
  if (!f) return;
  selected = null;
  render();
  $("#inspector").hidden = false;
  $("#inspector").innerHTML =
    `<button class="close" id="closeFocus" aria-label="Chiudi dettaglio">×</button><span class="badge">Priorità di ricerca · non un verdetto</span><h3>${escape(f.claim)}</h3><h4>Perché questo passaggio</h4><p>${escape(f.why)}</p><h4>Che cosa stai assumendo</h4><p>${escape(f.assumption)}</p><h4>La verifica che conta</h4><p>${escape(f.test)}</p><p class="muted">Conclusione condizionata ai dati estratti dal testo. Le evidenze devono ancora essere raccolte.</p>${financialDetail()}`;
  $("#closeFocus").onclick = () => {
    $("#inspector").hidden = true;
  };
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
