# Read-only TypeScript agent example

Companion to https://ontave.daltn.tech/index/build-ai-agent-typescript/.

Node.js 24, ESM. Install pinned dependencies with `npm ci`, then run `npm run check` and `npm test` for offline tool checks. These checks do not test live model behavior.

For an optional live model call, configure `AI_GATEWAY_API_KEY` and `AI_GATEWAY_MODEL` privately on your server, selecting a model available in your AI Gateway account. `npm start` uses those credentials and can incur provider charges. No credentials are included here. Core test imports make no network calls.

The records are fictional and confined to one in-memory workspace. There is no record-writing tool, authentication server, production database or Ontave integration in this small example. The guide explains how to replace the lookup boundary with a host-authorized accepted-data query when appropriate.
