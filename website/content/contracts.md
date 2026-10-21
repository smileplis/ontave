## Pin the interface your application uses

```ts
const contract = await ontave.contracts.register(context, selectedDefinition);
```

Registration checks that the selected definition is a projection of approved concepts, fields and relationships. The returned contract includes its ID, exact definition hash and source ontology lineage.

A contract fixes interface shape and meaning. Queries through it read **current accepted data**, not records frozen at registration time.

## Adoption is explicit

If the model adds RoofInspection, a deployed application using its earlier Person contract does not silently acquire new fields or static types. Register and generate a new selected contract when that application is ready to adopt the addition.

Additive model candidates must remain compatible with registered contracts. Destructive type or meaning changes are rejected within the current alpha boundary.

## Use exact hashes

```ts
const page = await ontave.entities.find(context, {
  contractId: contract.id,
  contractHash: contract.hash,
  conceptId: "person",
  limit: 25,
});
```

An unavailable, mismatched or incompatible contract fails explicitly. The runtime also validates returned field envelopes and types against the selected definition.

## Pull and generate

```ts
const lock = await ontave.contracts.pull(context, contract.id);
await generateContract(lock, "./generated/ontave");
```

See [generated types](/docs/type-generation/) for files and generation safety. Source ontology lineage lets consumers trace which approved model supplied the interface.
