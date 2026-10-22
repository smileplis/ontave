import { createOntave } from "../../dist/index.js";
import { postgres } from "../../dist/postgres.js";
import { personFixture } from "../../dist/testing.js";
const app = createOntave({
  storage: postgres({ connectionString: process.env.ONTAVE_TEST_DATABASE }),
  authorize: () => ({
    actorId: "process-test",
    workspaceId: process.env.ONTAVE_TEST_WORKSPACE,
    capabilities: ["worker"],
  }),
  limits: { leaseMs: 300 },
  model: {
    async extract(task) {
      process.send?.({ event: "inference-started" });
      if (process.env.ONTAVE_TEST_MODE === "hang") await new Promise(() => {});
      return {
        output: personFixture(task.text),
        model: "process-fixture",
        usage: { totalTokens: 0 },
      };
    },
  },
});
try {
  const result = await app.worker.runOnce(null);
  // The transaction is committed, but the parent never receives an acknowledgement.
  if (process.env.ONTAVE_TEST_MODE === "kill-after-result")
    process.kill(process.pid, "SIGKILL");
  process.send?.({ event: "result", result });
} finally {
  await app.close();
}
