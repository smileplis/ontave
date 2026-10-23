import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Ontave } from "./runtime.js";
import { check, OntaveError } from "./core.js";
import { studioHtml, studioCss, studioJs } from "./studio-assets.js";
export async function startStudio(options: {
  runtime: Ontave;
  context: unknown;
  port?: number;
  process?: () => Promise<unknown>;
}) {
  const port = options.port ?? 4320;
  check(
    Number.isInteger(port) && port >= 0 && port <= 65535,
    "INVALID_INPUT",
    "Invalid Studio port",
  );
  const token = randomBytes(32).toString("hex");
  let origin = "",
    queue = Promise.resolve();
  const server = createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      check(
        req.headers.host === new URL(origin).host,
        "FORBIDDEN",
        "Unexpected Studio host",
      );
      check(
        !req.headers.origin || req.headers.origin === origin,
        "FORBIDDEN",
        "Studio requires its local origin",
      );
      const url = new URL(req.url ?? "/", origin);
      if (req.method === "GET" && url.pathname === "/") {
        res.setHeader(
          "set-cookie",
          `ontave_studio=${token}; HttpOnly; SameSite=Strict; Path=/`,
        );
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(studioHtml);
        return;
      }
      if (
        req.method === "GET" &&
        ["/studio.js", "/studio.css"].includes(url.pathname)
      ) {
        res.writeHead(200, {
          "content-type": url.pathname.endsWith(".js")
            ? "text/javascript"
            : "text/css",
        });
        res.end(url.pathname.endsWith(".js") ? studioJs : studioCss);
        return;
      }
      check(
        (req.headers.cookie ?? "")
          .split(";")
          .some((c) => c.trim() === `ontave_studio=${token}`),
        "UNAUTHORIZED",
        "Open the local Studio first",
      );
      const { runtime, context } = options;
      if (req.method === "GET") {
        await queue;
        if (url.pathname === "/api/jobs")
          return send(200, await runtime.jobs.list(context));
        if (url.pathname === "/api/catalog")
          return send(200, await runtime.ontology.inspect(context));
        if (url.pathname === "/api/review")
          return send(
            200,
            await runtime.reviews.forJob(
              context,
              z.uuid().parse(url.searchParams.get("job")),
            ),
          );
        if (url.pathname === "/api/evidence")
          return send(
            200,
            await runtime.evidence.get(
              context,
              z.uuid().parse(url.searchParams.get("id")),
              {
                startByte: z.coerce
                  .number()
                  .int()
                  .min(0)
                  .parse(url.searchParams.get("start")),
              },
            ),
          );
        throw new OntaveError("NOT_FOUND", "Unknown Studio route");
      }
      check(
        req.method === "POST" &&
          req.headers.origin === origin &&
          req.headers["x-ontave-studio"] === "1" &&
          req.headers["sec-fetch-site"] !== "cross-site",
        "FORBIDDEN",
        "Expected a same-origin Studio action",
      );
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        check(
          size <= 524288,
          "PAYLOAD_TOO_LARGE",
          "Studio request exceeds 512 KiB",
        );
        chunks.push(chunk);
      }
      let input;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new OntaveError("INVALID_INPUT", "Expected JSON");
      }
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((ok) => {
        release = ok;
      });
      await previous;
      try {
        const decision = z.object({
          bundleId: z.uuid(),
          digest: z.string().regex(/^[a-f0-9]{64}$/),
          requestKey: z.uuid(),
        });
        if (url.pathname === "/api/ingest") {
          const x = z
            .object({
              source: z.string().min(1).max(200),
              id: z.string().min(1).max(200),
              text: z.string().min(1),
            })
            .strict()
            .parse(input);
          return send(
            200,
            await runtime.ingest(context, {
              source: x.source,
              idempotencyKey: x.id,
              payload: { kind: "text", text: x.text },
            }),
          );
        }
        if (url.pathname === "/api/process") {
          z.object({}).strict().parse(input);
          return send(
            200,
            await (options.process?.() ?? runtime.worker.runOnce(context)),
          );
        }
        if (url.pathname === "/api/accept" || url.pathname === "/api/reject") {
          const x = decision.strict().parse(input);
          return send(
            200,
            await runtime.reviews[
              url.pathname.endsWith("accept") ? "accept" : "reject"
            ](context, {
              ...x,
              reason:
                "Explicit local developer decision on the displayed source and exact proposal",
            }),
          );
        }
        if (url.pathname === "/api/amend") {
          const x = decision
            .extend({ extraction: z.unknown() })
            .strict()
            .parse(input);
          return send(
            200,
            await runtime.reviews.amend(context, {
              ...x,
              extraction: x.extraction as any,
              reason: "Local developer saved source-checked corrections",
            }),
          );
        }
        if (url.pathname === "/api/identity") {
          const x = decision
            .extend({
              mentionId: z.string(),
              entityId: z.union([z.uuid(), z.literal("new")]),
            })
            .strict()
            .parse(input);
          return send(
            200,
            await runtime.reviews.resolveIdentity(context, {
              ...x,
              reason: "Local developer explicitly selected an identity",
            }),
          );
        }
        throw new OntaveError("NOT_FOUND", "Unknown Studio action");
      } finally {
        release();
      }
    } catch (error) {
      send(
        error instanceof OntaveError && error.code === "NOT_FOUND"
          ? 404
          : error instanceof OntaveError &&
              ["UNAUTHORIZED", "FORBIDDEN"].includes(error.code)
            ? 403
            : 400,
        {
          error: error instanceof OntaveError ? error.code : "INVALID_INPUT",
          message:
            error instanceof OntaveError
              ? error.message
              : "Invalid Studio input",
        },
      );
    }
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", ok);
  });
  origin = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  return {
    url: origin,
    close: async () => {
      await queue;
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}
