# Cloud Project Workflow Configuration

This document covers cloud-specific workflow configurations and patterns for the lobehub-cloud project.

## Overview

The lobehub-cloud project extends the open-source lobehub codebase with cloud-specific features. Workflows can be implemented in either:

1. **Lobehub (open-source)** - Available to all users
2. **Lobehub-cloud (proprietary)** - Cloud-specific business logic

---

## Directory Structure

### Lobehub Submodule (Open-source)

```
lobehub/
└── src/
    ├── app/(backend)/api/workflows/
    │   ├── memory-user-memory/       # Memory extraction workflows
    │   └── agent-eval-run/            # Benchmark evaluation workflows
    └── server/workflows/
        ├── agentEvalRun/
        └── ...
```

### Lobehub-cloud (Proprietary)

```
lobehub-cloud/
└── src/
    ├── app/(backend)/api/workflows/
    │   ├── welcome-placeholder/       # Cloud-only: AI placeholder generation
    │   ├── agent-welcome/            # Cloud-only: Agent welcome messages
    │   ├── agent-eval-run/           # Re-export from lobehub
    │   └── memory-user-memory/       # Re-export from lobehub
    └── server/workflows/
        ├── welcomePlaceholder/
        ├── agentWelcome/
        └── agentEvalRun/             # Re-export from lobehub
```

---

## Cloud-Specific Patterns

### Pattern 1: Cloud-Only Workflows

**Use Case**: Features exclusive to cloud users (AI generation, premium features)

**Example**: `welcome-placeholder`, `agent-welcome`

**Implementation**:
- Implement directly in `lobehub-cloud/src/app/(backend)/api/workflows/`
- No need for re-exports
- Can use cloud-specific packages and services

**Structure**:
```
lobehub-cloud/src/
├── app/(backend)/api/workflows/
│   └── feature-name/
│       ├── process-items/route.ts
│       ├── paginate-items/route.ts
│       └── execute-item/route.ts
└── server/workflows/
    └── featureName/
        └── index.ts
```

---

### Pattern 2: Re-export from Lobehub

**Use Case**: Workflows implemented in open-source but also used in cloud

**Example**: `agent-eval-run`, `memory-user-memory`

**Why Re-export?**
- Cloud deployment needs to serve these endpoints
- Lobehub submodule code is not directly accessible in cloud routes
- Allows cloud-specific overrides if needed in the future

#### Re-export Implementation

**Step 1**: Implement workflow in lobehub submodule

```typescript
// lobehub/src/app/(backend)/api/workflows/feature/layer/route.ts
import { serve } from '@upstash/workflow/nextjs';

export const { POST } = serve<Payload>(
  async (context) => {
    // Implementation
  },
  { flowControl: { ... } }
);
```

**Step 2**: Create re-export in lobehub-cloud

```typescript
// lobehub-cloud/src/app/(backend)/api/workflows/feature/layer/route.ts
export { POST } from 'lobehub/src/app/(backend)/api/workflows/feature/layer/route';
```

**Important**: Use `lobehub/src/...` path, NOT `@/...` to avoid circular imports.

#### Re-export Directory Structure

```bash
# Create directories
mkdir -p lobehub-cloud/src/app/(backend)/api/workflows/feature-name/layer-1
mkdir -p lobehub-cloud/src/app/(backend)/api/workflows/feature-name/layer-2
mkdir -p lobehub-cloud/src/app/(backend)/api/workflows/feature-name/layer-3

# Create re-export files
echo "export { POST } from 'lobehub/src/app/(backend)/api/workflows/feature-name/layer-1/route';" > \
  lobehub-cloud/src/app/(backend)/api/workflows/feature-name/layer-1/route.ts

echo "export { POST } from 'lobehub/src/app/(backend)/api/workflows/feature-name/layer-2/route';" > \
  lobehub-cloud/src/app/(backend)/api/workflows/feature-name/layer-2/route.ts

echo "export { POST } from 'lobehub/src/app/(backend)/api/workflows/feature-name/layer-3/route';" > \
  lobehub-cloud/src/app/(backend)/api/workflows/feature-name/layer-3/route.ts
```

---

## TypeScript Path Mappings

The cloud project uses tsconfig path mappings to override lobehub code:

```json
// lobehub-cloud/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*", "./lobehub/src/*"]
    }
  }
}
```

**Resolution Order**:
1. `./src/*` (cloud code) - checked first
2. `./lobehub/src/*` (open-source) - fallback

This allows cloud to override specific modules while using lobehub defaults.

---

## Workflow Class Location

### Cloud-Only Workflows

Place workflow class in cloud:

```
lobehub-cloud/src/server/workflows/featureName/index.ts
```

### Shared Workflows

Place workflow class in lobehub, re-export in cloud if needed:

```
lobehub/src/server/workflows/featureName/index.ts
```

---

## Environment Variables

Both lobehub and cloud workflows require:

```bash
# Required for all workflows
APP_URL=https://your-app.com          # Base URL for workflow endpoints
QSTASH_TOKEN=qstash_xxx               # QStash authentication token

# Optional (for custom QStash URL)
QSTASH_URL=https://custom-qstash.com # Custom QStash endpoint
```

