---
id_prefix: ai
verify: true
skip_when: docs/lockfile-only diff
---

# AI Coding Bad Habits

Detect locally plausible but mechanically incomplete code: changes that compile in isolation while
ignoring semantic scope, static type information, refactor closure, explanatory comments, or
repository precedent. "AI coding" names the recurring implementation habits, not the author or
provenance — review observable code and never speculate about who wrote it.

This dimension is not a license to report personal taste. Every finding must identify a concrete
cost: misleading reading flow, duplicated policy, stale names, redundant runtime work, a missed
compatibility boundary, or divergence from an established repository pattern.

Use this dimension for the specifically mechanical pattern: code that is locally plausible but
globally unfinished. If the same root cause is fully covered by `code-style` (an isolated
readability issue) or `reuse-architecture` (a proven duplicate, wrong layer, or bypassed extension
seam), report it there instead; never emit the same finding twice.

## Quick checklist

- **Narrow special case inside generic code**: a provider/model/call-site-specific condition, helper,
  or name is embedded in a shared abstraction and makes the generic contract harder to read or
  extend. Pay special attention to one-off helpers that hide a single narrow branch at a generic
  property such as `type`, `status`, or `mode`; keep variant policy in its owning layer or make the
  exceptional condition explicit at the decision point.
- **Partial refactor**: a renamed concept leaves stale filenames, tests, exports, docs, or adjacent
  identifiers; a compatibility alias, forwarding wrapper, or `const newName = oldName` remains even
  though no caller needs it. Complete the semantic rename across the affected unit, following the
  repository's file-naming convention.
- **Defensive type noise despite known types**: repeated `typeof`, `in`, `isRecord`, defensive
  optional chaining, or cast-and-check logic revalidates values whose static type and callers
  already guarantee the shape. Confirm the type with LSP/type definitions first. For genuinely
  untrusted structured input, validate once at the boundary — prefer an existing schema (often Zod
  in this repo) over scattered ad-hoc guards.
- **Commentary that narrates coding instead of explaining code**: comments preserve the author's
  thought process, edit history, numbered implementation steps, or restate the next line, while the
  actual workaround, invariant, trade-off, or non-obvious constraint is left unexplained. Keep
  durable "why"; delete transient narration.
- **Precedent-blind implementation**: naming, file layout, error handling, data flow, or abstraction
  shape is invented locally without checking the nearest same-kind implementation or relevant repo
  skill. Require concrete repository precedent before calling a deviation wrong; intentional
  deviations with a stated reason are valid.

### Examples

Use these examples to recognize the shape of a bad habit, not as keyword-matching rules. Verify the
declared types, callers, repository convention, and compatibility boundary before reporting.

### Narrow special case hidden behind a generic property

```ts
const getBlockErrorType = (reason: string) =>
  reason === 'IMAGE_PROHIBITED_CONTENT' ? ErrorType.ContentPolicyViolation : undefined;

// Inside a shared stream parser:
type: getBlockErrorType(finishReason);
```

`type` and `getBlockErrorType` read like the generic owner of error classification, but the helper
only hides one image-generation condition. Keep the condition explicit at the decision point when
that is clearest, or move the policy into the image/provider adapter that owns it.

### Rename that stops at the exported symbol

```ts
// register-file-work.ts
export const registerWork = async () => {
  // ...
};

export const registerFileWork = registerWork;
```

If no released caller needs compatibility, rename the file, tests, imports, and adjacent concepts
according to repository convention, then remove the alias. Renaming only the export leaves two
names for one concept and makes readers search for a migration that does not exist.

### Runtime guards around an already-known type

```ts
interface Work {
  id: string;
}

const getWorkId = (work: Work) =>
  isRecord(work) && typeof work.id === 'string' ? work.id : undefined;
```

`work.id` is already guaranteed by the in-process type. Use it directly. If the value came from
JSON, an SDK, or another trust boundary, parse it once with the existing `WorkSchema` and pass the
validated `Work` onward instead of repeating guards at every use.

