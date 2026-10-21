export { createOntave, Ontave } from "./runtime.js";
export type { OntaveConfig } from "./runtime.js";
export {
  OntaveError,
  sourceSpan,
  hash,
  json,
  definition,
  extend,
  compatible,
  validateValue,
  starter,
} from "./core.js";
export type * from "./types.js";
export { generateContract, validateContractRecords } from "./codegen.js";
