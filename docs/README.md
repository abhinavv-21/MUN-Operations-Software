# docs/

Handoff material for **MUN Operations Software** — the multi-tenant successor to this
application, being built at
<https://github.com/abhinavv-21/MUN-Operations-Software>.

Nothing in this folder affects the running deployment.
These are documents, written to be read by a session that has never seen this codebase.

| File | What it is | Read it when |
| --- | --- | --- |
| [`KICKSTART-MUN-SAAS.md`](./KICKSTART-MUN-SAAS.md) | The prompt. Self-contained: architecture, schema, eight stages, exit criteria. Paste it into a fresh session in the new repository. | Starting the new build |
| [`REFERENCE-LRI-MUN-X.md`](./REFERENCE-LRI-MUN-X.md) | A decision record for this codebase — the contracts, the security choices that look like bugs, the guarantees, the gaps, the operational lessons | Deciding how to build something the new project also needs |

Start with the kickstart prompt.
It tells you when to read the reference.

## One warning about the reference

This application is **single-tenant**.
It serves exactly one conference, accounts are created by hand, and there is no signup page
anywhere by design.

Its auth and hosting decisions were made under constraints that do not apply to a SaaS, and
several are actively wrong to copy — the bespoke JWT and refresh-session machinery, the
in-process rate limiter, the CORS configuration, and a globally unique `Delegate.email`
that becomes a bug the moment one person registers for two conferences.

Those are marked **DO NOT CARRY** in both documents.
The things worth taking are the error contract, the audit trail, the serializable
allocation, the storage module, the ingestion aliases, and the reasoning behind each.
