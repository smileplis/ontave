# Start with Ontave

Ontave `0.1.0-alpha.5` is a developer preview for Node.js 24 servers. The alpha's open quality gates are recorded in [release status](https://github.com/smileplis/ontave/blob/v0.1.0-alpha.5/docs/RELEASE_STATUS.json).

## Install the framework

In your application's directory:

```sh
npm install ontave
npx ontave version
npx ontave help
```

The package includes the TypeScript declarations, ESM runtime, CLI and internal PostgreSQL migrations. Installing or importing core does not provision a database, request provider credentials or call a model. Use `.mjs` files, or configure your TypeScript application for ESM.

## Run the interactive example

With Node.js 24 on macOS or Linux:

```sh
npx --yes ontave@0.1.0-alpha.5 playground --install
```

Open the localhost URL printed by the command. It creates a temporary PostgreSQL instance and restricted role, then uses the actual SDK to exercise source preservation, model evaluation, identity decisions, fact review and accepted-data queries. `--install` explicitly permits downloading optional local tooling. No Docker or model key is needed. Ctrl+C stops the server and removes the temporary database.

Try the roof-inspection and payment-claim examples. Inspect the source, evaluate and approve the proposed model, confirm the displayed identity links, accept the facts and inspect the accepted record. Reset and decline a proposal to see that it produces no accepted record. The payment remains reported.

This playground uses fictional fixture responses. Its setup and governance flow do not establish arbitrary-message extraction accuracy.

## Simplified local setup in alpha.5

Alpha.5 adds `ontave dev --install`, persistent local PostgreSQL, `openOntave` and a ready review Studio. See [local setup](LOCAL_AND_HOSTED.md) for the few-line example, private provider configuration and bring-your-own-database option. The setup below remains available for shared authenticated applications.

## Connect an application

Use a dedicated PostgreSQL 18 database with separate migration and restricted runtime roles. Follow the [operator setup](OPERATOR_RUNBOOK.md). Generate a trusted local CLI configuration with:

```sh
npx ontave init --output ./ontave.config.mjs
```

The generated config names the required environment variables. Supply private connection references, a workspace UUID, local credential and an explicit Gemini key/model when using that adapter. Configure your own host authentication for an application. A model is unnecessary for pure accepted-data reads; selecting a missing model configuration returns an actionable error with no fixture fallback.

Run migration planning before applying internal migrations. Provision the workspace explicitly, register a contract and run a workspace-authorized worker. The [API reference](API_REFERENCE.md) describes the exact CLI and SDK inputs. The [Node example](../examples/node/demo.mjs) runs the full lifecycle on a migrated database with an explicitly fictional adapter. The [Next.js server example](../examples/next-server/README.md) keeps database access and model keys on the server.

## Evaluate the preview

Check output against your own reviewed source examples, including conflicting information and ambiguous identities. Strict mode requires explicit review. Alpha.5 can adopt eligible additions and reported facts under an explicit host policy; exceptions remain pending. Accepting an interpretation does not verify the underlying business event. Keep provider/model settings, expected answers and trial results so errors can be reproduced. Review [quality results and limits](QUALITY_REPORT.md) before choosing a workload.
