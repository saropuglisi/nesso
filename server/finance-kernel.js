import { AppError } from "./domain.js";
import { calculate } from "./arithmetic.js";

const PRICING_KEYS = [
  "price",
  "quantity",
  "variableCost",
  "fixedCost",
  "discountPercent",
  "newQuantity",
];
const MARKETPLACE_KEYS = ["gmv", "marketplacePercent", "commissionPercent"];
const EARNINGS_KEYS = [
  "reportedEps",
  "consensusEps",
  "guidanceEps",
  "consensusGuidance",
];
const BOND_KEYS = ["modifiedDuration", "price", "yieldChangeBp"];

function invalid(message) {
  throw new AppError(message, 422);
}

function record(value, name) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    invalid(`${name} non valido.`);
  for (const [key, entry] of Object.entries(value))
    if (typeof entry !== "number" || !Number.isFinite(entry))
      invalid(`${name}.${key} deve essere un numero finito.`);
  return value;
}

function valuesFor(values, keys) {
  record(values, "values");
  for (const key of keys) {
    if (!Object.hasOwn(values, key)) invalid(`Valore mancante: ${key}.`);
    if (typeof values[key] !== "number" || !Number.isFinite(values[key]))
      invalid(`Valore non finito: ${key}.`);
  }
  return values;
}

function range(
  value,
  key,
  { min = -Infinity, max = Infinity, nonzero = false } = {},
) {
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (nonzero && value === 0)
  )
    invalid(`Intervallo non valido: ${key}.`);
  return value;
}

function literal(value) {
  if (!Number.isFinite(value)) invalid("Numero non finito nel calcolo.");
  const source = String(value);
  if (!/[eE]/.test(source)) return source;
  const [coefficient, exponentText] = source.toLowerCase().split("e");
  const exponent = Number(exponentText);
  const negative = coefficient.startsWith("-");
  const unsigned =
    negative || coefficient.startsWith("+")
      ? coefficient.slice(1)
      : coefficient;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = whole + fraction;
  const decimalIndex = whole.length + exponent;
  const body =
    decimalIndex <= 0
      ? `0.${"0".repeat(-decimalIndex)}${digits}`
      : decimalIndex >= digits.length
        ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
        : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  return `${negative ? "-" : ""}${body}`;
}

const displayNumber = new Intl.NumberFormat("it-IT", {
  maximumSignificantDigits: 8,
});

function display(value) {
  return displayNumber.format(clean(value));
}

function relativeDisplay(value) {
  if (value > 0) return `superiore del ${display(value)}%`;
  if (value < 0) return `inferiore del ${display(Math.abs(value))}%`;
  return "in linea con";
}

function signedDisplay(value) {
  return `${value > 0 ? "+" : ""}${display(value)}`;
}

function term(value) {
  return `(${literal(value)})`;
}

