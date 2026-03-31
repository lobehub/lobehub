---
name: trpc-router
description: TRPC router development guide. Use when creating or modifying TRPC routers (src/server/routers/**), adding procedures, or working with server-side API endpoints. Triggers on TRPC router creation, procedure implementation, or API endpoint tasks.
---

# TRPC Router Guide

## File Location

- Routers: `src/server/routers/lambda/<domain>.ts`
- Helpers: `src/server/routers/lambda/_helpers/`
- Schemas: `src/server/routers/lambda/_schema/`

## Router Structure

### Imports

```typescript
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { SomeModel } from '@/database/models/some';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
```

### Middleware: Inject Models into ctx

**Always use middleware to inject models into `ctx`** instead of creating `new Model(ctx.serverDB, ctx.userId)` inside every procedure.

```typescript
const domainProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      fooModel: new FooModel(ctx.serverDB, ctx.userId),
      barModel: new BarModel(ctx.serverDB, ctx.userId),
    },
  });
});
```

Then use `ctx.fooModel` in procedures:

```typescript
// Good
const model = ctx.fooModel;

// Bad - don't create models inside procedures
const model = new FooModel(ctx.serverDB, ctx.userId);
```

**Exception**: When a model needs a different `userId` (e.g., watchdog iterating over multiple users' tasks), create it inline.

### Procedure Pattern

```typescript
export const fooRouter = router({
  // Query
  find: domainProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
    try {
      const item = await ctx.fooModel.findById(input.id);
      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' });
      return { data: item, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[foo:find]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to find item',
      });
    }
  }),

  // Mutation
  create: domainProcedure.input(createSchema).mutation(async ({ input, ctx }) => {
    try {
      const item = await ctx.fooModel.create(input);
      return { data: item, message: 'Created', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[foo:create]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create',
      });
    }
  }),
});
```

### Aggregated Detail Endpoint

For views that need multiple related data, create a single `detail` procedure that fetches everything in parallel:

```typescript
detail: domainProcedure.input(idInput).query(async ({ input, ctx }) => {
  const item = await resolveOrThrow(ctx.fooModel, input.id);

  const [children, related] = await Promise.all([
    ctx.fooModel.findChildren(item.id),
    ctx.barModel.findByFooId(item.id),
  ]);

  return {
    data: { ...item, children, related },
    success: true,
  };
}),
```

This avoids the CLI or frontend making N sequential requests.

## Conventions

- Return shape: `{ data, success: true }` for queries, `{ data?, message, success: true }` for mutations
- Error handling: re-throw `TRPCError`, wrap others with `console.error` + new `TRPCError`
- Input validation: use `zod` schemas, define at file top
- Router name: `export const fooRouter = router({ ... })`
- Procedure names: alphabetical order within the router object
- Log prefix: `[domain:procedure]` format, e.g. `[task:create]`
