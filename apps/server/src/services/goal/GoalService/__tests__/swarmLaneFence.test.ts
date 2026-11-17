// @vitest-environment node
import type { GoalGraphSnapshot } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { isClosedSwarmLane } from '../swarm';

const laneNodeId = 'node_lane_a';
const promoteNodeId = 'node_promote';

const snapshot = (options: {
  laneStatus?: 'backlog' | 'resolved' | 'retired' | 'running';
  swarm?: boolean;
  wrapUp?: boolean;
}) =>
  ({
    goal: {
      config:
        options.swarm === false
          ? {}
          : {
              swarm: {
                lanes: [{ key: 'A', taskNodeId: laneNodeId }],
                ...(options.wrapUp
                  ? {
                      wrapUp: {
                        championLane: 'A',
                        championScore: 41,
                        promoteNodeId,
                        startedAt: '2026-01-01T00:00:00Z',
                      },
                    }
                  : {}),
              },
            },
    },
    nodes: [
      { id: laneNodeId, status: options.laneStatus ?? 'backlog' },
      { id: promoteNodeId, status: 'backlog' },
    ],
  }) as unknown as GoalGraphSnapshot;

describe('isClosedSwarmLane', () => {
  it('lets a backlog lane start normally before the deadline', () => {
    expect(isClosedSwarmLane(snapshot({}), laneNodeId)).toBe(false);
  });

  it('closes the lane once another advance has claimed the wrap-up', () => {
    expect(isClosedSwarmLane(snapshot({ laneStatus: 'resolved', wrapUp: true }), laneNodeId)).toBe(
      true,
    );
  });

  it('closes a lane node that is already resolved or retired', () => {
    expect(isClosedSwarmLane(snapshot({ laneStatus: 'resolved' }), laneNodeId)).toBe(true);
    expect(isClosedSwarmLane(snapshot({ laneStatus: 'retired' }), laneNodeId)).toBe(true);
  });

  it('keeps the promotion Task dispatchable while the wrap-up runs', () => {
    expect(
      isClosedSwarmLane(snapshot({ laneStatus: 'resolved', wrapUp: true }), promoteNodeId),
    ).toBe(false);
  });

  it('leaves ordinary goals alone', () => {
    expect(isClosedSwarmLane(snapshot({ swarm: false }), laneNodeId)).toBe(false);
  });
});
