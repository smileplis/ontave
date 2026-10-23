// Explicit fictional example. Actual SDK, persistent local PostgreSQL, no paid model calls.
import { openOntave } from "ontave/local";
import { fixtureAdapter, personFixture } from "ontave/testing";
const app = await openOntave({
  install: true,
  model: fixtureAdapter(() => personFixture("Rahul")),
});
await app.ingest({ id: "local-fictional-rahul", text: "Rahul" });
await app.process();
console.log(
  "Fictional fixture mode. Source and review use the real local SDK.",
);
console.log((await app.studio()).url);
const stop = async () => {
  await app.close();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
