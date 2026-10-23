// Application integration for the same domain/extractor as the plain comparator.
import { createOntave } from "../../dist/index.js";
import { postgres } from "../../dist/postgres.js";
import {
  quotationDefinition,
  validateOutput,
  toExtraction,
} from "./domain.mjs";
const seedText = "Quotation BOOT-1 is a fictional schema setup fixture.";
const seed = {
  records: [
    {
      type: "quotation",
      fields: { reference: { value: "BOOT-1", quote: "BOOT-1" } },
    },
  ],
  observations: [],
};
function neutral(extraction) {
  return {
    records: extraction.entities.map((e) => ({
      type: e.conceptId,
      fields: Object.fromEntries(
        Object.entries(e.fields).map(([id, f]) => [
          id,
          {
            value: f.value,
            quote: f.quote,
            ...(f.occurrence === undefined ? {} : { occurrence: f.occurrence }),
          },
        ]),
      ),
    })),
    observations: extraction.observations.map((o) => ({
      concept: o.concept,
      quote: o.quote,
    })),
  };
}
export class OntaveQuotationStore {
  constructor({ connectionString, authorize, extract, reviewOnly = false }) {
    this.transactions = 0;
    this.bootstrapCalls = 0;
    this.extractionCalls = 0;
    const storage = postgres({ connectionString });
    const transaction = storage.transaction.bind(storage);
    storage.transaction = (...args) => {
      this.transactions++;
      return transaction(...args);
    };
    this.app = createOntave({
      storage,
      authorize,
      ...(reviewOnly
        ? {}
        : {
            model: {
              extract: async (task) => {
                const bootstrap = task.text === seedText;
                if (bootstrap) this.bootstrapCalls++;
                else this.extractionCalls++;
                const output = validateOutput(
                  bootstrap ? seed : await extract(task.text),
                  task.text,
                );
                return {
                  output: toExtraction(output, task.ontology),
                  model: bootstrap
                    ? "authored-schema-bootstrap"
                    : "paired-quotation-extractor",
                };
              },
            },
          }),
    });
  }
  async setup(context, workspaceId) {
    await this.app.workspaces.create(context, {
      workspaceId,
      name: "Supplier quotation comparison",
      seed: "empty",
      requestKey: "quotation-workspace",
    });
    const before = await this.app.ontology.inspect(context);
    if (before.definition.concepts.length === 0) {
      // Explicit authored bootstrap, never presented as live discovery or accuracy validation.
      const evidence = await this.app.ingest(context, {
        source: "authored-schema-fixture",
        idempotencyKey: "bootstrap",
        payload: { kind: "text", text: seedText },
      });
      await this.app.worker.runOnce(context);
      const candidate = await this.app.ontology.propose(context, {
        patch: quotationDefinition,
        evidenceIds: [evidence.evidence_id],
        requestKey: "quotation-schema",
        reason:
          "Application explicitly selected this supplier-quotation schema",
      });
      const suite = await this.app.evaluations.registerSuite(context, {
        name: "Authored schema smoke check",
        maxCalls: 2,
        timeoutMs: 10000,
        tasks: [
          {
            id: "reference",
            kind: "extract",
            evidenceId: evidence.evidence_id,
            expected: [
              {
                conceptId: "quotation",
                fieldId: "reference",
                value: "BOOT-1",
                quote: "BOOT-1",
              },
            ],
          },
        ],
      });
      const evaluation = await this.app.evaluations.evaluate(context, {
        candidateId: candidate.candidateId,
        suiteId: suite.suiteId,
      });
      if (!evaluation.passed) throw Error("SCHEMA_BOOTSTRAP_FAILED");
      const published = await this.app.ontology.publish(context, {
        candidateId: candidate.candidateId,
        candidateHash: candidate.hash,
        evaluationId: evaluation.evaluationId,
        evaluationHash: evaluation.hash,
        requestKey: "approve-authored-schema",
        reason:
          "Explicit setup approval of the authored schema; real semantic qualification is separate",
      });
      for (let n = 0; n < published.reprocessingJobs.length; n++) {
        const work = await this.app.worker.runOnce(context);
        if (work && "bundleId" in work) {
          const b = await this.app.reviews.get(context, work.bundleId);
          await this.app.reviews.reject(context, {
            bundleId: b.id,
            digest: b.hash,
            requestKey: "decline-bootstrap-" + n,
            reason: "Fixture is not a real supplier quotation",
          });
        }
      }
    }
    this.contract = await this.app.contracts.register(
      context,
      quotationDefinition,
    );
    return this.contract;
  }
  async ingest(context, { source = "supplier", id, text }) {
    const r = await this.app.ingest(context, {
      source,
      idempotencyKey: id,
      payload: { kind: "text", text },
    });
    return { evidenceId: r.evidence_id, jobId: r.job_id };
  }
  process(context) {
    return this.app.worker.runOnce(context);
  }
  async review(context, jobId) {
    const view = await this.app.reviews.forJob(context, jobId),
      b = view.bundle;
    return {
      jobId: view.job.id,
      state: view.job.state,
      evidence: {
        id: view.evidence.id,
        text: view.evidence.payload,
        range: view.evidence.range,
      },
      bundle: b
        ? {
            id: b.id,
            digest: b.hash,
            output: neutral(b.body.extraction),
            pending: b.body.pending,
            identityCandidates: b.body.identityCandidates ?? {},
          }
        : null,
    };
  }
  async amend(context, input) {
    const old = await this.app.reviews.get(context, input.bundleId),
      source = await this.app.evidence.get(context, old.evidence_id);
    if (source.range.hasMore) throw Error("REVIEW_SOURCE_REQUIRES_PAGINATION");
    const output = validateOutput(input.output, source.payload),
      extraction = toExtraction(output);
    // Immutable existing bindings require the SDK's original mention IDs.
    if (extraction.entities.length !== old.body.extraction.entities.length)
      throw Error("RECORD_SET_CHANGE_REQUIRES_NEW_REVIEW");
    extraction.entities.forEach((e, i) => {
      e.mentionId = old.body.extraction.entities[i].mentionId;
    });
    const r = await this.app.reviews.amend(context, {
      bundleId: input.bundleId,
      digest: input.digest,
      extraction,
      requestKey: input.key,
      reason: input.reason,
    });
    return { bundleId: r.bundleId, digest: r.digest };
  }
  async resolveIdentity(context, input) {
    const r = await this.app.reviews.resolveIdentity(context, {
      bundleId: input.bundleId,
      digest: input.digest,
      mentionId: input.mentionId,
      entityId: input.entityId,
      requestKey: input.key,
      reason: input.reason,
    });
    return { bundleId: r.bundleId, digest: r.digest };
  }
  accept(context, input) {
    return this.app.reviews.accept(context, {
      bundleId: input.bundleId,
      digest: input.digest,
      requestKey: input.key,
      reason: input.reason,
    });
  }
  reject(context, input) {
    return this.app.reviews.reject(context, {
      bundleId: input.bundleId,
      digest: input.digest,
      requestKey: input.key,
      reason: input.reason,
    });
  }
  async read(context) {
    const records = [];
    for (const conceptId of ["quotation", "quote_line"]) {
      const r = await this.app.entities.find(context, {
        contractId: this.contract.id,
        contractHash: this.contract.hash,
        conceptId,
        limit: 100,
      });
      records.push(...r.records);
    }
    return { records };
  }
  explain(context, entityId) {
    return this.app.assertions.explain(context, entityId);
  }
  close() {
    return this.app.close();
  }
}
