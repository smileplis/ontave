## Try before integrating

The [browser sandbox](/playground/) needs no setup. The [local playground](/docs/quickstart/) prepares a real temporary PostgreSQL database with one explicit command. Use that first to explore the complete model and fact review flow.

## Supported baseline

| Component  | Tested baseline                         |
| ---------- | --------------------------------------- |
| Node.js    | 24 LTS; local verification uses 24.22.0 |
| PostgreSQL | 18; local disposable tests use 18.4     |
| TypeScript | 7.0.2 declarations and consumer checks  |
| Modules    | ESM                                     |
| Runtime    | Trusted server process                  |

Other Node, database, edge and browser combinations are not yet part of the verified support matrix.

## Install from npm

In your application directory:

```sh
npm install ontave
npx ontave version
npx ontave help
```

The current public npm release is **`0.1.0-alpha.6`**. It is a developer preview. To select that exact version, use `npm install ontave@0.1.0-alpha.6`.

The package includes ESM runtime code, TypeScript declarations, CLI entry points and internal PostgreSQL migrations. Installing it does not provision a database or contact a model. Keep all database and model credentials on the server.

## Persistent local setup

```sh
npx ontave dev --install
```

This explicitly prepares local PostgreSQL, private workspace credentials and a ready review Studio. Ctrl+C stops the process and retains the data in `.ontave`. Configure a private `GEMINI_API_KEY` and explicit `GEMINI_MODEL` in the server environment to process your own messages; inference uses your provider account. No model is called on import. The Studio is a loopback developer tool, not a publicly authenticated hosted service.

The [`openOntave` API](https://github.com/smileplis/ontave/blob/v0.1.0-alpha.6/docs/LOCAL_AND_HOSTED.md) provides the same setup from TypeScript.

## Build the published release from source

```sh
git clone --branch v0.1.0-alpha.6 https://github.com/smileplis/ontave.git
cd ontave
npm ci
npm run build
npm pack --pack-destination artifacts
```

Install the resulting archive in your application:

```sh
npm install ../ontave/artifacts/ontave-0.1.0-alpha.6.tgz
npx ontave help
```

The package itself has no install hook. Repository development dependencies include a local Node binary and a disposable PostgreSQL binary; your package-manager policy may require allowing their installation scripts.

## Explicit entry points

```ts
import { createOntave, starter, generateContract } from "ontave";
import { postgres, migrate, migrationPlan } from "ontave/postgres";
import { gemini } from "ontave/models/gemini";
import { groq } from "ontave/models/groq";
import { fixtureAdapter } from "ontave/testing";
```

Core imports do not start a worker, read provider keys, apply migrations, install playground tooling or contact a model. Select and configure those operations explicitly.

## Next steps

Prepare a [dedicated database](/docs/database/) and follow the [first-record flow](/docs/quickstart/). Keep all database and provider credentials on the server.
