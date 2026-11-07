import type { StepSnapshot } from '../types';

export interface ResolvedContextEngine {
  input?: unknown;
  metadata?: unknown;
  output?: unknown;
}

const resolvedBySteps = new WeakMap<
  readonly StepSnapshot[],
  { length: number; resolved: Map<StepSnapshot, ResolvedContextEngine> }
>();

/**
 * Resolve the full Context Engine snapshot of every step that ran the CE.
 *
 * Two storage formats coexist, possibly within one snapshot (a run that spans
 * a deploy):
 * - pooled: `inputRefs` / `outputRef` point into the `pool` entries that any
 *   step of the snapshot introduced. `outputRef` names a list node
 *   `{ base?, refs }`: the list of `base` followed by `refs`. Resolution does not
 *   depend on step order.
 * - changed-fields: `input` / `output` / `metadata` hold full values, and an
 *   omitted field means "same as the closest earlier step that stored it".
 *
 * `metadata` always uses the changed-fields form. Results are memoized per
 * steps array, so per-step callers (viewers) stay linear.
 */
export function resolveContextEngineSteps(
  steps: readonly StepSnapshot[],
): Map<StepSnapshot, ResolvedContextEngine> {
  const cached = resolvedBySteps.get(steps);
  if (cached && cached.length === steps.length) return cached.resolved;

  const pool = new Map<string, unknown>();
  for (const step of steps) {
    const entries = step.contextEngine?.pool;
    if (!entries) continue;
    for (const [ref, value] of Object.entries(entries)) pool.set(ref, value);
  }

  const lookup = (ref: string, stepIndex: number) => {
    if (!pool.has(ref)) {
      throw new Error(
        `Context engine pool entry ${ref} referenced by step ${stepIndex} is missing`,
      );
    }
    return pool.get(ref);
  };

  const lists = new Map<string, string[]>();
  const resolveList = (ref: string, stepIndex: number): string[] => {
    // Walk down to a resolved ancestor, then build the lists back up iteratively.
    const pending: Array<{ node: { base?: string; refs: string[] }; ref: string }> = [];
    let cursor: string | undefined = ref;
    let list: string[] = [];
    while (cursor !== undefined) {
      const known = lists.get(cursor);
      if (known) {
        list = known;
        break;
      }
      const node = lookup(cursor, stepIndex) as { base?: string; refs: string[] };
      pending.push({ node, ref: cursor });
      if (pending.length > pool.size) {
        throw new Error(`Context engine output list ${ref} of step ${stepIndex} is cyclic`);
      }
      cursor = node.base;
    }
    for (const { node, ref: nodeRef } of pending.reverse()) {
      list = [...list, ...node.refs];
      lists.set(nodeRef, list);
    }
    return list;
  };

  const resolved = new Map<StepSnapshot, ResolvedContextEngine>();
  let lastInput: unknown;
  let lastMetadata: unknown;
  let lastOutput: unknown;

  // Stable sort: equal step indexes keep their recorded order.
  const ordered = [...steps].sort((a, b) => a.stepIndex - b.stepIndex);
  for (const step of ordered) {
    const ce = step.contextEngine;
    if (!ce) continue;

    if (ce.inputRefs) {
      lastInput = Object.fromEntries(
        Object.entries(ce.inputRefs).map(([key, ref]) => [key, lookup(ref, step.stepIndex)]),
      );
    } else if (ce.input !== undefined) {
      lastInput = ce.input;
    }

    if (ce.outputRef !== undefined) {
      lastOutput = resolveList(ce.outputRef, step.stepIndex).map((ref) =>
        lookup(ref, step.stepIndex),
      );
    } else if (ce.output !== undefined) {
      lastOutput = ce.output;
    }

    if (ce.metadata !== undefined) lastMetadata = ce.metadata;

    resolved.set(step, { input: lastInput, metadata: lastMetadata, output: lastOutput });
  }

  resolvedBySteps.set(steps, { length: steps.length, resolved });
  return resolved;
}
