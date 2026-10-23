export { createOntave, Ontave } from "./runtime.js";
export type { OntaveConfig } from "./runtime.js";
export type { AutomationPolicy } from "./policy.js";
export { additivePolicy } from "./policy.js";
export { advanceAutomatically } from "./automation.js";
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
