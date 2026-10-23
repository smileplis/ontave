import type { Ontave } from "./runtime.js";
import { OntaveError } from "./core.js";

/** Bounded orchestration. Existing strict review APIs retain their behavior. */
export async function advanceAutomatically(
  runtime: Ontave,
  context: unknown,
  jobId: string,
) {
  const events: unknown[] = [];
  for (let step = 0; step < 4; step++) {
    const view = await runtime.reviews.forJob(context, jobId);
    if (view.job.state === "completed" || view.job.state === "rejected")
      return { state: view.job.state, events };
    if (view.job.state === "waiting_ontology") {
      const snapshot = await runtime.ontology.inspect(context);
      try {
        const key = `auto-proposal/${view.evidence.id}/${snapshot.hash}`;
        const p = await runtime.ontology.propose(context, {
          evidenceIds: [view.evidence.id],
          requestKey: key,
          reason:
            "Automatic proposal from source observations; no human approval or semantic qualification claimed",
        });
        const published = await runtime.ontology.publishByPolicy(context, {
          candidateId: p.candidateId,
          candidateHash: p.hash,
          requestKey: `auto-publish/${p.hash}`,
          reason: "Host opted into bounded additive evolution",
        });
        events.push({ kind: "policy-publication", ...published });
      } catch (error) {
        if (error instanceof OntaveError)
          return {
            state: view.job.state,
            events,
            exception: { code: error.code, message: error.message },
          };
        throw error;
      }
    } else if (view.job.state === "waiting_review" && view.bundle) {
      try {
        const accepted = await runtime.reviews.acceptByPolicy(context, {
          bundleId: view.bundle.id,
          digest: view.bundle.hash,
          requestKey: `auto-accept/${view.bundle.hash}`,
        });
        events.push({ kind: "policy-acceptance", ...accepted });
      } catch (error) {
        if (error instanceof OntaveError)
          return {
            state: view.job.state,
            events,
            exception: { code: error.code, message: error.message },
          };
        throw error;
      }
    } else if (view.job.state !== "queued")
      return { state: view.job.state, events };
    // The durable worker remains workspace-scoped, and may service an older queued job.
    if ((await runtime.jobs.get(context, jobId)).state === "queued")
      await runtime.worker.runOnce(context);
  }
  return {
    state: (await runtime.jobs.get(context, jobId)).state,
    events,
    exception: {
      code: "BUDGET_EXHAUSTED",
      message:
        "Automatic transition budget exhausted; source and pending work retained",
    },
  };
}
