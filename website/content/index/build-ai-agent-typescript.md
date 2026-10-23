An AI agent needs a model, a small set of tools and a loop that decides when to stop. A useful first agent should do one bounded job before it gets permission to change business state.

This guide builds a **read-only installation assistant in TypeScript**. It can look up a fictional record by its exact ID and explain the result. It cannot send messages, alter a payment or invent an installation. Ontave is optional for this first example. Later, it can provide a reviewed source of operational records when incoming information needs more than a fixed schema.

## 1. Choose one observable task

Start with a question you can score: “What is the status of installation I-101, and is its payment verified?”

The expected record says `awaiting inspection`, with payment marked `reported`. A successful answer preserves both distinctions. A fluent answer that says “payment confirmed” fails, even if the lookup succeeded.

Use a deterministic workflow when the sequence is already known. Let a model choose tools only when that flexibility helps the task.

## 2. Install the small example

Use **Node.js 24** and an ESM project. The [complete example on GitHub](https://github.com/smileplis/ontave/tree/main/website/examples/read-only-agent) contains `agent.ts`, `package.json` and offline tests. It pins AI SDK `7.0.150` and Zod `4.6.7`.

```sh
npm ci
npm run check
npm test
```

Those commands apply inside the example directory. The type check and tests make no provider calls. To make a live call later, configure `AI_GATEWAY_API_KEY` and `AI_GATEWAY_MODEL` privately on your server, selecting an available model in your AI Gateway account. Live calls can incur provider charges. Follow the [AI Gateway configuration guide](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway) for account and model setup.

## 3. Implement a constrained lookup tool

AI SDK's agent abstraction runs the model and tool loop. This example supplies an exact-ID lookup, an explicit step limit and a deadline. The underlying records are fictional, in memory and restricted to one workspace.

<!-- include:read-only-agent -->

Run `npm start` only after configuring the model and credentials. A suitable answer identifies the inspection stage and says payment is reported, not independently verified. Exact wording depends on the selected model.

The input schema rejects malformed IDs. It is not authentication. In a real service, authenticate the caller and scope the lookup on the server before returning a record. A model-provided workspace ID must not grant access to another tenant.

## 4. Test tools and model behavior separately

The example tests cover known and absent records, malformed tool input and the reported payment state. They establish deterministic tool behavior, not whether a live model will use it correctly.

Then test the complete agent with a reviewed set of prompts. Include a missing installation, a request to confirm an unverified payment, an instruction embedded in a tool result and an attempt to obtain another workspace's data. Record the selected model, prompt, tool arguments, final answer, latency and available usage.

The four-step limit bounds iterations. It does not guarantee the agent will answer within four steps or enforce a monetary spending cap. The deadline bounds waiting; production tools still need their own cancellation and resource limits.

## 5. Add Ontave when the data needs review

A fixed installation record can live in an ordinary database. Consider Ontave when messages and documents introduce new facts, uncertain identities or unfamiliar concepts that need source lineage and approval.

In that design, Ontave preserves evidence and stages interpretations before facts are accepted. The lookup tool can call a host-authorized, [typed accepted-data query](/docs/queries/) instead of reading the fictional map. Model activation and fact acceptance remain separate from the agent's tool loop.

Ontave is a developer preview, not an agent runtime or a turnkey production system. Start with its [local playground](/docs/quickstart/) and [release limits](/docs/status/), then evaluate it against your own source examples.

## Continue building

Read the [agent framework comparison](/index/best-ai-agent-frameworks/) before adding orchestration complexity, and the [agent evaluation checklist](/index/evaluating-ai-agents/) before giving the assistant write tools. The example follows the current [AI SDK agent API](https://ai-sdk.dev/docs/agents/building-agents) and [loop controls](https://ai-sdk.dev/docs/agents/loop-control), checked on October 23, 2026.
