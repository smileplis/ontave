import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod } from "node:fs/promises";
import { Pool } from "pg";
import { migrate, postgres } from "./postgres.js";
import { check, OntaveError } from "./core.js";
import { PreviewSession, type PreviewAction } from "./preview/session.js";
import { scenarios } from "./preview/scenarios.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const databaseVersion = "18.4.0-beta.17";
async function embedded(directory: string, install: boolean) {
  try {
    return await import(
      `@embedded-postgres/${process.platform}-${process.arch}`
    );
  } catch {}
  check(
    install,
    "MODEL_UNAVAILABLE",
    "The playground needs optional local PostgreSQL tooling. Run ontave playground --install to download it into an isolated temporary directory.",
  );
  const deps = resolve(directory, "tooling");
  await mkdir(deps, { mode: 0o700 });
  await writeFile(
    resolve(deps, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { "embedded-postgres": databaseVersion },
      overrides: {
        [`@embedded-postgres/${process.platform}-${process.arch}`]:
          databaseVersion,
      },
    }),
  );
  process.stdout.write("Preparing isolated PostgreSQL playground tooling…\n");
  const code = await new Promise<number | null>((res, rej) => {
    const child = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--loglevel=error",
      ],
      { cwd: deps, stdio: "ignore" },
    );
    child.once("error", rej);
    child.once("exit", res);
  });
  check(
    code === 0,
    "STORAGE_UNAVAILABLE",
    "Unable to install playground tooling. Check npm access, then retry; no existing database was changed.",
  );
  // The published native package stores symbolic links as metadata. Restore
  // them with its pinned helper, without enabling arbitrary npm lifecycle hooks.
  const nativeRoot = resolve(
    deps,
    "node_modules/@embedded-postgres",
    `${process.platform}-${process.arch}`,
  );
  const nativePackage = JSON.parse(
    await readFile(resolve(nativeRoot, "package.json"), "utf8"),
  );
  check(
    nativePackage.version === databaseVersion,
    "STORAGE_UNAVAILABLE",
    "Unexpected playground binary version",
  );
  const hydrated = await new Promise<number | null>((res, rej) => {
    const child = spawn(
      process.execPath,
      [resolve(nativeRoot, "scripts/hydrate-symlinks.js")],
      { cwd: nativeRoot, stdio: "ignore" },
    );
    child.once("error", rej);
    child.once("exit", res);
  });
  check(
    hydrated === 0,
    "STORAGE_UNAVAILABLE",
    "Unable to prepare the local PostgreSQL binary",
  );
  return await import(pathToFileURL(resolve(nativeRoot, "dist/index.js")).href);
}
/** Local-only, explicit developer tool. Core imports never start this server. */
export async function startPlayground(
  options: { port?: number; install?: boolean } = {},
) {
  check(
    process.versions.node.split(".")[0] === "24",
    "INVALID_INPUT",
    "The tested playground requires Node.js 24.",
  );
  const port = options.port ?? 4320;
  check(
    Number.isInteger(port) && port >= 0 && port <= 65535,
    "INVALID_INPUT",
    "Use a port from 0 to 65535",
  );
  const directory = await mkdtemp(resolve(tmpdir(), "ontave-playground-"));
  let database: ChildProcess | undefined,
    admin: Pool | undefined,
    session: PreviewSession | undefined,
    server: ReturnType<typeof createServer> | undefined,
    closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    if (session) await session.close().catch(() => {});
    if (admin) await admin.end().catch(() => {});
    if (
      database &&
      database.exitCode === null &&
      database.signalCode === null
    ) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => database?.kill("SIGKILL"), 5000);
        database!.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        database!.kill("SIGINT");
      });
    }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const binaries = await embedded(directory, options.install === true);
    const reservation = createServer();
    await new Promise<void>((res, rej) => {
      reservation.once("error", rej);
      reservation.listen(0, "127.0.0.1", () => res());
    });
    const databasePort = (reservation.address() as { port: number }).port;
    await new Promise<void>((r) => reservation.close(() => r()));
    const password = randomBytes(24).toString("hex");
    const passwordFile = resolve(directory, "password");
    await writeFile(passwordFile, password, { mode: 0o600 });
    const data = resolve(directory, "data");
    await chmod(binaries.initdb, 0o755);
    await chmod(binaries.postgres, 0o755);
    const initialized = await new Promise<number | null>((res, rej) => {
      const child = spawn(
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
      child.once("error", rej);
      child.once("exit", res);
    });
    await rm(passwordFile, { force: true });
    check(
      initialized === 0,
      "STORAGE_UNAVAILABLE",
      "Unable to initialize temporary PostgreSQL. Run the playground as a regular user on a supported macOS/Linux host.",
    );
    database = spawn(
      binaries.postgres,
      [
        "-D",
        data,
        "-p",
        String(databasePort),
        "-h",
        "127.0.0.1",
        "-k",
        directory,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, LC_MESSAGES: "C" },
      },
    );
    await new Promise<void>((res, rej) => {
      const timer = setTimeout(
        () =>
          rej(
            new OntaveError(
              "STORAGE_UNAVAILABLE",
              "Temporary PostgreSQL startup timed out",
            ),
          ),
        15000,
      );
      database!.once("error", (error) => {
        clearTimeout(timer);
        rej(error);
      });
      database!.once("exit", () => {
        clearTimeout(timer);
        rej(
          new OntaveError(
            "STORAGE_UNAVAILABLE",
            "Temporary PostgreSQL exited before it was ready",
          ),
        );
      });
      database!.stderr!.on("data", (chunk) => {
        if (
          String(chunk).includes(
            "database system is ready to accept connections",
          )
        ) {
          clearTimeout(timer);
          res();
        }
      });
    });
    admin = new Pool({
      connectionString: `postgresql://postgres:${password}@127.0.0.1:${databasePort}/postgres`,
    });
    admin.on("error", () => {});
    await admin.query(
      `CREATE ROLE ontave_preview LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`,
    );
    await migrate(admin, "ontave_preview");
    session = new PreviewSession(
      postgres({
        connectionString: `postgresql://ontave_preview:${password}@127.0.0.1:${databasePort}/postgres`,
      }),
    );
    await session.reset();
    const pkg = JSON.parse(
      await readFile(resolve(packageRoot, "package.json"), "utf8"),
    );
    const { standalone } = await import(
      pathToFileURL(resolve(packageRoot, "examples/playground/markup.mjs")).href
    );
    const cookie = randomBytes(24).toString("hex");
    let url = "",
      queue = Promise.resolve();
    server = createServer(async (req, res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
      const json = (status: number, value: unknown) => {
        res.writeHead(status, {
          "content-type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(value));
      };
      try {
        check(
          req.headers.host === new URL(url).host,
          "FORBIDDEN",
          "Unexpected playground host",
        );
        check(
          !req.headers.origin || req.headers.origin === url,
          "FORBIDDEN",
          "Playground requests must originate from its local page",
        );
        const path = new URL(req.url ?? "/", url).pathname;
        if (req.method === "GET" && path === "/") {
          res.setHeader(
            "Set-Cookie",
            `ontave_preview=${cookie}; HttpOnly; SameSite=Strict; Path=/`,
          );
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(standalone(pkg.version));
          return;
        }
        const assets: Record<string, [string, string]> = {
          "/playground.js": ["playground.js", "text/javascript"],
          "/playground.css": ["playground.css", "text/css"],
          "/playground-logo.svg": ["playground-logo.svg", "image/svg+xml"],
        };
        if (req.method === "GET" && assets[path]) {
          const [file, mime] = assets[path]!;
          res.writeHead(200, { "content-type": mime });
          res.end(
            await readFile(
              resolve(packageRoot, "examples/playground/web", file),
            ),
          );
          return;
        }
        check(
          (req.headers.cookie ?? "")
            .split(";")
            .some((c) => c.trim() === `ontave_preview=${cookie}`),
          "UNAUTHORIZED",
          "Open the local playground page first",
        );
        if (req.method === "GET" && path === "/api/state") {
          await queue;
          json(200, await session!.snapshot());
          return;
        }
        check(
          req.method === "POST" && ["/api/action", "/api/reset"].includes(path),
          "NOT_FOUND",
          "Unknown playground route",
        );
        check(
          req.headers["x-ontave-playground"] === "1" &&
            req.headers["content-type"]?.startsWith("application/json"),
          "FORBIDDEN",
          "Expected a local playground JSON action",
        );
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          check(
            Buffer.byteLength(body) <= 4096,
            "INVALID_INPUT",
            "Playground action is too large",
          );
        }
        let input: any;
        try {
          input = JSON.parse(body);
        } catch {
          throw new OntaveError("INVALID_INPUT", "Expected a JSON action");
        }
        check(
          input && typeof input === "object" && !Array.isArray(input),
          "INVALID_INPUT",
          "Expected an action object",
        );
        if (path === "/api/reset")
          check(
            Object.keys(input).length === 1 &&
              scenarios.some((s) => s.id === input.scenario),
            "INVALID_INPUT",
            "Select one of the fictional scenarios",
          );
        else
          check(
            Object.keys(input).length === 1 &&
              [
                "interpret",
                "evaluate",
                "activate",
                "accept",
                "reject",
              ].includes(input.action),
            "INVALID_INPUT",
            "Unsupported playground action",
          );
        const operation = queue.then(() =>
          path === "/api/reset"
            ? session!.reset(input.scenario)
            : session!.act(input.action as PreviewAction),
        );
        queue = operation.then(
          () => {},
          () => {},
        );
        json(200, await operation);
      } catch (error) {
        const e =
          error instanceof OntaveError
            ? error
            : new OntaveError(
                "OPERATION_FAILED",
                "Playground operation failed; reset the example or restart the local process",
              );
        json(
          e.code === "NOT_FOUND"
            ? 404
            : e.code === "UNAUTHORIZED"
              ? 401
              : e.code === "FORBIDDEN"
                ? 403
                : 400,
          { error: { code: e.code, message: e.message } },
        );
      }
    });
    await new Promise<void>((res, rej) => {
      server!.once("error", rej);
      server!.listen(port, "127.0.0.1", () => res());
    });
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const shutdown = () => void close().then(() => process.exit(0));
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.stdout.write(
      `Ontave playground: ${url}\nFictional examples · real SDK and PostgreSQL · no provider calls\nPress Ctrl+C to stop and remove the temporary database.\n`,
    );
    return { url, close };
  } catch (error) {
    await close();
    throw error instanceof OntaveError
      ? error
      : new OntaveError(
          "STORAGE_UNAVAILABLE",
          "Unable to start the isolated playground. Use Node.js 24 on a supported macOS/Linux host and check that the selected port is free.",
        );
  }
}
