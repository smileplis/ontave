#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { generateContract } from "./codegen.js";
import { migrationPlan, migrate } from "./postgres.js";
import { check, OntaveError } from "./core.js";
import type { Ontave } from "./runtime.js";

const help = `Ontave 0.1.0-alpha.0 (private development build)
Usage: ontave <command> [action] --config ./ontave.config.mjs --input request.json

init                         Create a local config template without overwriting
doctor                       Check runtime configuration and workspace access
migrate plan|apply           Explicit internal migrations (apply requires --yes)
workspace create             Explicit authorized provisioning
ingest                       Preserve a text/JSON input and return its receipt
status                       List scoped jobs and states
worker [once]                Process scoped jobs; continuous mode handles shutdown
review show|resolve-identity|resolve-conflict|amend|accept|reject
ontology inspect|propose|diff|validate|evaluate|publish|reject
evaluation register|get      Register a suite or inspect an evaluation (--id)
contract register|pull       Adopt or retrieve an application contract
entities find                Read accepted records through an exact contract
typegen --input lock.json --output ./generated

Use --id for show/diff/pull, --input for mutations and queries. Publication,
review acceptance and migration apply require --yes with exact request digests.
No command publishes to npm or creates hosted infrastructure.
`;
const args = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    input: { type: "string" },
    id: { type: "string" },
    output: { type: "string" },
    yes: { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean" },
  },
});
const [command = "help", action] = args.positionals;
async function readInput() {
  check(
    args.values.input,
    "INVALID_INPUT",
    "Use --input with an explicit JSON file",
  );
  return JSON.parse(await readFile(resolve(args.values.input), "utf8"));
}
async function main(): Promise<unknown> {
  if (command === "help" || args.values.help) {
    process.stdout.write(help);
    return;
  }
  if (command === "version") {
    process.stdout.write("0.1.0-alpha.0\n");
    return;
  }
  if (command === "init") {
    const path = resolve(args.values.output ?? "ontave.config.mjs");
    await writeFile(
      path,
      `// Trusted server-side configuration. Do not expose this file to browsers.\nimport { createOntave, OntaveError } from 'ontave';\nimport { postgres } from 'ontave/postgres';\nimport { gemini } from 'ontave/models/gemini';\nexport default () => {\n const token = process.env.ONTAVE_LOCAL_TOKEN;\n if (!token || token.length < 32) throw new Error('Set ONTAVE_LOCAL_TOKEN to a private local secret');\n const runtime = createOntave({\n  storage: postgres({ connectionString: process.env.ONTAVE_DATABASE_URL }),\n  authorize: credential => {\n   if (credential !== token) throw new OntaveError('UNAUTHORIZED', 'Invalid local credential');\n   return { actorId: 'local-owner', workspaceId: process.env.ONTAVE_WORKSPACE_ID, capabilities: ['provision','read','ingest','review','worker'] };\n  },\n  model: process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL ? gemini({apiKey:process.env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL}) : {async extract(){throw new OntaveError('MODEL_UNAVAILABLE','Configure GEMINI_API_KEY and GEMINI_MODEL; no fixture fallback');}},\n  cursorSecret: process.env.ONTAVE_CURSOR_SECRET\n });\n return { runtime, context: token, migrationConnectionString: process.env.ONTAVE_MIGRATION_DATABASE_URL, runtimeRole: process.env.ONTAVE_RUNTIME_ROLE };\n};\n`,
      { flag: "wx" },
    );
    return {
      created: path,
      next: "Configure explicit environment references and use a dedicated disposable database. Run migrate plan before apply.",
    };
  }
  if (command === "typegen") {
    const lock = await readInput();
    check(
      args.values.output,
      "INVALID_INPUT",
      "Use --output for the generated directory",
    );
    await generateContract(lock, args.values.output);
    return { generated: resolve(args.values.output), contractHash: lock.hash };
  }
  check(
    args.values.config,
    "INVALID_INPUT",
    "Use --config with an explicit trusted server module",
  );
  const mod = await import(pathToFileURL(resolve(args.values.config)).href);
  const cfg =
    typeof mod.default === "function" ? await mod.default() : mod.default;
  const app = cfg.runtime as Ontave,
    ctx = cfg.context;
  check(
    app && ctx,
    "INVALID_INPUT",
    "Config must provide runtime and authorized context",
  );
  try {
    if (command === "migrate") {
      check(
        ["plan", "apply"].includes(action ?? ""),
        "INVALID_INPUT",
        "Use migrate plan or apply",
      );
      check(
        cfg.migrationConnectionString,
        "INVALID_INPUT",
        "An explicit migration connection is required",
      );
      const pool = new Pool({
        connectionString: cfg.migrationConnectionString,
      });
      try {
        if (action === "plan") return await migrationPlan(pool);
        check(
          args.values.yes,
          "INVALID_INPUT",
          "Migration apply requires --yes",
        );
        await migrate(pool, cfg.runtimeRole);
        return { applied: true };
      } finally {
        await pool.end();
      }
    }
    if (command === "doctor")
      return {
        node: process.version,
        workspace: await app.ontology.inspect(ctx),
        model: "Configured adapter; no provider call performed",
      };
    if (command === "workspace" && action === "create")
      return await app.workspaces.create(ctx, await readInput());
    if (command === "ingest") return await app.ingest(ctx, await readInput());
    if (command === "status") return await app.jobs.list(ctx);
    if (command === "worker") {
      if (action === "once") return await app.worker.runOnce(ctx);
      let stopping = false;
      let drain: NodeJS.Timeout | undefined;
      const stop = () => {
        stopping = true;
        drain ??= setTimeout(() => process.exit(0), 10000);
        drain.unref();
      };
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
      try {
        while (!stopping) {
          const result = await app.worker.runOnce(ctx);
          if (result) process.stdout.write(JSON.stringify(result) + "\n");
          else await new Promise((r) => setTimeout(r, 250));
        }
      } finally {
        if (drain) clearTimeout(drain);
        process.removeListener("SIGTERM", stop);
        process.removeListener("SIGINT", stop);
      }
      return { stopped: true };
    }
    if (command === "review") {
      if (action === "show")
        return await app.reviews.get(ctx, args.values.id ?? "");
      if (action === "accept") {
        check(
          args.values.yes,
          "INVALID_INPUT",
          "Review acceptance requires --yes",
        );
        return await app.reviews.accept(ctx, await readInput());
      }
      if (action === "reject")
        return await app.reviews.reject(ctx, await readInput());
      if (action === "resolve-conflict")
        return await app.reviews.resolveConflict(ctx, await readInput());
      if (action === "resolve-identity")
        return await app.reviews.resolveIdentity(ctx, await readInput());
      if (action === "amend")
        return await app.reviews.amend(ctx, await readInput());
    }
    if (command === "ontology") {
      if (action === "inspect") return await app.ontology.inspect(ctx);
      if (action === "propose")
        return await app.ontology.propose(ctx, await readInput());
      if (action === "diff" || action === "validate")
        return await app.ontology.diff(ctx, args.values.id ?? "");
      if (action === "evaluate")
        return await app.evaluations.evaluate(ctx, await readInput());
      if (action === "publish") {
        check(
          args.values.yes,
          "INVALID_INPUT",
          "Ontology publication requires --yes",
        );
        return await app.ontology.publish(ctx, await readInput());
      }
      if (action === "reject")
        return await app.ontology.reject(ctx, await readInput());
    }
    if (command === "evaluation" && action === "register")
      return await app.evaluations.registerSuite(ctx, await readInput());
    if (command === "evaluation" && action === "get")
      return await app.evaluations.get(ctx, args.values.id ?? "");
    if (command === "contract") {
      if (action === "register")
        return await app.contracts.register(ctx, await readInput());
      if (action === "pull")
        return await app.contracts.pull(ctx, args.values.id ?? "");
    }
    if (command === "entities" && action === "find")
      return await app.entities.find(ctx, await readInput());
    throw new OntaveError(
      "INVALID_INPUT",
      "Unsupported command; run ontave help",
    );
  } finally {
    await app.close();
  }
}
main()
  .then((value) => {
    if (value !== undefined)
      process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  })
  .catch((error) => {
    process.stderr.write(
      JSON.stringify({
        code: error instanceof OntaveError ? error.code : "OPERATION_FAILED",
        message:
          error instanceof OntaveError
            ? error.message
            : "Operation failed; check configuration and local permissions",
        retryable: error instanceof OntaveError && error.retryable,
      }) + "\n",
    );
    process.exitCode = 1;
  });
