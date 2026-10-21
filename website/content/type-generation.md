## Generate from a real registered contract

```ts
import { generateContract } from "ontave";

const lock = await ontave.contracts.pull(context, contract.id);
await generateContract(lock, "./generated/ontave");
```

Generation verifies the contract definition/hash and source ontology lineage. The explicit directory contains:

| File                         | Purpose                      |
| ---------------------------- | ---------------------------- |
| `contract.json`              | Pinned interface and lineage |
| `index.d.ts` / `index.d.mts` | TypeScript declarations      |
| `index.mjs`                  | Executable contract metadata |
| `validator.mjs`              | Runtime record validation    |

## Keep runtime validation

TypeScript declarations describe expected records at compile time. Use the generated validator to validate runtime data and full field envelopes, including uncertainty, verification and provenance IDs.

Generation is not a migration or an automatic upgrade of application code. Re-register and regenerate deliberately when adopting a new interface.

## Safe output paths

Stable IDs are validated before becoming generated identifiers. Generation uses an explicit output directory and rejects symlinks and incomplete source lineage. Older development contracts with missing lineage must be re-registered; the generator does not invent an approved origin.
