// Start a real human session only. Automated checks use a separate controller instance.
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { disposablePostgres } from "../tests/helpers/postgres.mjs";
import {
  migratePlain,
  PlainQuotationStore,
} from "../examples/supplier-quotes/plain-postgres.mjs";
import { OntaveQuotationStore } from "../examples/supplier-quotes/ontave-store.mjs";
import { startQuotationStudy } from "../examples/supplier-quotes/study-server.mjs";
import { quotationCases } from "../examples/supplier-quotes/cases.mjs";
const args = process.argv.slice(2);
if (args.some((a) => !a.startsWith("--port=")))
  throw Error("Use only optional --port=number");
const port = Number(args.find((a) => a.startsWith("--port="))?.slice(7) ?? 0);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw Error("Invalid port");
const version = JSON.parse(await readFile("package.json", "utf8")).version,
  candidateArchive = resolve(`artifacts/ontave-${version}.tgz`);
await access(candidateArchive).catch(() => {
  throw Error(
    "First run npm run verify:package to prepare the local candidate archive",
  );
});
const db = await disposablePostgres(),
  grants = new Map(),
  stores = [],
  tasks = { plain: [], ontave: [] },
  setups = {};
const authorize = (credential) => {
  if (!grants.has(credential)) throw Error("Unauthorized");
  return grants.get(credential);
};
const assign = () => {
  const workspaceId = randomUUID(),
    context = Symbol("local study maintainer");
  grants.set(context, {
    actorId: "local-study-maintainer",
    workspaceId,
    capabilities: ["provision", "ingest", "read", "review", "worker"],
  });
  return { workspaceId, context };
};
let controller;
try {
  await migratePlain(db.admin, "ontave_runtime");
  const picks = {
    plain: ["DEV-01", "DEV-02", "DEV-04"],
    ontave: ["TEST-01", "TEST-02", "TEST-04"],
  };
  for (const arm of ["plain", "ontave"]) {
    for (let n = 0; n < picks[arm].length; n++) {
      const document = quotationCases.find((c) => c.id === picks[arm][n]),
        output = structuredClone(document.expected);
      let injectedError = null;
      if (n < 2) {
        const item = output.records.find((r) => r.type === "quote_line");
        item.fields.unit_price.value.amount = String(
          item.fields.quantity.value,
        );
        injectedError = "unit_price_replaced_by_source_quantity";
      }
      const { workspaceId, context } = assign(),
        options = {
          connectionString: db.connectionString,
          authorize,
          extract: async () => output,
        };
      const store =
        arm === "plain"
          ? new PlainQuotationStore(options)
          : new OntaveQuotationStore(options);
      stores.push(store);
      if (store.setup) await store.setup(context, workspaceId);
      const receipt = await store.ingest(context, {
        source: "fictional-study",
        id: document.id,
        text: document.text,
      });
      await store.process(context);
      const view = await store.review(context, receipt.jobId);
      if (view.state !== "waiting_review")
        throw Error(
          "Study proposal failed to stage: " + arm + " " + document.id,
        );
      tasks[arm].push({
        arm,
        store,
        context,
        document,
        receipt,
        injectedError,
      });
    }
    const { workspaceId, context } = assign();
    if (arm === "ontave") {
      const setup = new OntaveQuotationStore({
        connectionString: db.connectionString,
        authorize,
        extract: async () => ({ records: [], observations: [] }),
      });
      stores.push(setup);
      await setup.setup(context, workspaceId);
    }
    setups[arm] = {
      config: { connectionString: db.connectionString, workspaceId },
    };
  }
  const root = resolve(
    "artifacts/quotation-human-study",
    new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID(),
  );
  controller = await startQuotationStudy({
    root,
    tasks,
    setups,
    candidateArchive,
    nodePath: process.execPath,
    port,
  });
  console.log("Quotation walkthrough: " + controller.url);
  console.log("Private results: " + root);
  console.log(
    "No model calls. Ctrl+C stops the study and removes the disposable database.",
  );
  let stop;
  await new Promise((ok) => {
    stop = ok;
    process.once("SIGINT", ok);
    process.once("SIGTERM", ok);
  });
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
} finally {
  if (controller) await controller.close();
  for (const store of stores) await store.close();
  await db.stop();
}