function clean(value) {
  if (!Number.isFinite(value)) invalid("Risultato numerico non finito.");
  const rounded = Number.parseFloat(value.toPrecision(15));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function calculation(label, expression, unit, basis) {
  let result;
  try {
    result = clean(calculate(expression));
  } catch {
    invalid(`Calcolo non rappresentabile: ${label}.`);
  }
  return { label, expression, unit, basis, result, arithmeticValid: true };
}

function output({
  conclusion,
  limitations,
  calculations,
  facts,
  focus,
  alternative,
}) {
  if (!Array.isArray(calculations) || calculations.length > 3)
    invalid("Massimo tre calcoli.");
  return {
    conclusion,
    limitations,
    limitation: limitations,
    calculations,
    facts,
    focus,
    alternative,
  };
}

function pricing(values, currency) {
  valuesFor(values, PRICING_KEYS);
  const price = range(values.price, "price", { min: Number.MIN_VALUE });
  const quantity = range(values.quantity, "quantity", {
    min: Number.MIN_VALUE,
  });
  const variableCost = range(values.variableCost, "variableCost", { min: 0 });
  const fixedCost = range(values.fixedCost, "fixedCost", { min: 0 });
  const discountPercent = range(values.discountPercent, "discountPercent", {
    min: 0,
    max: 100,
  });
  const newQuantity = range(values.newQuantity, "newQuantity", { min: 0 });
  const discountedPrice = price * (1 - discountPercent / 100);
  const beforeRevenue = clean(price * quantity);
  const beforeProfit = clean((price - variableCost) * quantity - fixedCost);
  const afterRevenue = clean(discountedPrice * newQuantity);
  const afterProfit = clean(
    (discountedPrice - variableCost) * newQuantity - fixedCost,
  );
  const contributionAfterDiscount = clean(discountedPrice - variableCost);
  if (
    !Number.isFinite(contributionAfterDiscount) ||
    contributionAfterDiscount <= 0
  )
    invalid("Il margine dopo lo sconto deve essere positivo.");
  const targetQuantity = clean(
    ((price - variableCost) * quantity) / contributionAfterDiscount,
  );
  if (
    ![
      beforeRevenue,
      beforeProfit,
      afterRevenue,
      afterProfit,
      targetQuantity,
    ].every(Number.isFinite)
  )
    invalid("Risultato pricing non finito.");

  const p = term(price),
    q = term(quantity),
    vc = term(variableCost),
    fc = term(fixedCost);
  const discount = term(discountPercent),
    nq = term(newQuantity);
  const discounted = `${p}*(1-${discount}/100)`;
  const calculations = [
    calculation(
      "Ricavi dopo lo sconto",
      `${discounted}*${nq}`,
      currency,
      "Prezzo, sconto e nuova quantità forniti nello scenario.",
    ),
    calculation(
      "Utile operativo dopo lo sconto",
      `(${discounted}-${vc})*${nq}-${fc}`,
      currency,
      "Costi variabili per unità e costi fissi invariati nello scenario.",
    ),
    calculation(
      "Quantità per conservare l’utile iniziale",
      `((${p}-${vc})*${q})/(${discounted}-${vc})`,
      "unità",
      "Quantità che conserva l’utile operativo iniziale prima dei costi fissi, con costi invariati.",
    ),
  ];
  const revenueChangePercent = clean(
    ((afterRevenue - beforeRevenue) / beforeRevenue) * 100,
  );
  const operatingProfitChangePercent =
    beforeProfit > 0
      ? clean(((afterProfit - beforeProfit) / beforeProfit) * 100)
      : null;
  const changes = [
    `ricavi ${signedDisplay(revenueChangePercent)}%`,
    ...(operatingProfitChangePercent === null
      ? []
      : [`utile operativo ${signedDisplay(operatingProfitChangePercent)}%`]),
  ].join(", ");
  const format = display;
  return output({
    conclusion: `Con lo sconto del ${format(discountPercent)}%, i ricavi dello scenario passano da ${format(beforeRevenue)} a ${format(afterRevenue)} ${currency}, mentre l’utile operativo passa da ${format(beforeProfit)} a ${format(afterProfit)} ${currency} (${changes} rispetto alla base); per conservare l’utile operativo iniziale servono ${format(targetQuantity)} unità.`,
    limitations:
      "È uno scenario deterministico: mantiene costi variabili e fissi costanti e non stima domanda, cannibalizzazione, imposte, resi o effetti temporali.",
    calculations,
    facts: {
      kind: "pricing",
      currency,
      before: {
        price,
        quantity,
        revenue: beforeRevenue,
        profit: beforeProfit,
        operatingProfit: beforeProfit,
      },
      after: {
        price: discountedPrice,
        quantity: newQuantity,
        revenue: afterRevenue,
        profit: afterProfit,
        operatingProfit: afterProfit,
      },
      targetQuantityPreservingBeforeProfit: targetQuantity,
      beforeRevenue,
      beforeProfit,
      afterRevenue,
      afterProfit,
      targetQuantity,
      revenueChangePercent,
      operatingProfitChangePercent,
    },
    focus: {
      claim: `Il prezzo scontato produce ${format(afterRevenue)} ${currency} di ricavi e ${format(afterProfit)} ${currency} di utile operativo con ${format(newQuantity)} unità.`,
      why: "Il passaggio decisivo è se la quantità aggiuntiva compensa il margine perso su ogni unità.",
      assumption:
        "I costi variabili per unità e i costi fissi restano costanti nello scenario.",
      test: "Confrontare quantità vendute, costi unitari e utile osservato dopo l’introduzione dello sconto.",
    },
    alternative: {
      label: "La domanda non compensa il margine perso",
      assumption: `La quantità resta sotto ${format(targetQuantity)} unità o i costi aumentano.`,
      challenge:
        "La crescita dei volumi può non recuperare la riduzione del margine unitario.",
      falsifier:
        "La quantità e i costi osservati sostengono almeno l’utile operativo iniziale nel periodo definito.",
    },
  });
}

function marketplace(values, currency) {
  valuesFor(values, MARKETPLACE_KEYS);
  const gmv = range(values.gmv, "gmv", { min: 0 });
  const marketplacePercent = range(
    values.marketplacePercent,
    "marketplacePercent",
    {
      min: 0,
      max: 100,
    },
  );
  const commissionPercent = range(
    values.commissionPercent,
    "commissionPercent",
    {
      min: 0,
      max: 100,
    },
  );
  const marketplaceGmv = clean((gmv * marketplacePercent) / 100);
  const directGmv = clean((gmv * (100 - marketplacePercent)) / 100);
  const marketplaceRevenue = clean((marketplaceGmv * commissionPercent) / 100);
  const directRevenue = directGmv;
  const totalRevenue = clean(marketplaceRevenue + directRevenue);
  if (
    ![
      marketplaceGmv,
      directGmv,
      marketplaceRevenue,
      directRevenue,
      totalRevenue,
    ].every(Number.isFinite)
  )
    invalid("Risultato marketplace non finito.");

  const g = term(gmv),
    mp = term(marketplacePercent),
    cp = term(commissionPercent);
  const calculations = [
    calculation(
      "Ricavo marketplace da commissione",
      `${g}*${mp}/100*${cp}/100`,
      currency,
      "GMV marketplace e commissione forniti nello scenario.",
    ),
    calculation(
      "Ricavo da vendite dirette",
      `${g}*(100-${mp})/100`,
      currency,
      "Quota non marketplace trattata come vendita diretta contabilizzata al lordo.",
    ),
    calculation(
      "Ricavo riconosciuto totale",
      `${g}*${mp}/100*${cp}/100+${g}*(100-${mp})/100`,
      currency,
      "Somma del ricavo marketplace e del ricavo diretto; GMV e ricavo restano misure diverse.",
    ),
  ];
  const format = display;
  return output({
    conclusion: `Su ${format(gmv)} ${currency} di GMV, ${format(marketplaceGmv)} ${currency} passano dal marketplace e generano ${format(marketplaceRevenue)} ${currency} di commissioni; ${format(directGmv)} ${currency} di vendite dirette portano il ricavo riconosciuto totale a ${format(totalRevenue)} ${currency}. Il GMV non equivale automaticamente al ricavo.`,
    limitations:
      "Il calcolo distingue GMV e ricavo contabilizzato, ma non stima costi, profitti, resi, imposte, cancellazioni o effetti di domanda.",
    calculations,
    facts: {
      kind: "marketplace",
      currency,
      gmv,
      marketplacePercent,
      commissionPercent,
      marketplaceGmv,
      directGmv,
      marketplaceRevenue,
      directRevenue,
      totalRevenue,
    },
    focus: {
      claim: `Il ricavo riconosciuto nello scenario è ${format(totalRevenue)} ${currency} su ${format(gmv)} ${currency} di GMV.`,
      why: "Il passaggio decisivo è separare il valore intermediato dal ricavo che la piattaforma può contabilizzare.",
      assumption:
        "La quota marketplace genera solo la commissione indicata e la quota diretta è contabilizzata al lordo.",
      test: "Confrontare GMV, mix marketplace-diretto, commissioni e ricavi contabilizzati nello stesso periodo.",
    },
    alternative: {
      label: "Il mix o la contabilizzazione differiscono dallo scenario",
      assumption:
        "Quote, commissione, resi o criterio contabile differiscono dai valori forniti.",
      challenge:
        "Lo stesso GMV può produrre ricavi diversi quando cambia il mix o il perimetro contabile.",
      falsifier:
        "Registri coerenti confermano quote, commissione e metodo di riconoscimento del ricavo.",
    },
  });
}

function earnings(values) {
  valuesFor(values, EARNINGS_KEYS);
  const reportedEps = values.reportedEps;
  const consensusEps = range(values.consensusEps, "consensusEps", {
    min: Number.MIN_VALUE,
  });
  const guidanceEps = values.guidanceEps;
  const consensusGuidance = range(
    values.consensusGuidance,
    "consensusGuidance",
    {
      min: Number.MIN_VALUE,
    },
  );
  const quarterlyPercent = clean(
    ((reportedEps - consensusEps) / consensusEps) * 100,
  );
  const annualPercent = clean(
    ((guidanceEps - consensusGuidance) / consensusGuidance) * 100,
  );
  if (![quarterlyPercent, annualPercent].every(Number.isFinite))
    invalid("Risultato EPS non finito.");

  const r = term(reportedEps),
    c = term(consensusEps),
    g = term(guidanceEps),
    cg = term(consensusGuidance);
  const calculations = [
    calculation(
      "Sorpresa EPS trimestrale",
      `((${r}-${c})/${c})*100`,
      "%",
      "EPS riportato e consenso trimestrile, confrontati nello stesso periodo.",
    ),
    calculation(
      "Scostamento guidance annuale",
      `((${g}-${cg})/${cg})*100`,
      "%",
      "Guidance annuale e consenso sulla guidance, confrontati nello stesso periodo.",
    ),
  ];
  const format = display;
  return output({
    conclusion: `L’EPS riportato è ${relativeDisplay(quarterlyPercent)} al consenso trimestrale, mentre la guidance annuale è ${relativeDisplay(annualPercent)} al consenso; sono confronti separati e non implicano che il prezzo debba salire.`,
    limitations:
      "Le percentuali descrivono sorprese omogenee per periodo; non collegano EPS e guidance di periodi diversi a una previsione causale sul prezzo.",
    calculations,
    facts: {
      kind: "earnings",
      quarterly: {
        reportedEps,
        consensusEps,
        surprisePercent: quarterlyPercent,
      },
      annual: {
        guidanceEps,
        consensusGuidance,
        surprisePercent: annualPercent,
      },
      priceConclusion: "non determinabile da questi soli confronti",
    },
    focus: {
      claim: `Il confronto trimestrale è ${format(quarterlyPercent)}% e quello annuale è ${format(annualPercent)}%, con periodi distinti.`,
      why: "Il passaggio decisivo è verificare aspettative e periodo prima di interpretare ciascuna sorpresa.",
      assumption:
        "Reported EPS, consenso, guidance e consenso guidance hanno definizioni e perimetri omogenei nel rispettivo periodo.",
      test: "Confrontare i dati pubblicati con il consenso omogeneo e osservare la revisione delle aspettative future senza inferire il prezzo.",
    },
    alternative: {
      label: "La reazione del mercato diverge dalla sorpresa contabile",
      assumption:
        "Il prezzo incorpora aspettative, outlook o informazioni ulteriori rispetto ai quattro valori EPS.",
      challenge:
        "Una sorpresa trimestrale positiva e una guidance annuale negativa possono avere effetti diversi e non deterministici.",
      falsifier:
        "Dati omogenei e revisione delle aspettative confermano la lettura separata dei due periodi.",
    },
  });
}

function bond(values, currency) {
  valuesFor(values, BOND_KEYS);
  const modifiedDuration = range(values.modifiedDuration, "modifiedDuration", {
    min: Number.MIN_VALUE,
  });
  const price = range(values.price, "price", { min: Number.MIN_VALUE });
  const yieldChangeBp = values.yieldChangeBp;
  const linearDeltaPrice = clean(
    -modifiedDuration * (yieldChangeBp / 10000) * price,
  );
  const approximatePrice = clean(price + linearDeltaPrice);
  const unchangedYieldChangeBp = 0;
  const unchangedPrice = price;
  if (![linearDeltaPrice, approximatePrice].every(Number.isFinite))
    invalid("Risultato bond non finito.");

  const d = term(modifiedDuration),
    p = term(price),
    y = term(yieldChangeBp);
  const calculations = [
    calculation(
      "Variazione lineare del prezzo",
      `${p}*(-${d})*${y}/10000`,
      currency,
      "Duration modificata, prezzo e variazione del rendimento richiesto forniti nello scenario.",
    ),
    calculation(
      "Prezzo approssimato dopo la variazione del rendimento",
      `${p}+${p}*(-${d})*${y}/10000`,
      currency,
      "Approssimazione lineare locale; non include convessità.",
    ),
    calculation(
      "Prezzo con rendimento invariato",
      `${p}+${p}*0`,
      currency,
      "Scenario separato in cui il rendimento richiesto dell’obbligazione resta invariato.",
    ),
  ];
  const format = display;
  const sign = (value) => (value > 0 ? "+" : "") + format(value);
  return output({
    conclusion: `Con una variazione del rendimento richiesto di ${format(yieldChangeBp)} punti base, la variazione lineare del prezzo è ${sign(linearDeltaPrice)} ${currency} e il prezzo approssimato è ${format(approximatePrice)} ${currency}; se il rendimento resta invariato (0 punti base), il prezzo resta ${format(unchangedPrice)} ${currency}. La precisione dipende dal rendimento richiesto dell’obbligazione, non dal solo tasso ufficiale.`,
    limitations:
      "È un’approssimazione lineare locale basata sulla duration modificata: non inventa né stima la convessità, la cedola, lo spread o il passaggio dal tasso ufficiale al rendimento richiesto.",
    calculations,
    facts: {
      kind: "bond",
      currency,
      modifiedDuration,
      price,
      yieldChangeBp,
      linearDeltaPrice,
      approximatePrice,
      unchangedYieldChangeBp,
      unchangedPrice,
    },
    focus: {
      claim: `La variazione lineare stimata è ${sign(linearDeltaPrice)} ${currency}, ma richiede che il rendimento richiesto cambi di ${format(yieldChangeBp)} punti base.`,
      why: "Il passaggio decisivo è il movimento del rendimento richiesto per questo titolo, non il movimento isolato del tasso ufficiale.",
      assumption:
        "La duration modificata resta applicabile localmente e gli altri fattori del titolo non cambiano nel confronto.",
      test: "Osservare rendimento richiesto, prezzo e spread del titolo nello stesso intervallo per verificare la direzione e la magnitudine locale.",
    },
    alternative: {
      label: "Il rendimento richiesto resta invariato",
      assumption:
        "Il cambiamento del tasso ufficiale non passa al rendimento richiesto di questa obbligazione.",
      challenge:
        "Senza una variazione del rendimento richiesto, la relazione duration-prezzo non produce un cambiamento di prezzo nello scenario.",
      falsifier:
        "Il rendimento richiesto osservato cambia insieme al prezzo e consente un confronto con l’approssimazione lineare.",
    },
  });
}

export function computeScenario(scenario) {
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario))
    invalid("Scenario non valido.");
  const { kind } = scenario;
  if (!["pricing", "marketplace", "earnings", "bond"].includes(kind))
    return null;
  const currency = scenario.currency ?? "unità monetarie";
  if (
    typeof currency !== "string" ||
    currency.trim().length === 0 ||
    currency.trim().length > 32
  )
    invalid("Valuta non valida.");
  const normalizedCurrency = currency.trim();
  if (!Object.hasOwn(scenario, "values"))
    invalid("Valori dello scenario mancanti.");
  switch (kind) {
    case "pricing":
      return pricing(scenario.values, normalizedCurrency);
    case "marketplace":
      return marketplace(scenario.values, normalizedCurrency);
    case "earnings":
      return earnings(scenario.values);
    case "bond":
      return bond(scenario.values, normalizedCurrency);
    default:
      return null;
  }
}
