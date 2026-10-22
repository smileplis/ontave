import { randomUUID } from "node:crypto";
import { createOntave, starter } from "../index.js";
import { check, sourceSpan } from "../core.js";
import type { Storage } from "../postgres.js";
import type { Definition, ExtractedEntity } from "../types.js";
import {
  installationPatch,
  sampleExtraction,
  scenarioById,
  scenarios,
  type Scenario,
} from "./scenarios.js";

export type PreviewAction =
  "interpret" | "evaluate" | "activate" | "accept" | "reject";
/** Explicit fictional demo orchestration. Every database effect uses the public SDK. */
export class PreviewSession {
  private workspaceId = randomUUID();
  private readonly context = Symbol("local-preview-owner");
  private readonly app;
  private scenario: Scenario = scenarios[0];
  private phase = "ready";
  private receipt: any;
  private work: any;
  private candidate: any;
  private evaluation: any;
  private oldContract: any;
  private currentContract: any;
  private accepted: any;
  private interpretations = 0;
  private decisions = 0;
  constructor(storage: Storage) {
    this.app = createOntave({
      storage,
      model: {
        async extract(task) {
          return {
            model: "ontave-fictional-preview-v1",
            output: sampleExtraction(task),
            usage: { totalTokens: 0 },
          };
        },
      },
      authorize: (ctx) => {
        check(
          ctx === this.context,
          "UNAUTHORIZED",
          "Invalid playground context",
        );
        return {
          actorId: "local-preview-owner",
          workspaceId: this.workspaceId,
          capabilities: ["provision", "read", "ingest", "worker", "review"],
        };
      },
    });
  }
  async reset(id = "roof") {
    this.scenario = scenarioById(id);
    this.workspaceId = randomUUID();
    this.phase = "ready";
    this.receipt =
      this.work =
      this.candidate =
      this.evaluation =
      this.accepted =
        null;
    this.interpretations = 0;
    this.decisions = 0;
    await this.app.workspaces.create(this.context, {
      workspaceId: this.workspaceId,
      name: "Fictional Ontave playground",
      seed: "people",
      requestKey: "create",
    });
    this.oldContract = await this.app.contracts.register(this.context, starter);
    await this.app.ingest(this.context, {
      source: "fictional-seed",
      idempotencyKey: "person",
      payload: { kind: "text", text: "Ramesh" },
    });
    let work = await this.app.worker.runOnce(this.context);
    check(
      work && "bundleId" in work,
      "VALIDATION_FAILED",
      "Unable to seed fictional person",
    );
    let bundle = await this.app.reviews.get(this.context, work.bundleId);
    await this.app.reviews.accept(this.context, {
      bundleId: bundle.id,
      digest: bundle.hash,
      requestKey: "seed-person",
      reason: "Explicit fictional initial workspace",
    });
    const input = await this.app.ingest(this.context, {
      source: "fictional-seed",
      idempotencyKey: "installation",
      payload: { kind: "text", text: "Installation I-101 is scheduled." },
    });
    await this.app.worker.runOnce(this.context);
    const candidate = await this.app.ontology.propose(this.context, {
      patch: installationPatch,
      evidenceIds: [input.evidence_id],
      requestKey: "seed-installation",
      reason: "Explicit fictional initial model",
    });
    const suite = await this.app.evaluations.registerSuite(this.context, {
      name: "Fictional installation bootstrap",
      maxCalls: 2,
      timeoutMs: 10000,
      tasks: [
        {
          id: "earlier-contract",
          kind: "contract",
          contractId: this.oldContract.id,
        },
        {
          id: "new-installation",
          kind: "extract",
          evidenceId: input.evidence_id,
          expected: [
            {
              conceptId: "installation",
              fieldId: "reference",
              value: "I-101",
              quote: "I-101",
            },
          ],
        },
      ],
    });
    const evaluated = await this.app.evaluations.evaluate(this.context, {
      candidateId: candidate.candidateId,
      suiteId: suite.suiteId,
    });
    await this.app.ontology.publish(this.context, {
      candidateId: candidate.candidateId,
      candidateHash: candidate.hash,
      evaluationId: evaluated.evaluationId,
      evaluationHash: evaluated.hash,
      requestKey: "seed-publish",
      reason: "Passing fictional bootstrap checks",
    });
    work = await this.app.worker.runOnce(this.context);
    check(
      work && "bundleId" in work,
      "VALIDATION_FAILED",
      "Unable to stage fictional installation",
    );
    bundle = await this.app.reviews.get(this.context, work.bundleId);
    await this.app.reviews.accept(this.context, {
      bundleId: bundle.id,
      digest: bundle.hash,
      requestKey: "seed-work",
      reason: "Explicit fictional initial workspace",
    });
    const head = await this.app.ontology.inspect(this.context);
    this.currentContract = await this.app.contracts.register(
      this.context,
      head.definition,
    );
    return this.snapshot();
  }
  async act(action: PreviewAction) {
    if (action === "interpret") {
      check(
        this.phase === "ready",
        "INVALID_INPUT",
        "Reset before interpreting another example",
      );
      this.receipt = await this.app.ingest(this.context, {
        source: "fictional-preview",
        idempotencyKey: "example",
        payload: { kind: "text", text: this.scenario.text },
      });
      this.work = await this.app.worker.runOnce(this.context);
      this.interpretations++;
      check(
        this.work?.state === "waiting_ontology",
        "VALIDATION_FAILED",
        "The example must wait for model review",
      );
      this.candidate = await this.app.ontology.propose(this.context, {
        patch: structuredClone(this.scenario.patch) as unknown as Definition,
        evidenceIds: [this.receipt.evidence_id],
        requestKey: "new-concept",
        reason: "Explicitly selected fictional preview proposal",
      });
      this.phase = "model-review";
    } else if (action === "evaluate") {
      check(
        this.phase === "model-review",
        "INVALID_INPUT",
        "Interpret the example before evaluating",
      );
      const suite = await this.app.evaluations.registerSuite(this.context, {
        name: "Reviewed fictional example and earlier contract",
        maxCalls: 2,
        timeoutMs: 10000,
        tasks: [
          {
            id: "earlier-contract",
            kind: "contract",
            contractId: this.oldContract.id,
          },
          {
            id: "new-capability",
            kind: "extract",
            evidenceId: this.receipt.evidence_id,
            expected: [
              {
                conceptId: "person",
                fieldId: "name",
                value: "Ramesh",
                quote: "Ramesh",
              },
              {
                conceptId: "installation",
                fieldId: "reference",
                value: "I-101",
                quote: "I-101",
              },
              {
                conceptId: this.scenario.conceptId,
                fieldId: this.scenario.field,
                value: this.scenario.value,
                quote: this.scenario.quote,
                verification: "reported",
              },
            ],
            relationships: this.scenario.patch.relations.map((r) => ({
              relationId: r.id,
              source: {
                conceptId: this.scenario.conceptId,
                fields: { [this.scenario.field]: this.scenario.value },
              },
              target: {
                conceptId: r.target,
                name: r.target === "person" ? "Ramesh" : "I-101",
              },
              quote: this.scenario.text,
            })),
          },
        ],
      });
      this.evaluation = await this.app.evaluations.evaluate(this.context, {
        candidateId: this.candidate.candidateId,
        suiteId: suite.suiteId,
      });
      check(
        this.evaluation.passed,
        "VALIDATION_FAILED",
        "Fictional example checks failed",
      );
      this.phase = "evaluated";
    } else if (action === "activate") {
      check(
        this.phase === "evaluated" && this.evaluation?.passed,
        "INVALID_INPUT",
        "Evaluate the proposed model before activation",
      );
      await this.app.ontology.publish(this.context, {
        candidateId: this.candidate.candidateId,
        candidateHash: this.candidate.hash,
        evaluationId: this.evaluation.evaluationId,
        evaluationHash: this.evaluation.hash,
        requestKey: "activate-example",
        reason: "Explicit playground model approval",
      });
      const head = await this.app.ontology.inspect(this.context);
      this.currentContract = await this.app.contracts.register(
        this.context,
        head.definition,
      );
      this.work = await this.app.worker.runOnce(this.context);
      this.interpretations++;
      check(
        ["waiting_review", "waiting_identity"].includes(this.work?.state),
        "VALIDATION_FAILED",
        "Expected a fact bundle waiting for review",
      );
      this.phase = "fact-review";
    } else if (action === "accept") {
      check(
        this.phase === "fact-review",
        "INVALID_INPUT",
        "Activate the model and inspect the facts first",
      );
      let bundle = await this.app.reviews.get(this.context, this.work.bundleId);
      // The UI explicitly asks the user to confirm these fictional identity matches.
      // This demo orchestration is not an automatic identity policy in the SDK.
      for (const mentionId of [...bundle.body.pending]) {
        const mention = bundle.body.extraction.entities.find(
          (m: ExtractedEntity) => m.mentionId === mentionId,
        )!;
        const candidates = bundle.body.identityCandidates[mentionId] ?? [];
        const exact = candidates.filter(
          (c: { id: string; name: string; conceptId: string }) =>
            c.name === mention.name && c.conceptId === mention.conceptId,
        );
        check(
          exact.length === 1,
          "UNRESOLVED_IDENTITY",
          "This fictional example needs exactly one reviewed identity match",
        );
        const revised = await this.app.reviews.resolveIdentity(this.context, {
          bundleId: bundle.id,
          digest: bundle.hash,
          mentionId,
          entityId: exact[0]!.id,
          requestKey: "confirm-" + mentionId,
          reason:
            "User explicitly confirmed the displayed fictional identity match",
        });
        this.work.bundleId = revised.bundleId;
        bundle = await this.app.reviews.get(this.context, revised.bundleId);
      }
      this.accepted = await this.app.reviews.accept(this.context, {
        bundleId: bundle.id,
        digest: bundle.hash,
        requestKey: "accept-example",
        reason: "User checked this fictional interpretation and its evidence",
      });
      this.decisions++;
      this.phase = "accepted";
    } else if (action === "reject") {
      check(
        ["model-review", "evaluated", "fact-review"].includes(this.phase),
        "INVALID_INPUT",
        "No proposal is waiting for review",
      );
      if (this.phase === "fact-review") {
        const b = await this.app.reviews.get(this.context, this.work.bundleId);
        await this.app.reviews.reject(this.context, {
          bundleId: b.id,
          digest: b.hash,
          requestKey: "reject-facts",
          reason: "User declined this fictional interpretation",
        });
      } else
        await this.app.ontology.reject(this.context, {
          candidateId: this.candidate.candidateId,
          candidateHash: this.candidate.hash,
          requestKey: "reject-model",
          reason: "User declined this fictional model change",
        });
      this.decisions++;
      this.phase = "rejected";
    } else check(false, "INVALID_INPUT", "Unsupported playground action");
    return this.snapshot();
  }
  async snapshot() {
    const head = await this.app.ontology.inspect(this.context);
    const available = head.definition.concepts.some(
      (c) => c.id === this.scenario.conceptId,
    );
    const records = available
      ? (
          await this.app.entities.find(this.context, {
            contractId: this.currentContract.id,
            contractHash: this.currentContract.hash,
            conceptId: this.scenario.conceptId,
          })
        ).records
      : [];
    const oldRead = await this.app.entities.find(this.context, {
      contractId: this.oldContract.id,
      contractHash: this.oldContract.hash,
      conceptId: "person",
    });
    const job = this.receipt
      ? await this.app.jobs.get(this.context, this.receipt.job_id)
      : null;
    const bundle = this.work?.bundleId
      ? await this.app.reviews.get(this.context, this.work.bundleId)
      : null;
    const metrics = this.receipt
      ? await this.app.metrics.summary(this.context)
      : null;
    return {
      version: "0.1.0-alpha.2",
      mode: "postgres",
      phase: this.phase,
      scenario: {
        id: this.scenario.id,
        name: this.scenario.name,
        text: this.scenario.text,
        description: this.scenario.description,
        label: this.scenario.label,
        conceptId: this.scenario.conceptId,
      },
      scenarios: scenarios.map((s) => ({ id: s.id, name: s.name })),
      model: {
        ordinal: head.ordinal,
        hash: head.hash,
        concepts: head.definition.concepts.map((c) => ({
          id: c.id,
          name: c.name,
          fields: c.fields,
        })),
        relations: head.definition.relations,
      },
      source: {
        text: this.scenario.text,
        evidenceId: this.receipt?.evidence_id ?? null,
        jobState: job?.state ?? null,
        span: sourceSpan(this.scenario.text, this.scenario.quote),
        quote: this.scenario.quote,
      },
      proposal: this.candidate
        ? {
            id: this.candidate.candidateId,
            hash: this.candidate.hash,
            patch: this.scenario.patch,
          }
        : null,
      evaluation: this.evaluation
        ? {
            passed: this.evaluation.passed,
            id: this.evaluation.evaluationId,
            hash: this.evaluation.hash,
            report: this.evaluation.report,
          }
        : null,
      bundle: bundle
        ? {
            id: bundle.id,
            digest: bundle.hash,
            state: bundle.state,
            pending: bundle.body.pending,
            identityCandidates: bundle.body.identityCandidates,
            extraction: bundle.body.extraction,
          }
        : null,
      records,
      earlierContract: {
        hash: this.oldContract.hash,
        readable: oldRead.records.some(
          (r) =>
            r.fields.name?.state === "value" &&
            r.fields.name.value === "Ramesh",
        ),
      },
      usage: {
        interpretations: this.interpretations,
        reviewDecisions: this.decisions,
        providerCalls: 0,
      },
      metrics,
    };
  }
  async close() {
    await this.app.close();
  }
}