### Comments that preserve the coding transcript

```ts
// First check whether the cache has a value.
// If it does, return it.
if (cached) return cached;
```

Delete narration that merely restates control flow. Keep a comment when it explains the durable
reason, for example: `// Ignore v1 cache entries because they lack the workspace isolation key.`

### A locally plausible implementation that ignores repository precedent

```ts
useEffect(() => {
  lambdaClient.work.list.query().then(setWorks);
}, []);
```

If same-kind features in the repository use a store SWR hook → service → `lambdaClient` pipeline,
the direct component call is precedent-blind even though it works locally. Follow the established
route, or document the constraint that makes this feature different.

## Rule sources (deep mode: read before reviewing)

- Repo root `AGENTS.md` / `CLAUDE.md` — repository-wide naming, comment, and workflow conventions
- `.agents/skills/typescript/SKILL.md` — static typing, runtime validation, and type-guard conventions
- `.agents/skills/project-overview/SKILL.md` — ownership and layer boundaries
- The category skill matching the changed code (`testing`, `drizzle`, `trpc-router`, `zustand`,
  `builtin-tool`, etc.) — use its established pattern as the primary precedent
- The nearest same-kind sibling implementation and the changed symbol's callers

## How to check

Run five focused passes:

1. **Scope locality**: name each new condition/helper and ask whether its vocabulary is narrower than
   the file or abstraction containing it. Trace the pipeline and existing extension seams before
   deciding the code belongs elsewhere. A narrow report does not prove the root cause is narrow.
2. **Refactor closure**: for renamed concepts, search both old and new names across symbols,
   filenames, exports, tests, docs, and import paths. Search every alias/wrapper for callers. Keep a
   compatibility shim only when a released caller or staged migration needs it, and require a
   deprecation/removal story.
3. **Type confidence**: use LSP hover/go-to-definition when available; otherwise read the declared
   type and representative callers. Distinguish trusted in-process values from external JSON,
   database JSON, SDK payloads, and other untrusted boundaries. Do not remove guards merely because
   TypeScript compiles.
4. **Comment intent**: read added comments without the diff narrative. Keep comments that explain
   why the code cannot be simpler, an invariant, a compatibility constraint, or an external
   reference. Flag narration that will be stale after the next edit, especially when the real
   workaround remains undocumented.
5. **Repository precedent**: identify the nearest same-kind implementation and relevant skill.
   Compare naming, layering, validation, error handling, and tests. No concrete precedent means no
   precedent-blind finding.

## Violations

- A narrow variant concern pollutes a generic layer or is hidden behind a one-use indirection,
  making the shared decision harder to understand or extend.
- A rename/refactor leaves contradictory names or no-op aliases/wrappers with no compatibility
  caller.
- Runtime guards duplicate guarantees already established by the declared type and trusted callers,
  obscuring the actual business logic.
- Added comments record implementation narration while omitting the non-obvious reason the code
  exists.
- The diff invents a local pattern despite a clearly applicable repository precedent or skill.

## Not violations

- A variant-specific rule implemented inside that variant's adapter/provider/module.
- A filename that names the broader module rather than one exported function.
- An alias or wrapper preserving a released public API, plugin contract, serialized name, or
  multi-PR migration, with evidence that callers still depend on it.
- Runtime validation at a real trust boundary, including parsed JSON, database JSON, network/SDK
  payloads, IPC, plugin/tool input, or legacy persisted data. Static types do not make external data
  trustworthy.
- A small inline type guard that narrows a genuine union more clearly than a schema would.
- Comments explaining a workaround, invariant, trade-off, compatibility constraint, or source
  reference.
- An intentional departure from precedent whose constraint is documented in code or the PR.

## Severity calibration

- Use P1 only when the habit creates a concrete correctness, compatibility, or shared-abstraction
  risk.
- Use P2 for maintainability/readability debt that is likely to mislead the next change.
- Do not report "looks AI-generated." The habit is only a lead; the finding must name the
  code-level consequence and evidence.
