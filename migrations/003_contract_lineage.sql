ALTER TABLE ontave.contracts ADD COLUMN source_ontology_id uuid;
ALTER TABLE ontave.contracts ADD COLUMN source_ontology_hash text;
ALTER TABLE ontave.contracts ADD FOREIGN KEY(workspace_id,source_ontology_id) REFERENCES ontave.versions(workspace_id,id);
