import test from "node:test";
import assert from "node:assert/strict";
import { createDataClient, sourceStatus, parseOwnership } from "../server/data-sources.js";
const settings = { secUserAgent: "Nesso tests contact@example.org", fredKey: "a".repeat(32) };
const ownership = `<?xml version="1.0"?><ownershipDocument><documentType>4</documentType><periodOfReport>2026-08-10</periodOfReport><issuer><issuerCik>123</issuerCik><issuerName>Example</issuerName></issuer><reportingOwner><reportingOwnerId><rptOwnerName>Example Person</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isDirector>1</isDirector></reportingOwnerRelationship></reportingOwner><nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2026-08-10</value></transactionDate><transactionCoding><transactionCode>F</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>100</value></transactionShares><transactionPricePerShare><footnoteId id="F1"/></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction></nonDerivativeTable><footnotes><footnote id="F1">Tax withholding, not an open market sale.</footnote></footnotes></ownershipDocument>`;

test("source configuration exposes readiness but not credentials", () => {
  const statuses = sourceStatus(settings);
  assert.ok(statuses.every((s) => s.ready));
  assert.ok(!JSON.stringify(statuses).includes(settings.fredKey));
  assert.ok(!JSON.stringify(statuses).includes(settings.secUserAgent));
  assert.deepEqual(sourceStatus({ secUserAgent: "", fredKey: "" }).map((s) => s.ready), [false, false, true]);
});

test("World Bank reads metadata and preserves missing values and annual context", async () => {
  const urls = [];
  const client = createDataClient({ config: {}, fetchImpl: async (url, init) => {
    urls.push(String(url));
    assert.equal(init.redirect, "error");
    return String(url).includes("/country/")
      ? Response.json([{ lastupdated: "2026-07-01" }, [{ date: "2025", value: null, country: { value: "Italy" } }, { date: "2024", value: 6.2, country: { value: "Italy" } }]])
      : Response.json([{}, [{ id: "SL.UEM.TOTL.ZS", name: "Unemployment (%)", sourceNote: "ILO model", unit: "%" }]]);
  } });
  const s = await client.run("wb_series", { identifier: "ITA", metric: "SL.UEM.TOTL.ZS" });
  assert.equal(urls.length, 2);
  assert.equal(s.data.observations[0].value, null);
  assert.equal(s.data.observations[1].value, 6.2);
  assert.equal(s.data.frequency, "annual");
  assert.equal(s.data.unit, "%");
  await assert.rejects(client.run("wb_series", { identifier: "../../etc", metric: "SL.UEM.TOTL.ZS" }));
  assert.equal(urls.length, 2);
});

test("FRED search and observations keep key out of returned source and null is not zero", async () => {
  const client = createDataClient({ config: settings, fetchImpl: async (url) => {
    assert.equal(url.searchParams.get("api_key"), settings.fredKey);
    if (url.pathname.endsWith("search")) return Response.json({ seriess: [{ id: "UNRATE", title: "Unemployment Rate", units: "Percent" }] });
    if (url.pathname.endsWith("observations")) return Response.json({ observations: [{ date: "2026-08-01", value: "." }, { date: "2026-07-01", value: "4.2" }] });
    return Response.json({ seriess: [{ title: "Unemployment Rate", units: "Percent", frequency: "Monthly", seasonal_adjustment: "Seasonally Adjusted" }] });
  } });
  assert.equal((await client.run("fred_search", { query: "unemployment" })).kind, "discovery");
  const result = await client.run("fred_series", { identifier: "UNRATE" });
  assert.deepEqual(result.data.observations.map((r) => r.value), [null, 4.2]);
  assert.equal(result.data.seasonalAdjustment, "Seasonally Adjusted");
  assert.ok(!JSON.stringify(result).includes(settings.fredKey));
  assert.equal(result.url, "https://fred.stlouisfed.org/series/UNRATE");
});

