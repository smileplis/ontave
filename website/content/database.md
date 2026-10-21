## Separate owner and runtime access

Use a dedicated PostgreSQL 18 database. Migrations need an authorized owner/operator connection; application queries use a different non-owner login without superuser or BYPASSRLS privileges.

For a local development database, an administrator can create the runtime role interactively:

```sql
CREATE ROLE ontave_runtime LOGIN NOSUPERUSER NOBYPASSRLS;
\password ontave_runtime
```

Use your database operator's credential workflow for managed PostgreSQL. Keep passwords in private environment or libpq configuration rather than command history. Do not reuse an unrelated application database.

## Apply explicit internal migrations

```js
import { Pool } from "pg";
import { migrate, migrationPlan } from "ontave/postgres";

const admin = new Pool({
  connectionString: process.env.ONTAVE_MIGRATION_DATABASE_URL,
});
try {
  console.log(await migrationPlan(admin));
  await migrate(admin, "ontave_runtime");
} finally {
  await admin.end();
}
```

Run this on the intended dedicated database as an explicit operator step. Runtime construction never runs migrations automatically.

## Ledger and grants

Migrations use an advisory transaction lock and verify applied checksums before running pending SQL. Pending internal DDL and ledger changes commit together. A checksum mismatch requires investigation against the exact installed artifact; do not edit the ledger to conceal it.

The migration grants the selected runtime role the required scoped operations. Immutable evidence and history cannot be rewritten through the runtime role. Row-level security is forced on workspace tables, with workspace-aware foreign keys.

## Provision explicitly

Migrations do not create a global business workspace or seed. Call `workspaces.create` with trusted provisioning capability and choose `empty` or `people`. Register an explicit application contract before querying records.
