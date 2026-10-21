ALTER TABLE ontave.candidates ADD COLUMN generation jsonb;
CREATE TABLE ontave.proposal_requests (
 workspace_id uuid NOT NULL REFERENCES ontave.workspaces, request_key text NOT NULL,
 digest text NOT NULL, parent_id uuid NOT NULL, state text NOT NULL CHECK(state IN ('running','completed','failed')),
 result jsonb, error jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,request_key), FOREIGN KEY(workspace_id,parent_id) REFERENCES ontave.versions
);
ALTER TABLE ontave.proposal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontave.proposal_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON ontave.proposal_requests
 USING (workspace_id = nullif(current_setting('ontave.workspace_id',true),'')::uuid)
 WITH CHECK (workspace_id = nullif(current_setting('ontave.workspace_id',true),'')::uuid);
