-- Append-only attempt accounting survives a killed worker and records late fenced replies.
CREATE TABLE ontave.worker_events (
 workspace_id uuid NOT NULL, id uuid NOT NULL, job_id uuid NOT NULL, fence integer NOT NULL,
 event text NOT NULL CHECK(event IN ('started','completed','failed','lease_expired')),
 details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,job_id,fence,event),
 FOREIGN KEY(workspace_id,job_id) REFERENCES ontave.jobs
);
ALTER TABLE ontave.worker_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontave.worker_events FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON ontave.worker_events
 USING (workspace_id = nullif(current_setting('ontave.workspace_id',true),'')::uuid)
 WITH CHECK (workspace_id = nullif(current_setting('ontave.workspace_id',true),'')::uuid);
