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

## Install the developer preview

```sh
npm install https://github.com/smileplis/ontave/releases/download/v0.1.0-alpha.2/ontave-0.1.0-alpha.2.tgz
```

The versioned GitHub developer-preview release includes the tested npm-format archive. It can be installed by npm without a registry publication.

## Build from source

The registry package name is reserved here as a working name. There is no public npm registry release to install yet. Build a tarball from the repository:

```sh
git clone https://github.com/smileplis/ontave.git
cd ontave
npm ci
npm run build
npm pack --pack-destination artifacts
```

Install the resulting tarball in your application:

```sh
npm install ../ontave/artifacts/ontave-0.1.0-alpha.2.tgz
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
