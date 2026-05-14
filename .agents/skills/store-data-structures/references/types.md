# Type Definitions in Detail

The skill body's Type Definitions section covers the rules; this file holds the full worked examples to keep SKILL.md lean.

## Organization

Types should be organized by entity in separate files (not mixed):

```text
@lobechat/types/src/eval/
├── benchmark.ts        # Benchmark types
├── agentEvalDataset.ts # Dataset types
├── agentEvalRun.ts     # Run types
└── index.ts            # Re-exports
```

## Example: Benchmark Types

```typescript
// packages/types/src/eval/benchmark.ts
import type { EvalBenchmarkRubric } from './rubric';

/**
 * Full benchmark entity with all fields including heavy data.
 */
export interface AgentEvalBenchmark {
  createdAt: Date;
  description?: string | null;
  id: string;
  identifier: string;
  isSystem: boolean;
  metadata?: Record<string, unknown> | null;
  name: string;
  referenceUrl?: string | null;
  rubrics: EvalBenchmarkRubric[]; // Heavy field
  updatedAt: Date;
}

/**
 * Lightweight benchmark item — excludes heavy fields, may add computed stats.
 */
export interface AgentEvalBenchmarkListItem {
  createdAt: Date;
  description?: string | null;
  id: string;
  identifier: string;
  isSystem: boolean;
  name: string;
  // Note: rubrics NOT included (heavy field)

  // Computed statistics for UI display
  datasetCount?: number;
  runCount?: number;
  testCaseCount?: number;
}
```

## Example: Document Types (with heavy content)

```typescript
// packages/types/src/document.ts

/**
 * Full document entity — includes heavy content fields.
 */
export interface Document {
  id: string;
  title: string;
  description?: string;
  content: string; // Heavy field — full markdown content
  editorData: any; // Heavy field — editor state
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lightweight document item — excludes heavy content.
 */
export interface DocumentListItem {
  id: string;
  title: string;
  description?: string;
  // Note: content and editorData NOT included
  createdAt: Date;
  updatedAt: Date;

  // Computed statistics
  wordCount?: number;
  lastEditedBy?: string;
}
```

## Heavy Fields to Exclude from List

- Large text content (`content`, `editorData`, `fullDescription`)
- Complex objects (`rubrics`, `config`, `metrics`)
- Binary data (`image`, `file`)
- Large arrays (`messages`, `items`)

The reason these belong only on Detail: list pages render many rows, so pulling heavy fields blows up payload size and slows render. Detail pages render one entity, so the full payload is fine.