**Cloud-Specific**:
```bash
# Cloud database (for monetization features)
CLOUD_DATABASE_URL=postgresql://...

# Cloud-specific services
REDIS_URL=redis://...
```

---

## Best Practices

### 1. Decide: Cloud or Open-Source?

**Implement in Lobehub if**:
- Feature is useful for all LobeChat users
- No proprietary business logic
- Can be open-sourced

**Implement in Cloud if**:
- Premium/paid feature
- Uses cloud-specific services
- Contains proprietary algorithms

### 2. Re-export Pattern

✅ **Do**:
```typescript
// Simple re-export
export { POST } from 'lobehub/src/app/(backend)/api/workflows/feature/route';
```

❌ **Don't**:
```typescript
// Avoid circular imports with @/ path
export { POST } from '@/app/(backend)/api/workflows/feature/route'; // ❌
```

### 3. Keep Workflow Logic in Lobehub

For shared features:
- Implement core logic in `lobehub/` (open-source)
- Only override if cloud needs different behavior
- Use re-exports for cloud deployment

### 4. Directory Naming

Follow consistent naming across lobehub and cloud:

```
# Both should use same structure
lobehub/src/app/(backend)/api/workflows/feature-name/
lobehub-cloud/src/app/(backend)/api/workflows/feature-name/
```

---

## Migration Guide

### Moving Workflow from Cloud to Lobehub

**Step 1**: Copy workflow to lobehub
```bash
cp -r lobehub-cloud/src/app/(backend)/api/workflows/feature \
      lobehub/src/app/(backend)/api/workflows/
```

**Step 2**: Remove cloud-specific dependencies
- Replace cloud services with generic interfaces
- Remove proprietary business logic
- Update imports to use lobehub paths

**Step 3**: Create re-exports in cloud
```typescript
// lobehub-cloud/src/app/(backend)/api/workflows/feature/*/route.ts
export { POST } from 'lobehub/src/app/(backend)/api/workflows/feature/*/route';
```

**Step 4**: Move workflow class to lobehub
```bash
mv lobehub-cloud/src/server/workflows/feature \
   lobehub/src/server/workflows/
```

**Step 5**: Update cloud imports
```typescript
// Change from
import { Workflow } from '@/server/workflows/feature';

// To
import { Workflow } from 'lobehub/src/server/workflows/feature';
```

---

## Examples

### Cloud-Only Workflow: welcome-placeholder

**Location**: `lobehub-cloud/src/app/(backend)/api/workflows/welcome-placeholder/`

**Why Cloud-Only**: Uses proprietary AI generation service and Redis caching

**Structure**:
```
lobehub-cloud/
├── src/app/(backend)/api/workflows/welcome-placeholder/
│   ├── process-users/route.ts
│   ├── paginate-users/route.ts
│   └── generate-user/route.ts
└── src/server/workflows/welcomePlaceholder/
    └── index.ts
```

### Re-exported Workflow: agent-eval-run

**Location**:
- Implementation: `lobehub/src/app/(backend)/api/workflows/agent-eval-run/`
- Re-export: `lobehub-cloud/src/app/(backend)/api/workflows/agent-eval-run/`

**Why Re-export**: Core feature available in open-source, also used by cloud

**Cloud Re-export Files**:
```typescript
// lobehub-cloud/src/app/(backend)/api/workflows/agent-eval-run/run-benchmark/route.ts
export { POST } from 'lobehub/src/app/(backend)/api/workflows/agent-eval-run/run-benchmark/route';

// lobehub-cloud/src/app/(backend)/api/workflows/agent-eval-run/paginate-test-cases/route.ts
export { POST } from 'lobehub/src/app/(backend)/api/workflows/agent-eval-run/paginate-test-cases/route';

// ... (all layers)
```

---

## Troubleshooting

### Circular Import Error

**Error**: `Circular definition of import alias 'POST'`

**Cause**: Using `@/` path in re-export within cloud codebase

**Solution**: Use `lobehub/src/` path instead
```typescript
// ❌ Wrong
export { POST } from '@/app/(backend)/api/workflows/feature/route';

// ✅ Correct
export { POST } from 'lobehub/src/app/(backend)/api/workflows/feature/route';
```

### Workflow Not Found (404)

**Cause**: Missing re-export in cloud

**Solution**: Create re-export files for all workflow layers
```bash
# Check if re-export exists
ls lobehub-cloud/src/app/\(backend\)/api/workflows/feature-name/

# If missing, create re-exports
mkdir -p lobehub-cloud/src/app/\(backend\)/api/workflows/feature-name/layer
echo "export { POST } from 'lobehub/src/app/(backend)/api/workflows/feature-name/layer/route';" > \
  lobehub-cloud/src/app/\(backend\)/api/workflows/feature-name/layer/route.ts
```

### Type Errors After Moving to Lobehub

**Cause**: Cloud-specific types or services used in lobehub code

**Solution**:
1. Extract cloud-specific logic to cloud-only wrapper
2. Use dependency injection for services
3. Define generic interfaces in lobehub

---

## Related Documentation

- [SKILL.md](../SKILL.md) - Standard workflow patterns
