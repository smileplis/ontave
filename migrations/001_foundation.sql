CREATE SCHEMA IF NOT EXISTS ontave;
CREATE TABLE ontave.migrations (version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ontave.workspaces (
 workspace_id uuid PRIMARY KEY, name text NOT NULL, active_id uuid, revision integer NOT NULL DEFAULT 0,
 request_key text NOT NULL, request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ontave.versions (
 workspace_id uuid NOT NULL REFERENCES ontave.workspaces, id uuid NOT NULL, ordinal integer NOT NULL,
 parent_id uuid, hash text NOT NULL, definition jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,ordinal), FOREIGN KEY(workspace_id,parent_id) REFERENCES ontave.versions
);
ALTER TABLE ontave.workspaces ADD FOREIGN KEY(workspace_id,active_id) REFERENCES ontave.versions(workspace_id,id);
CREATE TABLE ontave.evidence (
 workspace_id uuid NOT NULL REFERENCES ontave.workspaces, id uuid NOT NULL, source text NOT NULL, request_key text NOT NULL,
 envelope_hash text NOT NULL, kind text NOT NULL CHECK(kind IN ('text','json','attestation')), payload text NOT NULL,
 metadata jsonb NOT NULL, source_policy text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,source,request_key)
);
CREATE TABLE ontave.jobs (
 workspace_id uuid NOT NULL, id uuid NOT NULL, evidence_id uuid NOT NULL, interpretation integer NOT NULL DEFAULT 1,
 state text NOT NULL CHECK(state IN ('queued','processing','waiting_ontology','waiting_identity','waiting_review','retry_scheduled','completed','rejected','failed')),
 attempts integer NOT NULL DEFAULT 0, calls integer NOT NULL DEFAULT 0, fence integer NOT NULL DEFAULT 0,
 lease_owner uuid, lease_until timestamptz, next_at timestamptz NOT NULL DEFAULT now(), bundle_id uuid,
 error jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,evidence_id,interpretation), FOREIGN KEY(workspace_id,evidence_id) REFERENCES ontave.evidence
);
CREATE TABLE ontave.runs (
 workspace_id uuid NOT NULL, id uuid NOT NULL, job_id uuid NOT NULL, ontology_id uuid NOT NULL,
 model text NOT NULL, output jsonb, error jsonb, usage jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id,job_id) REFERENCES ontave.jobs, FOREIGN KEY(workspace_id,ontology_id) REFERENCES ontave.versions
);
CREATE TABLE ontave.bundles (
 workspace_id uuid NOT NULL, id uuid NOT NULL, job_id uuid NOT NULL, evidence_id uuid NOT NULL, ontology_id uuid NOT NULL,
 hash text NOT NULL, body jsonb NOT NULL, revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id,job_id) REFERENCES ontave.jobs,
 FOREIGN KEY(workspace_id,evidence_id) REFERENCES ontave.evidence, FOREIGN KEY(workspace_id,ontology_id) REFERENCES ontave.versions,
 UNIQUE(workspace_id,job_id,revision)
);
ALTER TABLE ontave.jobs ADD FOREIGN KEY(workspace_id,bundle_id) REFERENCES ontave.bundles(workspace_id,id);
CREATE TABLE ontave.entities (
 workspace_id uuid NOT NULL REFERENCES ontave.workspaces, id uuid NOT NULL, concept_id text NOT NULL, name text NOT NULL,
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,id)
);
CREATE TABLE ontave.identifiers (
 workspace_id uuid NOT NULL, authority text NOT NULL, kind text NOT NULL, normalized text NOT NULL, entity_id uuid NOT NULL,
 evidence_id uuid NOT NULL, PRIMARY KEY(workspace_id,authority,kind,normalized),
 FOREIGN KEY(workspace_id,entity_id) REFERENCES ontave.entities, FOREIGN KEY(workspace_id,evidence_id) REFERENCES ontave.evidence
);
CREATE TABLE ontave.assertions (
 workspace_id uuid NOT NULL, id uuid NOT NULL, entity_id uuid NOT NULL, field_id text, relation_id text, target_entity_id uuid,
 value jsonb, verification text NOT NULL CHECK(verification IN ('reported','verified','disputed','unknown')),
 kind text NOT NULL CHECK(kind IN ('set','retract')), target_assertion_id uuid, evidence_id uuid NOT NULL,
 bundle_id uuid NOT NULL, span jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id,entity_id) REFERENCES ontave.entities,
 FOREIGN KEY(workspace_id,target_entity_id) REFERENCES ontave.entities, FOREIGN KEY(workspace_id,evidence_id) REFERENCES ontave.evidence,
 FOREIGN KEY(workspace_id,bundle_id) REFERENCES ontave.bundles, FOREIGN KEY(workspace_id,target_assertion_id) REFERENCES ontave.assertions,
 CHECK ((field_id IS NOT NULL AND relation_id IS NULL) OR (relation_id IS NOT NULL AND field_id IS NULL))
);
CREATE TABLE ontave.projections (
 workspace_id uuid NOT NULL, entity_id uuid NOT NULL, field_id text NOT NULL, result jsonb NOT NULL,
 state_rank smallint NOT NULL CHECK(state_rank BETWEEN 1 AND 5), val_text text, val_num numeric(38,10), val_bool boolean, val_ts timestamptz,
 PRIMARY KEY(workspace_id,entity_id,field_id), FOREIGN KEY(workspace_id,entity_id) REFERENCES ontave.entities
);
CREATE TABLE ontave.contracts (
 workspace_id uuid NOT NULL REFERENCES ontave.workspaces, id uuid NOT NULL, hash text NOT NULL, definition jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,hash)
);
CREATE TABLE ontave.candidates (
 workspace_id uuid NOT NULL, id uuid NOT NULL, parent_id uuid NOT NULL, parent_hash text NOT NULL,
 hash text NOT NULL, patch jsonb NOT NULL, definition jsonb NOT NULL, observations jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('proposed','published','rejected')), published_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,parent_id) REFERENCES ontave.versions, FOREIGN KEY(workspace_id,published_id) REFERENCES ontave.versions
);
CREATE TABLE ontave.suites (
 workspace_id uuid NOT NULL REFERENCES ontave.workspaces, id uuid NOT NULL, hash text NOT NULL, suite jsonb NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,hash)
);
CREATE TABLE ontave.evaluations (
 workspace_id uuid NOT NULL, id uuid NOT NULL, candidate_id uuid NOT NULL, suite_id uuid NOT NULL, candidate_hash text NOT NULL,
 suite_hash text NOT NULL, hash text NOT NULL, passed boolean NOT NULL, report jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES ontave.candidates, FOREIGN KEY(workspace_id,suite_id) REFERENCES ontave.suites
);
CREATE TABLE ontave.decisions (
 workspace_id uuid NOT NULL REFERENCES ontave.workspaces, id uuid NOT NULL, operation text NOT NULL, request_key text NOT NULL,
 digest text NOT NULL, actor text NOT NULL, reason text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,operation,request_key)
);
CREATE INDEX jobs_claim ON ontave.jobs(workspace_id,state,next_at);
CREATE INDEX assertions_field ON ontave.assertions(workspace_id,entity_id,field_id);
CREATE INDEX projections_numeric ON ontave.projections(workspace_id,field_id,state_rank,val_num,entity_id);
CREATE INDEX projections_text ON ontave.projections(workspace_id,field_id,state_rank,val_text,entity_id);
CREATE INDEX entities_concept ON ontave.entities(workspace_id,concept_id,id);
DO $$ DECLARE item text; BEGIN
 FOREACH item IN ARRAY ARRAY['workspaces','versions','evidence','jobs','runs','bundles','entities','identifiers','assertions','projections','contracts','candidates','suites','evaluations','decisions'] LOOP
  EXECUTE format('ALTER TABLE ontave.%I ENABLE ROW LEVEL SECURITY',item);
  EXECUTE format('ALTER TABLE ontave.%I FORCE ROW LEVEL SECURITY',item);
  EXECUTE format('CREATE POLICY workspace_scope ON ontave.%I USING (workspace_id = nullif(current_setting(''ontave.workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id = nullif(current_setting(''ontave.workspace_id'',true),'''')::uuid)',item);
 END LOOP;
END $$;
