import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config, publicConfig } from "./provider.js";
import { analyze } from "./analysis.js";
import { critique } from "./thesis-dialogue.js";
import { research, RESEARCH_TIMEOUT_MS } from "./research.js";
import { dataConfig, sourceStatus } from "./data-sources.js";
import { buildCharts } from "./chart-data.js";
import { buildEvidenceAudit } from "./evidence-audit.js";
import {
  AppError,
  requireThat,
  inputSpec,
  validateGraph,
  validateCriteria,
  evaluate,
  hash,
} from "./domain.js";
import { openStore } from "./store.js";

const root = fileURLToPath(new URL("../", import.meta.url));
export function createApp({
  provider = config(),
  store = openStore(
    resolve(
      process.env.NESSO_DATA_DIR || resolve(root, "data"),
      "nesso.sqlite",
    ),
  ),
  inference = analyze,
  dialogue = critique,
  researcher = research,
  sourcesConfig = dataConfig(),
} = {}) {
  let busy = false;
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const allowedHosts = [
        `127.0.0.1:${server.address().port}`,
        `localhost:${server.address().port}`,
      ];
      requireThat(
        allowedHosts.includes(req.headers.host),
        "Host non autorizzato.",
        403,
      );
      if (req.headers.origin)
        requireThat(
          allowedHosts.map((h) => `http://${h}`).includes(req.headers.origin),
          "Origine non autorizzata.",
          403,
        );
      requireThat(
        !req.headers["sec-fetch-site"] ||
          ["same-origin", "none"].includes(req.headers["sec-fetch-site"]),
        "Richiesta cross-origin non consentita.",
        403,
      );
      const path = new URL(req.url, `http://${req.headers.host}`).pathname;
      if (req.method === "GET" && path === "/api/config")
        return send(200, {
          ...publicConfig(provider),
          dataSources: sourceStatus(sourcesConfig),
          researchTimeoutMs: RESEARCH_TIMEOUT_MS,
          features: { charts: true, reasoning: true, evidenceAudit: true },
        });
      if (req.method === "GET" && path === "/api/journal")
        return send(200, {
          analyses: store.list("analysis"),
          snapshots: store.list(),
          evaluations: store.list("evaluation"),
        });
      if (req.method === "GET" && path.startsWith("/api/records/"))
        return send(200, store.get(path.slice("/api/records/".length)));
      if (req.method === "POST") {
        requireThat(
          req.headers["content-type"]?.split(";")[0] === "application/json",
          "Usa application/json.",
          415,
        );
        let size = 0,
          chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          requireThat(size <= 250000, "Richiesta troppo grande.", 413);
          chunks.push(chunk);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          throw new AppError("JSON non valido.");
        }
        requireThat(
          body && typeof body === "object" && !Array.isArray(body),
          "La richiesta deve essere un oggetto.",
        );
        if (path === "/api/critique") {
          requireThat(!busy, "Un’analisi è già in corso. Attendi il completamento.", 429);
          const input = inputSpec(body);
          const controller = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) controller.abort();
          });
          busy = true;
          try {
            const result = await dialogue(provider, input, controller.signal);
            if (!controller.signal.aborted) return send(200, result);
            return;
          } finally {
            busy = false;
          }
        }
        if (path === "/api/analyze" || path === "/api/analyze/stream") {
          requireThat(
            !busy,
            "Un’analisi è già in corso. Attendi il completamento.",
            429,
          );
          const input = inputSpec(body);
          busy = true;
          const controller = new AbortController();
          const streaming = path.endsWith("/stream");
          const emit = (type, data) => {
            if (!res.destroyed)
              res.write(JSON.stringify({ type, data }) + "\n");
          };
          if (streaming) {
            res.writeHead(200, {
              "content-type": "application/x-ndjson; charset=utf-8",
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            });
            res.flushHeaders();
            emit("start", { message: "Esploro i nessi della tua tesi…" });
          }
          res.on("close", () => {
            if (!res.writableEnded) controller.abort();
          });
          try {
            const evidence = input.research
              ? await researcher(provider, input, controller.signal, streaming ? emit : undefined, { config: sourcesConfig })
              : null;
            const result = await inference(
              provider,
              evidence ? { ...input, evidence } : input,
              controller.signal,
              undefined,
              streaming ? emit : undefined,
            );
            if (controller.signal.aborted) return;
            const graph = validateGraph(result.graph, input.effort);
            // The dossier is separately validated by deepen(), never accepted
            // from the client or asked for again in the graph JSON schema.
            if (result.reasoning) graph.reasoning = result.reasoning;
            const charts = buildCharts(evidence);
            // Presence/absence of retrieved material is deterministic; this is
            // not a truth score and must never come from the model or client.
            const evidenceAudit = buildEvidenceAudit({ graph, evidence, charts });
            const record = store.add("analysis", {
              schemaVersion: "nesso.analysis.v1",
              input,
              graph,
              provenance: result.provenance,
              charts,
              evidenceAudit,
              ...(evidence ? { research: evidence } : {}),
            });
            if (streaming) {
              emit("complete", record);
              return res.end();
            }
            return send(201, record);
          } catch (e) {
            if (!streaming) throw e;
            emit("error", {
              message:
                e instanceof AppError
                  ? e.status === 422
                    ? "Il modello ha prodotto una mappa non valida: " +
                      e.message +
                      " La bozza non è salvata; questo non è un giudizio sulla tua tesi."
                    : e.message
                  : "Generazione interrotta. La mappa parziale non è stata salvata.",
            });
            res.end();
          } finally {
            busy = false;
          }
        }
        if (path === "/api/snapshots") {
          requireThat(
            body.confirmed === true,
            "Conferma esplicitamente i criteri.",
          );
          const analysis = store.get(body.analysisId);
          requireThat(
            analysis.kind === "analysis",
            "La sorgente deve essere un’analisi.",
          );
          const criteria = validateCriteria(body.criteria);
          requireThat(
            !(
              analysis.body.graph.interpretation?.deadline ||
              analysis.body.input.deadline
            ) ||
              criteria.every(
                (c) =>
                  c.due <=
                  (analysis.body.graph.interpretation?.deadline ||
                    analysis.body.input.deadline),
              ),
            "La data dei criteri non può superare l’orizzonte della tesi. Rivedi la tesi prima di fissarla.",
          );
          const existing = store
            .list()
            .find(
              (s) =>
                s.parentId === analysis.id &&
                hash(s.body.criteria) === hash(criteria),
            );
          if (existing) return send(200, existing);
          return send(
            201,
            store.add(
              "snapshot",
              {
                ...analysis.body,
                criteria,
                ruleVersion: "numeric-threshold-v1",
                analysisHash: analysis.sha256,
              },
              analysis.id,
            ),
          );
        }
        if (path === "/api/evaluations") {
          requireThat(
            body.confirmed === true,
            "Conferma la provenienza delle osservazioni.",
          );
          const snapshot = store.get(body.snapshotId);
          requireThat(
            snapshot.kind === "snapshot",
            "Seleziona una versione preregistrata.",
          );
          return send(
            201,
            store.add(
              "evaluation",
              {
                confirmed: true,
                snapshotHash: snapshot.sha256,
                ...evaluate(snapshot.body, body.observations),
              },
              snapshot.id,
            ),
          );
        }
        throw new AppError("Endpoint non trovato.", 404);
      }
      requireThat(req.method === "GET", "Metodo non consentito.", 405);
      const assets = {
        "/": ["public/index.html", "text/html"],
        "/app.js": ["public/app.js", "text/javascript"],
        "/charts.js": ["public/charts.js", "text/javascript"],
        "/style.css": ["public/style.css", "text/css"],
      };
      requireThat(Object.hasOwn(assets, path), "Risorsa non trovata.", 404);
      const [file, type] = assets[path],
        contents = await readFile(resolve(root, file));
      res.writeHead(200, {
        "content-type": `${type}; charset=utf-8`,
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      });
      res.end(contents);
    } catch (e) {
      if (!res.headersSent && !res.destroyed)
        send(e.status || 500, {
          error:
            e instanceof AppError
              ? e.message
              : "Errore interno. Nessuna credenziale è stata esposta.",
        });
    }
  });
  return { server, store };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, store } = createApp(),
    port = Number(process.env.NESSO_PORT || 4180);
  server.listen(port, "127.0.0.1", () =>
    console.log(`Nesso: http://127.0.0.1:${server.address().port}`),
  );
  server.on("error", (e) => {
    console.error(
      e.code === "EADDRINUSE"
        ? "Porta occupata: modifica NESSO_PORT."
        : "Avvio non riuscito.",
    );
    process.exitCode = 1;
    store.close();
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () =>
      server.close(() => {
        store.close();
        process.exit(0);
      }),
    );
}
