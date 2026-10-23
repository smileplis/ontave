import "server-only";
import { createOntave, OntaveError, type Ontave } from "ontave";
import { postgres } from "ontave/postgres";
import { fixtureAdapter, personFixture } from "ontave/testing";
import { gemini } from "ontave/models/gemini";
import { localOwner } from "./session";
let instance: Ontave | undefined;
export function getRuntime(): Ontave {
  if (instance) return instance;
  if (!process.env.ONTAVE_WORKSPACE_ID || !process.env.ONTAVE_DATABASE_URL)
    throw new OntaveError(
      "INVALID_INPUT",
      "Configure dedicated server resources",
    );
  const model =
    process.env.ONTAVE_DEMO_MODE === "fixture"
      ? fixtureAdapter((task) => personFixture(task.text))
      : process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL
        ? gemini({
            apiKey: process.env.GEMINI_API_KEY,
            model: process.env.GEMINI_MODEL,
          })
        : undefined;
  instance = createOntave({
    storage: postgres({ connectionString: process.env.ONTAVE_DATABASE_URL }),
    model,
    cursorSecret: process.env.ONTAVE_CURSOR_SECRET,
    authorize: (credential) => {
      if (credential !== localOwner)
        throw new OntaveError("UNAUTHORIZED", "Invalid server session");
      return {
        actorId: "local-demo-owner",
        workspaceId: process.env.ONTAVE_WORKSPACE_ID,
        capabilities: ["read", "ingest"],
      };
    },
  });
  return instance;
}
