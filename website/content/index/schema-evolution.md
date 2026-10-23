A stable application contract and a changing business model can coexist. The key is to make model changes explicit, evaluate them and keep adoption under the application's control.

Ontave treats an unfamiliar concept as a proposed change to a logical model. It does not silently rewrite application tables or generate a new product interface.

## From installation to inspection

Imagine a service that already tracks people and installations. An incoming message introduces a roof inspection requirement. The active model may not yet include a concept for that inspection.

The source is retained. The unfamiliar requirement can support a candidate model that adds the concept, fields and relationships needed to represent it. That candidate does not become active simply because a model proposed it.

## Evaluate before activation

Ontave can compare a parent and candidate against an explicitly registered evaluation suite. The suite can contain extraction checks, compatibility checks for an earlier contract and deterministic read fixtures.

Activation names the exact candidate and evaluation artifacts. This binds the decision to what was evaluated. Passing a finite suite is useful evidence for that change; it does not establish universal model accuracy.

See the [candidate evaluation guide](/docs/evaluation/) for supported tasks, budgets and failure handling.

## Keep the application's contract pinned

An existing installation screen can continue to use its registered version-one contract while the logical model adds roof inspection. That contract defines the concepts and fields the application expects.

Pinned does not mean frozen business data. Queries read current accepted records through the selected contract. A new interface can register an updated contract and adopt the new concept deliberately.

Ontave can generate TypeScript declarations and executable validators from a registered contract. These describe the selected interface; they do not build the application's screens. Read about [application contracts](/docs/contracts/) and [generated types](/docs/type-generation/).

## Keep fact review separate

Approving the model makes a representation available. It does not accept every extracted fact that uses it. Reprocessed evidence still produces an interpretation that must pass the fact-review boundary.

This separation matters when a concept is useful but a particular source is ambiguous or incorrect. You can accept the model change and decline the proposed facts.

## Know the current limits

The developer preview supports additive ontology evolution. It does not implement destructive model changes, automatic established-entity merging or physical business-table migrations. Live discovery and independent semantic qualification remain open.

Try the [roof-inspection playground](/playground/) for a fictional worked example. For a real integration, start with a small reviewed dataset and inspect the [current release status](/docs/status/).
