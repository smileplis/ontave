import {
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
  chmod,
  readdir,
} from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { Pool } from "pg";
import { embedded } from "./playground.js";
import { migrate } from "./postgres.js";
import { check, OntaveError, parseUUID } from "./core.js";

export async function localIdentity(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "local.json");
  const entries = await readdir(directory);
  check(
    entries.includes("local.json") ||
      entries.every((entry) => entry === ".gitignore"),
    "INVALID_INPUT",
    "Choose a dedicated empty Ontave data directory, not an application source folder",
  );
  await writeFile(resolve(directory, ".gitignore"), "*\n!.gitignore\n", {
    flag: "wx",
    mode: 0o600,
  }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  try {
    const c = JSON.parse(await readFile(path, "utf8"));
    check(
      c.version === 1 &&
        typeof c.password === "string" &&
        /^[a-f0-9]{48}$/.test(c.password) &&
        typeof c.workspaceId === "string" &&
        typeof c.cursorSecret === "string" &&
        /^[a-f0-9]{64}$/.test(c.cursorSecret),
      "INVALID_INPUT",
      "Invalid local configuration",
    );
    parseUUID(c.workspaceId);
    return c as {
      version: number;
      password: string;
      workspaceId: string;
      cursorSecret: string;
    };
  } catch (error) {
    if (!(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ))
      throw error;
  }
  const c = {
    version: 1,
    password: randomBytes(24).toString("hex"),
    workspaceId: randomUUID(),
    cursorSecret: randomBytes(32).toString("hex"),
  };
  await writeFile(path, JSON.stringify(c, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  return c;
}
/** Explicit local provisioning, persistent on disk. Never runs on core import. */
export async function startLocalDatabase(directory: string, install: boolean) {
  check(
    process.versions.node.split(".")[0] === "24",
    "INVALID_INPUT",
    "Local PostgreSQL setup requires Node.js 24",
  );
  const identity = await localIdentity(directory),
    lock = resolve(directory, "session.lock"),
    nonce = randomUUID();
  try {
    const old = JSON.parse(await readFile(lock, "utf8"));
    let alive = true;
    try {
      process.kill(old.pid, 0);
    } catch {
      alive = false;
    }
    check(
      !alive,
      "OPERATION_IN_PROGRESS",
      "This Ontave directory is already open in another process",
    );
    await rm(lock);
  } catch (e) {
    if (e instanceof OntaveError) throw e;
    if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT"))
      throw e;
  }
  await writeFile(lock, JSON.stringify({ pid: process.pid, nonce }), {
    flag: "wx",
    mode: 0o600,
  });
  let database: ChildProcess | undefined,
    admin: Pool | undefined,
    closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await admin?.end().catch(() => {});
    if (database && database.exitCode === null && database.signalCode === null)
      await new Promise<void>((ok) => {
        const timer = setTimeout(() => database?.kill("SIGKILL"), 5000);
        database!.once("exit", () => {
          clearTimeout(timer);
          ok();
        });
        database!.kill("SIGINT");
      });
    const existing = await readFile(lock, "utf8").catch(() => "");
    if (existing && JSON.parse(existing).nonce === nonce)
      await rm(lock, { force: true });
  };
  try {
    const binaries = await embedded(directory, install, "local"),
      data = resolve(directory, "pgdata");
    await chmod(binaries.initdb, 0o755);
    await chmod(binaries.postgres, 0o755);
    const exists = await access(resolve(data, "PG_VERSION")).then(
      () => true,
      () => false,
    );
    if (!exists) {
      const passwordFile = resolve(directory, "init-password");
      await writeFile(passwordFile, identity.password, {
        flag: "wx",
        mode: 0o600,
      });
      let code;
      try {
        code = await new Promise<number | null>((ok, fail) => {
          const p = spawn(
            binaries.initdb,
            [
              "-D",
              data,
              "-U",
              "postgres",
              "--pwfile",
              passwordFile,
              "--auth-host=scram-sha-256",
              "--auth-local=trust",
              "--locale=C",
              "--encoding=UTF8",
            ],
            { stdio: "ignore" },
          );
          p.once("error", fail);
          p.once("exit", ok);
        });
      } finally {
        await rm(passwordFile, { force: true });
      }
      check(
        code === 0,
        "STORAGE_UNAVAILABLE",
        "Unable to initialize local PostgreSQL; run as a regular macOS/Linux user",
      );
    }
    const reservation = createServer();
    await new Promise<void>((ok, fail) => {
      reservation.once("error", fail);
      reservation.listen(0, "127.0.0.1", ok);
    });
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((ok) => reservation.close(() => ok()));
    database = spawn(
      binaries.postgres,
      ["-D", data, "-p", String(port), "-h", "127.0.0.1", "-k", ""],
      {
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, LC_MESSAGES: "C" },
      },
    );
    await new Promise<void>((ok, fail) => {
      let settled = false;
      const finish = (e?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        e ? fail(e) : ok();
      };
      const timer = setTimeout(
        () =>
          finish(
            new OntaveError(
              "STORAGE_UNAVAILABLE",
              "Local PostgreSQL startup timed out",
            ),
          ),
        15000,
      );
      database!.once("error", () =>
        finish(
          new OntaveError(
            "STORAGE_UNAVAILABLE",
            "Unable to start local PostgreSQL",
          ),
        ),
      );
      database!.once("exit", () =>
        finish(
          new OntaveError(
            "STORAGE_UNAVAILABLE",
            "Local PostgreSQL exited before readiness",
          ),
        ),
      );
      database!.stderr!.on("data", (chunk) => {
        if (
          String(chunk).includes(
            "database system is ready to accept connections",
          )
        )
          finish();
      });
    });
    admin = new Pool({
      connectionString: `postgresql://postgres:${identity.password}@127.0.0.1:${port}/postgres`,
    });
    admin.on("error", () => {});
    if (
      !(
        await admin.query("SELECT 1 FROM pg_roles WHERE rolname='ontave_local'")
      ).rowCount
    )
      await admin.query(
        `CREATE ROLE ontave_local LOGIN PASSWORD '${identity.password}' NOSUPERUSER NOBYPASSRLS`,
      );
    await migrate(admin, "ontave_local");
    return {
      connectionString: `postgresql://ontave_local:${identity.password}@127.0.0.1:${port}/postgres`,
      workspaceId: identity.workspaceId,
      cursorSecret: identity.cursorSecret,
      directory,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
