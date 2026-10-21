## Operator-owned recovery

Ontave stores evidence, accepted state, model versions, contracts and decision lineage in PostgreSQL. Backup and restoration are database-operator procedures, not an SDK export or automatic rollback feature.

A stopped-boundary exercise has passed across two disposable instances: all 17 table hashes matched, and evidence, accepted reads, waiting identity, restricted-role isolation and the migration ledger were verified. In-flight lease restoration remains a separate fault scenario. Use PostgreSQL client tools matching the supported server and practice against disposable databases before relying on an operational runbook.

## Record a consistency boundary

Stop ingesters and workers at a recorded application boundary. Using an authorized operator connection, record counts and hashes for evidence, versions, contracts, assertions, decisions and pending jobs. Note waiting states and any leases.

## Dump and restore

Use private libpq service/passfile configuration rather than passwords in command-line arguments.

```sh
pg_dump --format=custom --file=ontave.dump service=ontave_source
pg_restore --single-transaction --exit-on-error   --dbname=service=ontave_restore ontave.dump
```

Create a fresh target from `template0` and recreate owner/runtime roles separately. A dump does not automatically transfer global roles. Restore only a trusted dump: restoring a database can execute code supplied by its source.

## Verify before resuming

Apply the exact package's migration grants and confirm a clean plan. Compare scoped evidence and assertion/decision lineage, inspect a pinned contract read and test runtime RLS under the non-owner role.

Preserve waiting review/ontology/identity states. Let abandoned leases expire, then restart an appropriately scoped worker and verify fencing before resuming ingestion.

See the official [PostgreSQL dump documentation](https://www.postgresql.org/docs/18/backup-dump.html) and [pg_restore reference](https://www.postgresql.org/docs/18/app-pgrestore.html).
