import type { ModelAdapter, ModelTask, Extraction } from "./types.js";
import { check } from "./core.js";
export function fixtureAdapter(
  handler: (task: ModelTask) => Extraction | Promise<Extraction>,
): ModelAdapter {
  return {
    async extract(task) {
      check(
        !task.signal.aborted,
        "MODEL_UNAVAILABLE",
        "Fixture task was aborted",
      );
      return {
        output: structuredClone(await handler(task)),
        model: "ontave:deterministic-fixture",
      };
    },
  };
}
export const personFixture = (name: string, quote = name): Extraction => ({
  entities: [
    {
      mentionId: "person_1",
      conceptId: "person",
      name,
      fields: { name: { value: name, quote } },
    },
  ],
  relationships: [],
  observations: [],
});
