import { resolve } from "node:path";
import { Pool } from "pg";
import { createOntave } from "./runtime.js";
import type { OntaveConfig } from "./runtime.js";
import { postgres, migrate } from "./postgres.js";
import { localIdentity, startLocalDatabase } from "./local-database.js";
import { startStudio } from "./studio.js";
import { advanceAutomatically } from "./automation.js";
import { check, abortable } from "./core.js";
import type { ModelAdapter, EntityQuery } from "./types.js";
import { automationPolicy } from "./policy.js";

/** A single-developer local workspace. Use createOntave with host authentication for shared servers. */
export async function openOntave(
  options: {
    directory?: string;
    install?: boolean;
    connectionString?: string;
    migrationConnectionString?: string;
    runtimeRole?: string;
    model?: OntaveConfig["model"];
    automation?: OntaveConfig["automation"];
    seed?: "empty" | "people";
  } = {},
) {
  if (options.automation) automationPolicy(options.automation);
  check(
    !options.model || typeof options.model.extract === "function",
    "INVALID_INPUT",
    "A configured model must implement extract",
  );
  check(
    !options.migrationConnectionString ||
      (options.connectionString && options.runtimeRole),
    "INVALID_INPUT",
    "External migrations require an explicit runtime connection and role",
  );
  const directory = resolve(options.directory ?? ".ontave"),
    identity = await localIdentity(directory);
  let database: Awaited<ReturnType<typeof startLocalDatabase>> | undefined;
  if (!options.connectionString)
    database = await startLocalDatabase(directory, options.install === true);
  if (options.migrationConnectionString) {
    check(
      options.connectionString && options.runtimeRole,
      "INVALID_INPUT",
      "External migration needs explicit runtime connection and role",
    );
    const admin = new Pool({
      connectionString: options.migrationConnectionString,
    });
    try {
      await migrate(admin, options.runtimeRole!);
    } finally {
      await admin.end();
    }
  }
  const stop = new AbortController();
  const model: ModelAdapter | undefined = options.model
    ? {
        extract: (task) => {
          const signal = AbortSignal.any([task.signal, stop.signal]);
          return abortable(signal, () =>
            options.model!.extract({ ...task, signal }),
          );
        },
        ...(options.model.propose
          ? {
              propose: (
                task: Parameters<NonNullable<ModelAdapter["propose"]>>[0],
              ) => {
                const signal = AbortSignal.any([task.signal, stop.signal]);
                return abortable(signal, () =>
                  options.model!.propose!({ ...task, signal }),
                );
              },
            }
          : {}),
      }
    : undefined;
  const context = Symbol("trusted local workspace"),
    runtime = createOntave({
      storage: postgres({
        connectionString:
          options.connectionString ?? database!.connectionString,
      }),
      model,
      automation: options.automation,
      cursorSecret: identity.cursorSecret,
      authorize: (credential) => {
        check(
          credential === context,
          "UNAUTHORIZED",
          "Invalid local owner credential",
        );
        return {
          actorId: "local-developer",
          workspaceId: identity.workspaceId,
          capabilities: ["provision", "read", "ingest", "worker", "review"],
        };
      },
    });
  const studios: Set<Awaited<ReturnType<typeof startStudio>>> = new Set();
  const operations = new Set<Promise<unknown>>();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    stop.abort();
    await Promise.allSettled([...operations]);
    await Promise.allSettled([...studios].map((studio) => studio.close()));
    try {
      await runtime.close();
    } finally {
      await database?.close();
    }
  };
  try {
    await runtime.workspaces.create(context, {
      workspaceId: identity.workspaceId,
      name: "Local Ontave workspace",
      requestKey: "local-workspace-v1",
      seed: options.seed ?? "people",
    });
  } catch (error) {
    await close();
    throw error;
  }
  const processOne = () => {
    check(!closed, "INVALID_INPUT", "Local workspace is closed");
    const operation = (async () => {
      const work = await runtime.worker.runOnce(context);
      if (work && options.automation)
        return {
          work,
          automation: await advanceAutomatically(runtime, context, work.jobId),
        };
      return work;
    })();
    operations.add(operation);
    operation.then(
      () => operations.delete(operation),
      () => operations.delete(operation),
    );
    return operation;
  };
  return {
    runtime,
    context,
    workspaceId: identity.workspaceId,
    directory,
    ingest: (input: { id: string; text: string; source?: string }) =>
      runtime.ingest(context, {
        source: input.source ?? "local",
        idempotencyKey: input.id,
        payload: { kind: "text", text: input.text },
      }),
    process: processOne,
    catalog: () => runtime.ontology.inspect(context),
    async find(query: Omit<EntityQuery, "contractId" | "contractHash">) {
      const snapshot = await runtime.ontology.inspect(context),
        contract = await runtime.contracts.register(
          context,
          snapshot.definition,
        );
      return runtime.entities.find(context, {
        ...query,
        contractId: contract.id,
        contractHash: contract.hash,
      });
    },
    async studio(options: { port?: number } = {}) {
      check(!closed, "INVALID_INPUT", "Local workspace is closed");
      const studio = await startStudio({
        runtime,
        context,
        port: options.port,
        process: processOne,
      });
      studios.add(studio);
      return studio;
    },
    close,
  };
}
