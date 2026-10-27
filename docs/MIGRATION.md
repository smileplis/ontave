# Replacing the earlier Ontave framework

Ontave 0.2 is an interactive conversation framework derived from the MIT-licensed Daltn Interactive Chat foundation (`aab27f0`). It replaces the prior ontology/evidence framework in this repository. This is an intentional API break and a source preview, not an npm publication or an automatic data migration.

## Earlier Ontave 0.1 consumers

The previous framework's latest GitHub release at the replacement checkpoint is [`v0.1.0-alpha.6`](https://github.com/smileplis/ontave/releases/tag/v0.1.0-alpha.6), at commit `81f0cca`. Its sources remain at that tag and in Git history. Earlier tags and release artifacts are preserved. They retain their Apache 2.0 license.

The 0.2 package does not provide the old PostgreSQL runtime, ingestion, ontology review, migrations, CLI, model extraction adapters, local studio, or playground. The old subpaths (`ontave/postgres`, `ontave/local`, `ontave/studio`, `ontave/testing`, and `ontave/models/*`) have no replacements here. There is no database-format conversion. Existing deployments must retain their exact prior version until intentionally migrated or retired by their owners.

The new package uses the version `0.2.0-alpha.1` to distinguish the API. No release tag, npm dist-tag, website deployment, or existing product dependency is changed by this source branch. `npm install ontave` continues to resolve whichever earlier version the registry currently serves; install the locally packed tarball to evaluate this preview. Publishing is a separate release operation.

## Framework demo deployment

The previous documentation and playground are replaced by the new `examples/react/` demo. Root `vercel.json` builds it with `npm run build:example` and serves `examples/react/dist` with restrictive response headers. The `website/` directory is now a small deployment wrapper for existing hosting projects rooted there. Its install command installs the repository lockfile, and its build copies the same demo into `website/dist`; no shared project setting needs to change. `npm run build:website` checks that path locally and in CI. Pushing a branch may trigger the existing hosting service’s automatic preview; this source branch does not change a production domain or project configuration. Previous-framework deep links are not redirected into unrelated new APIs; use the archived release documentation linked above.

## Original Daltn Interactive Chat consumers

Update imports after installing the Ontave preview:

| Before | After |
| --- | --- |
| `@daltn/interactive-chat` | `ontave` |
| `@daltn/interactive-chat/react` | `ontave/react` |
| `@daltn/interactive-chat/styles.css` | `ontave/styles.css` |

Existing eight-control version 1 specifications and response normalization remain supported. Ontave adds `select` and `rating`. A client supporting only the original kind set should restrict advertised provider capabilities and reject unsupported interactions with its normal readable fallback.

New saved replies begin with `Ontave interactive reply\n`. Both `decodeInteractiveReply` and `interactiveText` continue to read the original `Daltn interactive reply\n` marker. Old clients do not understand the new marker; upgrade readers before switching writers. Neither marker authenticates a reply.

`InteractionForm` adds an optional `interactionId` for canonical turn identity. Pass this even when two questions have identical content. Previously malformed or future-version specs threw during rendering; they now render a noninteractive chat fallback.

## Scope and provenance

New framework code and documentation use MIT, retaining the original Daltn contributors' copyright. The previous ontology code is not included in the new tarball; it remains Apache 2.0 in its historical releases. No license is granted here to a separate Daltn product, application, or business data.

The replacement is developed in an independent clone. Product source, production databases, deployed websites, and application dependency manifests are outside this change. Consumers may adopt the framework independently.
