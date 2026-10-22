import { searchDocuments } from "./src/search.ts";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "dist");
async function walk(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    files.push(...(item.isDirectory() ? await walk(path) : [path]));
  }
  return files;
}
let links = 0;
const files = await walk(root);
for (const file of files) {
  if (!file.endsWith(".html")) continue;
  const html = await readFile(file, "utf8");
  assert.ok(html.includes('lang="en"'));
  assert.equal((html.match(/<h1(?: |>)/g) || []).length, 1, file);
  assert.ok(
    !/AIza[A-Za-z0-9_-]{30,}|gsk_[A-Za-z0-9]{35,}|sk-or-v1-[0-9a-f]{40,}|mstrl_[A-Za-z0-9_-]{35,}|\/Users\//.test(
      html,
    ),
    "Private content found",
  );
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const href = match[1];
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    const url = new URL(href, "http://local");
    let path = resolve(root, "." + decodeURIComponent(url.pathname));
    try {
      if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
      await stat(path);
    } catch {
      throw Error(`Broken link: ${href} in ${file}`);
    }
    if (url.hash && path.endsWith(".html"))
      assert.ok(
        (await readFile(path, "utf8")).includes(
          `id="${decodeURIComponent(url.hash.slice(1))}"`,
        ),
        `Missing anchor ${href}`,
      );
    links++;
  }
}
const search = JSON.parse(
  await readFile(resolve(root, "search-index.json"), "utf8"),
);
assert.equal(search.length, 29);
assert.ok(search.some((x) => x.title === "Your first accepted record"));
const home = await readFile(resolve(root, "index.html"), "utf8");
assert.ok(!home.includes('class="eyebrow"'));
assert.ok(home.includes('aria-label="How Ontave works"'));
assert.ok(home.includes("Walkthrough chapters"));
assert.ok(!files.some((f) => f.includes("/research/")));
const playground = await readFile(
  resolve(root, "playground/index.html"),
  "utf8",
);
assert.ok(playground.includes('data-mode="reference"'));
assert.ok(playground.includes("0.1.0-alpha.2"));
assert.ok(playground.includes("playground --install"));
assert.ok(playground.includes("Guided sandbox"));
const reference = JSON.parse(
  await readFile(resolve(root, "preview-reference.json"), "utf8"),
);
assert.equal(reference.version, "0.1.0-alpha.2");
assert.equal(reference.kind, "recorded-sdk-fixtures");
assert.equal(reference.scenarios.roof.states.at(-1).records.length, 1);
assert.equal(
  reference.scenarios.payment.states.at(-1).records[0].fields.amount
    .verification,
  "reported",
);
assert.ok(home.includes("/ontave-wordmark.svg"));
const benchmark = JSON.parse(
  await readFile(resolve(root, "benchmarks.json"), "utf8"),
);
assert.equal(
  benchmark.deliveries.counterfactualCalls -
    benchmark.deliveries.extractionCalls,
  400,
);
assert.equal(benchmark.reads.modelCalls, 0);
assert.deepEqual(
  benchmark.orderedReadP95.map((x) => x.ms),
  [0.95, 1.37, 8.27],
);
assert.equal(benchmark.provenance.sourceReferencedAssertions, 100);
for (const id of ["deliveries", "reads", "provenance"]) {
  assert.ok(home.includes(`aria-controls="chart-${id}"`));
  assert.ok(home.includes(`id="chart-${id}"`));
}
assert.ok(home.includes("Synthetic workload") || home.includes("SYNTHETIC WORKLOAD"));
assert.ok(home.includes("/docs/benchmarks/"));
assert.ok(benchmark.limitations.includes("model accuracy"));
assert.ok(
  !(await readFile(resolve(root, "favicon.svg"), "utf8")).includes(
    "paint0_linear_95_806",
  ),
);
console.log(
  JSON.stringify({
    ok: true,
    htmlPages: files.filter((f) => f.endsWith(".html")).length,
    internalLinksChecked: links,
    searchDocuments: search.length,
    scrollStoryRendered: true,
    privateContentExcluded: true,
  }),
);

const documents = [
  {
    title: "Release status",
    description: "Alpha release",
    text: "release notes",
    path: "/release",
  },
  {
    title: "Workers & recovery",
    description: "Durable leases and fenced jobs",
    text: "lease expiry",
    path: "/workers",
  },
  {
    title: "Source evidence",
    description: "Inspect quotes",
    text: "source preservation",
    path: "/source",
  },
];
assert.equal(searchDocuments(documents, "lease")[0]?.path, "/workers");
assert.equal(searchDocuments(documents, "lease evidence").length, 0);
assert.doesNotThrow(() => searchDocuments(documents, "(unsafe["));
