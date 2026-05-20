import type { ExecutionSnapshot } from '@lobechat/agent-tracing';

import type { MockCase } from '../types';
import { snapshotToEvents } from './snapshotToEvents';

/**
 * Convert a raw ExecutionSnapshot JSON object into a MockCase.
 */
export function snapshotToMockCase(
  snapshot: ExecutionSnapshot,
  meta: { id: string; name?: string; path: string },
): MockCase {
  const events = snapshotToEvents(snapshot);
  const toolCount = events.filter((e) => e.type === 'tool_start').length;
  const stepCount = events.filter((e) => e.type === 'step_start').length;
  const totalMs = events.reduce((s, e) => s + (e.delay ?? 0), 0);

  return {
    id: meta.id,
    name: meta.name ?? meta.id,
    tags: ['snapshot'],
    source: { type: 'snapshot', path: meta.path, events },
    meta: { toolCount, stepCount, estimatedDurationMs: totalMs },
  };
}
