# Reference behavior inventory

The EvoOntology reference is pinned to commit `c94389b764394379086ff25e50d0e0f4396167b4`, obtained from the repository's HEAD during the Ontave build. [Pinned repository](https://github.com/ruc-datalab/EvoOntology/tree/c94389b764394379086ff25e50d0e0f4396167b4).

This implementation has not copied the Python source and does not claim a complete TypeScript port or benchmark parity. It uses the documented lifecycle as an architectural reference. A line-by-line source audit/behavioral parity suite remains separate work.

| Reference idea | Ontave implementation boundary |
| --- | --- |
| Versioned semantic definitions | Immutable workspace-scoped PostgreSQL snapshots, stable IDs and hashes |
| Candidate lifecycle | Additive patch, deterministic validation, evaluation and explicit publication |
| Parent/candidate comparison | Registered declarative extraction/contract tasks, independent expected checks, same evidence and adapter |
| Runtime semantic inspection | Authorized SDK/CLI definition inspection; MCP is deferred |
| Operational data | Ontave adds preserved evidence, durable jobs, assertion review and current projections |
| Stable app interfaces | Explicit registered contract projections and generated TypeScript/runtime validators |
| Trajectory-driven optimization | No automatic background evolution trigger; explicit proposals only in this build |

The source transcript is design input. Claims about universal speed, accuracy, automatic rollback or production maturity are not inherited from it.
