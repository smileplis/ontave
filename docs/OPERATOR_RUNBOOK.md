# Ontave local operations

Use a dedicated PostgreSQL 18 database. The owner/migration role creates internal schema and grants; the runtime role must be a separate non-owner login without superuser or BYPASSRLS privileges. The storage adapter rejects privileged runtime roles. Runtime database credentials belong only in trusted server processes.

## Setup and migrations

1. Create the dedicated database, owner and restricted runtime login using the database operator's normal credential workflow. Do not reuse existing application resources.
2. Set Ontave's runtime and migration connection references privately. Keep `.env` ignored and restrict its permissions. Select a workspace UUID and private local CLI credential.
3. From the installed package, run `ontave init`, then explicit `migrate plan` and `migrate apply --yes` using the generated config. Supply `--config` and load the environment explicitly with Node 24's `--env-file` when needed.
4. Provision the selected empty/people workspace with `workspace create`. Register an explicit contract before record reads. Start one workspace-authorized worker per scope.

Migrations take a transaction advisory lock, verify previously applied checksums, and commit all pending internal DDL with the ledger. A failure rolls back that migration transaction. Correct the cause and rerun the plan; never edit the checksum ledger to disguise an applied-source mismatch. A checksum mismatch needs operator investigation against the exact installed artifact.

## Jobs and recovery

A receipt preserves evidence and a job together. `queued` and due `retry_scheduled` jobs are claimable. Waiting ontology, identity and review states need their named dependency; they are not worker completion. Only an accepted current bundle completes its interpretation.

Workers reserve their call budget before inference, renew leases and check owner/fence/expiry before staging. A process crash can incur an unknown/repeated provider charge; canonical effects remain fenced. Restart a worker after lease expiry to reclaim abandoned work. Explicit reprocessing creates another interpretation and retains accepted identity/correction history.

SIGINT/SIGTERM stop CLI claims and allow up to ten seconds to drain; an unfinished job is recovered through its lease. Supervisor restarts should back off on storage/configuration errors. The remaining real-process crash/shutdown acceptance cases are tracked in implementation status.

Generated proposal requests reserve one call per key. Inspect `ontology.proposalStatus` before explicitly issuing another key after a failed/abandoned request. Never infer an approved candidate or accepted fact from a provider response alone.

## Backup and restore procedure

The operator exercise is implemented in `scripts/verify-restore.mjs`. It passed with PostgreSQL 18 client tools and two disposable instances: all 17 table content hashes matched; evidence, accepted contract reads, waiting identity state, restricted-role isolation and the migration ledger were verified. This exercise restores a stopped boundary, not an in-flight lease. Set `ONTAVE_PG_CLIENT_BIN` to your PostgreSQL client-tool directory when needed.

1. Stop ingesters and workers at a recorded application boundary. Record counts and hashes for evidence, versions, contracts, assertions, decisions and pending jobs using an authorized operator connection.
2. With an operator role able to read every scoped table, run `pg_dump --format=custom --file=ontave.dump` using a private libpq service/passfile. Do not put database passwords in command history. The dump is a consistent database snapshot; role definitions require separate operator handling. [PostgreSQL dump documentation](https://www.postgresql.org/docs/18/backup-dump.html).
3. Create a fresh disposable target database from `template0` and recreate the required owner/runtime roles. Restore only a trusted dump with `pg_restore --single-transaction --exit-on-error --dbname=target ontave.dump`. Reapply the exact package's migration grants and verify its plan is clean. [PostgreSQL restore documentation](https://www.postgresql.org/docs/18/app-pgrestore.html).
4. Compare the recorded scoped data and lineage. Test runtime RLS under the restored non-owner role, including missing and wrong workspace contexts. Test a contract read and inspect original evidence/retraction history.
5. Preserve waiting states. Let any abandoned processing lease expire; restart the appropriately scoped worker and verify its fencing behavior. Resume ingestion only after checks pass.

This is a database operator procedure. The package does not supply managed backups, a workspace export API or automatic rollback of accepted facts.
