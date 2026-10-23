import { randomUUID } from "node:crypto";
import { createOntave, advanceAutomatically } from "../../dist/index.js";
import { postgres } from "../../dist/postgres.js";
import { OntaveQuotationStore } from "../supplier-quotes/ontave-store.mjs";
import {
  frozenDefinition,
  policy,
  digest,
  sdkExtraction,
  validatePlan,
} from "./shared.mjs";
import { businessValues } from "./frozen-app.mjs";
import { reuseCurrentDefinitions } from "./references.mjs";
export class AdaptiveOntave {
  constructor(
    connectionString,
    { automatic = true, reuseDefinitions = false } = {},
  ) {
    this.connectionString = connectionString;
    this.automatic = automatic;
    this.reuseDefinitions = reuseDefinitions;
    this.workspaceId = randomUUID();
    this.context = Symbol("trusted application service");
    this.evidence = new Map();
    this.events = [];
  }
  authorize = (context) => {
    if (context !== this.context) throw Error("UNAUTHORIZED");
    return {
      actorId: this.automatic
        ? "automation/" + policy.id
        : "strict-quotation-control",
      workspaceId: this.workspaceId,
      capabilities: ["provision", "ingest", "read", "worker", "review"],
    };
  };
  async setup() {
    const boot = new OntaveQuotationStore({
      connectionString: this.connectionString,
      authorize: this.authorize,
      extract: async () => {
        throw Error("Bootstrap accepts its explicit fixture only");
      },
    });
    try {
      await boot.setup(this.context, this.workspaceId);
      this.contract = boot.contract;
      this.bootstrapFixtureCalls = boot.bootstrapCalls;
    } finally {
      await boot.close();
    }
    this.runtime = createOntave({
      storage: postgres({ connectionString: this.connectionString }),
      authorize: this.authorize,
      ...(this.automatic ? { automation: policy } : {}),
      identifierRules: [{ authority: "quotation_source", kind: "reference" }],
      model: {
        extract: async (task) => {
          const output = sdkExtraction(this.plan, task.ontology, this.event.id);
          if (this.automatic)
            validatePlan(this.plan, this.parent, this.event.text);
          return {
            output,
            model: "paired-neutral-plan-replay",
            usage: { liveInferenceCalls: 0, predictionHash: digest(this.plan) },
          };
        },
        propose: async () => {
          if (this.plan.observations.length)
            throw Object.assign(
              Error(
                "Uncertain observations are not automatic schema authority",
              ),
              { code: "VALIDATION_FAILED" },
            );
          return {
            patch: this.plan.patch,
            model: "paired-neutral-plan-replay",
            usage: { liveInferenceCalls: 0, predictionHash: digest(this.plan) },
          };
        },
      },
    });
    if (
      digest((await this.runtime.ontology.inspect(this.context)).definition) !==
      digest(frozenDefinition)
    )
      throw Error("Frozen initial model diverged");
  }
  async apply(event, plan, { seed = false } = {}) {
    this.event = event;
    this.plan = plan;
    this.parent = (
      await this.runtime.ontology.inspect(this.context)
    ).definition;
    if (this.reuseDefinitions)
      this.plan = reuseCurrentDefinitions(this.plan, this.parent);
    const receipt = await this.runtime.ingest(this.context, {
      source: event.source ?? "supplier",
      idempotencyKey: event.id,
      payload: { kind: "text", text: event.text },
    });
    this.evidence.set(receipt.evidence_id, event.id);
    const old = await this.runtime.jobs.get(this.context, receipt.job_id);
    if (old.state === "completed")
      return { state: "completed", duplicate: true, events: [] };
    await this.runtime.worker.runOnce(this.context);
    if (seed) {
      const view = await this.runtime.reviews.forJob(
        this.context,
        receipt.job_id,
      );
      await this.runtime.reviews.accept(this.context, {
        bundleId: view.bundle.id,
        digest: view.bundle.hash,
        requestKey: "seed/" + event.id,
        reason:
          "Authored initial fixture setup before the application is frozen",
      });
      return { state: "completed", events: [] };
    }
    if (!this.automatic)
      return {
        state: (await this.runtime.jobs.get(this.context, receipt.job_id))
          .state,
        events: [],
      };
    const result = await advanceAutomatically(
      this.runtime,
      this.context,
      receipt.job_id,
    );
    this.events.push(...result.events);
    return result;
  }
  async definition() {
    return (await this.runtime.ontology.inspect(this.context)).definition;
  }
  async findFrozen(query) {
    return businessValues(
      (
        await this.runtime.entities.find(this.context, {
          ...query,
          contractId: this.contract.id,
          contractHash: this.contract.hash,
        })
      ).records,
    );
  }
  async related(parentConcept) {
    const current = await this.definition(),
      contract = await this.runtime.contracts.register(this.context, current),
      parents = (
        await this.runtime.entities.find(this.context, {
          contractId: contract.id,
          contractHash: contract.hash,
          conceptId: parentConcept,
          limit: 100,
        })
      ).records,
      result = [];
    for (const relation of current.relations.filter(
      (r) => r.target === parentConcept,
    )) {
      const rows = (
        await this.runtime.entities.find(this.context, {
          contractId: contract.id,
          contractHash: contract.hash,
          conceptId: relation.source,
          include: [relation.id],
          limit: 100,
        })
      ).records;
      for (const row of rows) {
        const proof = await this.runtime.assertions.explain(
          this.context,
          row.id,
        );
        result.push({
          id: row.id,
          conceptId: row.conceptId,
          fields: row.fields,
          parentReferences: (row.relationships?.[relation.id]?.items ?? []).map(
            (link) =>
              parents.find((p) => p.id === link.id)?.fields.reference.value,
          ),
          sourceEventIds: [
            ...new Set(
              proof
                .map((p) => this.evidence.get(p.evidence_id))
                .filter(Boolean),
            ),
          ],
        });
      }
    }
    return result;
  }
  async close() {
    await this.runtime?.close();
  }
}
