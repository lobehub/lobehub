# Cloud Project Workflow Configuration

How the cloud project serves workflows on top of the open-source submodule.

## Table of Contents

1. [Overview](#overview)
2. [Directory Structure](#directory-structure) — submodule + cloud layout
3. [Shared Workflows](#shared-workflows) — served through the submodule catch-all
4. [Cloud-Only Workflows](#cloud-only-workflows) — separate `cloud/` catch-all
5. [Path Mappings](#path-mappings)
6. [Best Practices](#best-practices) — decide cloud vs OSS
7. [Migration Guide](#migration-guide) — moving a workflow from cloud to lobehub
8. [Troubleshooting](#troubleshooting)

## Overview

Workflows live in one of two places:

1. **Lobehub (open-source)** — available to every deployment
2. **Lobehub-cloud (proprietary)** — cloud-only business logic

Both use the same building blocks: a Next.js catch-all route that forwards into a Hono router, and one Hono sub-app per workflow with one `serve(...)` endpoint per layer.

---

## Directory Structure

### Lobehub Submodule (Open-source)

```text
lobehub/
├── src/app/(backend)/api/workflows/
│   └── [[...route]]/route.ts        # Catch-all — forwards into the Hono router below
└── apps/server/src/
    ├── router-hono/workflows/
    │   ├── index.ts                  # Mounts each workflow's sub-app at /api/workflows/{name}
    │   ├── agent-eval-run/
    │   └── memory-user-memory/
    └── workflows/
        ├── agentEvalRun/             # Workflow class (static trigger*() methods)
        └── memoryUserMemory/
```

### Lobehub-cloud (Proprietary)

```text
lobehub-cloud/
├── src/app/(backend)/api/workflows/
│   ├── [[...route]]/route.ts        # One-line re-export of the submodule catch-all
│   └── cloud/[[...route]]/route.ts  # Catch-all for cloud-only workflows
└── apps/server/src/cloud-workflow/
    ├── index.ts                      # Cloud Hono router, basePath /api/workflows/cloud
    └── feature-name/
        ├── index.ts                  # Sub-app — one app.post('/{layer}', serve(...)) per layer
        ├── handlers/                 # One handler per layer
        └── workflow.ts               # Workflow class + payload types
```

Next.js routes the more specific `cloud/` segment to the cloud catch-all, so the two routers never collide.

---

## Shared Workflows

A workflow added to the submodule is served by cloud automatically: cloud's `[[...route]]/route.ts` re-exports the submodule catch-all, which already mounts every sub-app in `router-hono/workflows/index.ts`.

```typescript
// lobehub-cloud/src/app/(backend)/api/workflows/[[...route]]/route.ts
export { POST } from 'lobehub/src/app/(backend)/api/workflows/[[...route]]/route';
```

Do not add per-workflow re-export files in cloud. Import the submodule route through the `lobehub/...` path, not `@/...`, to avoid a circular alias.

---

## Cloud-Only Workflows

Implement cloud-only workflows under `apps/server/src/cloud-workflow/<name>/` and mount the sub-app in `apps/server/src/cloud-workflow/index.ts`:

```typescript
// lobehub-cloud/apps/server/src/cloud-workflow/feature-name/index.ts
import { serve } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import { createWorkflowQstashClient } from '@/server/router-hono/workflows/qstashClient';

const app = new Hono();

app.post(
  '/process-items',
  serve<ProcessItemsPayload>((context) => runProcessItems(context), {
    flowControl: { key: 'feature-name.process-items', parallelism: 1, ratePerSecond: 1 },
    qstashClient: createWorkflowQstashClient(),
  }),
);

export default app;
```

```typescript
// lobehub-cloud/apps/server/src/cloud-workflow/index.ts
app.route('/feature-name', featureNameApp);
```

Their endpoints live under `/api/workflows/cloud/<name>/<layer>`, so the workflow class must trigger that path.

---

## Path Mappings

Cloud resolves `@/server/*` through cloud code first, then the submodule:

```json
// lobehub-cloud/tsconfig.json
"@/server/*": ["./src/server/*", "./apps/server/src/*", "./lobehub/apps/server/src/*"]
```

Cloud-only workflows can therefore import shared helpers such as `@/server/router-hono/workflows/qstashClient` directly.

---

## Best Practices

**Implement in Lobehub if**:

- The feature is useful for every deployment
- It contains no proprietary business logic

**Implement in Cloud if**:

- It depends on cloud-only services or data
- It contains proprietary business logic

Keep shared logic in `lobehub/` and let cloud consume it through the catch-all re-export; override only when cloud needs different behavior.

---

## Migration Guide

### Moving a Workflow from Cloud to Lobehub

1. Move the sub-app from `lobehub-cloud/apps/server/src/cloud-workflow/<name>/` to `lobehub/apps/server/src/router-hono/workflows/<name>/`, and its class to `lobehub/apps/server/src/workflows/<name>/`.
2. Replace cloud-only services with generic interfaces and remove proprietary logic.
3. Mount the sub-app in `lobehub/apps/server/src/router-hono/workflows/index.ts` and remove it from `cloud-workflow/index.ts`.
4. Update the class's trigger URLs from `/api/workflows/cloud/<name>/...` to `/api/workflows/<name>/...`.

---

## Troubleshooting

### Circular Import Error

**Error**: `Circular definition of import alias`

**Cause**: Cloud's catch-all re-export uses `@/app/...` instead of `lobehub/src/app/...`.

### Workflow Not Found (404)

- Shared workflow: check that the sub-app is mounted in `lobehub/apps/server/src/router-hono/workflows/index.ts`.
- Cloud-only workflow: check that it is mounted in `cloud-workflow/index.ts` and that the trigger URL includes the `/cloud` segment.

### Type Errors After Moving to Lobehub

Cloud-only types or services leaked into the moved code. Keep them in a cloud-side wrapper or inject them through a generic interface.

---

## Related Documentation

- [SKILL.md](../SKILL.md) - Standard workflow patterns
