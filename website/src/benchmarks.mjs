// Published aggregates from the disclosed alpha.2 local fixture runs.
// These are operation counts and database timings, not semantic accuracy scores.
export const benchmarkData = {
  version: "0.1.0-alpha.2",
  environment:
    "Apple M4 Pro · 24 GB · Node.js 24.22.0 · localhost PostgreSQL 18.4",
  deliveries: {
    distinctSources: 100,
    deliveries: 500,
    extractionCalls: 100,
    counterfactualCalls: 500,
  },
  reads: { requests: 1000, modelCalls: 0 },
  provenance: {
    acceptedFieldAssertions: 100,
    sourceReferencedAssertions: 100,
    visibleBeforeReview: 0,
  },
  orderedReadP95: [
    { records: 100, ms: 0.95 },
    { records: 1000, ms: 1.37 },
    { records: 10000, ms: 8.27 },
  ],
  method: "/docs/benchmarks/",
  limitations:
    "Synthetic fictional data and automated review. No provider calls. Not a production SLO, model accuracy score, billing comparison or human productivity study.",
};

const sourceDots = Array.from(
  { length: 100 },
  (_, i) =>
    `<circle class="coverage-dot" cx="${30 + (i % 20) * 24}" cy="${52 + Math.floor(i / 20) * 33}" r="4"/>`,
).join("");
const readPoints = benchmarkData.orderedReadP95.map((d, i) => ({
  ...d,
  x: 60 + i * 220,
  y: 246 - d.ms * 20,
}));
const readPath = readPoints
  .map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`)
  .join(" ");
const chart = (id, title, description, content) =>
  `<svg viewBox="0 0 560 300" role="img" aria-labelledby="${id}-title ${id}-description"><title id="${id}-title">${title}</title><desc id="${id}-description">${description}</desc>${content}</svg>`;

export const metrics = `<section class="benchmarks frame section" id="benchmarks">
  <div class="section-title"><h2>Fewer repeat calls.<br><span class="gradient-type">More context kept.</span></h2><a class="text-link" href="/docs/benchmarks/">How we measured it <span>↗</span></a></div>
  <div class="benchmark-tabs" role="tablist" aria-label="Measured framework behavior">
    <button role="tab" id="benchmark-deliveries" aria-selected="true" aria-controls="chart-deliveries" data-benchmark="deliveries">Repeated deliveries</button>
    <button role="tab" id="benchmark-reads" aria-selected="false" tabindex="-1" aria-controls="chart-reads" data-benchmark="reads">Structured reads</button>
    <button role="tab" id="benchmark-provenance" aria-selected="false" tabindex="-1" aria-controls="chart-provenance" data-benchmark="provenance">Source coverage</button>
  </div>
  <div class="benchmark-panel" id="chart-deliveries" role="tabpanel" aria-labelledby="benchmark-deliveries">
    <div class="benchmark-copy"><strong class="metric-display">80<span>%</span></strong><h3>Fewer extraction calls<br>on repeated deliveries.</h3><p>100 sources. Five deliveries each. One extraction per source.</p><small>Compared with extracting every delivery.</small></div>
    <figure class="benchmark-chart">${chart("delivery-chart", "Extraction calls across 500 deliveries", "Extracting every delivery would require 500 calls. Ontave's idempotent fixture run used 100 calls, avoiding 400 calls.", `<defs><linearGradient id="bar-gradient"><stop stop-color="#f20aad"/><stop offset="1" stop-color="#ff44ba"/></linearGradient></defs><g class="chart-grid"><path d="M40 65H525M40 155H525M40 245H525"/></g><g class="chart-tick"><text x="40" y="277">0</text><text x="272" y="277">250</text><text x="512" y="277">500 calls</text></g><text class="chart-label" x="40" y="41">Extract every delivery · counterfactual</text><rect class="chart-bar comparison-bar" x="40" y="65" width="480" height="43" rx="2"/><text class="chart-value comparison-value" x="506" y="93" text-anchor="end">500</text><text class="chart-label" x="40" y="142">Ontave · measured fixture extractions</text><rect class="chart-bar measured-bar" x="40" y="166" width="96" height="43" rx="2" fill="url(#bar-gradient)"/><text class="chart-value" x="152" y="194">100</text><path class="avoided-bracket" d="M150 221v6h370v-6"/><text class="chart-note" x="335" y="216" text-anchor="middle">400 calls avoided</text>`)}<figcaption>500 deliveries · deterministic fixture adapter · no live model</figcaption></figure>
  </div>
  <div class="benchmark-panel" id="chart-reads" role="tabpanel" aria-labelledby="benchmark-reads" hidden>
    <div class="benchmark-copy"><strong class="metric-display">0<span> calls</span></strong><h3>Your accepted data.<br>No inference on read.</h3><p>1,000 structured queries. Zero model calls. Local read timings at three dataset sizes.</p><small>Read p95, 100 timed reads per dataset.<br>Short synthetic Person records; page size 25.</small></div>
    <figure class="benchmark-chart">${chart("read-chart", "Local ordered-read p95 by dataset size", "At 100 records, p95 was 0.95 milliseconds. At 1,000 records, 1.37 milliseconds. At 10,000 records, 8.27 milliseconds. Dataset sizes are equally spaced categories; vertical scale is zero to ten milliseconds.", `<defs><linearGradient id="read-area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#bc8dbb" stop-opacity=".24"/><stop offset="1" stop-color="#bc8dbb" stop-opacity="0"/></linearGradient></defs><g class="chart-grid"><path d="M60 46H520M60 146H520M60 246H520"/></g><g class="chart-tick"><text x="13" y="50">10 ms</text><text x="22" y="150">5</text><text x="22" y="250">0</text></g><path d="${readPath} L500 246H60Z" fill="url(#read-area)"/><path class="read-line" d="${readPath}" pathLength="1"/>${readPoints.map((p) => `<circle class="read-point" cx="${p.x}" cy="${p.y}" r="5"/><text class="chart-value" x="${p.x}" y="${p.y - 19}" text-anchor="middle">${p.ms} ms</text><text class="chart-tick" x="${p.x}" y="277" text-anchor="middle">${p.records.toLocaleString("en-US")}</text>`).join("")}`)}<figcaption>Records in each dataset · localhost PostgreSQL · not a production SLO</figcaption></figure>
  </div>
  <div class="benchmark-panel" id="chart-provenance" role="tabpanel" aria-labelledby="benchmark-provenance" hidden>
    <div class="benchmark-copy"><strong class="metric-display">100<span>/100</span></strong><h3>Accepted field assertions.<br>Every source attached.</h3><p>Every accepted field assertion kept its source. None appeared before approval.</p><small>Source coverage measures traceability.<br>It does not establish semantic accuracy.</small></div>
    <figure class="benchmark-chart">${chart("coverage-chart", "Source reference coverage", "100 of 100 accepted field assertions retained source references. Each of the one hundred dots represents one assertion in the fixture run.", `<g class="coverage-dots">${sourceDots}</g><path class="chart-rule" d="M26 224H510"/><circle class="coverage-dot" cx="30" cy="258" r="4"/><text class="chart-label" x="45" y="262">One source-linked assertion</text><text class="chart-tick" x="510" y="262" text-anchor="end">100 / 100</text>`)}<figcaption>Deterministic fictional sources · automated approval · 100 assertions</figcaption></figure>
  </div>
  <div class="benchmark-foot"><span>Local alpha.2 measurements. Human time savings and provider cost savings are unmeasured.</span><a href="/benchmarks.json">View the data ↗</a></div>
  <details class="benchmark-data"><summary>Inspect the numbers and environment</summary><p>${benchmarkData.environment}</p><div class="table-wrap"><table><caption>Recorded synthetic workload results</caption><thead><tr><th>Measurement</th><th>Result</th></tr></thead><tbody><tr><td>Deliveries / distinct sources / extraction calls</td><td>500 / 100 / 100</td></tr><tr><td>Model calls for 1,000 structured queries</td><td>0</td></tr><tr><td>Source-referenced / accepted field assertions</td><td>100 / 100</td></tr><tr><td>Ordered-read p95: 100 / 1,000 / 10,000 records</td><td>0.95 / 1.37 / 8.27 ms</td></tr></tbody></table></div><p>${benchmarkData.limitations} <a href="/docs/benchmarks/">Read the full method →</a></p></details>
</section>`;
