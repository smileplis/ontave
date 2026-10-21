## Stable IDs, explicit types

```ts
const inspection = {
  concepts: [
    {
      id: "roof_inspection",
      name: "RoofInspection",
      description: "An inspection before panel installation",
      fields: [
        {
          id: "reference",
          name: "Reference",
          description: "Explicit inspection reference from the source",
          type: "text",
        },
      ],
    },
  ],
  relations: [],
};
```

Concept, field and relation IDs begin with a lowercase letter and contain lowercase letters, digits or underscores, up to 64 characters. Names are display labels; IDs are the stable interface.

## Scalar dialect

| Type        | Representation                                                   |
| ----------- | ---------------------------------------------------------------- |
| `text`      | String                                                           |
| `integer`   | Safe integer                                                     |
| `decimal`   | Decimal string, normalized without floating point                |
| `money`     | `{ amount: "50000", currency: "INR" }`                           |
| `boolean`   | Boolean                                                          |
| `date`      | Valid calendar date                                              |
| `timestamp` | Offset-aware timestamp with seconds, up to six fractional digits |
| `enum`      | One of the declared string values                                |

`optional` controls whether a field may be missing. `nullable` separately permits a value of null. Timestamps support years 1–9999. Timestamp equality currently uses the preserved typed string representation.

## Relationships

A relationship declares a stable ID, name, source concept and target concept. Set `max: 1` for the supported single-target constraint. Read inclusion is bounded to one hop.

## Additions and compatibility

The alpha supports new concepts, optional additions to existing concepts and relationships. Renames, changed meanings/types, required field additions on existing concepts and destructive changes are rejected. It does not emit business-table DDL.
