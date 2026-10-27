# Host and React integration

## One canonical conversation

1. Select an interaction from a completed provider result, then parse it with `Interaction` or a provider parser.
2. Save the validated spec with the canonical assistant turn. If storing an encoded reply, handle its byte-limit error before acknowledging the turn.
3. Render the saved spec and stable turn ID. Keep the normal text composer available.
4. On submission, send values and the turn reference to your server. Load the spec from authorized storage; do not accept a browser replacement spec.
5. Verify actor access, conversation scope, latest eligible turn, and request idempotency before continuing. Run `validateResponse(savedSpec, values)` on the server.
6. Persist the normalized values and `formatResponse(savedSpec, values)` through the existing conversation executor. The host owns transactions and provider budgets.
7. Acknowledge persistence, then render the prior interaction read-only with its saved values. Continue the same conversation.

The library has no database or server middleware. A React demo running in a browser cannot enforce server permissions. Its fictional fixture validation illustrates the data flow only.

## Form props

| Prop | Contract |
| --- | --- |
| `interaction` | Saved version 1 specification; invalid runtime data displays a safe fallback |
| `interactionId` | Canonical saved-turn ID; a different ID resets the draft even for identical questions |
| `onSubmit(values)` | Called only after normalization; return your host request promise |
| `initialValues` | Host-validated persisted values; changing them resets the draft |
| `readOnly` | Display a summary or a superseded-question explanation; never call `onSubmit` |
| `pending` | Host request/recovery state; block inputs and submission |
| `disabled` | Block editing and submission, for example when the actor cannot reply |
| `error` | Host error feedback, rendered as escaped text and focused when shown |

Changing the spec or `readOnly` also starts fresh internal form state. Ordinary rerenders with equivalent data preserve the draft. A successful callback alone does not prove persistence or automatically mark the question read-only; the host supplies acknowledged state.

Native radio, checkbox, select, text, date, time and numeric controls provide keyboard semantics. Each control has a label or group legend. Error feedback has an alert role, focus, and a description link from the form. Styles respect reduced motion. The React tests exercise native semantics under jsdom; they do not certify every assistive-technology/browser combination.

## Exact uncertain retries

The renderer prevents overlapping callbacks while the returned promise is unsettled. After rejection it retains values and allows retry or editing. A transport failure may follow a successful server write. In that case the host must retain the original turn ID, request ID, and normalized body, keep the form disabled during readback/recovery, and retry the identical request. An edited payload needs a new request only after the host has established that the earlier request was definitively rejected. This policy belongs in your existing transport layer.

Superseding a question or unmounting the form does not cancel an already dispatched host request. Bind callbacks to the captured turn ID and verify it on the server. Do not apply a late acknowledgment to a different turn.

## Extending controls

Add a bounded schema, canonical response validation, readable formatting, registered client support, and recovery/security tests together. `select` uses the same two-to-six options as radio choices. `rating` accepts an integer from 1 through 5 and has no custom options or numeric bounds. Numeric bounds remain exclusive to `number`.

Trusted native clients use `createControlRegistry`; the model can select only installed kind/version pairs. Uploads, entity search, and availability widgets need scoped host permission checks and remain future extensions. Keep those checks and all real approval flows in the host.
