---
name: typescript
description: 'Use for TypeScript style and type safety when editing TS/TSX/MTS, including imports, async code and error suppression.'
user-invocable: false
---

# TypeScript Code Style Guide

## Types and Type Safety

- Avoid explicit type annotations when TypeScript can infer
- Avoid implicitly `any`; explicitly type when necessary
- Use accurate types: prefer `Record<PropertyKey, unknown>` over `object` or `any`
- Prefer `interface` for object shapes (e.g., React props); use `type` for unions/intersections
- Prefer `as const satisfies XyzInterface` over plain `as const`
- Prefer `@ts-expect-error` over `@ts-ignore` over `as any`
- Avoid meaningless null/undefined parameters; design strict function contracts
- Prefer ES module augmentation (`declare module '...'`) over `namespace`; do not introduce `namespace`-based extension patterns
- When a type needs extensibility, expose a small mergeable interface at the source type and let each feature/plugin augment it locally instead of centralizing all extension fields in one registry file
- For package-local extensibility patterns like `PipelineContext.metadata`, define the metadata fields next to the processor/provider/plugin that reads or writes them

## Async Patterns

- Prefer `async`/`await` over callbacks or `.then()` chains
- **Async-first for IO**: new IO code (fs, child\_process, etc.) must use async APIs at its boundaries — use promise-based variants like `import { readFile } from 'fs/promises'`, never `*Sync` by default. Function coloring is asymmetric: async→sync migration is never needed, while sync→async (when IO gets slower, gains concurrency, or grows a subprocess/network call) forces rewriting every caller up the chain — sync-first debt that compounds. Micro-costs of async (thread-pool dispatch, cache races) are not valid reasons: races are solved by caching the promise instead of the result
- `*Sync` is acceptable in exactly one place: call sites locked inside a synchronous contract you don't control — an existing sync signature chain (don't virally refactor a legacy sync chain in a bugfix, but new standalone modules must not extend such chains), or sync-only callbacks like `process.on('exit')`. Module-load-time and CLI startup init are NOT exceptions — use top-level `await` (ESM) there
- Use `Promise.all`, `Promise.race` for concurrent operations where safe

## Imports

- Let lint enforce `simple-import-sort/imports` and `consistent-type-imports` with separate `import type` statements (`fixStyle: 'separate-type-imports'`).

## Code Structure

- Prefer **named exports** over `export default` — keeps refactor renames and IDE auto-import in sync, and avoids the `default` re-naming drift you get with `import Foo from './foo'`. Reserve `export default` for files where the framework requires it (Next.js page/route/layout, React.lazy targets, config files like `vitest.config.ts`). The codebase still has many `export default` occurrences — that's historical debt, not a pattern to copy; do not model new code on existing `export default` usage outside the framework-required cases above

## Reusability

- Before adding guards, parsing, normalization, timing, or JSON-safe helpers, search `packages/utils` and installed packages. Reuse `@lobechat/utils` or its relevant subpath instead of duplicating helpers across features.
- Do not hand-roll reusable record/object-map guards such as `typeof value === 'object' && value !== null`; import helpers like `isRecord`, `isPlainRecord`, `isObjectLike`, `toRecord`, `pickString`, `UnknownRecord`, etc. from `@lobechat/utils/object`.
- Assign `Date.now()` to a constant once and reuse for consistency

## Logging

- Never log user private information (API keys, etc.)
- Don't use `import { log } from 'debug'` directly (logs to console)
- Use `console.error` in catch blocks instead of debug package
- Always log the error in `.catch()` callbacks — silent `.catch(() => fallback)` swallows failures and makes debugging impossible
