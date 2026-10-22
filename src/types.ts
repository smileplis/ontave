export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Capability = "read" | "ingest" | "review" | "worker" | "provision";
export interface Access {
  actorId: string;
  workspaceId?: string;
  capabilities: Capability[];
  sourcePolicy?: string;
}
export type Verification = "reported" | "verified" | "disputed" | "unknown";
export interface EvidenceRef {
  path?: string;
  quote: string;
  occurrence?: number;
}
export interface Span {
  startByte: number;
  endByte: number;
  path?: string;
}
export interface FieldDefinition {
  id: string;
  name: string;
  description: string;
  type:
    | "text"
    | "integer"
    | "decimal"
    | "money"
    | "boolean"
    | "date"
    | "timestamp"
    | "enum";
  optional?: boolean;
  nullable?: boolean;
  values?: string[];
}
export interface Concept {
  id: string;
  name: string;
  description: string;
  fields: FieldDefinition[];
}
export interface Relation {
  id: string;
  name: string;
  source: string;
  target: string;
  max?: 1;
}
export interface Definition {
  concepts: Concept[];
  relations: Relation[];
}
export interface Snapshot {
  id: string;
  hash: string;
  definition: Definition;
  ordinal: number;
}
export interface ExtractedField extends EvidenceRef {
  value: Json;
  verification?: Verification;
}
export interface ExtractedEntity {
  mentionId: string;
  conceptId: string;
  name: string;
  existingId?: string;
  fields: Record<string, ExtractedField>;
  identifiers?: {
    authority: string;
    kind: string;
    value: string;
    quote: string;
    occurrence?: number;
    path?: string;
  }[];
}
export interface Extraction {
  entities: ExtractedEntity[];
  relationships: {
    source: string;
    target: string;
    relationId: string;
    quote: string;
    occurrence?: number;
    path?: string;
  }[];
  observations: (EvidenceRef & { concept: string })[];
}
export interface ModelTask {
  kind?: "text" | "json";
  text: string;
  ontology: Definition;
  signal: AbortSignal;
  candidates: { id: string; name: string; conceptId: string }[];
  verifiedFields?: string[];
  identifierRules?: { authority: string; kind: string }[];
}
export interface ModelResult {
  output: unknown;
  model: string;
  usage?: Json;
}
export interface ModelAdapter {
  extract(task: ModelTask): Promise<ModelResult>;
  propose?(task: {
    observations: Json[];
    ontology: Definition;
    signal: AbortSignal;
  }): Promise<{ patch: Definition; model: string; usage?: Json }>;
}
export type FieldResult<T = Json> =
  | {
      state: "value";
      value: T;
      verification: Verification;
      assertionIds: string[];
    }
  | { state: "unknown"; reason: string; assertionIds: string[] }
  | { state: "missing" }
  | {
      state: "conflict";
      candidates: {
        value: T;
        verification: Verification;
        assertionIds: string[];
      }[];
    };
export interface EntityRecord {
  id: string;
  conceptId: string;
  name: string;
  revision: number;
  fields: Record<string, FieldResult>;
  relationships?: Record<
    string,
    {
      items: { id: string; verification: Verification; assertionId: string }[];
      hasMore: boolean;
    }
  >;
}
export interface Filter {
  field: string;
  op: "eq" | "in" | "gt" | "gte" | "lt" | "lte" | "stateIs" | "verificationIn";
  value: Json;
}
export interface EntityQuery {
  contractId: string;
  contractHash: string;
  conceptId: string;
  where?: Filter[];
  order?: { field: string; direction: "asc" | "desc" };
  limit?: number;
  cursor?: string;
  include?: string[];
}
export type EvaluationTask =
  | {
      id: string;
      kind: "extract";
      evidenceId: string;
      expected: {
        conceptId: string;
        fieldId: string;
        value: Json;
        verification?: Verification;
        equivalentValues?: string[];
        entityName?: string;
        quote?: string;
        path?: string;
        occurrence?: number;
      }[];
      identities?: {
        conceptId: string;
        name: string;
        existingId: string | null;
        identifiers?: { authority: string; kind: string; value: string }[];
      }[];
      relationships?: {
        relationId: string;
        source: {
          conceptId: string;
          name?: string;
          fields?: Record<string, Json>;
        };
        target: {
          conceptId: string;
          name?: string;
          fields?: Record<string, Json>;
        };
        quote: string;
        path?: string;
        occurrence?: number;
      }[];
      observations?: (EvidenceRef & { concept: string })[];
      candidates?: { id: string; name: string; conceptId: string }[];
    }
  | { id: string; kind: "contract"; contractId: string }
  | {
      id: string;
      kind: "read";
      definition: Definition;
      records: EntityRecord[];
      query: Omit<EntityQuery, "contractId" | "contractHash" | "cursor">;
      expected:
        | { records: EntityRecord[]; hasMore: boolean }
        | { error: "INVALID_INPUT" | "CONTRACT_NOT_AVAILABLE" };
    };
export interface EvaluationSuite {
  name: string;
  tasks: EvaluationTask[];
  maxCalls: number;
  timeoutMs: number;
}
export interface Limits {
  payloadBytes: number;
  metadataBytes: number;
  operations: number;
  modelTimeoutMs: number;
  modelCalls: number;
  attempts: number;
  leaseMs: number;
  candidates: number;
}
