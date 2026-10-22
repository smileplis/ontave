import { operationalMetrics } from "./metrics.js";
import {
  evaluationSuiteSchema,
  evaluateRead,
  scoreExtraction,
  validateReadFixture,
} from "./evaluation.js";
import { entityQuerySchema, readRecords } from "./read.js";
import { validateContractRecords } from "./codegen.js";
import { randomUUID, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { conceptReuseReasons } from "./definition-review.js";
import { z } from "zod";
import type { Storage } from "./postgres.js";
import type {
  Access,
  Capability,
  Definition,
  Extraction,
  ModelAdapter,
  ModelTask,
  Limits,
  Json,
  FieldResult,
  FieldDefinition,
  EntityQuery,
  EntityRecord,
  Snapshot,
  EvaluationSuite,
} from "./types.js";
import {
  check,
  abortable,
  compatible,
  decodeCursor,
  definition,
  encodeCursor,
  extend,
  hash,
  json,
  OntaveError,
  sameValue,
  sourceReference,
  starter,
  uuid,
  parseUUID,
  idSchema,
  validateExtraction,
  validateValue,
  normalizeValue,
} from "./core.js";

export interface OntaveConfig {
  storage: Storage;
  model: ModelAdapter;
  authorize(context: unknown): Promise<Access> | Access;
  identifierRules?: { authority: string; kind: string; lowercase?: boolean }[];
  sourcePolicies?: Record<string, { verifiedFields: string[] }>;
  limits?: Partial<Limits>;
  cursorSecret?: string;
  metadataKeys?: string[];
}
type Resolution = {
  entityId: string;
  revision: number;
  mode: "new" | "link";
  reviewer?: boolean;
  basis?: {
    kind: "trusted_identifier" | "accepted_source" | "unresolved" | "new";
    evidenceId: string;
    identifierMatches: {
      authority: string;
      kind: string;
      normalizedValue: string;
      lowercase: boolean;
      entityIds: string[];
    }[];
    acceptedEntityIds: string[];
  };
};
type Body = {
  extraction: Extraction;
  resolutions: Record<string, Resolution>;
  pending: string[];
  retractions: string[];
  identityCandidates?: Record<
    string,
    { id: string; name: string; conceptId: string }[]
  >;
  reason?: string;
};
const limits: Limits = {
  payloadBytes: 262144,
  metadataBytes: 16384,
  operations: 250,
  modelTimeoutMs: 45000,
  modelCalls: 2,
  attempts: 3,
  leaseMs: 90000,
  candidates: 10,
};
const accessSchema = z
  .object({
    actorId: z.string().min(1),
    workspaceId: uuid.optional(),
    capabilities: z.array(
      z.enum(["read", "ingest", "review", "worker", "provision"]),
    ),
    sourcePolicy: z.string().optional(),
  })
  .strict();

export class Ontave {
  readonly limits: Limits;
  private readonly cursorSecret: string;
  constructor(private config: OntaveConfig) {
    check(
      Object.keys(config.limits ?? {}).every((k) => Object.hasOwn(limits, k)),
      "INVALID_INPUT",
      "Unknown resource limit",
    );
    this.limits = Object.freeze({ ...limits, ...config.limits });
    check(
      Object.entries(this.limits).every(
        ([k, v]) => v <= limits[k as keyof Limits],
      ),
      "INVALID_INPUT",
      "Limit increases require a separately tested resource profile",
    );
    for (const n of Object.values(this.limits))
      check(
        Number.isSafeInteger(n) && n > 0,
        "INVALID_INPUT",
        "Limits must be positive safe integers",
      );
    this.cursorSecret = config.cursorSecret ?? randomBytes(32).toString("hex");
    check(
      this.cursorSecret.length >= 32,
      "INVALID_INPUT",
      "Cursor secret must be at least 32 characters",
    );
  }
  private async access(
    context: unknown,
    capability: Capability,
  ): Promise<Access & { workspaceId: string }> {
    let a: Access;
    try {
      a = accessSchema.parse(await this.config.authorize(context));
    } catch {
      throw new OntaveError(
        "UNAUTHORIZED",
        "An authenticated host context is required",
      );
    }
    check(
      a.capabilities.includes(capability),
      "FORBIDDEN",
      `Missing ${capability} capability`,
    );
    check(
      a.workspaceId || capability === "provision",
      "FORBIDDEN",
      "An authorized workspace is required",
    );
    return a as Access & { workspaceId: string };
  }
  private async active(c: PoolClient): Promise<Snapshot> {
    const r = await c.query(
      "SELECT v.* FROM ontave.workspaces w JOIN ontave.versions v ON (v.workspace_id=w.workspace_id AND v.id=w.active_id)",
    );
    check(r.rows.length === 1, "NOT_FOUND", "Workspace not found");
    return r.rows[0];
  }
  private modelInput(
    evidence: { payload: string; kind: string; source_policy: string },
    ontology: Definition,
    candidates: { id: string; name: string; conceptId: string }[],
  ): Omit<ModelTask, "signal"> {
    check(
      ontology.concepts.length <= 25,
      "BUDGET_EXHAUSTED",
      "Model task exceeds the 25-concept limit; no definitions were omitted",
    );
    const input: Omit<ModelTask, "signal"> = {
      text: evidence.payload,
      kind: evidence.kind === "json" ? "json" : "text",
      ontology,
      candidates,
      identifierRules: this.config.identifierRules ?? [],
      verifiedFields:
        this.config.sourcePolicies?.[evidence.source_policy]?.verifiedFields ??
        [],
    };
    check(
      Buffer.byteLength(json(input)) <= 60000,
      "BUDGET_EXHAUSTED",
      "Complete model context exceeds the bounded profile; no content was truncated",
    );
    return input;
  }
  private async decision(
    c: PoolClient,
    a: Access,
    operation: string,
    key: string,
    digest: string,
  ): Promise<any | undefined> {
    check(
      typeof key === "string" && key.length > 0 && key.length <= 200,
      "INVALID_INPUT",
      "A bounded request key is required",
    );
    const r = await c.query(
      "SELECT digest,result FROM ontave.decisions WHERE operation=$1 AND request_key=$2",
      [operation, key],
    );
    if (!r.rows.length) return undefined;
    check(
      r.rows[0].digest === digest,
      "IDEMPOTENCY_CONFLICT",
      "Mutation key was used with different input",
    );
    return r.rows[0].result;
  }
  private async record(
    c: PoolClient,
    a: Access & { workspaceId: string },
    operation: string,
    key: string,
    digest: string,
    result: unknown,
    reason: string,
  ) {
    check(
      typeof reason === "string" &&
        reason.trim().length > 0 &&
        reason.length <= 2000,
      "INVALID_INPUT",
      "A bounded decision reason is required",
    );
    await c.query(
      "INSERT INTO ontave.decisions(workspace_id,id,operation,request_key,digest,actor,reason,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        a.workspaceId,
        randomUUID(),
        operation,
        key,
        digest,
        a.actorId,
        reason,
        json(result),
      ],
    );
  }
  readonly workspaces = {
    create: async (
      context: unknown,
      input: {
        workspaceId: string;
        name: string;
        requestKey: string;
        seed: "empty" | "people";
      },
    ) => {
      const a = await this.access(context, "provision");
      parseUUID(input.workspaceId);
      check(
        !a.workspaceId || a.workspaceId === input.workspaceId,
        "FORBIDDEN",
        "Provisioning context is scoped to a different workspace",
      );
      check(
        typeof input.name === "string" &&
          input.name.length > 0 &&
          input.name.length <= 200,
        "INVALID_INPUT",
        "Workspace name is required",
      );
      const w = input.workspaceId;
      const d =
        input.seed === "people" ? starter : { concepts: [], relations: [] };
      check(
        ["empty", "people"].includes(input.seed),
        "INVALID_INPUT",
        "Unsupported seed",
      );
      const digest = hash(input);
      return this.config.storage.transaction(w, async (c) => {
        const previous = await c.query(
          "SELECT * FROM ontave.workspaces WHERE workspace_id=$1",
          [w],
        );
        if (previous.rows.length) {
          check(
            previous.rows[0].request_key === input.requestKey &&
              previous.rows[0].request_hash === digest,
            "IDEMPOTENCY_CONFLICT",
            "Workspace already exists with different provisioning input",
          );
          return { workspaceId: w, ontologyId: previous.rows[0].active_id };
        }
        const id = randomUUID();
        await c.query(
          "INSERT INTO ontave.workspaces(workspace_id,name,request_key,request_hash) VALUES($1,$2,$3,$4)",
          [w, input.name, input.requestKey, digest],
        );
        await c.query(
          "INSERT INTO ontave.versions(workspace_id,id,ordinal,hash,definition) VALUES($1,$2,0,$3,$4)",
          [w, id, hash(d), json(d)],
        );
        await c.query(
          "UPDATE ontave.workspaces SET active_id=$1 WHERE workspace_id=$2",
          [id, w],
        );
        return { workspaceId: w, ontologyId: id };
      });
    },
  };
  async ingest(
    context: unknown,
    input: {
      source: string;
      idempotencyKey: string;
      payload: { kind: "text"; text: string } | { kind: "json"; value: Json };
      metadata?: Record<string, Json>;
    },
  ) {
    const a = await this.access(context, "ingest");
    check(
      input && typeof input === "object" && !Array.isArray(input),
      "INVALID_INPUT",
      "An ingestion object is required",
    );
    check(
      typeof input.source === "string" &&
        typeof input.idempotencyKey === "string" &&
        input.source.length > 0 &&
        input.source.length <= 200 &&
        input.idempotencyKey?.length > 0 &&
        input.idempotencyKey.length <= 200,
      "INVALID_INPUT",
      "Source and idempotency key are required",
    );
    const kind = input.payload?.kind;
    check(
      kind === "text" || kind === "json",
      "INVALID_INPUT",
      "Supported inputs are text and JSON",
    );
    const payload =
      input.payload.kind === "text"
        ? input.payload.text
        : json(input.payload.value);
    check(
      typeof payload === "string" && payload.length > 0,
      "INVALID_INPUT",
      "Input must not be empty",
    );
    check(
      !/[\uD800-\uDFFF]/u.test(payload),
      "INVALID_INPUT",
      "Input must contain well-formed Unicode",
    );
    check(
      Buffer.byteLength(payload) <= this.limits.payloadBytes,
      "PAYLOAD_TOO_LARGE",
      "Input exceeds payload limit",
    );
    const metadataValue = input.metadata ?? {};
    check(
      typeof metadataValue === "object" &&
        !Array.isArray(metadataValue) &&
        Object.keys(metadataValue).every((k) =>
          (
            this.config.metadataKeys ?? [
              "sourceEventTime",
              "sourceTimezone",
              "sourceReference",
              "externalId",
              "correctionOf",
              "contentType",
            ]
          ).includes(k),
        ),
      "INVALID_INPUT",
      "Unsupported metadata key",
    );
    const metadata = json(metadataValue);
    check(
      Buffer.byteLength(metadata) <= this.limits.metadataBytes,
      "PAYLOAD_TOO_LARGE",
      "Metadata exceeds limit",
    );
    const policy = a.sourcePolicy ?? "untrusted";
    const digest = hash({
      source: input.source,
      kind,
      payload,
      metadata: JSON.parse(metadata),
      policy,
    });
    return this.config.storage.transaction(a.workspaceId, async (c) => {
      const evidenceId = randomUUID(),
        jobId = randomUUID();
      const added = await c.query(
        "INSERT INTO ontave.evidence(workspace_id,id,source,request_key,envelope_hash,kind,payload,metadata,source_policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(workspace_id,source,request_key) DO NOTHING RETURNING id",
        [
          a.workspaceId,
          evidenceId,
          input.source,
          input.idempotencyKey,
          digest,
          kind,
          payload,
          metadata,
          policy,
        ],
      );
      if (!added.rowCount) {
        const prev = await c.query(
          "SELECT e.envelope_hash,e.id AS evidence_id,j.id AS job_id,j.state FROM ontave.evidence e JOIN ontave.jobs j ON (e.workspace_id=j.workspace_id AND e.id=j.evidence_id) WHERE e.source=$1 AND e.request_key=$2 ORDER BY j.interpretation LIMIT 1",
          [input.source, input.idempotencyKey],
        );
        check(
          prev.rows[0]?.envelope_hash === digest,
          "IDEMPOTENCY_CONFLICT",
          "Key reused with different content",
        );
        return prev.rows[0];
      }
      await c.query(
        "INSERT INTO ontave.jobs(workspace_id,id,evidence_id,state) VALUES($1,$2,$3,'queued')",
        [a.workspaceId, jobId, evidenceId],
      );
      return { evidence_id: evidenceId, job_id: jobId, state: "queued" };
    });
  }
  readonly evidence = {
    get: async (
      context: unknown,
      id: string,
      options: { startByte?: number; limitBytes?: number } = {},
    ) => {
      const a = await this.access(context, "read");
      parseUUID(id);
      const start = options.startByte ?? 0,
        limit = options.limitBytes ?? 8192;
      check(
        Number.isSafeInteger(start) &&
          start >= 0 &&
          Number.isSafeInteger(limit) &&
          limit >= 4 &&
          limit <= 8192,
        "INVALID_INPUT",
        "Evidence ranges require a nonnegative byte start and a 4–8192 byte limit",
      );
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const r = await c.query("SELECT * FROM ontave.evidence WHERE id=$1", [
          id,
        ]);
        check(r.rows[0], "NOT_FOUND", "Evidence not found");
        const bytes = Buffer.from(r.rows[0].payload, "utf8");
        check(
          start <= bytes.length &&
            (start === bytes.length || (bytes[start]! & 0xc0) !== 0x80),
          "INVALID_INPUT",
          "Range must start at a UTF-8 boundary within the evidence",
        );
        let end = Math.min(bytes.length, start + limit);
        while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
        return {
          ...r.rows[0],
          payload: bytes.subarray(start, end).toString("utf8"),
          range: {
            startByte: start,
            endByte: end,
            totalBytes: bytes.length,
            hasMore: end < bytes.length,
            nextStartByte: end < bytes.length ? end : null,
          },
        };
      });
    },
  };
  readonly jobs = {
    attempts: async (context: unknown, jobId: string) => {
      const a = await this.access(context, "read");
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const job = await c.query("SELECT id FROM ontave.jobs WHERE id=$1", [
          parseUUID(jobId),
        ]);
        check(job.rowCount, "NOT_FOUND", "Job unavailable");
        return (
          await c.query(
            "SELECT fence,event,details,created_at FROM ontave.worker_events WHERE job_id=$1 ORDER BY created_at,id",
            [jobId],
          )
        ).rows;
      });
    },
    list: async (context: unknown) => {
      const a = await this.access(context, "read");
      return this.config.storage.transaction(
        a.workspaceId,
        async (c) =>
          (
            await c.query(
              "SELECT id,evidence_id,state,attempts,calls,bundle_id,error,created_at FROM ontave.jobs ORDER BY created_at DESC LIMIT 100",
            )
          ).rows,
      );
    },
    get: async (context: unknown, id: string) => {
      const a = await this.access(context, "read");
      parseUUID(id);
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const r = await c.query("SELECT * FROM ontave.jobs WHERE id=$1", [id]);
        check(r.rows[0], "NOT_FOUND", "Job not found");
        return r.rows[0];
      });
    },
    reprocess: async (
      context: unknown,
      input: { evidenceId: string; requestKey: string; reason: string },
    ) => {
      const a = await this.access(context, "review");
      const digest = hash(input);
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const old = await this.decision(
          c,
          a,
          "reprocess",
          input.requestKey,
          digest,
        );
        if (old) return old;
        const e = await c.query("SELECT id FROM ontave.evidence WHERE id=$1", [
          parseUUID(input.evidenceId),
        ]);
        check(e.rows[0], "NOT_FOUND", "Evidence not found");
        // Serialize interpretation allocation on the mutable original job, never grant UPDATE on evidence.
        await c.query(
          "UPDATE ontave.jobs SET updated_at=now() WHERE evidence_id=$1 AND interpretation=1",
          [input.evidenceId],
        );
        const n = await c.query(
          "SELECT coalesce(max(interpretation),0)+1 AS n FROM ontave.jobs WHERE evidence_id=$1",
          [input.evidenceId],
        );
        const id = randomUUID();
        await c.query(
          "INSERT INTO ontave.jobs(workspace_id,id,evidence_id,interpretation,state) VALUES($1,$2,$3,$4,'queued')",
          [a.workspaceId, id, input.evidenceId, n.rows[0].n],
        );
        const result = { jobId: id };
        await this.record(
          c,
          a,
          "reprocess",
          input.requestKey,
          digest,
          result,
          input.reason,
        );
        return result;
      });
    },
  };
  private async identities(
    c: PoolClient,
    e: Extraction,
    evidenceId: string,
  ): Promise<{
    resolutions: Record<string, Resolution>;
    pending: string[];
    identityCandidates: Record<
      string,
      { id: string; name: string; conceptId: string }[]
    >;
  }> {
    const resolutions: Record<string, Resolution> = {};
    const pending: string[] = [];
    const identityCandidates: Record<
      string,
      { id: string; name: string; conceptId: string }[]
    > = {};
    // Reuse only exact source-bound mentions from accepted interpretations of this evidence.
    // A matching name in a different receipt is never sufficient identity proof.
    const accepted = await c.query(
      "SELECT b.body FROM ontave.bundles b JOIN ontave.decisions d ON d.workspace_id=b.workspace_id AND d.operation='accept' AND d.result->>'bundleId'=b.id::text WHERE b.evidence_id=$1 ORDER BY b.revision DESC",
      [evidenceId],
    );
    const signature = (m: Extraction["entities"][number]) =>
      hash({
        conceptId: m.conceptId,
        name: m.name,
        nameSource: m.fields.name
          ? {
              quote: m.fields.name.quote,
              occurrence: m.fields.name.occurrence ?? 0,
              path: m.fields.name.path ?? null,
            }
          : null,
        identifiers: (m.identifiers ?? [])
          .map((i) => ({
            authority: i.authority,
            kind: i.kind,
            value: i.value,
          }))
          .sort((a, b) => json(a).localeCompare(json(b))),
      });
    for (const mention of e.entities) {
      const exact = new Set<string>();
      const identifierMatches: NonNullable<
        Resolution["basis"]
      >["identifierMatches"] = [];
      for (const ident of mention.identifiers ?? []) {
        const rule = this.config.identifierRules?.find(
          (r) => r.authority === ident.authority && r.kind === ident.kind,
        );
        if (!rule) continue;
        const value = rule.lowercase
          ? ident.value.trim().toLowerCase()
          : ident.value.trim();
        const found = await c.query(
          "SELECT entity_id FROM ontave.identifiers WHERE authority=$1 AND kind=$2 AND normalized=$3",
          [ident.authority, ident.kind, value],
        );
        identifierMatches.push({
          authority: rule.authority,
          kind: rule.kind,
          normalizedValue: value,
          lowercase: rule.lowercase === true,
          entityIds: found.rows.map((row) => row.entity_id),
        });
        for (const row of found.rows) exact.add(row.entity_id);
      }
      const previousIds = new Set<string>();
      for (const row of accepted.rows) {
        const body = row.body as Body;
        for (const prior of body.extraction.entities) {
          if (
            signature(prior) === signature(mention) &&
            body.resolutions[prior.mentionId]
          )
            previousIds.add(body.resolutions[prior.mentionId]!.entityId);
        }
      }
      if (previousIds.size === 1) exact.add([...previousIds][0]!);
      let entityId = exact.size === 1 ? [...exact][0] : undefined;
      const tokens = (name: string) =>
        name
          .normalize("NFKC")
          .toLocaleLowerCase("en-US")
          .match(/[\p{L}\p{N}]+/gu) ?? [];
      const nameTokens = tokens(mention.name);
      const prefix = (nameTokens[0] ?? "")
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_");
      const candidates = await c.query(
        `SELECT id,revision,concept_id,name FROM ontave.entities WHERE concept_id=$1 AND (lower(name)=lower($2) OR lower(name) LIKE $3 ESCAPE E'\\\\') ORDER BY id LIMIT $4`,
        [
          mention.conceptId,
          mention.name,
          prefix + " %",
          this.limits.candidates,
        ],
      );
      const similar = candidates.rows.filter((row) => {
        const other = tokens(row.name);
        return (
          nameTokens.length > 0 &&
          other[0] === nameTokens[0] &&
          nameTokens
            .slice(1, Math.min(nameTokens.length, other.length))
            .every(
              (token, i) =>
                token === other[i + 1] ||
                (token.length === 1 && other[i + 1]!.startsWith(token)) ||
                (other[i + 1]!.length === 1 && token.startsWith(other[i + 1]!)),
            )
        );
      });
      identityCandidates[mention.mentionId] = similar.map((row) => ({
        id: row.id,
        name: row.name,
        conceptId: row.concept_id,
      }));
      if (mention.existingId) {
        const known = await c.query(
          "SELECT id FROM ontave.entities WHERE id=$1",
          [mention.existingId],
        );
        check(
          known.rows[0],
          "INVALID_MODEL_OUTPUT",
          "Model referenced an unavailable identity",
        );
      }
      if (
        exact.size > 1 ||
        (!entityId && (similar.length > 0 || !!mention.existingId))
      )
        pending.push(mention.mentionId);
      entityId ??= randomUUID();
      const existing = await c.query(
        "SELECT revision,concept_id FROM ontave.entities WHERE id=$1",
        [entityId],
      );
      if (existing.rows[0])
        check(
          existing.rows[0].concept_id === mention.conceptId,
          "UNRESOLVED_IDENTITY",
          "Identifier belongs to another concept",
        );
      resolutions[mention.mentionId] = {
        entityId,
        revision: existing.rows[0]?.revision ?? 0,
        mode: existing.rows.length ? "link" : "new",
        basis: {
          kind: pending.includes(mention.mentionId)
            ? "unresolved"
            : identifierMatches.some((match) => match.entityIds.length)
              ? "trusted_identifier"
              : previousIds.size === 1
                ? "accepted_source"
                : "new",
          evidenceId,
          identifierMatches,
          acceptedEntityIds: [...previousIds].sort(),
        },
      };
    }
    return { resolutions, pending, identityCandidates };
  }
  readonly worker = {
    runOnce: async (context: unknown) => {
      const a = await this.access(context, "worker"),
        owner = randomUUID();
      const claimed = await this.config.storage.transaction(
        a.workspaceId,
        async (c) => {
          const r = await c.query(
            "SELECT * FROM ontave.jobs WHERE ((state IN ('queued','retry_scheduled') AND next_at<=now()) OR (state='processing' AND lease_until<now())) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
          );
          const j = r.rows[0];
          if (!j) return null;
          if (j.state === "processing")
            await c.query(
              "INSERT INTO ontave.worker_events(workspace_id,id,job_id,fence,event,details) VALUES($1,$2,$3,$4,'lease_expired',$5) ON CONFLICT DO NOTHING",
              [
                a.workspaceId,
                randomUUID(),
                j.id,
                j.fence,
                json({
                  usage: "unknown",
                  reason:
                    "Previous worker did not finalize before lease expiry",
                }),
              ],
            );
          if (
            j.attempts >= this.limits.attempts ||
            j.calls >= this.limits.modelCalls
          ) {
            await c.query(
              "UPDATE ontave.jobs SET state='failed',error=$2,lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
              [j.id, json({ code: "BUDGET_EXHAUSTED" })],
            );
            return { exhausted: true, jobId: j.id };
          }
          const next = await c.query(
            "UPDATE ontave.jobs SET state='processing',attempts=attempts+1,calls=calls+1,fence=fence+1,lease_owner=$2,lease_until=now()+($3::text||' milliseconds')::interval,updated_at=now() WHERE id=$1 RETURNING *",
            [j.id, owner, this.limits.leaseMs],
          );
          await c.query(
            "INSERT INTO ontave.worker_events(workspace_id,id,job_id,fence,event,details) VALUES($1,$2,$3,$4,'started',$5)",
            [
              a.workspaceId,
              randomUUID(),
              j.id,
              next.rows[0].fence,
              json({ attempt: next.rows[0].attempts, usage: "unknown" }),
            ],
          );
          const ev = await c.query(
            "SELECT * FROM ontave.evidence WHERE id=$1",
            [j.evidence_id],
          );
          const snapshot = await this.active(c);
          const candidates = await c.query(
            'SELECT id,name,concept_id AS "conceptId" FROM ontave.entities ORDER BY id LIMIT $1',
            [this.limits.candidates],
          );
          return {
            job: next.rows[0],
            evidence: ev.rows[0],
            snapshot,
            candidates: candidates.rows,
          };
        },
        { isolation: "read committed" },
      );
      if (!claimed || "exhausted" in claimed) return claimed;
      const { job, evidence, snapshot, candidates } = claimed;
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.limits.modelTimeoutMs,
      );
      const heartbeat = setInterval(
        () => {
          void this.config.storage
            .transaction(a.workspaceId, async (c) => {
              const r = await c.query(
                "UPDATE ontave.jobs SET lease_until=now()+($4::text||' milliseconds')::interval WHERE id=$1 AND fence=$2 AND lease_owner=$3 AND state='processing' AND lease_until>now()",
                [job.id, job.fence, owner, this.limits.leaseMs],
              );
              if (!r.rowCount) controller.abort();
            })
            .catch(() => controller.abort());
        },
        Math.max(50, Math.min(20000, this.limits.leaseMs / 3)),
      );
      let attemptModel = "unavailable",
        attemptUsage: string | null = null,
        attemptOutput: string | null = null;
      try {
        const input = this.modelInput(
          evidence,
          snapshot.definition,
          candidates,
        );
        const response = await abortable(controller.signal, () =>
          this.config.model.extract({ ...input, signal: controller.signal }),
        );
        check(
          typeof response.model === "string" &&
            response.model.length > 0 &&
            response.model.length <= 200,
          "INVALID_MODEL_OUTPUT",
          "Invalid provider model identifier",
        );
        attemptModel = response.model;
        try {
          attemptUsage = response.usage ? json(response.usage) : null;
          const out = json(response.output);
          check(
            Buffer.byteLength(out) <= 2097152,
            "BUDGET_EXHAUSTED",
            "Adapter output exceeds 2 MiB",
          );
          attemptOutput = out;
        } catch (error) {
          if (error instanceof OntaveError && error.code === "BUDGET_EXHAUSTED")
            throw error;
          throw new OntaveError(
            "INVALID_MODEL_OUTPUT",
            "Adapter output or usage is not bounded canonical JSON",
          );
        }
        const extraction = validateExtraction(
          response.output,
          evidence.payload,
          snapshot.definition,
          evidence.kind === "json" ? "json" : "text",
        );
        const size = extraction.entities.reduce(
          (n, e) => n + 1 + Object.keys(e.fields).length,
          extraction.relationships.length,
        );
        check(
          size <= this.limits.operations,
          "BUDGET_EXHAUSTED",
          "Bundle operation limit exceeded",
        );
        for (const entity of extraction.entities)
          for (const [key, f] of Object.entries(entity.fields))
            if (f.verification === "verified")
              check(
                this.config.sourcePolicies?.[
                  evidence.source_policy
                ]?.verifiedFields.includes(entity.conceptId + "." + key),
                "VALIDATION_FAILED",
                "This source cannot verify the asserted field",
              );
        return await this.config.storage.transaction(
          a.workspaceId,
          async (c) => {
            await this.fence(c, job.id, job.fence, owner);
            const ids = await this.identities(c, extraction, evidence.id);
            const body: Body = { extraction, ...ids, retractions: [] };
            const run = randomUUID(),
              bundle = randomUUID();
            await c.query(
              "INSERT INTO ontave.runs(workspace_id,id,job_id,ontology_id,model,output,usage) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                a.workspaceId,
                run,
                job.id,
                snapshot.id,
                response.model,
                json(extraction),
                response.usage ? json(response.usage) : null,
              ],
            );
            const revision = await c.query(
              "SELECT coalesce(max(revision),0)+1 AS n FROM ontave.bundles WHERE job_id=$1",
              [job.id],
            );
            await c.query(
              "INSERT INTO ontave.bundles(workspace_id,id,job_id,evidence_id,ontology_id,hash,body,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
              [
                a.workspaceId,
                bundle,
                job.id,
                evidence.id,
                snapshot.id,
                hash({
                  body,
                  ontologyHash: snapshot.hash,
                  evidenceHash: evidence.envelope_hash,
                }),
                json(body),
                revision.rows[0].n,
              ],
            );
            const state = extraction.observations.length
              ? "waiting_ontology"
              : ids.pending.length
                ? "waiting_identity"
                : "waiting_review";
            await c.query(
              "UPDATE ontave.jobs SET state=$2,bundle_id=$3,lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
              [job.id, state, bundle],
            );
            await c.query(
              "INSERT INTO ontave.worker_events(workspace_id,id,job_id,fence,event,details) VALUES($1,$2,$3,$4,'completed',$5)",
              [
                a.workspaceId,
                randomUUID(),
                job.id,
                job.fence,
                json({
                  model: attemptModel,
                  usage: response.usage ?? null,
                  runId: run,
                }),
              ],
            );
            return { jobId: job.id, bundleId: bundle, state };
          },
        );
      } catch (error) {
        if (error instanceof OntaveError && error.details) {
          attemptModel = error.details.model ?? attemptModel;
          attemptUsage = error.details.usage ? json(error.details.usage) : null;
        }
        const err =
          error instanceof OntaveError
            ? error
            : new OntaveError(
                "INVALID_MODEL_OUTPUT",
                "Provider or extraction validation failed",
              );
        await this.config.storage.transaction(a.workspaceId, async (c) => {
          const state =
            err.retryable &&
            job.attempts < this.limits.attempts &&
            job.calls < this.limits.modelCalls
              ? "retry_scheduled"
              : "failed";
          const owned = await c.query(
            "SELECT id FROM ontave.jobs WHERE id=$1 AND fence=$2 AND lease_owner=$3 AND state='processing' FOR UPDATE",
            [job.id, job.fence, owner],
          );
          await c.query(
            "INSERT INTO ontave.worker_events(workspace_id,id,job_id,fence,event,details) VALUES($1,$2,$3,$4,'failed',$5) ON CONFLICT DO NOTHING",
            [
              a.workspaceId,
              randomUUID(),
              job.id,
              job.fence,
              json({
                model: attemptModel,
                usage: attemptUsage ? JSON.parse(attemptUsage) : null,
                code: err.code,
                fenced: !owned.rows.length,
              }),
            ],
          );
          await c.query(
            "INSERT INTO ontave.runs(workspace_id,id,job_id,ontology_id,model,error,output,usage) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              a.workspaceId,
              randomUUID(),
              job.id,
              snapshot.id,
              attemptModel,
              json({
                code: err.code,
                message: err.message,
                attempt: job.attempts,
                fence: job.fence,
                usage: attemptUsage ? "recorded" : "unknown",
              }),
              attemptOutput,
              attemptUsage,
            ],
          );
          await c.query(
            "UPDATE ontave.jobs SET state=$4,error=$5,lease_owner=NULL,lease_until=NULL,next_at=now()+interval '1 second',updated_at=now() WHERE id=$1 AND fence=$2 AND lease_owner=$3 AND state='processing'",
            [
              job.id,
              job.fence,
              owner,
              state,
              json({ code: err.code, message: err.message }),
            ],
          );
        });
        return {
          jobId: job.id,
          state: "error",
          error: { code: err.code, message: err.message },
        };
      } finally {
        clearTimeout(timeout);
        clearInterval(heartbeat);
      }
    },
  };
  private async fence(c: PoolClient, id: string, fence: number, owner: string) {
    const r = await c.query(
      "SELECT id FROM ontave.jobs WHERE id=$1 AND fence=$2 AND lease_owner=$3 AND state='processing' AND lease_until>now() FOR UPDATE",
      [id, fence, owner],
    );
    check(r.rows.length, "LEASE_LOST", "Worker lease is no longer current");
  }
  private async bundle(c: PoolClient, id: string, lock = false): Promise<any> {
    parseUUID(id);
    const r = await c.query(
      "SELECT b.*,j.state,j.bundle_id AS current_bundle FROM ontave.bundles b JOIN ontave.jobs j ON(j.workspace_id=b.workspace_id AND j.id=b.job_id) WHERE b.id=$1" +
        (lock ? " FOR UPDATE OF j" : ""),
      [id],
    );
    check(r.rows[0], "NOT_FOUND", "Bundle not found");
    return r.rows[0];
  }
  readonly reviews = {
    resolveConflict: async (
      context: unknown,
      input: {
        entityId: string;
        fieldId: string;
        expectedRevision: number;
        selectedAssertionId: string | null;
        statement: string;
        requestKey: string;
        reason: string;
      },
    ) => this.stageCorrection(context, { ...input, action: "resolveConflict" }),
    get: async (context: unknown, id: string) => {
      const a = await this.access(context, "review");
      return this.config.storage.transaction(a.workspaceId, (c) =>
        this.bundle(c, id),
      );
    },
    resolveIdentity: async (
      context: unknown,
      input: {
        bundleId: string;
        digest: string;
        mentionId: string;
        entityId: string | "new";
        requestKey: string;
        reason: string;
      },
    ) => {
      const a = await this.access(context, "review");
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const digest = hash(input),
          old = await this.decision(
            c,
            a,
            "resolveIdentity",
            input.requestKey,
            digest,
          );
        if (old) return old;
        const b = await this.bundle(c, input.bundleId, true);
        check(
          b.hash === input.digest &&
            b.current_bundle === b.id &&
            ["waiting_identity", "waiting_review"].includes(b.state),
          "STALE_BUNDLE",
          "Bundle is not current or is awaiting ontology",
        );
        const body = b.body as Body;
        const m = body.extraction.entities.find(
          (x) => x.mentionId === input.mentionId,
        );
        check(m, "INVALID_INPUT", "Mention not found");
        let entityId: string = randomUUID(),
          revision = 0;
        if (input.entityId !== "new") {
          const r = await c.query("SELECT * FROM ontave.entities WHERE id=$1", [
            parseUUID(input.entityId),
          ]);
          check(
            r.rows[0] && r.rows[0].concept_id === m.conceptId,
            "NOT_FOUND",
            "Compatible identity not found",
          );
          entityId = input.entityId;
          revision = r.rows[0].revision;
        }
        body.resolutions[input.mentionId] = {
          entityId,
          revision,
          mode: revision ? "link" : "new",
          reviewer: true,
        };
        body.pending = body.pending.filter((x) => x !== input.mentionId);
        body.reason = input.reason;
        const result = await this.revise(c, a, b, body);
        await this.record(
          c,
          a,
          "resolveIdentity",
          input.requestKey,
          digest,
          result,
          input.reason,
        );
        return result;
      });
    },
    accept: async (
      context: unknown,
      input: {
        bundleId: string;
        digest: string;
        requestKey: string;
        reason: string;
      },
    ) => {
      const a = await this.access(context, "review");
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const digest = hash(input),
          old = await this.decision(c, a, "accept", input.requestKey, digest);
        if (old) return old;
        const b = await this.bundle(c, input.bundleId, true);
        check(
          b.hash === input.digest &&
            b.current_bundle === b.id &&
            b.state === "waiting_review",
          "STALE_BUNDLE",
          "Only the exact current review-ready bundle can be accepted",
        );
        const body = b.body as Body;
        check(
          body.pending.length === 0 &&
            body.extraction.observations.length === 0,
          "UNRESOLVED_IDENTITY",
          "Bundle dependencies remain",
        );
        const active = await this.active(c);
        const previous = await c.query(
          "SELECT definition FROM ontave.versions WHERE id=$1",
          [b.ontology_id],
        );
        check(
          compatible(previous.rows[0].definition, active.definition),
          "STALE_ONTOLOGY",
          "Bundle requires renewed interpretation",
        );
        const evidence = await c.query(
          "SELECT * FROM ontave.evidence WHERE id=$1",
          [b.evidence_id],
        );
        validateExtraction(
          body.extraction,
          evidence.rows[0].payload,
          active.definition,
          evidence.rows[0].kind === "json" ? "json" : "text",
        );
        const published: string[] = [];
        for (const m of body.extraction.entities) {
          const r = body.resolutions[m.mentionId];
          check(r, "UNRESOLVED_IDENTITY", "Missing identity decision");
          const current = await c.query(
            "SELECT * FROM ontave.entities WHERE id=$1 FOR UPDATE",
            [r.entityId],
          );
          if (r.mode === "new") {
            check(
              !current.rows.length,
              "STALE_BUNDLE",
              "Proposed identity already exists",
            );
            const concept = active.definition.concepts.find(
              (x) => x.id === m.conceptId,
            )!;
            for (const f of concept.fields)
              check(
                f.optional || Object.hasOwn(m.fields, f.id),
                "VALIDATION_FAILED",
                "Required field missing",
              );
            await c.query(
              "INSERT INTO ontave.entities(workspace_id,id,concept_id,name) VALUES($1,$2,$3,$4)",
              [a.workspaceId, r.entityId, m.conceptId, m.name],
            );
          } else {
            check(
              current.rows[0]?.revision === r.revision &&
                current.rows[0]?.concept_id === m.conceptId,
              "STALE_BUNDLE",
              "Entity changed since review",
            );
            await c.query(
              "UPDATE ontave.entities SET revision=revision+1 WHERE id=$1",
              [r.entityId],
            );
          }
          published.push(r.entityId);
          for (const ident of m.identifiers ?? []) {
            const rule = this.config.identifierRules?.find(
              (x) => x.authority === ident.authority && x.kind === ident.kind,
            );
            if (!rule) continue;
            const value = rule.lowercase
              ? ident.value.trim().toLowerCase()
              : ident.value.trim();
            const existing = await c.query(
              "SELECT entity_id FROM ontave.identifiers WHERE authority=$1 AND kind=$2 AND normalized=$3",
              [ident.authority, ident.kind, value],
            );
            check(
              !existing.rows.length ||
                existing.rows[0].entity_id === r.entityId,
              "UNRESOLVED_IDENTITY",
              "Identifier is already linked elsewhere",
            );
            await c.query(
              "INSERT INTO ontave.identifiers(workspace_id,authority,kind,normalized,entity_id,evidence_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
              [
                a.workspaceId,
                ident.authority,
                ident.kind,
                value,
                r.entityId,
                b.evidence_id,
              ],
            );
          }
          for (const [field, f] of Object.entries(m.fields)) {
            const v = f.verification ?? "reported";
            if (v === "verified")
              check(
                this.config.sourcePolicies?.[
                  evidence.rows[0].source_policy
                ]?.verifiedFields.includes(m.conceptId + "." + field),
                "VALIDATION_FAILED",
                "Source verification rule denied",
              );
            const existing = await c.query(
              "SELECT id FROM ontave.assertions WHERE entity_id=$1 AND field_id=$2 AND evidence_id=$3 AND value=$4::jsonb AND verification=$5 AND kind='set'",
              [r.entityId, field, b.evidence_id, json(f.value), v],
            );
            if (!existing.rows.length)
              await c.query(
                "INSERT INTO ontave.assertions(workspace_id,id,entity_id,field_id,value,verification,kind,evidence_id,bundle_id,span) VALUES($1,$2,$3,$4,$5,$6,'set',$7,$8,$9)",
                [
                  a.workspaceId,
                  randomUUID(),
                  r.entityId,
                  field,
                  json(f.value),
                  v,
                  b.evidence_id,
                  b.id,
                  json(
                    sourceReference(
                      evidence.rows[0].payload,
                      f,
                      evidence.rows[0].kind === "json" ? "json" : "text",
                    ),
                  ),
                ],
              );
          }
        }
        for (const relationship of body.extraction.relationships) {
          const s = body.resolutions[relationship.source]!,
            t = body.resolutions[relationship.target]!;
          const def = active.definition.relations.find(
            (x) => x.id === relationship.relationId,
          )!;
          const existing = await c.query(
            "SELECT a.id,a.target_entity_id,a.evidence_id,EXISTS(SELECT 1 FROM ontave.assertions x WHERE x.target_assertion_id=a.id AND x.kind='retract') AS retracted FROM ontave.assertions a WHERE a.entity_id=$1 AND a.relation_id=$2 AND a.kind='set'",
            [s.entityId, relationship.relationId],
          );
          if (def.max === 1)
            check(
              existing.rows
                .filter((x) => !x.retracted && !body.retractions.includes(x.id))
                .every((x) => x.target_entity_id === t.entityId),
              "UNRESOLVED_CONFLICT",
              "Relationship cardinality conflict",
            );
          if (
            !existing.rows.some(
              (x) =>
                x.target_entity_id === t.entityId &&
                x.evidence_id === b.evidence_id,
            )
          )
            await c.query(
              "INSERT INTO ontave.assertions(workspace_id,id,entity_id,relation_id,target_entity_id,verification,kind,evidence_id,bundle_id,span) VALUES($1,$2,$3,$4,$5,'reported','set',$6,$7,$8)",
              [
                a.workspaceId,
                randomUUID(),
                s.entityId,
                relationship.relationId,
                t.entityId,
                b.evidence_id,
                b.id,
                json(
                  sourceReference(
                    evidence.rows[0].payload,
                    relationship,
                    evidence.rows[0].kind === "json" ? "json" : "text",
                  ),
                ),
              ],
            );
        }
        for (const target of body.retractions) {
          const r = await c.query(
            "SELECT * FROM ontave.assertions WHERE id=$1 AND kind='set'",
            [parseUUID(target)],
          );
          check(r.rows[0], "NOT_FOUND", "Retraction target not found");
          const x = r.rows[0];
          check(
            published.includes(x.entity_id),
            "VALIDATION_FAILED",
            "Retraction must bind a reviewed entity revision",
          );
          await c.query(
            "INSERT INTO ontave.assertions(workspace_id,id,entity_id,field_id,relation_id,value,verification,kind,target_assertion_id,evidence_id,bundle_id,span) VALUES($1,$2,$3,$4,$5,NULL,'unknown','retract',$6,$7,$8,$9)",
            [
              a.workspaceId,
              randomUUID(),
              x.entity_id,
              x.field_id,
              x.relation_id,
              x.id,
              b.evidence_id,
              b.id,
              json({
                startByte: 0,
                endByte: Buffer.byteLength(evidence.rows[0].payload),
              }),
            ],
          );
        }
        for (const id of published)
          await this.project(c, a.workspaceId, id, active.definition);
        await c.query(
          "UPDATE ontave.jobs SET state='completed',updated_at=now() WHERE id=$1",
          [b.job_id],
        );
        const result = {
          entityIds: published,
          bundleId: b.id,
          ontologyHash: active.hash,
        };
        await this.record(
          c,
          a,
          "accept",
          input.requestKey,
          digest,
          result,
          input.reason,
        );
        return result;
      });
    },
    reject: async (
      context: unknown,
      input: {
        bundleId: string;
        digest: string;
        requestKey: string;
        reason: string;
      },
    ) => {
      const a = await this.access(context, "review");
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const d = hash(input),
          old = await this.decision(c, a, "reject", input.requestKey, d);
        if (old) return old;
        const b = await this.bundle(c, input.bundleId, true);
        check(
          b.hash === input.digest &&
            b.current_bundle === b.id &&
            !["completed", "rejected"].includes(b.state),
          "STALE_BUNDLE",
          "Bundle is not rejectable",
        );
        await c.query("UPDATE ontave.jobs SET state='rejected' WHERE id=$1", [
          b.job_id,
        ]);
        const result = { rejected: true };
        await this.record(
          c,
          a,
          "reject",
          input.requestKey,
          d,
          result,
          input.reason,
        );
        return result;
      });
    },
    amend: async (
      context: unknown,
      input: {
        bundleId: string;
        digest: string;
        extraction: Extraction;
        retractions?: string[];
        requestKey: string;
        reason: string;
      },
    ) => {
      const a = await this.access(context, "review");
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const digest = hash(input),
          old = await this.decision(c, a, "amend", input.requestKey, digest);
        if (old) return old;
        const b = await this.bundle(c, input.bundleId, true);
        check(
          b.hash === input.digest &&
            b.current_bundle === b.id &&
            ["waiting_ontology", "waiting_identity", "waiting_review"].includes(
              b.state,
            ),
          "STALE_BUNDLE",
          "Bundle cannot be amended",
        );
        const e = await c.query(
          "SELECT payload,kind FROM ontave.evidence WHERE id=$1",
          [b.evidence_id],
        );
        const active = await this.active(c);
        const extraction = validateExtraction(
          input.extraction,
          e.rows[0].payload,
          active.definition,
          e.rows[0].kind === "json" ? "json" : "text",
        );
        check(
          extraction.entities.every((x) => b.body.resolutions[x.mentionId]),
          "INVALID_INPUT",
          "Amendments cannot add unreviewed identities",
        );
        const body: Body = {
          ...b.body,
          extraction,
          pending: b.body.pending.filter((id: string) =>
            extraction.entities.some((m) => m.mentionId === id),
          ),
          retractions: input.retractions ?? b.body.retractions,
          reason: input.reason,
        };
        const result = await this.revise(c, a, b, body);
        await this.record(
          c,
          a,
          "amend",
          input.requestKey,
          digest,
          result,
          input.reason,
        );
        return result;
      });
    },
  };
  private async revise(
    c: PoolClient,
    a: Access & { workspaceId: string },
    b: any,
    body: Body,
  ) {
    check(body.reason?.trim(), "INVALID_INPUT", "A reason is required");
    const snapshot = await this.active(c);
    const prior = (
      await c.query("SELECT definition FROM ontave.versions WHERE id=$1", [
        b.ontology_id,
      ])
    ).rows[0];
    check(
      prior && compatible(prior.definition, snapshot.definition),
      "STALE_ONTOLOGY",
      "Definitions are incompatible; reprocess the source and review a new interpretation",
    );
    const evidence = (
      await c.query(
        "SELECT payload,kind,envelope_hash FROM ontave.evidence WHERE id=$1",
        [b.evidence_id],
      )
    ).rows[0];
    validateExtraction(
      body.extraction,
      evidence.payload,
      snapshot.definition,
      evidence.kind === "json" ? "json" : "text",
    );
    const id = randomUUID(),
      digest = hash({
        body,
        parent: b.hash,
        ontologyHash: snapshot.hash,
        evidenceHash: evidence.envelope_hash,
      });
    await c.query(
      "INSERT INTO ontave.bundles(workspace_id,id,job_id,evidence_id,ontology_id,hash,body,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        a.workspaceId,
        id,
        b.job_id,
        b.evidence_id,
        snapshot.id,
        digest,
        json(body),
        b.revision + 1,
      ],
    );
    await c.query("UPDATE ontave.jobs SET bundle_id=$2,state=$3 WHERE id=$1", [
      b.job_id,
      id,
      body.extraction.observations.length
        ? "waiting_ontology"
        : body.pending.length
          ? "waiting_identity"
          : "waiting_review",
    ]);
    return { bundleId: id, digest };
  }
  private async project(
    c: PoolClient,
    workspace: string,
    id: string,
    d: Definition,
  ) {
    const er = await c.query(
      "SELECT concept_id FROM ontave.entities WHERE id=$1",
      [id],
    );
    const concept = d.concepts.find((x) => x.id === er.rows[0].concept_id)!;
    for (const f of concept.fields) {
      const rows = await c.query(
        "SELECT a.* FROM ontave.assertions a WHERE entity_id=$1 AND field_id=$2 AND kind='set' AND NOT EXISTS(SELECT 1 FROM ontave.assertions r WHERE r.target_assertion_id=a.id AND r.kind='retract') ORDER BY created_at,id",
        [id, f.id],
      );
      const groups = new Map<
        string,
        { value: Json; verification: any; assertionIds: string[] }
      >();
      for (const a of rows.rows) {
        const key = hash(a.value),
          g = groups.get(key);
        if (g) {
          g.assertionIds.push(a.id);
          if (a.verification === "verified") g.verification = "verified";
        } else
          groups.set(key, {
            value: a.value,
            verification: a.verification,
            assertionIds: [a.id],
          });
      }
      let result: FieldResult =
        groups.size > 1
          ? { state: "conflict", candidates: [...groups.values()] }
          : groups.size === 1
            ? { state: "value", ...[...groups.values()][0]! }
            : f.optional
              ? { state: "missing" }
              : {
                  state: "unknown",
                  reason: "No current accepted value",
                  assertionIds: [],
                };
      const rank =
        result.state === "value"
          ? result.value === null
            ? 2
            : 1
          : result.state === "missing"
            ? 3
            : result.state === "unknown"
              ? 4
              : 5;
      let text: null | string = null,
        num: null | string = null,
        bool: null | boolean = null,
        ts: null | string = null;
      if (result.state === "value" && result.value !== null) {
        validateValue(f, result.value);
        if (["text", "enum"].includes(f.type)) text = String(result.value);
        if (["integer", "decimal"].includes(f.type)) num = String(result.value);
        if (f.type === "money") num = String((result.value as any).amount);
        if (f.type === "boolean") bool = result.value as boolean;
        if (["date", "timestamp"].includes(f.type)) ts = String(result.value);
      }
      await c.query(
        "INSERT INTO ontave.projections(workspace_id,entity_id,field_id,result,state_rank,val_text,val_num,val_bool,val_ts) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(workspace_id,entity_id,field_id) DO UPDATE SET result=excluded.result,state_rank=excluded.state_rank,val_text=excluded.val_text,val_num=excluded.val_num,val_bool=excluded.val_bool,val_ts=excluded.val_ts",
        [workspace, id, f.id, json(result), rank, text, num, bool, ts],
      );
    }
  }
  readonly assertions = {
    explain: async (context: unknown, entityId: string) => {
      const a = await this.access(context, "read");
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const r = await c.query(
          "SELECT * FROM ontave.assertions WHERE entity_id=$1 ORDER BY created_at,id",
          [parseUUID(entityId)],
        );
        return r.rows;
      });
    },
    correct: async (
      context: unknown,
      input: {
        targetAssertionId: string;
        expectedRevision: number;
        value: Json;
        statement: string;
        requestKey: string;
        reason: string;
      },
    ) => this.stageCorrection(context, { ...input, action: "correct" }),
    retract: async (
      context: unknown,
      input: {
        targetAssertionId: string;
        expectedRevision: number;
        statement: string;
        requestKey: string;
        reason: string;
      },
    ) => this.stageCorrection(context, { ...input, action: "retract" }),
    attest: async (
      context: unknown,
      input: {
        entityId: string;
        fieldId: string;
        expectedRevision: number;
        value: Json;
        statement: string;
        requestKey: string;
        reason: string;
        verification?: "reported" | "verified";
      },
    ) => this.stageCorrection(context, { ...input, action: "attest" }),
  };
  private async stageCorrection(
    context: unknown,
    input: {
      action: "correct" | "retract" | "attest" | "resolveConflict";
      selectedAssertionId?: string | null;
      targetAssertionId?: string;
      entityId?: string;
      fieldId?: string;
      expectedRevision: number;
      value?: Json;
      statement: string;
      requestKey: string;
      reason: string;
      verification?: "reported" | "verified";
    },
  ) {
    const a = await this.access(context, "review");
    const digest = hash(input);
    check(
      typeof input.statement === "string" &&
        input.statement.trim() &&
        Buffer.byteLength(input.statement) <= 8192,
      "INVALID_INPUT",
      "A bounded attestation statement is required",
    );
    return this.config.storage.transaction(a.workspaceId, async (c) => {
      const old = await this.decision(
        c,
        a,
        "assertion-" + input.action,
        input.requestKey,
        digest,
      );
      if (old) return old;
      let target: any;
      if (input.targetAssertionId) {
        const t = await c.query(
          "SELECT * FROM ontave.assertions WHERE id=$1 AND kind='set'",
          [parseUUID(input.targetAssertionId)],
        );
        check(
          t.rows[0] && t.rows[0].field_id,
          "NOT_FOUND",
          "Field assertion not found",
        );
        target = t.rows[0];
      }
      const entityId = target?.entity_id ?? parseUUID(input.entityId),
        fieldId = target?.field_id ?? input.fieldId;
      const er = await c.query(
        "SELECT * FROM ontave.entities WHERE id=$1 FOR UPDATE",
        [entityId],
      );
      const entity = er.rows[0];
      check(
        entity && entity.revision === input.expectedRevision,
        "STALE_BUNDLE",
        "Entity revision changed",
      );
      const snapshot = await this.active(c);
      const concept = snapshot.definition.concepts.find(
        (x) => x.id === entity.concept_id,
      )!;
      const field = concept.fields.find((x) => x.id === fieldId);
      check(field, "INVALID_INPUT", "Field is unavailable");
      let retractions: string[] = target ? [target.id] : [];
      if (input.action === "resolveConflict") {
        const assertions = await c.query(
          "SELECT a.id,a.value FROM ontave.assertions a WHERE entity_id=$1 AND field_id=$2 AND kind='set' AND NOT EXISTS(SELECT 1 FROM ontave.assertions r WHERE r.target_assertion_id=a.id AND r.kind='retract')",
          [entityId, fieldId],
        );
        check(
          new Set(assertions.rows.map((x) => hash(x.value))).size > 1,
          "UNRESOLVED_CONFLICT",
          "Field has no current competing values",
        );
        check(
          input.selectedAssertionId === null ||
            uuid.safeParse(input.selectedAssertionId).success,
          "INVALID_INPUT",
          "Choose a current assertion or explicitly retain the unresolved conflict",
        );
        if (input.selectedAssertionId !== null) {
          const selected = assertions.rows.find(
            (x) => x.id === input.selectedAssertionId,
          );
          check(
            selected,
            "STALE_BUNDLE",
            "Selected assertion is no longer current",
          );
          retractions = assertions.rows
            .filter((x) => !sameValue(x.value, selected.value))
            .map((x) => x.id);
        }
      }
      if (input.action !== "retract" && input.action !== "resolveConflict") {
        check(
          input.value !== undefined,
          "INVALID_INPUT",
          "An attested value is required",
        );
        validateValue(field, input.value);
      }
      const verification = input.verification ?? "reported";
      if (verification === "verified")
        check(
          this.config.sourcePolicies?.[
            "reviewer-attestation"
          ]?.verifiedFields.includes(concept.id + "." + fieldId),
          "FORBIDDEN",
          "Host policy does not permit verification by attestation",
        );
      const evidenceId = randomUUID(),
        jobId = randomUUID(),
        bundleId = randomUUID();
      const extraction: Extraction = {
        entities: [
          {
            mentionId: "subject",
            conceptId: entity.concept_id,
            name: entity.name,
            fields: ["retract", "resolveConflict"].includes(input.action)
              ? {}
              : {
                  [fieldId]: {
                    value: normalizeValue(field, input.value!),
                    quote: input.statement,
                    verification,
                  },
                },
          },
        ],
        relationships: [],
        observations: [],
      };
      const body: Body = {
        extraction,
        resolutions: {
          subject: {
            entityId,
            revision: entity.revision,
            mode: "link",
            reviewer: true,
          },
        },
        pending: [],
        retractions,
        reason: input.reason,
      };
      const bundleHash = hash({
        body,
        ontologyHash: snapshot.hash,
        evidenceHash: digest,
      });
      await c.query(
        "INSERT INTO ontave.evidence(workspace_id,id,source,request_key,envelope_hash,kind,payload,metadata,source_policy) VALUES($1,$2,'reviewer-attestation',$3,$4,'attestation',$5,$6,'reviewer-attestation')",
        [
          a.workspaceId,
          evidenceId,
          input.action + ":" + input.requestKey,
          digest,
          input.statement,
          json({ actorId: a.actorId, reason: input.reason }),
        ],
      );
      await c.query(
        "INSERT INTO ontave.jobs(workspace_id,id,evidence_id,state) VALUES($1,$2,$3,'waiting_review')",
        [a.workspaceId, jobId, evidenceId],
      );
      await c.query(
        "INSERT INTO ontave.bundles(workspace_id,id,job_id,evidence_id,ontology_id,hash,body,revision) VALUES($1,$2,$3,$4,$5,$6,$7,1)",
        [
          a.workspaceId,
          bundleId,
          jobId,
          evidenceId,
          snapshot.id,
          bundleHash,
          json(body),
        ],
      );
      await c.query("UPDATE ontave.jobs SET bundle_id=$2 WHERE id=$1", [
        jobId,
        bundleId,
      ]);
      const result = { bundleId, digest: bundleHash, evidenceId, jobId };
      await this.record(
        c,
        a,
        "assertion-" + input.action,
        input.requestKey,
        digest,
        result,
        input.reason,
      );
      return result;
    });
  }
  private async storeProposal(
    context: unknown,
    input: {
      patch: Definition;
      evidenceIds: string[];
      requestKey: string;
      reason: string;
    },
    generation: Json = null,
    expectedParentHash?: string,
  ) {
    const a = await this.access(context, "review");
    const digest = hash(input);
    return this.config.storage.transaction(a.workspaceId, async (c) => {
      const old = await this.decision(
        c,
        a,
        "propose",
        input.requestKey,
        digest,
      );
      if (old) return old;
      check(
        input.reason.trim() && input.evidenceIds.length,
        "INVALID_INPUT",
        "Proposal needs evidence and rationale",
      );
      for (const id of input.evidenceIds) {
        const e = await c.query("SELECT id FROM ontave.evidence WHERE id=$1", [
          parseUUID(id),
        ]);
        check(e.rows[0], "NOT_FOUND", "Proposal evidence unavailable");
      }
      const parent = await this.active(c);
      check(
        !expectedParentHash || parent.hash === expectedParentHash,
        "STALE_BASE",
        "Ontology changed during proposal generation; generate a new candidate",
      );
      const next = extend(parent.definition, input.patch);
      const contracts = await c.query(
        "SELECT definition FROM ontave.contracts",
      );
      check(
        contracts.rows.every((x) => compatible(x.definition, next)),
        "VALIDATION_FAILED",
        "Candidate breaks a contract",
      );
      const id = randomUUID(),
        candidateHash = hash({
          parent: parent.hash,
          patch: input.patch,
          observations: [...new Set(input.evidenceIds)].sort(),
          generation,
        });
      await c.query(
        "INSERT INTO ontave.candidates(workspace_id,id,parent_id,parent_hash,hash,patch,definition,observations,state,generation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'proposed',$9)",
        [
          a.workspaceId,
          id,
          parent.id,
          parent.hash,
          candidateHash,
          json(input.patch),
          json(next),
          json([...new Set(input.evidenceIds)]),
          generation ? json(generation) : null,
        ],
      );
      const result = { candidateId: id, hash: candidateHash };
      await this.record(
        c,
        a,
        "propose",
        input.requestKey,
        digest,
        result,
        input.reason,
      );
      return result;
    });
  }
  private async generateProposal(
    context: unknown,
    input: { evidenceIds: string[]; requestKey: string; reason: string },
  ) {
    const a = await this.access(context, "review");
    check(
      this.config.model.propose,
      "MODEL_UNAVAILABLE",
      "This adapter does not support ontology proposals",
    );
    check(
      input.requestKey.length > 0 &&
        input.requestKey.length <= 180 &&
        input.reason.trim() &&
        input.evidenceIds.length > 0 &&
        input.evidenceIds.length <= 10,
      "INVALID_INPUT",
      "A bounded proposal key, rationale and up to ten evidence IDs are required",
    );
    const digest = hash(input),
      internalKey = "generated:" + input.requestKey;
    const reserved = await this.config.storage.transaction(
      a.workspaceId,
      async (c) => {
        const prior = await c.query(
          "SELECT * FROM ontave.proposal_requests WHERE request_key=$1",
          [input.requestKey],
        );
        if (prior.rows.length) {
          const r = prior.rows[0];
          check(
            r.digest === digest,
            "IDEMPOTENCY_CONFLICT",
            "Proposal key was used with different input",
          );
          if (r.state === "completed") return { result: r.result };
          // Recover the candidate committed just before a process lost its reply.
          const done = await c.query(
            "SELECT result FROM ontave.decisions WHERE operation='propose' AND request_key=$1",
            [internalKey],
          );
          if (done.rows[0]) {
            await c.query(
              "UPDATE ontave.proposal_requests SET state='completed',result=$2 WHERE request_key=$1",
              [input.requestKey, json(done.rows[0].result)],
            );
            return { result: done.rows[0].result };
          }
          throw new OntaveError(
            r.state === "running"
              ? "OPERATION_IN_PROGRESS"
              : "MODEL_UNAVAILABLE",
            r.state === "running"
              ? "Proposal has a reserved provider call; inspect its state before explicitly retrying with a new key"
              : "Previous proposal failed; an explicit new request key permits another bounded call",
          );
        }
        const parent = await this.active(c),
          observations: Json[] = [];
        const hashes: string[] = [];
        for (const id of [...new Set(input.evidenceIds)]) {
          const e = await c.query(
            "SELECT e.envelope_hash,b.body FROM ontave.evidence e JOIN ontave.jobs j ON j.workspace_id=e.workspace_id AND j.evidence_id=e.id JOIN ontave.bundles b ON b.workspace_id=j.workspace_id AND b.id=j.bundle_id WHERE e.id=$1 AND j.state='waiting_ontology' ORDER BY j.interpretation DESC LIMIT 1",
            [parseUUID(id)],
          );
          check(
            e.rows[0],
            "INVALID_INPUT",
            "Proposal requires current unresolved observations from this workspace",
          );
          hashes.push(e.rows[0].envelope_hash);
          for (const observation of e.rows[0].body.extraction.observations)
            observations.push({ evidenceId: id, ...observation });
        }
        check(
          observations.length > 0 && observations.length <= 50,
          "BUDGET_EXHAUSTED",
          "Proposal needs between one and fifty unresolved observations",
        );
        await c.query(
          "INSERT INTO ontave.proposal_requests(workspace_id,request_key,digest,parent_id,state) VALUES($1,$2,$3,$4,'running') ON CONFLICT DO NOTHING",
          [a.workspaceId, input.requestKey, digest, parent.id],
        );
        return { parent, observations, hashes };
      },
    );
    if ("result" in reserved) return reserved.result;
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), this.limits.modelTimeoutMs);
    try {
      check(
        reserved.parent.definition.concepts.length <= 25 &&
          Buffer.byteLength(
            json({
              ontology: reserved.parent.definition,
              observations: reserved.observations,
            }),
          ) <= 60000,
        "BUDGET_EXHAUSTED",
        "Proposal context exceeds the bounded profile; no definitions or observations were omitted",
      );
      const result = await abortable(controller.signal, () =>
        this.config.model.propose!({
          observations: reserved.observations,
          ontology: reserved.parent.definition,
          signal: controller.signal,
        }),
      );
      const stored = await this.storeProposal(
        context,
        {
          patch: result.patch,
          evidenceIds: input.evidenceIds,
          requestKey: internalKey,
          reason: input.reason,
        },
        {
          model: result.model,
          promptVersion: "ontave-proposal-v1",
          evidenceHashes: reserved.hashes,
          usage: result.usage ?? null,
        },
        reserved.parent.hash,
      );
      await this.config.storage.transaction(a.workspaceId, async (c) => {
        await c.query(
          "UPDATE ontave.proposal_requests SET state='completed',result=$2 WHERE request_key=$1",
          [input.requestKey, json(stored)],
        );
      });
      return stored;
    } catch (error) {
      const e =
        error instanceof OntaveError
          ? error
          : new OntaveError(
              "INVALID_MODEL_OUTPUT",
              "Ontology proposal could not be validated",
            );
      await this.config.storage.transaction(a.workspaceId, async (c) => {
        await c.query(
          "UPDATE ontave.proposal_requests SET state='failed',error=$2 WHERE request_key=$1",
          [
            input.requestKey,
            json({ code: e.code, message: e.message, usage: "unknown" }),
          ],
        );
      });
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  readonly ontology = {
    proposalStatus: async (context: unknown, requestKey: string) => {
      const a = await this.access(context, "read");
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const r = await c.query(
          "SELECT request_key,state,result,error,created_at FROM ontave.proposal_requests WHERE request_key=$1",
          [requestKey],
        );
        check(r.rows[0], "NOT_FOUND", "Proposal request not found");
        return r.rows[0];
      });
    },
    inspect: async (context: unknown) => {
      const a = await this.access(context, "read");
      return this.config.storage.transaction(a.workspaceId, (c) =>
        this.active(c),
      );
    },
    propose: async (
      context: unknown,
      input: {
        patch?: Definition;
        evidenceIds: string[];
        requestKey: string;
        reason: string;
      },
    ) => {
      await this.access(context, "review");
      check(
        input &&
          typeof input.requestKey === "string" &&
          input.requestKey.length > 0 &&
          input.requestKey.length <= 180 &&
          typeof input.reason === "string" &&
          input.reason.trim() &&
          input.reason.length <= 2000 &&
          Array.isArray(input.evidenceIds) &&
          input.evidenceIds.length > 0 &&
          input.evidenceIds.length <= 50,
        "INVALID_INPUT",
        "A bounded proposal key, evidence and rationale are required",
      );
      check(
        !input.requestKey.startsWith("generated:"),
        "INVALID_INPUT",
        "The generated proposal key prefix is reserved",
      );
      if (input.patch)
        return this.storeProposal(context, { ...input, patch: input.patch });
      return this.generateProposal(context, input);
    },
    diff: async (context: unknown, id: string) => {
      const a = await this.access(context, "read");
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const r = await c.query("SELECT * FROM ontave.candidates WHERE id=$1", [
          parseUUID(id),
        ]);
        check(r.rows[0], "NOT_FOUND", "Candidate not found");
        const row = r.rows[0];
        const parent = (
          await c.query("SELECT definition FROM ontave.versions WHERE id=$1", [
            row.parent_id,
          ])
        ).rows[0].definition as Definition;
        const next = row.definition as Definition;
        const addedConcepts = next.concepts.filter(
          (n) => !parent.concepts.some((p) => p.id === n.id),
        );
        const reuseWarnings = addedConcepts.flatMap((n) =>
          parent.concepts
            .map((p) => ({
              proposedConceptId: n.id,
              existingConceptId: p.id,
              reasons: conceptReuseReasons(n, p),
            }))
            .filter((hint) => hint.reasons.length > 0)
            .map((hint) => ({ ...hint, reason: hint.reasons.join(" ") })),
        );
        const previousRejections = (
          await c.query(
            "SELECT id,hash FROM ontave.candidates WHERE parent_id=$1 AND definition=$2::jsonb AND state='rejected' AND id<>$3 ORDER BY created_at,id",
            [row.parent_id, json(next), row.id],
          )
        ).rows;
        return {
          ...row,
          reviewHints: {
            addedConcepts: addedConcepts.map((c) => c.id),
            addedFields: next.concepts.flatMap((n) =>
              n.fields
                .filter(
                  (f) =>
                    parent.concepts.some((p) => p.id === n.id) &&
                    !parent.concepts
                      .find((p) => p.id === n.id)!
                      .fields.some((old) => old.id === f.id),
                )
                .map((f) => ({ conceptId: n.id, fieldId: f.id })),
            ),
            addedRelations: next.relations
              .filter((n) => !parent.relations.some((p) => p.id === n.id))
              .map((r) => r.id),
            reuseWarnings,
            previousRejections,
          },
        };
      });
    },
    publish: async (
      context: unknown,
      input: {
        candidateId: string;
        candidateHash: string;
        evaluationId: string;
        evaluationHash: string;
        requestKey: string;
        reason: string;
      },
    ) => {
      const a = await this.access(context, "review");
      const digest = hash(input);
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const old = await this.decision(
          c,
          a,
          "publish",
          input.requestKey,
          digest,
        );
        if (old) return old;
        await c.query("SELECT workspace_id FROM ontave.workspaces FOR UPDATE");
        const parent = await this.active(c);
        const r = await c.query(
          "SELECT * FROM ontave.candidates WHERE id=$1 FOR UPDATE",
          [parseUUID(input.candidateId)],
        );
        const candidate = r.rows[0];
        check(
          candidate &&
            candidate.state === "proposed" &&
            candidate.hash === input.candidateHash,
          "STALE_BASE",
          "Candidate is unavailable or changed",
        );
        check(
          parent.id === candidate.parent_id &&
            parent.hash === candidate.parent_hash,
          "STALE_BASE",
          "Generate and evaluate a new candidate against the current head",
        );
        const ev = await c.query(
          "SELECT * FROM ontave.evaluations WHERE id=$1 AND candidate_id=$2",
          [parseUUID(input.evaluationId), candidate.id],
        );
        const evaluation = ev.rows[0];
        check(
          evaluation?.passed &&
            evaluation.hash === input.evaluationHash &&
            evaluation.candidate_hash === candidate.hash,
          "EVALUATION_INCOMPLETE",
          "A matching passing evaluation is required",
        );
        const contracts = await c.query(
          "SELECT definition FROM ontave.contracts",
        );
        check(
          contracts.rows.every((x) =>
            compatible(x.definition, candidate.definition),
          ),
          "VALIDATION_FAILED",
          "Contract compatibility failed",
        );
        const id = randomUUID();
        await c.query(
          "INSERT INTO ontave.versions(workspace_id,id,ordinal,parent_id,hash,definition) VALUES($1,$2,$3,$4,$5,$6)",
          [
            a.workspaceId,
            id,
            parent.ordinal + 1,
            parent.id,
            hash(candidate.definition),
            json(candidate.definition),
          ],
        );
        await c.query(
          "UPDATE ontave.workspaces SET active_id=$1,revision=revision+1",
          [id],
        );
        await c.query(
          "UPDATE ontave.candidates SET state='published',published_id=$2 WHERE id=$1",
          [candidate.id, id],
        );
        const replay = await c.query(
          "UPDATE ontave.jobs SET state='queued',bundle_id=NULL,attempts=0,calls=0,error=NULL,next_at=now() WHERE state='waiting_ontology' AND evidence_id=ANY($1::uuid[]) RETURNING id",
          [candidate.observations],
        );
        const result = {
          ontologyId: id,
          reprocessingJobs: replay.rows.map((x) => x.id),
        };
        await this.record(
          c,
          a,
          "publish",
          input.requestKey,
          digest,
          result,
          input.reason,
        );
        return result;
      });
    },
    reject: async (
      context: unknown,
      input: {
        candidateId: string;
        candidateHash: string;
        requestKey: string;
        reason: string;
      },
    ) => {
      const a = await this.access(context, "review");
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const digest = hash(input),
          old = await this.decision(
            c,
            a,
            "rejectCandidate",
            input.requestKey,
            digest,
          );
        if (old) return old;
        const r = await c.query(
          "UPDATE ontave.candidates SET state='rejected' WHERE id=$1 AND hash=$2 AND state='proposed' RETURNING id",
          [parseUUID(input.candidateId), input.candidateHash],
        );
        check(r.rowCount, "STALE_BASE", "Candidate unavailable");
        const result = { rejected: true };
        await this.record(
          c,
          a,
          "rejectCandidate",
          input.requestKey,
          digest,
          result,
          input.reason,
        );
        return result;
      });
    },
  };
  readonly metrics = {
    summary: async (context: unknown) => {
      const a = await this.access(context, "read");
      return this.config.storage.transaction(a.workspaceId, operationalMetrics);
    },
  };
  readonly evaluations = {
    get: async (context: unknown, evaluationId: string) => {
      const a = await this.access(context, "review");
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const r = await c.query(
          "SELECT id,hash,passed,report,created_at FROM ontave.evaluations WHERE id=$1",
          [parseUUID(evaluationId)],
        );
        check(r.rows[0], "NOT_FOUND", "Evaluation unavailable");
        return r.rows[0];
      });
    },
    registerSuite: async (context: unknown, suite: EvaluationSuite) => {
      const a = await this.access(context, "review");
      const parsed = evaluationSuiteSchema.safeParse(suite);
      check(parsed.success, "INVALID_INPUT", "Invalid closed evaluation suite");
      suite = parsed.data as EvaluationSuite;
      check(
        Buffer.byteLength(json(suite)) <= 1048576,
        "PAYLOAD_TOO_LARGE",
        "Evaluation suite exceeds 1 MiB",
      );
      check(
        suite.maxCalls >=
          2 * suite.tasks.filter((t) => t.kind === "extract").length,
        "INVALID_INPUT",
        "Call budget cannot complete both sides of every extraction task",
      );
      check(
        suite.name.length > 0 &&
          suite.tasks.length > 0 &&
          suite.tasks.length <= 40 &&
          suite.maxCalls > 0 &&
          suite.maxCalls <= 80 &&
          suite.timeoutMs > 0 &&
          suite.timeoutMs <= 600000,
        "INVALID_INPUT",
        "Invalid bounded evaluation suite",
      );
      check(
        new Set(suite.tasks.map((x) => x.id)).size === suite.tasks.length &&
          suite.tasks.every((x) =>
            ["extract", "contract", "read"].includes(x.kind),
          ),
        "INVALID_INPUT",
        "Unsupported or duplicate evaluation tasks",
      );
      const digest = hash(suite);
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        for (const t of suite.tasks) {
          if (t.kind === "extract") {
            const e = await c.query(
              "SELECT id FROM ontave.evidence WHERE id=$1",
              [parseUUID(t.evidenceId)],
            );
            check(
              e.rows[0],
              "INVALID_INPUT",
              "Extraction evaluation requires authorized evidence and expected checks",
            );
            for (const candidate of t.candidates ?? []) {
              const row = await c.query(
                "SELECT id FROM ontave.entities WHERE id=$1 AND concept_id=$2",
                [candidate.id, candidate.conceptId],
              );
              check(
                row.rowCount,
                "NOT_FOUND",
                "Evaluation identity candidate unavailable",
              );
            }
          } else if (t.kind === "read") {
            validateReadFixture(t);
          } else {
            const r = await c.query(
              "SELECT id FROM ontave.contracts WHERE id=$1",
              [parseUUID(t.contractId)],
            );
            check(r.rows[0], "NOT_FOUND", "Contract unavailable");
          }
        }
        const id = randomUUID();
        const r = await c.query(
          "INSERT INTO ontave.suites(workspace_id,id,hash,suite) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,hash) DO NOTHING RETURNING id",
          [a.workspaceId, id, digest, json(suite)],
        );
        const stored =
          r.rows[0] ??
          (
            await c.query("SELECT id FROM ontave.suites WHERE hash=$1", [
              digest,
            ])
          ).rows[0];
        return { suiteId: stored.id, hash: digest };
      });
    },
    evaluate: async (
      context: unknown,
      input: { candidateId: string; suiteId: string },
    ) => {
      const a = await this.access(context, "review");
      const data = await this.config.storage.transaction(
        a.workspaceId,
        async (c) => {
          const r = await c.query(
            "SELECT * FROM ontave.candidates WHERE id=$1",
            [parseUUID(input.candidateId)],
          );
          const s = await c.query("SELECT * FROM ontave.suites WHERE id=$1", [
            parseUUID(input.suiteId),
          ]);
          check(
            r.rows[0] && s.rows[0],
            "EVALUATION_INCOMPLETE",
            "Candidate and applicable suite are required",
          );
          const p = await c.query("SELECT * FROM ontave.versions WHERE id=$1", [
            r.rows[0].parent_id,
          ]);
          const suite = s.rows[0].suite as EvaluationSuite;
          const inputs = [];
          for (const t of suite.tasks) {
            if (t.kind === "extract") {
              const e = await c.query(
                "SELECT * FROM ontave.evidence WHERE id=$1",
                [t.evidenceId],
              );
              inputs.push({ task: t, evidence: e.rows[0] });
            } else if (t.kind === "read") {
              inputs.push({ task: t });
            } else {
              const q = await c.query(
                "SELECT definition FROM ontave.contracts WHERE id=$1",
                [t.contractId],
              );
              inputs.push({ task: t, contract: q.rows[0].definition });
            }
          }
          return {
            candidate: r.rows[0],
            suiteRow: s.rows[0],
            parent: p.rows[0],
            inputs,
          };
        },
      );
      const suite = data.suiteRow.suite as EvaluationSuite;
      for (const task of suite.tasks)
        if (task.kind === "extract")
          for (const g of task.expected)
            if (g.equivalentValues) {
              const field = (data.candidate.definition as Definition).concepts
                .find((c) => c.id === g.conceptId)
                ?.fields.find((f) => f.id === g.fieldId);
              check(
                field?.type === "text" && typeof g.value === "string",
                "INVALID_INPUT",
                "Equivalent values are allowed only for explicitly labeled text fields",
              );
            }
      check(
        suite.tasks.some((t) => t.kind === "extract"),
        "EVALUATION_INCOMPLETE",
        "Suite must assess a new extraction capability",
      );
      let calls = 0;
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), suite.timeoutMs);
      const outcomes: Json[] = [],
        traces: Json[] = [];
      let passed = true;
      let failure: OntaveError | undefined;
      try {
        for (const { task, evidence, contract } of data.inputs) {
          check(
            !controller.signal.aborted,
            "EVALUATION_INCOMPLETE",
            "Evaluation deadline exceeded",
          );
          const scores: number[] = [];
          for (const d of [
            data.parent.definition,
            data.candidate.definition,
          ] as Definition[]) {
            if (task.kind === "contract") {
              scores.push(compatible(contract, d) ? 1 : 0);
              continue;
            }
            if (task.kind === "read") {
              const result = await this.config.storage.transaction(
                a.workspaceId,
                (c) => evaluateRead(c, task, d, a.workspaceId),
              );
              const ok = sameValue(
                result as unknown as Json,
                task.expected as unknown as Json,
              );
              traces.push({
                taskId: task.id,
                side: scores.length === 0 ? "parent" : "candidate",
                kind: "read",
                fixtureHash: hash(task.records),
                output: result as unknown as Json,
                passed: ok,
              });
              scores.push(ok ? 1 : 0);
              continue;
            }
            const input = this.modelInput(evidence, d, task.candidates ?? []);
            check(
              ++calls <= suite.maxCalls,
              "BUDGET_EXHAUSTED",
              "Evaluation call budget exhausted",
            );
            check(
              !controller.signal.aborted,
              "EVALUATION_INCOMPLETE",
              "Evaluation deadline exceeded",
            );
            const callSignal = AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(this.limits.modelTimeoutMs),
            ]);
            const trace: Record<string, Json> = {
              taskId: task.id,
              side: scores.length === 0 ? "parent" : "candidate",
              status: "started",
              kind: "extract",
              startedAt: new Date().toISOString(),
              model: null,
              usage: null,
            };
            traces.push(trace);
            const result = await abortable(
              callSignal,
              () => this.config.model.extract({ ...input, signal: callSignal }),
              "EVALUATION_INCOMPLETE",
            );
            check(
              typeof result.model === "string" &&
                result.model.length > 0 &&
                result.model.length <= 200,
              "INVALID_MODEL_OUTPUT",
              "Invalid provider model identifier",
            );
            trace.model = result.model;
            try {
              trace.usage =
                result.usage === undefined
                  ? null
                  : JSON.parse(json(result.usage));
            } catch {
              throw new OntaveError(
                "INVALID_MODEL_OUTPUT",
                "Provider usage is not canonical JSON",
              );
            }
            let encoded: string;
            try {
              encoded = json(result.output);
            } catch {
              throw new OntaveError(
                "INVALID_MODEL_OUTPUT",
                "Provider output is not canonical JSON",
              );
            }
            check(
              Buffer.byteLength(encoded) <= 2097152,
              "BUDGET_EXHAUSTED",
              "Evaluation output exceeds 2 MiB",
            );
            trace.output = JSON.parse(encoded);
            trace.outputHash = hash(result.output);
            const e = validateExtraction(
              result.output,
              evidence.payload,
              d,
              evidence.kind === "json" ? "json" : "text",
            );
            check(
              e.entities.reduce(
                (n, m) => n + 1 + Object.keys(m.fields).length,
                e.relationships.length,
              ) <= this.limits.operations,
              "BUDGET_EXHAUSTED",
              "Evaluation bundle operation limit exceeded",
            );
            for (const m of e.entities)
              for (const [field, f] of Object.entries(m.fields))
                if (f.verification === "verified")
                  check(
                    this.config.sourcePolicies?.[
                      evidence.source_policy
                    ]?.verifiedFields.includes(m.conceptId + "." + field),
                    "VALIDATION_FAILED",
                    "This source cannot verify the evaluated field",
                  );
            const metrics = scoreExtraction(e, task, d, evidence.payload);
            trace.durationMs =
              Date.now() - Date.parse(trace.startedAt as string);
            trace.metrics = metrics;
            trace.status = "complete";
            scores.push(metrics.passed ? 1 : 0);
          }
          const good = scores[1] === 1 && scores[1]! >= scores[0]!;
          passed &&= good;
          outcomes.push({
            taskId: task.id,
            parent: scores[0]!,
            candidate: scores[1]!,
            passed: good,
          });
        }
      } catch (e) {
        failure =
          e instanceof OntaveError
            ? e
            : new OntaveError(
                "EVALUATION_INCOMPLETE",
                "Evaluation failed; no publication is permitted",
              );
        const last = traces.at(-1) as Record<string, Json> | undefined;
        if (last?.status === "started") {
          last.status = "failed";
          last.durationMs = Date.now() - Date.parse(last.startedAt as string);
          last.error = {
            code: failure.code,
            message: failure.message,
            outcome: failure.details?.outcome ?? "unknown",
          };
          last.model = last.model ?? failure.details?.model ?? null;
          last.usage = last.usage ?? failure.details?.usage ?? null;
        }
        passed = false;
      } finally {
        clearTimeout(timer);
      }
      passed = passed && outcomes.some((x: any) => x.candidate > x.parent);
      const report = {
        evaluatorVersion: "ontave-exact-task-v3",
        status: failure ? "failed" : "complete",
        failure: failure
          ? { code: failure.code, message: failure.message }
          : null,
        outcomes,
        traces,
        calls,
        inferenceAttempts: traces.filter((t: any) => t.kind === "extract")
          .length,
        parentHash: data.parent.hash,
        candidateHash: data.candidate.hash,
        suiteHash: data.suiteRow.hash,
        evidenceHashes: data.inputs
          .filter((x) => "evidence" in x)
          .map((x) => x.evidence?.envelope_hash),
      };
      const digest = hash(report),
        id = randomUUID();
      await this.config.storage.transaction(a.workspaceId, async (c) => {
        await c.query(
          "INSERT INTO ontave.evaluations(workspace_id,id,candidate_id,suite_id,candidate_hash,suite_hash,hash,passed,report) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            a.workspaceId,
            id,
            data.candidate.id,
            data.suiteRow.id,
            data.candidate.hash,
            data.suiteRow.hash,
            digest,
            passed,
            json(report),
          ],
        );
      });
      if (failure)
        throw new OntaveError(
          failure.code,
          failure.message,
          failure.retryable,
          { ...failure.details, evaluationId: id },
        );
      return { evaluationId: id, hash: digest, passed, report };
    },
  };
  readonly contracts = {
    register: async (context: unknown, d: Definition) => {
      const a = await this.access(context, "review");
      const normalized = definition(d),
        digest = hash(normalized);
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const snapshot = await this.active(c);
        check(
          compatible(normalized, snapshot.definition),
          "VALIDATION_FAILED",
          "Contract is not a projection of approved definitions",
        );
        const existing = await c.query(
          "SELECT id,source_ontology_id,source_ontology_hash FROM ontave.contracts WHERE hash=$1",
          [digest],
        );
        if (existing.rows.length)
          return {
            id: existing.rows[0].id,
            hash: digest,
            definition: normalized,
            sourceOntologyId: existing.rows[0].source_ontology_id as
              string | null,
            sourceOntologyHash: existing.rows[0].source_ontology_hash as
              string | null,
          };
        const id = randomUUID();
        await c.query(
          "INSERT INTO ontave.contracts(workspace_id,id,hash,definition,source_ontology_id,source_ontology_hash) VALUES($1,$2,$3,$4,$5,$6)",
          [
            a.workspaceId,
            id,
            digest,
            json(normalized),
            snapshot.id,
            snapshot.hash,
          ],
        );
        return {
          id,
          hash: digest,
          definition: normalized,
          sourceOntologyId: snapshot.id,
          sourceOntologyHash: snapshot.hash,
        };
      });
    },
    pull: async (context: unknown, id: string) => {
      const a = await this.access(context, "read");
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const r = await c.query(
          'SELECT id,hash,definition,source_ontology_id AS "sourceOntologyId",source_ontology_hash AS "sourceOntologyHash",created_at FROM ontave.contracts WHERE id=$1',
          [parseUUID(id)],
        );
        check(r.rows[0], "CONTRACT_NOT_AVAILABLE", "Contract not available");
        return r.rows[0];
      });
    },
  };
  readonly entities = {
    find: async (
      context: unknown,
      query: EntityQuery,
    ): Promise<{
      records: EntityRecord[];
      nextCursor: string | null;
      contractHash: string;
      ontologyHash: string;
    }> => {
      const a = await this.access(context, "read");
      const parsed = entityQuerySchema.safeParse(query);
      check(parsed.success, "INVALID_INPUT", "Invalid closed structured query");
      query = parsed.data as EntityQuery;
      parseUUID(query.contractId);
      check(
        Number.isInteger(query.limit ?? 25) &&
          (query.limit ?? 25) > 0 &&
          (query.limit ?? 25) <= 100,
        "INVALID_INPUT",
        "Page size must be 1–100",
      );
      check(
        !query.where || query.where.length <= 20,
        "INVALID_INPUT",
        "Too many predicates",
      );
      return this.config.storage.transaction(a.workspaceId, async (c) => {
        const r = await c.query(
          "SELECT * FROM ontave.contracts WHERE id=$1 AND hash=$2",
          [query.contractId, query.contractHash],
        );
        check(
          r.rows[0],
          "CONTRACT_NOT_AVAILABLE",
          "Exact contract is unavailable",
        );
        const d = r.rows[0].definition as Definition;
        const concept = d.concepts.find((x) => x.id === query.conceptId);
        check(concept, "INVALID_INPUT", "Concept absent from contract");
        const active = await this.active(c);
        check(
          compatible(d, active.definition),
          "CONTRACT_NOT_AVAILABLE",
          "Contract is incompatible",
        );
        return readRecords(
          c,
          query,
          d,
          a.workspaceId,
          this.cursorSecret,
          active.hash,
        );
      });
    },
  };
  async close() {
    await this.config.storage.close();
  }
}
export function createOntave(config: OntaveConfig): Ontave {
  return new Ontave(config);
}
