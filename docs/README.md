# docs/

Everything a session with no memory of building this needs in order to work on it safely.

The code carries dense comments at each decision point — that is where the *local* reasoning
lives.
These documents carry the reasoning that does not fit next to any one line: why the tenancy model
has three axes, which security holes were found and closed, and which parts of the original
specification no longer compile.

**Read in this order.** The first three are enough to start working.

| | Document | What it is |
| --- | --- | --- |
| 1 | [`01-CURRENT-STATE.md`](./01-CURRENT-STATE.md) | What is built, what is deliberately not, and what must never be built in v1 |
| 2 | [`02-INVARIANTS.md`](./02-INVARIANTS.md) | Ten rules, the mechanism enforcing each, and the command that proves it |
| 3 | [`03-ARCHITECTURE.md`](./03-ARCHITECTURE.md) | Tenancy, context, services, the error contract |
| 4 | [`04-STACK-DECISIONS.md`](./04-STACK-DECISIONS.md) | Where the original spec's code no longer works, and what replaced it |
| 5 | [`05-DESIGN-SYSTEM.md`](./05-DESIGN-SYSTEM.md) | Tokens, grounds, runtime theming, the contrast contract |
| 6 | [`06-ENVIRONMENT.md`](./06-ENVIRONMENT.md) | Machine setup, environment variables, deployment, runbook |
| 7 | [`07-TRAPS.md`](./07-TRAPS.md) | Every defect found during the build, and the lesson from each |
| 8 | [`08-TESTING.md`](./08-TESTING.md) | The harness contract, what each suite guards, how to prove a fix |
| 9 | [`09-NEXT-STAGES.md`](./09-NEXT-STAGES.md) | Stage 7 as built, and Stage 8 with its exit criterion |
| — | [`KICKSTART.md`](./KICKSTART.md) | The prompt to paste into a fresh session |
| — | [`REFERENCE-LRI-MUN-X.md`](./REFERENCE-LRI-MUN-X.md) | Decision record for the **single-tenant predecessor** this product replaces |

## Read this before you…

| You are about to… | Read |
| --- | --- |
| Add a table or change the schema | `02` (RLS and classification rules), `03` (which scope axis it belongs to) |
| Add an API route | `03` (`withApi`, `createCtx`), `02` (the error contract) |
| Change a colour, or add a component | `05`, and run `npm run lint` — a hex outside the theme layer fails the build |
| Touch authentication or membership | `03`, then `07` — three cross-tenant holes were found here, all in this area |
| Write a query outside `ctx.db` | `03` (`scope-resolution.ts`), and expect to justify it |
| Debug a sign-in that fails silently | `07`, the environment-variable and stranded-spinner entries |
| Debug an intermittent 500 under load | `07`, the serialization-failure entry |
| Deploy, or change an environment variable | `06` |
| Add a mutating route | `02` #9 — it must declare an audit action, and three tests check it |
| Touch anything offline | `02` #10, `src/lib/offline/policy.ts`, and the comment in `providers.tsx` |
| Change an exporter | `09`, the Stage 7 decisions — the writers are hand-written for deployment reasons |
| Start the next stage | `01`, then `09` |

## Two warnings

**`REFERENCE-LRI-MUN-X.md` describes a different product.** It is the single-tenant application
this one replaces, and its auth, hosting and rate-limiting decisions are marked **DO NOT CARRY**
for good reason. Read it for the error contract, the audit trail, the serializable allocation and
the ingestion aliases — the reasoning that survived. Not for the mechanisms.

**The original build specification is now partly wrong.** It was written against Prisma 6,
Tailwind 3 and Next 15. Several of its code snippets do not compile against what is installed.
`04-STACK-DECISIONS.md` lists every divergence. Where they disagree, **the repository is
correct**.
