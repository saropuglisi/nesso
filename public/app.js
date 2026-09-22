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
  liveMessage = "",
  critiqueController,
  critiqueSequence = 0,
  layout = null,
  fitFrame = 0,
  fitRequested = false,
  analysisViewActive = false,
  chartsModulePromise = null;
const labels = { low: "Basso", medium: "Medio", high: "Alto", max: "Massimo" };
const relationLabels = {
  causes: "Effetto",
  requires: "Condizione necessaria",
  supports: "Argomento a favore",
  challenges: "Obiezione",
  measures: "Verifica",
};
const DRAFT_KEY = "nesso.draft.v1";
const isoDate = () => new Date().toISOString().slice(0, 10);
function readDraft() {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
function saveDraft(patch) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...readDraft(), ...patch }));
  } catch {
    // Draft persistence is best effort: private browsing can disable storage.
  }
}
function saveFailedAnalysis(message = liveMessage) {
  if (!analysis?.draft || !analysis.body?.graph) return;
  try {
    const failedAnalysis = {
      analysis,
      message: String(message || "Bozza locale non salvata.").slice(0, 1000),
      savedAt: new Date().toISOString(),
    };
    // Keep local recovery bounded. Retrieved sources are already capped by
    // the server, but a corrupted local value must not fill browser storage.
    if (JSON.stringify(failedAnalysis).length <= 200000)
      saveDraft({ failedAnalysis });
  } catch {
    // Recovery is best effort and never blocks the analysis itself.
  }
}
function recoverFailedAnalysis(value) {
  const candidate = value?.analysis;
  const body = candidate?.body;
  const graph = body?.graph;
  const input = body?.input;
  if (
    candidate?.draft !== true ||
    !input || typeof input.thesis !== "string" || input.thesis.length < 15 ||
    !labels[input.effort] ||
    !graph || typeof graph.title !== "string" ||
    !Array.isArray(graph.nodes) || !graph.nodes.length || graph.nodes.length > 24 ||
    !Array.isArray(graph.edges) ||
    !graph.nodes.every((node) => node && typeof node.id === "string" &&
      typeof node.label === "string" && ["thesis", "consequence", "alternative"].includes(node.kind)) ||
    !graph.edges.every((edge) => edge && typeof edge.from === "string" && typeof edge.to === "string")
  ) return null;
  return {
    analysis: candidate,
    message: typeof value.message === "string"
      ? value.message.slice(0, 1000)
      : "Bozza locale recuperata · non salvata nel Diario.",
  };
}
function draftClarificationFor(thesis) {
  const draft = readDraft();
  return draft.clarificationThesis === thesis ? String(draft.clarification || "") : "";
}
function makeContext(question, answer, extra = "") {
  const parts = [];
  if (question?.trim())
    parts.push(`Domanda di chiarimento: ${question.trim()}`);
  if (question?.trim() || answer?.trim())
    parts.push(`Risposta dell’utente: ${answer?.trim() || "Nessuna risposta fornita."}`);
  if (extra?.trim()) parts.push(extra.trim());
  return parts.join("\n");
}
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
  invalidateCritique();
  $("#dialog").close();
}
function invalidateCritique() {
  if (!critiqueController) return;
  critiqueSequence += 1;
  critiqueController.abort();
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
  analysisViewActive = false;
  $("#journal").hidden = true;
  $("#workspace").hidden = false;
  $("#analysisPanel").hidden = true;
  $("#canvas").hidden = false;
  $("#chartsButton").disabled = Boolean(!analysis || analysis.draft || liveController || critiqueController);
  $("#chartsButton").setAttribute("aria-pressed", "false");
  if (liveController) $("#liveBar").hidden = false;
}
function settings() {
  modal(
    `<span class="eyebrow">CONNESSIONE AI</span><h2>Un motore, diversi modelli.</h2><div class="callout">${configuration.ready ? "Configurazione presente; la prima analisi verificherà la connessione." : "Configurazione incompleta: scegli modello e credenziali nel file locale .env."}</div><p>Provider: <strong>${escape(configuration.provider)}</strong><br>Modello: <strong>${escape(configuration.model || "Non configurato")}</strong><br>Destinazione: <code>${escape(configuration.endpoint)}</code><br>Chiave: ${configuration.keyConfigured ? "presente sul server" : "non configurata"}</p><p>${configuration.local ? "L’inferenza è diretta a un servizio sul tuo computer." : "Tesi e contesto saranno inviati al provider indicato quando avvii l’analisi."}</p><p>Configura queste variabili nel file <code>.env</code>, poi riavvia il server:</p><pre>NESSO_PROVIDER=openai-compatible\nNESSO_BASE_URL=https://openrouter.ai/api/v1\nNESSO_MODEL=provider/modello\nNESSO_API_KEY=la-tua-chiave</pre><p>Per LM Studio usa <code>openai-compatible</code>; per Ollama usa <code>ollama</code>; per OpenAI Responses usa <code>openai</code>. Le chiavi non vengono mai inviate a questa interfaccia.</p>`,
  );
}
function setModalContent(html, compact = false) {
  $("#dialog").classList.toggle("composer", compact);
  $("#dialogContent").innerHTML =
    '<button class="close" id="closeDialog" aria-label="Chiudi">×</button>' +
    html;
  $("#closeDialog").onclick = closeDialog;
}
function critiqueResult(data) {
  if (!data || typeof data !== "object") throw new Error("Risposta di chiarimento non valida.");
  const options = Array.isArray(data.options)
    ? data.options
        .filter((option) => typeof option === "string" && option.trim())
        .map((option) => option.trim().slice(0, 500))
        .slice(0, 6)
    : [];
  const observation = typeof data.observation === "string" ? data.observation.trim() : "";
  const question = typeof data.question === "string" ? data.question.trim() : "";
  if (!observation && !question) throw new Error("Il chiarimento non contiene una domanda.");
  return { observation, question, options };
}
function critiqueMarkup(input, result, previousContext = "") {
  const previous = previousContext?.trim()
    ? `<div class="critique-previous"><span class="eyebrow">CONTESTO GIÀ FORNITO</span><label class="field" for="critiquePreviousContext">Contesto precedente <span class="muted">(modificabile se serve)</span></label><textarea id="critiquePreviousContext" maxlength="12000">${escape(previousContext)}</textarea></div>`
    : "";
  const options = result.options.length
    ? `<div class="critique-options" role="group" aria-label="Risposte suggerite">${result.options
        .map((option, index) => `<button type="button" data-critique-option="${index}">${escape(option)}</button>`)
        .join("")}</div>`
    : "";
  return `<div class="critique-thesis"><span class="eyebrow">TESI ORIGINALE</span><div>${escape(input.thesis)}</div></div><h3>${escape(result.observation || "Un punto da chiarire")}</h3>${result.question ? `<p class="critique-question">${escape(result.question)}</p>` : ""}${previous}${options}<label class="field" for="critiqueClarification">La tua precisazione <span class="muted">(facoltativa)</span></label><textarea id="critiqueClarification" maxlength="6000" placeholder="Puoi aggiungere contesto o lasciare vuoto…">${escape(draftClarificationFor(input.thesis))}</textarea><label class="research-toggle"><input id="critiqueResearch" type="checkbox" ${readDraft().research !== false ? "checked" : ""}> Consulta API pubbliche quando servono dati</label><div class="critique-actions"><div class="error" id="critiqueError" role="alert"></div><button class="primary" id="createMap">Crea mappa →</button></div>`;
}
function bindCritiquePanel(target, input, result, options = {}) {
  saveDraft({
    thesis: input.thesis, effort: input.effort,
    critique: result, critiqueThesis: input.thesis,
    previousContext: options.previousContext || "",
  });
  const clarification = target.querySelector("#critiqueClarification");
  const previous = target.querySelector("#critiquePreviousContext");
  target.querySelector("#critiqueResearch").onchange = (event) => {
    saveDraft({ research: event.target.checked });
    $("#landingResearch").checked = event.target.checked;
  };
  const optionButtons = [...target.querySelectorAll("[data-critique-option]")];
  function persistClarification() {
    saveDraft({
      thesis: input.thesis,
      effort: input.effort,
      clarification: clarification.value,
      clarificationThesis: input.thesis,
    });
  }
  clarification.addEventListener("input", persistClarification);
  previous?.addEventListener("input", () => saveDraft({ previousContext: previous.value }));
  optionButtons.forEach((button) => {
    button.onclick = () => {
      clarification.value = result.options[+button.dataset.critiqueOption] || "";
      optionButtons.forEach((item) => item.classList.toggle("selected", item === button));
      persistClarification();
      clarification.focus();
    };
  });
  target.querySelector("#createMap").onclick = async () => {
    const answer = clarification.value.trim();
    persistClarification();
    const priorContext = previous ? previous.value : options.previousContext;
    const context = makeContext(result.question, answer, priorContext);
    if (context.length > 12000) {
      target.querySelector("#critiqueError").textContent = "Il contesto supera 12000 caratteri. Riducilo esplicitamente: non viene tagliato automaticamente.";
      previous?.focus();
      return;
    }
    const research = target.querySelector("#critiqueResearch").checked;
    saveDraft({ research });
    if (options.modal) closeDialog();
    await startLiveAnalysis({ thesis: input.thesis, effort: input.effort, context, research });
  };
}
async function beginCritique(input, options = {}) {
  if (liveController || critiqueController) return;
  const target = options.modal ? $("#dialogContent") : $(options.target || "#landingCritique");
  if (!target) return;
  const token = ++critiqueSequence;
  const controller = new AbortController();
  critiqueController = controller;
  const deadline = setTimeout(
    () => controller.abort(),
    Math.min(configuration?.timeoutMs || 120000, 120000),
  );
  saveDraft({ thesis: input.thesis, effort: input.effort });
  if (options.modal)
    setModalContent(`<div class="critique-thesis"><span class="eyebrow">TESI ORIGINALE</span><div>${escape(input.thesis)}</div></div><p class="critique-loading">Rifletto sulla tesi…</p>`, true);
  else {
    target.hidden = false;
    target.innerHTML = `<div class="critique-thesis"><span class="eyebrow">TESI ORIGINALE</span><div>${escape(input.thesis)}</div></div><p class="critique-loading">Rifletto sulla tesi…</p>`;
  }
  const analyzeButton = $("#landingAnalyze");
  if (analyzeButton) analyzeButton.disabled = true;
  $("#newButton").disabled = $("#journalButton").disabled = true;
  $("#chartsButton").disabled = true;
  try {
    const critiqueBody = { thesis: input.thesis, effort: input.effort };
    if (options.previousContext?.trim()) critiqueBody.context = options.previousContext.trim();
    const result = critiqueResult(
      await api("/api/critique", critiqueBody, controller.signal),
    );
    if (token !== critiqueSequence) return;
    const priorDraft = readDraft();
    if (priorDraft.critiqueThesis !== input.thesis || priorDraft.critique?.question !== result.question) {
      saveDraft({ clarification: "", clarificationThesis: input.thesis });
    }
    const html = critiqueMarkup(input, result, options.previousContext);
    if (options.modal) setModalContent(html, true);
    else target.innerHTML = html;
    bindCritiquePanel(options.modal ? $("#dialogContent") : target, input, result, options);
  } catch (error) {
    if (token !== critiqueSequence) return;
    const message = controller.signal.aborted
      ? "Il chiarimento ha impiegato troppo tempo. Puoi riprovare."
      : error.message || "Chiarimento non disponibile.";
    const retry = `<div class="error" role="alert">${escape(message)}</div><div class="critique-actions"><button class="primary" id="retryCritique">Riprova</button></div>`;
    if (options.modal) setModalContent(retry, true);
    else {
      target.hidden = false;
      target.innerHTML = retry;
    }
    (options.modal ? $("#dialogContent") : target).querySelector("#retryCritique").onclick = () => beginCritique(input, options);
  } finally {
    clearTimeout(deadline);
    if (critiqueController === controller) critiqueController = null;
    if (analyzeButton) analyzeButton.disabled = false;
    $("#newButton").disabled = $("#journalButton").disabled = false;
    $("#chartsButton").disabled = Boolean(!analysis || analysis.draft || liveController || critiqueController);
  }
}
function sameAnalysisRecord(left, right) {
  return left === right || Boolean(left?.id && right?.id && left.id === right.id);
}
function investigateFromDossier(detail = {}) {
  if (liveController || critiqueController || !analysis || analysis.draft) return;
  const record = detail.record;
  if (record && !sameAnalysisRecord(analysis, record)) return;
  const question = typeof detail.question === "string" ? detail.question.trim().slice(0, 900) : "";
  if (!question) return;
  newThesis({
    sourceRecord: record || analysis,
    followUpQuestion: question,
    followUpKind: detail.kind === "assumption" ? "assumption" : "nextCheck",
  });
}
function newThesis(options = {}) {
  if (liveController || critiqueController) return;
  closeMenu();
  const sourceRecord = options.sourceRecord;
  if (sourceRecord && !sameAnalysisRecord(analysis, sourceRecord)) return;
  const current = (sourceRecord || analysis)?.body?.input;
  const followUpQuestion = typeof options.followUpQuestion === "string" ? options.followUpQuestion.trim().slice(0, 900) : "";
  const previousContext = typeof current?.context === "string" ? current.context : "";
  const followUpContext = followUpQuestion
    ? [previousContext, `Controllo da approfondire: ${followUpQuestion}`].filter(Boolean).join("\n")
    : "";
  const contextEditor = followUpQuestion
    ? `<div class="critique-previous"><span class="eyebrow">CONTESTO DA MANTENERE</span><p>La tesi originale resta il punto di partenza. Puoi modificare il contesto prima di chiedere il chiarimento.</p><label class="field" for="followUpContext">Contesto precedente e controllo scelto</label><textarea id="followUpContext" maxlength="12000">${escape(followUpContext)}</textarea>${followUpContext.length > 12000 ? `<p class="error" role="alert">Il contesto supera 12000 caratteri: riducilo esplicitamente prima di continuare. Nulla è stato troncato.</p>` : ""}</div>`
    : "";
  modal(
    `${followUpQuestion ? `<div class="critique-thesis"><span class="eyebrow">TESI ORIGINALE MANTENUTA</span><div>${escape(current?.thesis || readDraft().thesis || "")}</div></div>` : ""}<label class="composer-title" for="thesis">Che cosa pensi possa succedere?</label><textarea id="thesis" maxlength="6000" placeholder="Scrivi la tua idea, come la racconteresti a qualcuno…">${escape(current?.thesis || readDraft().thesis || "")}</textarea>${contextEditor}<div class="composer-controls"><label for="effort">Effort</label><select id="effort" aria-label="Profondità dell’analisi">${Object.entries(
      labels,
    )
      .map(
        ([v, l]) =>
          `<option value="${v}" ${(current?.effort || readDraft().effort || "medium") === v ? "selected" : ""}>${l}</option>`,
      )
      .join(
        "",
      )}</select><button class="primary" id="analyze">Esplora →</button></div><div class="error" id="formError" role="alert"></div>`,
    true,
  );
  $("#thesis").focus();
  $("#thesis").addEventListener("input", () =>
    saveDraft({ thesis: $("#thesis").value, effort: $("#effort").value }),
  );
  $("#effort").addEventListener("change", () =>
    saveDraft({ thesis: $("#thesis").value, effort: $("#effort").value }),
  );
  $("#analyze").onclick = async () => {
    const input = {
      thesis: $("#thesis").value.trim(),
      effort: $("#effort").value,
    };
    if (input.thesis.length < 15) {
      $("#formError").textContent = "Scrivi una tesi di almeno 15 caratteri.";
      return;
    }
    if (sourceRecord && !sameAnalysisRecord(analysis, sourceRecord)) {
      $("#formError").textContent = "Questa analisi non è più attiva. Chiudi e riapri il dossier prima di preparare il controllo.";
      return;
    }
    const context = followUpQuestion ? $("#followUpContext").value : previousContext;
    if (context.length > 12000) {
      $("#formError").textContent = "Il contesto supera 12000 caratteri. Riducilo esplicitamente: non viene tagliato automaticamente.";
      $("#followUpContext")?.focus();
      return;
    }
    saveDraft({ thesis: input.thesis, effort: input.effort });
    await beginCritique(input, {
      modal: true,
      previousContext: context,
    });
  };
}
async function startLiveAnalysis(input) {
  if (liveController || critiqueController) return;
  input = {
    thesis: String(input?.thesis || "").trim(),
    effort: labels[input?.effort] ? input.effort : "medium",
    context: typeof input?.context === "string" ? input.context : "",
    research: input?.research === true,
  };
  if (input.thesis.length < 15) return;
  saveDraft({ thesis: input.thesis, effort: input.effort });
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
  saveFailedAnalysis("Analisi in corso · bozza locale non ancora salvata.");
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
  }, (configuration.timeoutMs || 240000) + (input.research ? configuration.researchTimeoutMs || 90000 : 0));
  const progressClock = setInterval(() => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    // Research and the critical brief intentionally precede graph nodes.
    // Keep the actual phase visible instead of calling that work a stall.
    $("#liveMessage").textContent = `${seconds}s · ${liveMessage}`;
  }, 1000);
  const nodes = new Map(),
    edges = [];
  let repairing = false;
  function event(frame) {
    if (frame.type === "error") throw new Error(frame.data.message);
    if (frame.type === "research") {
      analysis.body.research = frame.data;
      $("#sourcesButton").textContent = `Fonti e dati (${frame.data.sources.length})`;
      saveFailedAnalysis();
      return;
    }
    if (frame.type === "reset") {
      // A replacement is still only a candidate. Keep the first streamed map
      // visible until the server returns a fully validated record; otherwise
      // a slow or failed repair makes useful context disappear abruptly.
      repairing = true;
      nodes.clear();
      edges.length = 0;
      liveMessage = "La prima bozza non ha superato i controlli. Resta visibile mentre preparo la correzione…";
      saveFailedAnalysis();
      render();
      return;
    }
    if (frame.type === "stage") {
      liveMessage = frame.data.message;
      render();
      return;
    }
    if (frame.type === "financial") {
      if (!repairing) analysis.body.graph.financial = frame.data;
      if (!$("#inspector").hidden && $("#closeFocus")) inspectFocus();
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
      if (!repairing) analysis.body.graph.focus = f;
      liveMessage = repairing
        ? "Correzione in preparazione · la prima bozza resta visibile…"
        : "Passaggio decisivo individuato · costruisco i nessi…";
      render();
      if (!repairing) saveFailedAnalysis();
      return;
    }
    if (frame.type === "complete") {
      analysis = frame.data;
      complete = true;
      saveDraft({ failedAnalysis: undefined });
      $("#liveBar").hidden = true;
      render();
      requestFitGraph();
      if (!$("#inspector").hidden && $("#closeFocus")) inspectFocus();
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
    if (repairing) {
      liveMessage = `Correzione in preparazione · ${nodes.size} caselle ricevute · la prima bozza resta visibile…`;
      render();
      return;
    }
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
    saveFailedAnalysis();
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
      ? repairing
        ? "Tempo limite durante la correzione. La prima bozza resta visibile, ma non è stata salvata: puoi riprovare."
        : "Tempo limite raggiunto. La bozza resta visibile ma non è stata salvata: riprova con effort basso o un modello più rapido."
      : controller.signal.aborted
        ? "Analisi interrotta · la bozza visibile non è stata salvata"
        : repairing
          ? `${e.message} La prima bozza resta visibile, ma non è stata salvata.`
          : e.message;
    $("#stopAnalysis").hidden = true;
    $("#retryAnalysis").hidden = false;
    saveFailedAnalysis(liveMessage);
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
  $("#chartsButton").disabled = Boolean(analysis.draft || liveController || critiqueController);
  $("#sourcesButton").textContent = `Fonti e dati${analysis.body.research ? ` (${analysis.body.research.sources.length})` : ""}`;
  $("#focusSummary").hidden = !g.focus;
  $("#focusClaim").textContent = g.focus?.claim || "";
  $("#focusSummary").onclick = inspectFocus;
  $("#canvas").classList.toggle("has-focus", Boolean(g.focus));
  $("#empty").hidden = true;
  const originalThesis = analysis.body.input?.thesis || "";
  $("#originalThesis").hidden = !originalThesis;
  $("#originalThesisText").textContent = originalThesis;
  $("#titleLabel").textContent = g.title;
  $("#effortLabel").textContent =
    "Effort: " + labels[analysis.body.input.effort];
  $("#saveButton").disabled = Boolean(frozen) || Boolean(analysis.draft);
  $("#reviseButton").disabled = Boolean(liveController || critiqueController);
  $("#status").textContent =
    (analysis.draft
      ? "Bozza · non salvata"
      : frozen
        ? "Versione fissata · Salvata nel Diario"
        : "Salvata nel Diario") +
    " · " +
    analysis.body.provenance.model +
    " · " +
    g.nodes.length +
    " nodi";
  $("#liveMessage").textContent = liveMessage;
  $("#liveBar").classList.toggle("running", Boolean(liveController));

  // Render node content before calculating geometry. offsetHeight now reflects
  // long labels, so links leave each card at its actual edge instead of the
  // previous fixed 130px box.
  const existing = new Map(
    [...$("#graph").querySelectorAll("[data-node]")].map((el) => [
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
      button.onclick = () => inspect(button.dataset.node);
      $("#graph").append(button);
    }
    existing.delete(n.id);
    button.classList.add("node");
    for (const kind of ["thesis", "consequence", "alternative"])
      button.classList.toggle(kind, n.kind === kind);
    button.classList.toggle("selected", n.id === selected);
    const relation = g.edges.find((edge) => edge.to === n.id)?.relation;
    const role = n.kind === "thesis" ? "Tesi" : relationLabels[relation] || (n.kind === "alternative" ? "Alternativa" : "Conseguenza");
    const content = `<small>${escape(role)}<span>L${n.depth}</span></small><strong>${escape(n.label)}</strong><span>${analysis.draft ? "In costruzione · provvisorio" : "Ipotesi · da verificare"}${n.sourceIds?.length ? ` · ${n.sourceIds.length} fonti citate` : ""}</span>`;
    if (button.innerHTML !== content) button.innerHTML = content;
  }
  for (const el of existing.values()) el.remove();

  const metric = (n) => {
    const button = $("#graph").querySelector(`[data-node="${CSS.escape(n.id)}"]`);
    return {
      width: Math.max(1, button?.offsetWidth || 235),
      height: Math.max(1, button?.offsetHeight || 115),
    };
  };
  const metrics = new Map(g.nodes.map((n) => [n.id, metric(n)]));
  const grouped = {};
  g.nodes.forEach((n) => (grouped[n.depth] ??= []).push(n));
  const maxDepth = Math.max(...g.nodes.map((n) => n.depth));
  const radii = [0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const layer = grouped[depth] || [];
    const widest = Math.max(...layer.map((n) => metrics.get(n.id).width), 235);
    const circumferenceRadius =
      ((layer.length || 1) * Math.max(280, widest + 80)) / (Math.PI * 2);
    radii[depth] = Math.max(
      radii[depth - 1] + Math.max(300, widest + 80),
      circumferenceRadius,
    );
  }
  const outerRadius = radii[maxDepth] || 0;
  const center = outerRadius + 180;
  const positions = new Map();
  const children = new Map(g.nodes.map((n) => [n.id, []]));
  const parent = new Set();
  for (const edge of g.edges) {
    if (!parent.has(edge.to) && children.has(edge.from)) {
      children.get(edge.from).push(edge.to);
      parent.add(edge.to);
    }
  }
  const root = g.nodes.find((n) => n.kind === "thesis")?.id;
  const weights = new Map();
  const weighting = new Set();
  function branchWeight(id) {
    if (weights.has(id)) return weights.get(id);
    if (weighting.has(id)) return 1;
    weighting.add(id);
    const descendants = children.get(id) || [];
    const weight = descendants.length
      ? descendants.reduce((sum, child) => sum + branchWeight(child), 0)
      : 1;
    weighting.delete(id);
    weights.set(id, weight);
    return weight;
  }
  function placeBranch(id, startAngle, endAngle) {
    if (positions.has(id)) return;
    const node = g.nodes.find((item) => item.id === id);
    const angle = (startAngle + endAngle) / 2;
    const radius = radii[node.depth] || 0;
    const size = metrics.get(id);
    positions.set(id, {
      x: center + Math.cos(angle) * radius - size.width / 2,
      y: center + Math.sin(angle) * radius - size.height / 2,
    });
    const descendants = children.get(id) || [];
    const total = descendants.reduce(
      (sum, child) => sum + branchWeight(child),
      0,
    );
    let cursor = startAngle;
    for (const child of descendants) {
      const next = cursor + ((endAngle - startAngle) * branchWeight(child)) / total;
      placeBranch(child, cursor, next);
      cursor = next;
    }
  }
  if (root) {
    // Orient the first branch horizontally: two branches should use the wide
    // canvas, not collapse into a tall column that forces unreadable zoom.
    const branches = children.get(root) || [];
    const total = branches.reduce((sum, id) => sum + branchWeight(id), 0);
    const start = total ? -Math.PI * branchWeight(branches[0]) / total : -Math.PI;
    placeBranch(root, start, start + Math.PI * 2);
  }
  const unplaced = g.nodes.filter((n) => !positions.has(n.id));
  unplaced.forEach((n, i) => {
    const angle = (Math.PI * 2 * i) / Math.max(1, unplaced.length);
    const size = metrics.get(n.id);
    positions.set(n.id, {
      x: center + Math.cos(angle) * outerRadius - size.width / 2,
      y: center + Math.sin(angle) * outerRadius - size.height / 2,
    });
  });
  const nodeCenter = (id) => {
    const position = positions.get(id),
      size = metrics.get(id);
    return {
      x: position.x + size.width / 2,
      y: position.y + size.height / 2,
    };
  };
  const edgeAnchor = (id, from, toward) => {
    const size = metrics.get(id),
      halfWidth = size.width / 2,
      halfHeight = size.height / 2;
    const dx = toward.x - from.x,
      dy = toward.y - from.y,
      denominator = Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight),
      scale = denominator ? 1 / denominator : 0;
    return { x: from.x + dx * scale, y: from.y + dy * scale };
  };
  const edges = g.edges
    .filter((e) => positions.has(e.from) && positions.has(e.to))
    .map((e) => {
      const reverse = ["supports", "challenges", "measures"].includes(e.relation);
      const from = reverse ? e.to : e.from, to = reverse ? e.from : e.to;
      const ac = nodeCenter(from),
        bc = nodeCenter(to),
        start = edgeAnchor(from, ac, bc),
        end = edgeAnchor(to, bc, ac),
        bend = Math.min(90, Math.hypot(end.x - start.x, end.y - start.y) / 3),
        c1 = {
          x: start.x + ((end.x - start.x) * bend) / 180,
          y: start.y + ((end.y - start.y) * bend) / 180,
        },
        c2 = {
          x: end.x - ((end.x - start.x) * bend) / 180,
          y: end.y - ((end.y - start.y) * bend) / 180,
        };
      const label = { causes: "può causare", requires: "richiede", supports: "sostiene", challenges: "mette in dubbio", measures: "misura" }[e.relation];
      return `<path d="M${start.x} ${start.y} C${c1.x} ${c1.y},${c2.x} ${c2.y},${end.x} ${end.y}" fill="none" stroke="#a8b9ae" stroke-width="1.2" marker-end="url(#arrow)"><title>${escape(e.mechanism)}</title></path>${label ? `<text x="${(start.x + end.x) / 2}" y="${(start.y + end.y) / 2 - 6}" text-anchor="middle" class="edge-label">${escape(label)}</text>` : ""}`;
    })
    .join("");
  const bounds = g.nodes.reduce(
    (box, n) => {
      const p = positions.get(n.id), size = metrics.get(n.id);
      box.minX = Math.min(box.minX, p.x);
      box.minY = Math.min(box.minY, p.y);
      box.maxX = Math.max(box.maxX, p.x + size.width);
      box.maxY = Math.max(box.maxY, p.y + size.height);
      return box;
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const padding = 100;
  const width = Math.max(1, bounds.maxX + padding),
    height = Math.max(1, bounds.maxY + padding);
  layout = {
    positions,
    metrics,
    bounds: {
      minX: bounds.minX,
      minY: bounds.minY,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
    },
  };
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
  for (const n of g.nodes) {
    const button = $("#graph").querySelector(`[data-node="${CSS.escape(n.id)}"]`);
    button.style.left = positions.get(n.id).x + "px";
    button.style.top = positions.get(n.id).y + "px";
  }
  transform();
}
function requestFitGraph() {
  fitRequested = true;
  if (fitFrame) return;
  fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    if (fitRequested) {
      fitRequested = false;
      fitGraph();
    }
  });
}
function fitGraph() {
  if (!layout?.bounds) return;
  const canvas = $("#canvas");
  if (!canvas.clientWidth || !canvas.clientHeight) return;
  const canvasTop = canvas.getBoundingClientRect().top;
  const topInset = Math.max(18, ...["#originalThesis", "#focusSummary"].map((selector) => {
    const element = $(selector);
    return element.hidden ? 0 : element.getBoundingClientRect().bottom - canvasTop + 20;
  }));
  const availableWidth = Math.max(160, canvas.clientWidth - 36);
  const availableHeight = Math.max(100, canvas.clientHeight - topInset - 24);
  const { bounds } = layout;
  zoom = Math.max(
    0.25,
    Math.min(1.5, availableWidth / bounds.width, availableHeight / bounds.height),
  );
  pan = {
    x: (canvas.clientWidth - bounds.width * zoom) / 2 - bounds.minX * zoom,
    y: topInset + (availableHeight - bounds.height * zoom) / 2 -
      bounds.minY * zoom - $("#graph").offsetTop,
  };
  transform();
}
function hasChartItems(record) {
  const charts = record?.body?.charts;
  return Boolean(
    charts &&
      typeof charts === "object" &&
      charts.version === "nesso-charts-v1" &&
      Array.isArray(charts.items) &&
      charts.items.some(
        (item) => item && typeof item === "object" && ["line", "bar"].includes(item.type),
      ),
  );
}
function fallbackFinancialMarkup(graph) {
  const financial = graph?.financial && typeof graph.financial === "object" ? graph.financial : null;
  if (!financial) return "";
  const calculations = Array.isArray(financial.calculations)
    ? financial.calculations.filter((calculation) => calculation && calculation.arithmeticValid === true && Number.isFinite(calculation.result))
    : [];
  const assumptions = Array.isArray(financial.assumptions)
    ? financial.assumptions.map((assumption) => typeof assumption === "string" ? assumption.trim() : String(assumption?.claim || "").trim()).filter(Boolean)
    : [];
  if (!financial.conclusion && !calculations.length && !assumptions.length) return "";
  let number = (value) => {
    try { return new Intl.NumberFormat("it-IT", { maximumSignificantDigits: 12 }).format(value); } catch { return String(value); }
  };
  return `<section class="analysis-section analysis-financial"><span class="eyebrow">CALCOLI E ASSUNZIONI</span><h2>Che cosa segue dai numeri</h2>${financial.conclusion ? `<p>${escape(financial.conclusion)}</p>` : ""}${calculations.length ? `<div class="analysis-calculations">${calculations.map((calculation) => `<article><strong>${escape(calculation.label || "Calcolo verificato")}</strong><p>${escape(calculation.expression || "Espressione non indicata")} = <b>${escape(number(calculation.result))}${calculation.unit ? ` ${escape(calculation.unit)}` : ""}</b></p><small>Base: ${escape(calculation.basis || "Non indicata")}</small></article>`).join("")}</div>` : `<p class="analysis-empty-inline">Nessun calcolo numerico convalidato nel dossier.</p>`}${assumptions.length ? `<h3>Assunzioni numeriche</h3><ul class="analysis-item-list">${assumptions.map((assumption) => `<li>${escape(assumption)}</li>`).join("")}</ul>` : ""}${financial.limitation ? `<p class="muted">Limite: ${escape(financial.limitation)}</p>` : ""}<p class="muted">Sono mostrati solo risultati marcati come aritmeticamente validi; la scelta della formula e il nesso causale restano da verificare.</p></section>`;
}

const EVIDENCE_AUDIT_VERSION = "nesso-evidence-audit-v1";
function fallbackSourceAnchor(id) {
  const safe = String(id || "source").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "source";
  return `source-card-${safe}`;
}
function fallbackSourceDate(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const raw = value.trim();
  if (/^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(raw)) return raw;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("it-IT") : raw;
}
function fallbackSourceTiming(source) {
  const data = source?.data && typeof source.data === "object" ? source.data : {};
  const first = (...keys) => {
    for (const key of keys) {
      const value = source?.[key] ?? data[key];
      const label = fallbackSourceDate(value);
      if (label) return label;
    }
    return "";
  };
  const publication = first("publishedAt", "publicationDate", "publicationTime", "published");
  const filing = first("filedAt", "filingDate", "filed");
  const observation = first("observedAt", "observationDate", "observationTime", "observed");
  const observationLabels = Array.isArray(data.observations) ? data.observations.map((row) => String(row?.date || row?.period || row?.label || "")).filter((label) => /^\d{4}(?:-\d{2}){0,2}$/.test(label)).sort() : [];
  const observationRange = observationLabels.length > 1 ? `Osservazioni ${observationLabels[0]} – ${observationLabels[observationLabels.length - 1]}` : observationLabels.length === 1 ? `Osservata ${observationLabels[0]}` : "";
  const period = first("periodOfReport", "reportPeriod", "reportDate");
  const updated = first("updatedAt", "lastUpdated");
  const acquired = fallbackSourceDate(source?.retrievedAt);
  return [publication && `Pubblicata ${publication}`, filing && `Depositata ${filing}`, observation && `Osservata ${observation}`, !observation && observationRange, period && `Periodo del report ${period}`, updated && `Aggiornata ${updated}`, acquired && `Acquisita ${acquired}`].filter(Boolean);
}
function fallbackSourceDetails(source) {
  const data = source?.data && typeof source.data === "object" ? source.data : {};
  const excerpts = Array.isArray(data.excerpts)
    ? data.excerpts.map((part) => typeof part === "string" ? part : String(part?.text || "")).filter(Boolean).slice(0, 3).map((part) => part.slice(0, 520))
    : [];
  const observations = Array.isArray(data.observations)
    ? data.observations.slice(0, 4).map((row) => `${row?.date || row?.period || row?.label || "Periodo non indicato"}: ${row?.value === null || row?.value === undefined ? "mancante" : String(row.value).slice(0, 120)}`)
    : [];
  const descriptions = [data.caveat, data.coverage, data.description, data.definition, data.notes].filter((item) => typeof item === "string" && item.trim()).slice(0, 2).map((item) => item.trim().slice(0, 520));
  if (source.kind === "discovery") return `<div class="analysis-source-details"><strong>Elenco della ricerca</strong><p>Risultato di ricerca: è solo un elenco, non una fonte letta e non costituisce evidenza.</p>${[...descriptions, ...observations].slice(0, 3).map((item) => `<p>${escape(item)}</p>`).join("")}</div>`;
  if (!excerpts.length && !observations.length && !descriptions.length) return "";
  return `<div class="analysis-source-details"><strong>Estratti originali della fonte</strong><p>Estratti e dati ricevuti; non sono verificati dal dossier e non dimostrano la tesi.</p>${excerpts.map((item) => `<blockquote>${escape(item)}</blockquote>`).join("")}${observations.map((item) => `<p>${escape(item)}</p>`).join("")}${descriptions.map((item) => `<p>${escape(item)}</p>`).join("")}</div>`;
}
function fallbackSourceRefs(ids, sources) {
  const byId = new Map(sources.filter((source) => typeof source.id === "string").map((source) => [source.id, source]));
  return (Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && id.trim()).map((id) => {
    const source = byId.get(id);
    return source
      ? `<a href="#${escape(fallbackSourceAnchor(id))}"><span class="source-id">${escape(id)}</span> · ${escape(source.title || `Fonte ${id}`)}</a>`
      : `<span class="source-ref-missing">${escape(id)} · fonte non presente</span>`;
  }).join(" · ");
}
function fallbackSourceCards(sources) {
  const seen = new Set();
  const cards = sources.filter((source) => {
    if (!source?.id || seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  }).map((source) => {
    const href = safeSourceUrl(source.url);
    const title = String(source.title || source.id);
    const timing = fallbackSourceTiming(source);
    return `<article class="analysis-source-card" id="${escape(fallbackSourceAnchor(source.id))}" tabindex="-1"><span class="eyebrow">${escape(source.id)} · ${escape(source.provider || "")} · ${source.kind === "discovery" ? "ELENCO DI RICERCA" : "FONTE RECUPERATA"}</span><h3>${href ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(title)} ↗</a>` : escape(title)}</h3>${timing.length ? `<p class="analysis-source-meta">${escape(timing.join(" · "))}</p>` : ""}${!href && source.url ? `<small>URL esterno non collegato: non è un HTTPS sicuro.</small>` : ""}${fallbackSourceDetails(source)}</article>`;
  }).join("");
  return cards ? `<section class="analysis-section analysis-sources" id="analysis-sources"><span class="eyebrow">FONTI ESTRATTI</span><h2>Fonti presenti nel dossier</h2><p class="muted">Le fonti sono mostrate come materiale ricevuto. La presenza o la citazione non prova pertinenza, autenticità o nesso causale.</p>${cards}</section>` : "";
}
function fallbackEvidenceAuditMarkup(body) {
  const audit = body?.evidenceAudit;
  if (!audit || typeof audit !== "object" || audit.version !== EVIDENCE_AUDIT_VERSION) return `<section class="analysis-section analysis-evidence-audit"><span class="eyebrow">COPERTURA DELLE EVIDENZE</span><h2>Che cosa è stato letto</h2><p class="analysis-audit-unavailable">Report di copertura non disponibile per questo record precedente.</p></section>`;
  const counts = audit.counts && typeof audit.counts === "object" ? audit.counts : {};
  const value = (key) => Number.isInteger(counts[key]) && counts[key] >= 0 ? counts[key] : 0;
  const facts = [["Fonti recuperate", "retrieved"], ["Fonti lette", "read"], ["Risultati solo elenco", "discovery"], ["Fonti citate", "cited"], ["Ipotesi senza citazione", "uncitedClaims"], ["Riferimenti irrisolti", "unresolvedClaims"]];
  const claims = Array.isArray(audit.claims) ? audit.claims.filter((claim) => claim && typeof claim === "object") : [];
  const uncited = claims.filter((claim) => claim.citationState === "uncited");
  const unresolved = claims.filter((claim) => claim.citationState === "unresolved" || (Array.isArray(claim.issues) && claim.issues.length) || (Array.isArray(claim.sourceIds) && Array.isArray(claim.validSourceIds) && claim.sourceIds.some((id) => !claim.validSourceIds.includes(id))));
  const auditSources = Array.isArray(audit.sources) ? audit.sources.filter((source) => source && typeof source === "object" && source.id && source.available !== true) : [];
  const listingSources = auditSources.filter((source) => source.kind === "discovery");
  const otherSources = auditSources.filter((source) => source.kind !== "discovery");
  const availabilityText = [listingSources.length ? `Non citabili come evidenza (solo elenco): ${listingSources.map((source) => source.id).join(", ")}.` : "", otherSources.length ? `Fonti non disponibili: ${otherSources.map((source) => source.id).join(", ")}.` : ""].filter(Boolean).join(" ");
  const warnings = Array.isArray(audit.warnings) ? audit.warnings.filter((warning) => typeof warning === "string" && warning.trim()).slice(0, 12) : [];
  return `<section class="analysis-section analysis-evidence-audit"><span class="eyebrow">COPERTURA DELLE EVIDENZE</span><h2>Che cosa è stato letto</h2><div class="analysis-audit-grid">${facts.map(([label, key]) => `<div><strong>${escape(value(key))}</strong><span>${escape(label)}</span></div>`).join("")}</div><p class="muted">Le fonti lette e quelle citate sono conteggi tecnici: la disponibilità non dimostra la correttezza della tesi.</p>${uncited.length ? `<h3>Ipotesi senza citazione</h3><ul class="analysis-audit-list">${uncited.slice(0, 8).map((claim) => `<li>${escape(claim.claim || claim.id || "Ipotesi non descritta")}</li>`).join("")}</ul>` : ""}${unresolved.length ? `<h3>Riferimenti da risolvere</h3><ul class="analysis-audit-list">${unresolved.slice(0, 8).map((claim) => `<li>${escape(claim.claim || claim.id || "Riferimento non risolto")}${Array.isArray(claim.issues) && claim.issues.length ? `<small>${escape(claim.issues.join(" · "))}</small>` : ""}</li>`).join("")}</ul>` : ""}${availabilityText ? `<p class="muted">${escape(availabilityText)}</p>` : ""}${warnings.length ? `<div class="analysis-audit-warnings"><strong>Avvertenze del report</strong><ul>${warnings.map((warning) => `<li>${escape(warning)}</li>`).join("")}</ul></div>` : ""}</section>`;
}
function fallbackInvestigationItems(record) {
  const body = record?.body && typeof record.body === "object" ? record.body : {};
  const graph = body.graph && typeof body.graph === "object" ? body.graph : {};
  const reasoning = graph.reasoning && typeof graph.reasoning === "object" ? graph.reasoning : {};
  const uncertainties = Array.isArray(graph.uncertainties) ? graph.uncertainties.filter((item) => typeof item === "string" && item.trim()) : [];
  const assumptions = Array.isArray(reasoning.assumptions) && reasoning.assumptions.length ? reasoning.assumptions : uncertainties.map((claim) => ({ claim, howToTest: "Definire una misura e una fonte prima di trarre conclusioni." }));
  const nextChecks = Array.isArray(reasoning.nextChecks) && reasoning.nextChecks.length ? reasoning.nextChecks : graph.focus?.test ? [{ question: graph.focus.test }] : [];
  return { assumptions, nextChecks };
}
function bindAnalysisInvestigations(container, record) {
  if (!container || typeof container.addEventListener !== "function") return;
  if (container.__nessoAnalysisInvestigationCleanup) container.__nessoAnalysisInvestigationCleanup();
  const items = fallbackInvestigationItems(record);
  const handler = (event) => {
    const button = event.target?.closest?.("[data-investigate-kind][data-investigate-index]");
    if (!button || !container.contains?.(button)) return;
    const kind = button.dataset.investigateKind;
    const index = Number(button.dataset.investigateIndex);
    const item = items[kind === "assumption" ? "assumptions" : "nextChecks"][index];
    const question = String(kind === "assumption" ? item?.howToTest || item?.claim : item?.question || "").trim().slice(0, 900);
    if (!question) return;
    investigateFromDossier({ kind, question, record });
  };
  container.addEventListener("click", handler);
  container.__nessoAnalysisInvestigationCleanup = () => container.removeEventListener("click", handler);
}
function fallbackAnalysisMarkup(record, note = "") {
  const body = record?.body && typeof record.body === "object" ? record.body : {};
  const g = body.graph && typeof body.graph === "object" ? body.graph : {};
  const reasoning = g.reasoning && typeof g.reasoning === "object" ? g.reasoning : {};
  const thesis = String(body.input?.thesis || g.nodes?.find?.((node) => node?.kind === "thesis")?.label || "Tesi originale non disponibile.");
  const sources = Array.isArray(body.research?.sources)
    ? body.research.sources.filter((source) => source && typeof source === "object" && typeof source.id === "string" && source.id.trim())
    : [];
  const usefulSources = sources.filter((source) => source.kind !== "discovery");
  const supporting = Array.isArray(reasoning.supporting)
    ? reasoning.supporting.filter((item) => item && typeof item.claim === "string" && item.claim.trim()).map((item) => ({ ...item, sourceIds: Array.isArray(item.sourceIds) ? item.sourceIds.filter((id) => typeof id === "string") : [] }))
    : [];
  const opposing = Array.isArray(reasoning.opposing)
    ? reasoning.opposing.filter((item) => item && typeof item.claim === "string" && item.claim.trim()).map((item) => ({ ...item, sourceIds: Array.isArray(item.sourceIds) ? item.sourceIds.filter((id) => typeof id === "string") : [] }))
    : [];
  const uncertainties = Array.isArray(g.uncertainties)
    ? g.uncertainties.filter((item) => typeof item === "string" && item.trim())
    : [];
  const assumptions = Array.isArray(reasoning.assumptions) && reasoning.assumptions.length
    ? reasoning.assumptions
    : uncertainties.map((claim) => ({ claim, howToTest: "Definire una misura e una fonte prima di trarre conclusioni." }));
  const nextChecks = Array.isArray(reasoning.nextChecks) && reasoning.nextChecks.length
    ? reasoning.nextChecks
    : g.focus?.test
      ? [{ question: g.focus.test, whyItMatters: g.focus.why || "È il passaggio indicato come decisivo.", sourceHint: "Fonte da fissare." }]
      : [];
  const scenarios = Array.isArray(reasoning.scenarios) ? reasoning.scenarios : [];
  const limitations = Array.isArray(reasoning.limitations) && reasoning.limitations.length
    ? reasoning.limitations
    : ["La mappa organizza ipotesi e verifiche; non dimostra da sola un nesso causale.", ...(g.focus?.assumption ? [`Assunzione da verificare: ${g.focus.assumption}`] : [])];
  const listMarkup = (items, empty, render) => items.length
    ? `<ul class="analysis-item-list">${items.map(render).join("")}</ul>`
    : `<p class="analysis-empty-inline">${escape(empty)}</p>`;
  const sourceMarkup = sources.length
    ? `<ul class="analysis-source-list">${sources.map((source) => { const id = typeof source.id === "string" ? source.id : "Fonte"; const title = String(source.title || id); return `<li><a href="#${escape(fallbackSourceAnchor(id))}"><span class="source-id">${escape(id)}</span> · ${escape(title)}</a>${source.provider ? `<small>${escape(source.provider)}${source.kind === "discovery" ? " · risultato di ricerca, non evidenza recuperata" : ""}</small>` : source.kind === "discovery" ? `<small>Risultato di ricerca, non evidenza recuperata.</small>` : ""}</li>`; }).join("")}</ul>`
    : `<p class="analysis-empty-inline">Nessuna fonte recuperata nel dossier.</p>`;
  const effort = String(body.input?.effort || "").toLowerCase();
  const effortText = { low: "Essenziale: tesi, passaggio chiave e dati mancanti.", medium: "Verifica: tesi, fonti e controlli necessari.", high: "Confronto: argomenti a favore, contrari e assunzioni.", max: "Scenari e obiezioni: meccanismi alternativi e differenze osservabili." }[effort] || "L’effort organizza l’esplorazione.";
  const chartMessage = hasChartItems(record)
    ? note || "La serie è presente, ma la resa grafica non è disponibile in questa versione dell’interfaccia."
    : "Nessuna serie numerica sufficiente nelle fonti recuperate. Non vengono inventati grafici da nodi, voti o probabilità.";
  return `<div class="analysis-view analysis-view-fallback"><div class="analysis-view-header"><div><span class="eyebrow">DOSSIER · VISTA DI RISERVA</span><h1>${escape(g.title || "Analisi e grafici")}</h1><p class="analysis-lede">Lettura strutturata della tesi e dei controlli ancora necessari.</p></div><section class="analysis-deepening"><span class="eyebrow">PROFONDITÀ DELL’ESPLORAZIONE</span><strong>Effort ${escape(labels[effort] || "non indicato")}</strong><p>${escape(effortText)}</p><small>${body.provenance?.deepening?.reason ? `${escape(body.provenance.deepening.reason)} ` : ""}L’effort non garantisce accuratezza o validità scientifica.</small></section></div><section class="analysis-thesis"><span class="eyebrow">TESI ORIGINALE</span><blockquote>${escape(thesis)}</blockquote><p><span class="badge">Ipotesi non verificata</span> Punto di partenza, non risultato già dimostrato.</p></section>${usefulSources.length ? `<div class="analysis-notice"><strong>Fonti citate, causalità non dimostrata.</strong><p>${usefulSources.length} ${usefulSources.length === 1 ? "fonte recuperata" : "fonti recuperate"}; la citazione non prova pertinenza o nesso causale.</p>${sourceMarkup}</div>` : `<div class="analysis-notice analysis-warning"><strong>Fonti o dati mancanti.</strong><p>${sources.length ? "Sono presenti solo risultati di ricerca, non fonti recuperate utilizzabili come evidenza." : "Le conclusioni restano ipotesi da verificare."}</p>${sourceMarkup}</div>`}${plannerNotesMarkup(body)}${fallbackEvidenceAuditMarkup(body)}<section class="analysis-section"><span class="eyebrow">RAGIONAMENTO</span><h2>Che cosa stiamo valutando</h2><p class="analysis-question">${escape(reasoning.question || thesis)}</p><h3>Conclusione provvisoria</h3><div class="analysis-conclusion">${escape(reasoning.provisionalConclusion || g.summary || g.focus?.claim || g.financial?.conclusion || "Nessuna conclusione provvisoria disponibile.")}</div><p class="muted">Va distinta da una prova e può cambiare con dati migliori.</p></section>${fallbackFinancialMarkup(g)}<div class="analysis-columns"><section class="analysis-section"><span class="eyebrow">A FAVORE</span><h2>Elementi di sostegno</h2>${listMarkup(supporting, "Nessun elemento a favore esplicito.", (item) => `<li><strong>${escape(item.claim)}</strong>${item.sourceIds?.length ? `<small>Fonti citate: ${fallbackSourceRefs(item.sourceIds, sources)}</small>` : ""}</li>`)}</section><section class="analysis-section"><span class="eyebrow">CONTRO</span><h2>Obiezioni e confronto</h2>${listMarkup(opposing, "Nessuna obiezione esplicita: l’assenza non equivale a conferma.", (item) => `<li><strong>${escape(item.claim)}</strong>${item.sourceIds?.length ? `<small>Fonti citate: ${fallbackSourceRefs(item.sourceIds, sources)}</small>` : ""}</li>`)}</section></div><section class="analysis-section"><span class="eyebrow">ASSUNZIONI</span><h2>Che cosa deve essere vero</h2>${listMarkup(assumptions, "Nessuna assunzione esplicita.", (item, index) => `<li><strong>${escape(item.claim || item)}</strong>${item.howToTest ? `<span>Come testarla: ${escape(item.howToTest)}</span><button type="button" class="analysis-investigate" data-investigate-kind="assumption" data-investigate-index="${index}">Prepara questa verifica →</button>` : ""}</li>`)}</section>${scenarios.length ? `<section class="analysis-section"><span class="eyebrow">SCENARI</span><h2>Meccanismi alternativi</h2><div class="analysis-scenario-grid">${scenarios.map((item) => `<article><h3>${escape(item.name || "Scenario")}</h3>${item.mechanism ? `<p><strong>Meccanismo</strong><br>${escape(item.mechanism)}</p>` : ""}${item.observableDifference ? `<p><strong>Differenza osservabile</strong><br>${escape(item.observableDifference)}</p>` : ""}</article>`).join("")}</div></section>` : ""}<section class="analysis-section"><span class="eyebrow">PROSSIMI CONTROLLI</span><h2>Che cosa verificare ora</h2>${listMarkup(nextChecks, "Nessun controllo successivo esplicito.", (item, index) => `<li><strong>${escape(item.question || item)}</strong>${item.whyItMatters ? `<span>Perché conta: ${escape(item.whyItMatters)}</span>` : ""}${item.sourceHint ? `<small>Fonte suggerita: ${escape(item.sourceHint)}</small>` : ""}<button type="button" class="analysis-investigate" data-investigate-kind="nextCheck" data-investigate-index="${index}">Prepara questo controllo →</button></li>`)}</section><section class="analysis-section"><span class="eyebrow">LIMITI</span><h2>Che cosa il dossier non può concludere</h2><ul class="analysis-item-list">${limitations.map((item) => `<li>${escape(item)}</li>`).join("")}</ul></section><section class="analysis-section analysis-charts-section"><span class="eyebrow">DATI</span><h2>Grafici disponibili</h2><div class="analysis-empty-chart"><p>${escape(chartMessage)}</p></div></section>${fallbackSourceCards(sources)}</div>`;
}
async function analysisView() {
  if (!analysis || analysis.draft || liveController || critiqueController) return;
  const viewRecord = analysis;
  closeMenu();
  analysisViewActive = true;
  $("#journal").hidden = true;
  $("#workspace").hidden = false;
  $("#canvas").hidden = true;
  $("#inspector").hidden = true;
  $("#liveBar").hidden = true;
  $("#analysisPanel").hidden = false;
  $("#chartsButton").setAttribute("aria-pressed", "true");
  const panel = $("#analysisPanel");
  const chartFeatureReady = configuration?.features?.charts === true;
  panel.innerHTML = fallbackAnalysisMarkup(
    viewRecord,
    chartFeatureReady ? "Caricamento grafici…" : "La resa grafica richiede il supporto charts del server; il dossier resta consultabile.",
  );
  bindAnalysisInvestigations(panel, viewRecord);
  if (!chartFeatureReady) return;
  try {
    // Keep this import conditional: older servers do not serve charts.js and
    // must continue to render the structured fallback without an error.
    chartsModulePromise ||= import("/charts.js");
    const module = await chartsModulePromise;
    if (!analysisViewActive || analysis !== viewRecord || viewRecord.draft) return;
    if (typeof module.renderAnalysisView !== "function") throw new Error("Renderer grafici non disponibile.");
    module.renderAnalysisView(panel, viewRecord, { onInvestigate: investigateFromDossier });
  } catch (error) {
    if (!analysisViewActive || analysis !== viewRecord) return;
    panel.innerHTML = fallbackAnalysisMarkup(
      viewRecord,
      "I grafici non sono stati caricati; il dossier testuale resta disponibile. Nessun dato è stato trasformato o inventato.",
    );
    bindAnalysisInvestigations(panel, viewRecord);
  }
}
function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["www.sec.gov", "data.sec.gov", "api.worldbank.org", "fred.stlouisfed.org"].includes(url.hostname) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
function sourceCards(sources) {
  return sources.map((s) => {
    const data = s.data || {}, href = safeSourceUrl(s.url);
    const timing = fallbackSourceTiming(s);
    const rows = Array.isArray(data.observations) ? data.observations : null;
    const preview = rows
      ? `<p>${escape(data.name || s.title)} · ${escape(data.units || data.unit || "")} · ${escape(data.frequency || "")} · ${escape(data.seasonalAdjustment || "")}</p><table><thead><tr><th>Periodo</th><th>Valore</th></tr></thead><tbody>${rows.slice(0, 24).map((r) => `<tr><td>${escape(r.date)}</td><td>${r.value === null ? "Mancante" : escape(r.value)}</td></tr>`).join("")}</tbody></table>`
      : Array.isArray(data.excerpts)
        ? data.excerpts.slice(0, 3).map((part) => `<blockquote>${escape(String(part?.text || part).slice(0, 520))}</blockquote>`).join("")
        : Array.isArray(data.transactions)
          ? `<p>${escape(data.issuer?.issuerName)} · ${escape(data.periodOfReport)}</p><table><thead><tr><th>Data</th><th>Codice</th><th>Quantità</th><th>Prezzo/unità</th></tr></thead><tbody>${data.transactions.slice(0, 24).map((r) => `<tr><td>${escape(r.date)}</td><td>${escape(r.code)}${r.derivative ? " · derivato" : ""}</td><td>${escape(r.shares ?? "Non indicata")}</td><td>${escape(r.pricePerShare ?? "Non indicato")}</td></tr>`).join("")}</tbody></table><p>Note, titoli e condizioni sono nei dati completi sotto.</p>`
          : `<p>${escape(data.coverage || data.description || (s.kind === "discovery" ? "Risultato di ricerca: non costituisce ancora evidenza sulla tesi." : "Dati strutturati della fonte."))}</p>`;
    return `<article class="source-card" id="${escape(fallbackSourceAnchor(s.id))}"><span class="eyebrow">${escape(s.id)} · ${escape(s.provider)} · ${s.kind === "discovery" ? "ELENCO DI RICERCA" : "FONTE RECUPERATA"}</span><h3>${href ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(s.title)} ↗</a>` : escape(s.title)}</h3>${timing.length ? `<small>${escape(timing.join(" · "))}</small>` : ""}${s.kind === "discovery" ? `<p class="muted">Risultato di ricerca: solo elenco, non evidenza letta.</p>` : ""}${preview}${data.caveat ? `<p class="callout">${escape(data.caveat)}</p>` : ""}<details><summary>Dati completi e note della fonte</summary><pre>${escape(JSON.stringify(data, null, 2))}</pre></details></article>`;
  }).join("");
}
function plannerNotesOf(value) {
  const notes = [];
  const add = (candidate) => {
    if (!Array.isArray(candidate)) return;
    candidate.forEach((note) => {
      if (typeof note === "string" && note.trim()) notes.push(note.trim().slice(0, 1000));
    });
  };
  add(value?.plannerNotes);
  add(value?.research?.plannerNotes);
  add(value?.evidence?.plannerNotes);
  return [...new Set(notes)].slice(0, 8);
}
function plannerNotesMarkup(value) {
  const notes = plannerNotesOf(value);
  if (!notes.length) return "";
  return `<section class="analysis-section analysis-planner-notes"><span class="eyebrow">LIMITI PROPOSTI DAL MODELLO · NON VERIFICATI</span><details><summary>Limiti proposti dal modello · non verificati (${notes.length})</summary><p class="muted">Note prodotte durante la ricerca: possono essere superate dalle letture successive. Non sono dati o fonti, non dimostrano la tesi e non sostituiscono una verifica.</p><ul class="analysis-item-list">${notes.map((note) => `<li>${escape(note)}</li>`).join("")}</ul></details></section>`;
}
function sourcesDialog() {
  const r = analysis?.body.research || analysis?.body.evidence;
  const sources = r?.sources || [];
  modal(`<span class="eyebrow">RICERCA SU RICHIESTA</span><h2>Fonti e dati</h2><p>Il modello resta sul provider configurato. Solo le query e gli identificatori necessari vengono inviati alle API pubbliche. Nessun archivio preventivo, nessun motore di ricerca web.</p><div class="source-status">${(configuration?.dataSources || []).map((s) => `<p><strong>${escape(s.name)}</strong> · ${s.ready ? "Configurata" : "Da configurare"}<br><small>${escape(s.description)}</small>${s.ready ? "" : `<br><code>${escape(s.setup)}</code>`}</p>`).join("")}</div><p class="muted">Configura le variabili in .env e riavvia Nesso. <a href="https://fred.stlouisfed.org/docs/api/api_key.html" target="_blank" rel="noopener noreferrer">Chiave gratuita FRED ↗</a>. Il contatto SEC non è una chiave API.</p>${r ? `<h3>Questa analisi</h3><p>${r.status === "no-data" ? "Non sono stati recuperati dati utilizzabili. La mappa resta un ragionamento ipotetico." : "Fonti raccolte; i riferimenti sui nodi indicano dove il modello le ha citate. La pertinenza e i nessi causali restano da verificare."}</p>${plannerNotesMarkup(analysis?.body)}${(r.warnings || []).map((w) => `<p class="callout">${escape(w)}</p>`).join("")}${r.attempts.filter((a) => a.status === "error").map((a) => `<p class="error">${escape(a.tool)}: ${escape(a.error)}</p>`).join("")}${sourceCards(sources)}` : "<p>Nessuna ricerca associata alla mappa corrente. Attiva «Consulta API pubbliche» quando crei una nuova analisi.</p>"}`);
}
function nodeSourceCards(node) {
  const ids = new Set(node.sourceIds || []);
  const sources = (analysis.body.research?.sources || []).filter((s) => ids.has(s.id));
  return sources.length ? `<h4>Fonti citate per questo nodo</h4><p class="muted">Citazione del modello, non certificazione del nesso causale.</p>${sourceCards(sources)}` : "";
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
    `<button class="close" id="closeFocus" aria-label="Chiudi dettaglio">×</button><span class="badge">Priorità di ricerca · non un verdetto</span><h3>${escape(f.claim)}</h3><h4>Perché questo passaggio</h4><p>${escape(f.why)}</p><h4>Che cosa stai assumendo</h4><p>${escape(f.assumption)}</p><h4>La verifica che conta</h4><p>${escape(f.test)}</p><p class="muted">${analysis.body.research?.sources.some((s) => s.kind !== "discovery") ? "Dati raccolti disponibili in Fonti e dati. La conclusione causale resta da verificare." : "Le evidenze pertinenti devono ancora essere raccolte."}</p>${financialDetail()}`;
  $("#closeFocus").onclick = () => {
    $("#inspector").hidden = true;
  };
}
function relationLabel(edge, node) {
  if (edge?.relation && relationLabels[edge.relation]) return relationLabels[edge.relation];
  if (node?.kind === "alternative") return "Alternativa";
  if (node?.kind === "consequence") return "Conseguenza";
  return "Meccanismo causale";
}
function deepenNode(id) {
  if (liveController || critiqueController || !analysis) return;
  const node = analysis.body.graph.nodes.find((item) => item.id === id);
  if (!node) return;
  const original = analysis.body.input?.thesis || node.label;
  const prior = analysis.body.input?.context || "";
  const selectedContext = `Passaggio selezionato da approfondire: ${node.label}. Esamina questo passaggio senza sostituire la tesi originale.`;
  modal(`<p class="critique-loading">Rifletto sul passaggio selezionato…</p>`, true);
  beginCritique(
    { thesis: original, effort: analysis.body.input.effort || "medium" },
    {
      modal: true,
      previousContext: [prior, selectedContext].filter(Boolean).join("\n"),
    },
  );
}
function inspect(id) {
  selected = id;
  render();
  const g = analysis.body.graph,
    n = g.nodes.find((n) => n.id === id),
    incoming = g.edges.filter((e) => e.to === id);
  if (!n) return;
  $("#inspector").hidden = false;
  $("#inspector").innerHTML =
    `<button class="close" id="closeInspector" aria-label="Chiudi dettaglio">×</button><span class="badge">Ipotesi non verificata</span><h3>${escape(n.label)}</h3><div class="callout">${escape(n.challenge)}</div><h4>Come si collega</h4>${incoming.length ? incoming.map((e) => `<p class="relation-line"><strong>${escape(relationLabel(e, n))}</strong><span>${escape(e.mechanism || "Meccanismo non descritto.")}</span></p>`).join("") : "<p>Questa è la tesi iniziale.</p>"}<button id="deepenNode" type="button">Approfondisci questo punto</button>${n.kind === "thesis" && g.interpretation ? `<h4>Dal tuo testo</h4><p>${g.interpretation.domain === "trading" ? "Trading e mercati" : "Ambito generale"} · ${escape(g.interpretation.horizon || "Orizzonte da chiarire")}</p>${g.interpretation.context ? `<p>${escape(g.interpretation.context)}</p>` : ""}${g.interpretation.missing.length ? `<h4>Da chiarire</h4><ul>${g.interpretation.missing.map((x) => `<li>${escape(x)}</li>`).join("")}</ul>` : ""}` : ""}<h4>Assunzioni</h4><ul>${n.assumptions.map((s) => `<li>${escape(s)}</li>`).join("")}</ul><h4>Che cosa la smentirebbe</h4><p>${escape(n.falsifier)}</p><h4>Dati da raccogliere</h4><ul>${n.evidenceNeeded.map((s) => `<li>${escape(s)}</li>`).join("")}</ul>${(g.interpretation?.domain || analysis.body.input.domain) === "trading" ? `<h4>Tesi e prezzo di mercato</h4><p>${escape(g.trading.marketVsThesis)}</p><h4>Già scontato nel prezzo?</h4><p>${escape(g.trading.pricedIn)}</p><h4>Catalizzatori</h4><ul>${g.trading.catalysts.map((s) => `<li>${escape(s)}</li>`).join("")}</ul><h4>Invalidazione</h4><p>${escape(g.trading.invalidation)}</p>` : ""}`;
  $("#deepenNode").onclick = () => deepenNode(id);
  $("#inspector").insertAdjacentHTML("beforeend", nodeSourceCards(n));
  $("#closeInspector").onclick = () => {
    $("#inspector").hidden = true;
    selected = null;
    render();
  };
}
function transform() {
  const canvas = $("#canvas");
  $("#graph").style.transform =
    `translate(${pan.x}px,${pan.y}px) scale(${zoom})`;
  canvas.style.backgroundPosition = `${pan.x}px ${pan.y}px`;
  canvas.style.backgroundSize = `${20 * zoom}px ${20 * zoom}px`;
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
  analysisViewActive = false;
  // A journal fetch can happen after a map or an interrupted stream. Never
  // leave the old inspector/live status floating over the journal view.
  $("#liveBar").hidden = true;
  $("#inspector").hidden = true;
  $("#focusSummary").hidden = true;
  $("#analysisPanel").hidden = true;
  $("#canvas").hidden = false;
  $("#chartsButton").disabled = true;
  selected = null;
  $("#workspace").hidden = true;
  $("#journal").hidden = false;
  $("#journal").innerHTML = "<h1>Le mie tesi</h1><p>Caricamento…</p>";
  try {
    const data = await api("/api/journal");
    $("#journal").innerHTML =
      `<h1>Le mie tesi</h1><p>Qui trovi le mappe completate e le versioni per cui hai fissato criteri.</p><h2>Le tue tesi</h2>${
        data.analyses.length
          ? data.analyses
              .map(
                (a) =>
                  `<article class="journal-card"><span class="badge">Salvata automaticamente</span><h3>${escape(a.body.input.thesis)}</h3><small>${new Date(a.createdAt).toLocaleString("it-IT")} · ${a.body.graph.nodes.length} nodi · ${escape(a.body.provenance.model)}</small><div class="actions"><button data-open-analysis="${a.id}">Apri mappa</button></div></article>`,
              )
              .join("")
          : '<div class="callout">Non hai ancora analisi salvate. Le nuove mappe appariranno qui automaticamente.</div>'
      }<h2>Versioni con criteri fissati</h2>${
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
          : '<div class="callout">Non hai ancora fissato criteri per una tesi.</div>'
      }`;
    document.querySelectorAll("[data-open-analysis]").forEach(
      (b) =>
        (b.onclick = () => {
          analysis = data.analyses.find(
            (a) => a.id === b.dataset.openAnalysis,
          );
          frozen = null;
          selected = null;
          pan = { x: 35, y: 30 };
          zoom = 0.9;
          mapView();
          render();
          requestFitGraph();
        }),
    );
    document.querySelectorAll("[data-open]").forEach(
      (b) =>
        (b.onclick = () => {
          frozen = data.snapshots.find((s) => s.id === b.dataset.open);
          analysis = frozen;
          selected = null;
          mapView();
          render();
          requestFitGraph();
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
  $("#reviseButton").onclick =
    newThesis;
const savedDraft = readDraft();
$("#landingThesis").value = typeof savedDraft.thesis === "string" ? savedDraft.thesis : "";
if (labels[savedDraft.effort]) $("#landingEffort").value = savedDraft.effort;
if (savedDraft.critique && savedDraft.critiqueThesis === savedDraft.thesis) {
  try {
    const result = critiqueResult(savedDraft.critique);
    const input = { thesis: savedDraft.thesis, effort: labels[savedDraft.effort] ? savedDraft.effort : "medium" };
    const target = $("#landingCritique");
    const previousContext = typeof savedDraft.previousContext === "string" ? savedDraft.previousContext : "";
    target.hidden = false;
    target.innerHTML = critiqueMarkup(input, result, previousContext);
    bindCritiquePanel(target, input, result, { previousContext });
  } catch {
    // Invalid or obsolete saved UI content must not prevent a fresh start.
  }
}
$("#landingAnalyze").onclick = async () => {
  const input = {
    thesis: $("#landingThesis").value.trim(),
    effort: $("#landingEffort").value,
  };
  if (input.thesis.length < 15) {
    $("#landingError").textContent = "Scrivi una tesi di almeno 15 caratteri.";
    return;
  }
  $("#landingError").textContent = "";
  saveDraft({ thesis: input.thesis, effort: input.effort });
  await beginCritique(input, { target: "#landingCritique" });
};
$("#landingThesis").addEventListener("input", () => {
  if (critiqueController) {
    invalidateCritique();
    $("#landingCritique").hidden = true;
  }
  saveDraft({ thesis: $("#landingThesis").value, effort: $("#landingEffort").value });
});
$("#landingEffort").addEventListener("change", () => {
  if (critiqueController) {
    invalidateCritique();
    $("#landingCritique").hidden = true;
  }
  saveDraft({ thesis: $("#landingThesis").value, effort: $("#landingEffort").value });
});
$("#landingThesis").addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    $("#landingAnalyze").click();
  }
});
$("#mapButton").onclick = mapView;
$("#journalButton").onclick = journal;
$("#chartsButton").onclick = analysisView;
$("#settingsButton").onclick = settings;
$("#sourcesButton").onclick = sourcesDialog;
$("#landingResearch").checked = readDraft().research !== false;
$("#landingResearch").onchange = (e) => {
  saveDraft({ research: e.target.checked });
  if ($("#critiqueResearch")) $("#critiqueResearch").checked = e.target.checked;
};
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
  fitGraph();
};
$("#canvas").onpointerdown = (e) => {
  if (e.target.closest("#empty, button, input, textarea, select, label")) return;
  e.preventDefault();
  drag = { x: e.clientX, y: e.clientY, pan: { ...pan } };
  $("#canvas").classList.add("dragging");
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
  $("#canvas").classList.remove("dragging");
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
  const recovered = recoverFailedAnalysis(savedDraft.failedAnalysis);
  if (recovered) {
    analysis = recovered.analysis;
    frozen = null;
    selected = null;
    liveMessage = recovered.message;
    mapView();
    $("#liveBar").hidden = false;
    $("#stopAnalysis").hidden = true;
    $("#retryAnalysis").hidden = false;
    $("#retryAnalysis").onclick = () => startLiveAnalysis(analysis.body.input);
    render();
    requestFitGraph();
  }
} catch (e) {
  $("#modelLabel").textContent = "Server non disponibile";
  $("#status").textContent = e.message;
}
