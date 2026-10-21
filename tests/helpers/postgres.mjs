import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { mkdtemp, mkdir, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { migrate, postgres } from "../../dist/postgres.js";
export async function disposablePostgres() {
  await mkdir(resolve("artifacts"), { recursive: true });
  const dir = await mkdtemp(resolve("artifacts/pg-"));
  const port = await new Promise((res, rej) => {
    const server = net.createServer();
    server.on("error", rej);
    server.listen(0, "127.0.0.1", () => {
      const p = server.address().port;
      server.close(() => res(p));
    });
  });
  const password = randomBytes(20).toString("hex");
  const logs = [];
  const pg = new EmbeddedPostgres({
    databaseDir: dir + "/data",
    user: "postgres",
    password,
    port,
    persistent: false,
    initdbFlags: ["--locale=C", "--encoding=UTF8"],
    postgresFlags: ["-k", dir],
    onLog: (m) => logs.push(String(m)),
    onError: (m) => logs.push(String(m)),
  });
  try {
    await pg.initialise();
    await pg.start();
  } catch (e) {
    await appendFile(dir + "/startup.log", logs.join("\n"));
    throw e;
  }
  const admin = new Pool({
    connectionString: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
  });
  await admin.query(
    `CREATE ROLE ontave_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`,
  );
  await migrate(admin, "ontave_runtime");
  const connectionString = `postgresql://ontave_runtime:${password}@127.0.0.1:${port}/postgres`;
  return {
    admin,
    storage: postgres({ connectionString }),
    connectionString,
    port,
    async stop() {
      await admin.end();
      await pg.stop();
    },
  };
}
