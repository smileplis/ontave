import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { disposablePostgres } from "../helpers/postgres.mjs";
import {
  PlainQuotationStore,
  migratePlain,
} from "../../examples/supplier-quotes/plain-postgres.mjs";
import { OntaveQuotationStore } from "../../examples/supplier-quotes/ontave-store.mjs";
import { quotationCases } from "../../examples/supplier-quotes/cases.mjs";
import {
  recordKey,
  validateOutput,
} from "../../examples/supplier-quotes/domain.mjs";
test("both quotation implementations retain review, revisions, idempotency, source proofs, conflicts and workspace boundaries", async (t) => {
  const db = await disposablePostgres();
  t.after(() => db.stop());
  await migratePlain(db.admin, "ontave_runtime");
  for (const arm of ["plain", "ontave"])
    await t.test(arm, async () => {
      const workspaceId = randomUUID(),
        other = randomUUID(),
        c = quotationCases[0];
      let output = structuredClone(c.expected);
      output.records[1].fields.unit_price.value.amount = "10"; // Source-grounded but semantically wrong: a real reviewer must correct it.
      validateOutput(output, c.text);
      const grants = {
        owner: {
          actorId: "owner",
          workspaceId,
          capabilities: ["provision", "ingest", "read", "review", "worker"],
        },
        worker: { actorId: "worker", workspaceId, capabilities: ["worker"] },
        reviewer: {
          actorId: "reviewer",
          workspaceId,
          capabilities: ["read", "review"],
        },
        reader: { actorId: "reader", workspaceId, capabilities: ["read"] },
        other: {
          actorId: "other",
          workspaceId: other,
          capabilities: ["read", "review"],
        },
      };
      const options = {
        connectionString: db.connectionString,
        authorize: (ctx) => {
          if (!grants[ctx]) throw Error("UNAUTHORIZED");
          return grants[ctx];
        },
        extract: async () => output,
      };
      const store =
        arm === "plain"
          ? new PlainQuotationStore(options)
          : new OntaveQuotationStore(options);
      try {
        if (store.setup) await store.setup("owner", workspaceId);
        const receipts = await Promise.all([
          store.ingest("owner", { id: "first", text: c.text }),
          store.ingest("owner", { id: "first", text: c.text }),
        ]);
        assert.deepEqual(receipts[0], receipts[1]);
        await store.process("worker");
        let view = await store.review("reviewer", receipts[0].jobId);
        assert.equal(view.state, "waiting_review");
        assert.equal((await store.read("reader")).records.length, 0);
        for (const ctx of ["reader", "other"])
          await assert.rejects(store.review(ctx, receipts[0].jobId), (e) =>
            ["FORBIDDEN", "NOT_FOUND"].includes(e.code),
          );
        await assert.rejects(
          store.accept("reader", {
            bundleId: view.bundle.id,
            digest: view.bundle.digest,
            key: "no-grant",
            reason: "Forbidden attempt",
          }),
          (e) => e.code === "FORBIDDEN",
        );
        const old = view.bundle;
        await store.amend("reviewer", {
          bundleId: old.id,
          digest: old.digest,
          output: c.expected,
          key: "fix-price",
          reason: "Reviewer checked net unit price against source",
        });
        await assert.rejects(
          store.accept("reviewer", {
            bundleId: old.id,
            digest: old.digest,
            key: "stale",
            reason: "Old revision must fail",
          }),
          (e) => e.code === "STALE_BUNDLE",
        );
        view = await store.review("reviewer", receipts[0].jobId);
        assert.notEqual(view.bundle.digest, old.digest);
        const decision = {
          bundleId: view.bundle.id,
          digest: view.bundle.digest,
          key: "accept-first",
          reason: "Explicit reviewed correction",
        };
        assert.deepEqual(
          await store.accept("reviewer", decision),
          await store.accept("reviewer", decision),
        );
        const first = (await store.read("reader")).records,
          priced = first.find((r) => r.conceptId === "quote_line");
        assert.equal(priced.fields.unit_price.value.amount, "12500");
        assert.equal(priced.fields.unit_price.verification, "reported");
        const proof = await store.explain("reader", priced.id);
        assert.ok(proof.every((p) => p.evidence_id === receipts[0].evidenceId));
        await assert.rejects(
          store.ingest("owner", { id: "first", text: c.text + " altered" }),
          (e) => e.code === "IDEMPOTENCY_CONFLICT",
        );
        await assert.rejects(
          store.accept("reviewer", {
            ...decision,
            reason: "Changed meaning under same key",
          }),
          (e) => e.code === "IDEMPOTENCY_CONFLICT",
        );
        const revisedText = c.text.replace("12500", "13000");
        output = structuredClone(c.expected);
        output.records[1].fields.unit_price.value.amount = "13000";
        for (const claim of Object.values(output.records[1].fields))
          claim.quote = claim.quote.replace("12500", "13000");
        const second = await store.ingest("owner", {
          id: "second",
          text: revisedText,
        });
        await store.process("worker");
        view = await store.review("reviewer", second.jobId);
        assert.equal(view.state, "waiting_identity");
        for (const mentionId of [...view.bundle.pending]) {
          const record = view.bundle.output.records[Number(mentionId.slice(1))],
            entity = first.find(
              (e) =>
                e.conceptId === record.type && e.name === recordKey(record),
            );
          assert.ok(entity);
          await store.resolveIdentity("reviewer", {
            bundleId: view.bundle.id,
            digest: view.bundle.digest,
            mentionId,
            entityId: entity.id,
            key: "identity-" + mentionId,
            reason: "Reviewer explicitly selected existing supplier record",
          });
          view = await store.review("reviewer", second.jobId);
        }
        assert.equal(view.state, "waiting_review");
        const concurrent = await Promise.allSettled(
          ["one", "two"].map((key) =>
            store.accept("reviewer", {
              bundleId: view.bundle.id,
              digest: view.bundle.digest,
              key: "concurrent-" + key,
              reason: "Concurrent decisions must not duplicate writes",
            }),
          ),
        );
        assert.equal(
          concurrent.filter((r) => r.status === "fulfilled").length,
          1,
        );
        assert.equal(
          concurrent.find((r) => r.status === "rejected").reason.code,
          "STALE_BUNDLE",
        );
        const conflict = (await store.read("reader")).records.find(
          (r) => r.id === priced.id,
        ).fields.unit_price;
        assert.equal(conflict.state, "conflict");
        assert.deepEqual(
          conflict.candidates.map((c) => c.value.amount).sort(),
          ["12500", "13000"],
        );
      } finally {
        await store.close();
      }
    });
});
