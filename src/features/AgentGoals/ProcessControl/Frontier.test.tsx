/**
 * @vitest-environment happy-dom
 */
import type { GoalGraphNode, GoalGraphSnapshot, GoalItem } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Frontier from './Frontier';
import { buildGoalGraphView } from './goalGraphViewModel';

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openAcceptance: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en-US' }, t: (key: string) => key }),
}));

const T0 = new Date('2026-08-01T00:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const goal = {
  config: { recovery: { operationLeaseTimeoutMs: 15 * 60_000 } },
  createdAt: T0,
  id: 'goal-1',
  status: 'running',
  title: 'Goal',
  updatedAt: T0,
} as unknown as GoalItem;

const task = {
  createdAt: at(1),
  goalId: 'goal-1',
  id: 'w1',
  kind: 'task',
  priority: 0,
  status: 'active',
  taskId: 'task-1',
  title: 'Build the share page',
  updatedAt: at(30),
} as unknown as GoalGraphNode;

const snapshot: GoalGraphSnapshot = {
  decisions: [],
  edges: [],
  events: [
    {
      actorId: null,
      actorType: 'system',
      createdAt: at(30),
      entityId: 'w1',
      entityType: 'node',
      eventType: 'activated',
      goalId: 'goal-1',
      id: 'e1',
      operationId: null,
      reason: null,
      taskId: 'task-1',
    },
  ],
  goal,
  nodes: [task],
  workVersions: [],
} as unknown as GoalGraphSnapshot;

describe('Frontier stalled row', () => {
  it('explains the stall without an attempt ledger that still says the attempt is running', () => {
    const graph = buildGoalGraphView(snapshot, at(240).getTime());
    expect(graph.frontier[0]).toMatchObject({ kind: 'stale' });

    render(
      <Frontier
        actions={{ addTask: vi.fn(), decide: vi.fn() }}
        canEdit={false}
        graph={graph}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('goalProcess.tag.stalled')).toBeTruthy();
    expect(screen.getByText('goalProcess.stalled.description')).toBeTruthy();
    // The open attempt reads "Running" under a "Stalled" badge — a contradiction
    // the reader cannot resolve, and the description already says what happened.
    expect(screen.queryByText('goalProcess.attempts.title')).toBeNull();
  });
});
