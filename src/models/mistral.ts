import { chatAdapter } from "./chat.js";
import type { ChatConfig } from "./chat.js";
/** Experimental bounded adapter; select a model explicitly. */
export const mistral = (config: ChatConfig) => chatAdapter("mistral", config);