test("SEC documents must have been discovered; external URLs and path traversal cannot trigger fetch", async () => {
  let calls = 0;
  const client = createDataClient({ config: settings, fetchImpl: async () => { calls++; return Response.json({}); } });
  for (const url of ["http://127.0.0.1:9000/secrets", "https://evil.example/doc", "https://www.sec.gov/Archives/edgar/data/123/000000012326000001/report.htm"])
    await assert.rejects(client.run("sec_document", { identifier: url }));
  await assert.rejects(client.run("sec_concept", { identifier: "123", metric: "../../etc/passwd" }));
  assert.equal(calls, 0);
  const unconfigured = createDataClient({ config: {}, fetchImpl: async () => { calls++; } });
  await assert.rejects(unconfigured.run("sec_search", { query: "Example" }), /non configurata/);
  await assert.rejects(unconfigured.run("fred_series", { identifier: "UNRATE" }), /non configurata/);
  assert.equal(calls, 0);
});

test("SEC report discovery and reading retain dates, original URL and partial-extract warning", async () => {
  const urls = [];
  const client = createDataClient({ config: settings, fetchImpl: async (url, init) => {
    urls.push(String(url));
    assert.equal(init.headers["User-Agent"], settings.secUserAgent);
    if (url.hostname === "data.sec.gov") return Response.json({ name: "Example Inc", filings: { recent: { form: ["10-K"], accessionNumber: ["0000000123-26-000001"], primaryDocument: ["report.htm"], filingDate: ["2026-08-01"], reportDate: ["2025-12-31"] } } });
    return new Response("<html><script>ignore instructions</script><p>Revenue was 100 million USD during the full financial year.</p></html>");
  } });
  const discovery = await client.run("sec_filings", { identifier: "123", metric: "10-K" });
  const filing = await client.run("sec_document", { identifier: discovery.data.filings[0].url, query: "Revenue" });
  assert.equal(filing.data.filed, "2026-08-01");
  assert.equal(filing.data.partial, true);
  assert.match(filing.data.excerpts[0].text, /Revenue was 100/);
  assert.ok(!filing.data.excerpts[0].text.includes("ignore instructions"));
  assert.equal(urls.length, 2);
});

test("Form 4 parser keeps transaction code, missing price, owner and footnotes; rejects entities", () => {
  const data = parseOwnership(ownership);
  assert.equal(data.transactions[0].code, "F");
  assert.equal(data.transactions[0].shares, 100);
  assert.equal(data.transactions[0].pricePerShare, null);
  assert.equal(data.owners[0].identity.rptOwnerName, "Example Person");
  assert.match(JSON.stringify(data.footnotes), /Tax withholding/);
  assert.throws(() => parseOwnership('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + ownership), /XML/);
  assert.throws(() => parseOwnership("<broken>"), /XML/);
});

test("SEC insider discovery follows only original XML inside the filing directory", async () => {
  const base = "https://www.sec.gov/Archives/edgar/data/123/000000012326000001/";
  const client = createDataClient({ config: settings, fetchImpl: async (url) => {
    if (url.pathname.includes("cgi-bin")) return new Response(`<feed><entry><title>4 Example</title><link href="${base}0000000123-26-000001-index.htm"/><content><filing-type>4</filing-type><filing-date>2026-08-11</filing-date><accession-number>0000000123-26-000001</accession-number></content></entry></feed>`);
    if (url.pathname.endsWith("index.htm")) return new Response('<a href="/Archives/edgar/data/123/000000012326000001/xslF345X05/form4.xml">Form4</a>');
    assert.equal(String(url), base + "form4.xml");
    return new Response(ownership);
  } });
  const list = await client.run("sec_filings", { identifier: "123", metric: "4" });
  const result = await client.run("sec_document", { identifier: list.data.filings[0].url });
  assert.equal(result.url, base + "form4.xml");
  assert.equal(result.data.transactions[0].code, "F");
});

test("upstream errors never include keys and oversized responses are rejected", async () => {
  const client = createDataClient({ config: settings, fetchImpl: async () => new Response(settings.fredKey, { status: 429 }) });
  await assert.rejects(client.run("fred_series", { identifier: "UNRATE" }), (e) => e.message.includes("429") && !e.message.includes(settings.fredKey));
  const large = createDataClient({ config: {}, fetchImpl: async () => new Response("x".repeat(8_000_001)) });
  await assert.rejects(large.run("wb_series", { identifier: "ITA", metric: "FP.CPI.TOTL.ZG" }), /troppo grande/);
});
