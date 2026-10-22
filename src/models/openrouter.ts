import { chatAdapter } from "./chat.js";
import type { ChatConfig } from "./chat.js";
/** Experimental bounded adapter; select a model explicitly. */
export const openrouter = (config: ChatConfig) =>
  chatAdapter("openrouter", config);
