---
name: typescript
description: TypeScript code style and optimization guidelines. MUST READ before writing or modifying any TypeScript code (.ts, .tsx, .mts files). Also use when reviewing code quality or implementing type-safe patterns. Triggers on any TypeScript file edit, code style discussions, or type safety questions.
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
- Prefer async APIs over sync ones (avoid `*Sync`)
- Use promise-based variants: `import { readFile } from 'fs/promises'`
- Use `Promise.all`, `Promise.race` for concurrent operations where safe

## Imports

- This project uses `simple-import-sort/imports` and `consistent-type-imports` (`fixStyle: 'separate-type-imports'`)
- **Separate type imports**: always use `import type { ... }` for type-only imports, NOT `import { type ... }` inline syntax
- When a file already has `import type { ... }` from a package and you need to add a value import, keep them as **two separate statements**:
  ```ts
  import type { ChatTopicBotContext } from '@lobechat/types';
  import { RequestTrigger } from '@lobechat/types';
  ```
- Within each import statement, specifiers are sorted **alphabetically by name**

## Code Structure

- Prefer object destructuring
- Use consistent, descriptive naming; avoid obscure abbreviations
- Replace magic numbers/strings with well-named constants
- Defer formatting to tooling

## UI and Theming

- Use `@lobehub/ui`, Ant Design components instead of raw HTML tags
- Design for dark mode and mobile responsiveness
- Use `antd-style` token system instead of hard-coded colors

## Performance

- Prefer `for…of` loops over index-based `for` loops
- Reuse existing utils in `packages/utils` or installed npm packages
- Query only required columns from database

## Time Consistency

- Assign `Date.now()` to a constant once and reuse for consistency

## Logging

- Never log user private information (API keys, etc.)
- Don't use `import { log } from 'debug'` directly (logs to console)
- Use `console.error` in catch blocks instead of debug package
- Always log the error in `.catch()` callbacks — silent `.catch(() => fallback)` swallows failures and makes debugging impossible
