import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { DeviceActivityOrder, WorkingDirConfig } from './device';
import { sortDevicesByActivity, workingDirConfigSchema } from './device';

describe('sortDevicesByActivity', () => {
  const device = (
    over: Partial<DeviceActivityOrder> & { deviceId: string },
  ): DeviceActivityOrder => ({
    lastSeen: '2026-01-01T00:00:00.000Z',
    online: false,
    ...over,
  });

  /**
   * The regression this ordering exists for: the picker disables offline rows,
   * so an offline device sorted above an online one pushes the only *pickable*
   * machine out of a viewport that caps at a few rows. `lastSeenAt` is stamped
   * on register and never refreshed, so a box that reconnects on every boot
   * reports a fresher timestamp than one holding a month-long session — recency
   * must never be able to outrank liveness.
   */
  it('ranks an online device above an offline one that registered far more recently', () => {
    const sorted = sortDevicesByActivity([
      device({ deviceId: 'rebooted-vm', lastSeen: '2026-03-01T00:00:00.000Z' }),
      device({
        channels: [{ connectedAt: '2026-01-05T00:00:00.000Z' }],
        deviceId: 'long-lived',
        lastSeen: '2026-01-05T00:00:00.000Z',
        online: true,
      }),
    ]);

    expect(sorted.map((d) => d.deviceId)).toEqual(['long-lived', 'rebooted-vm']);
  });

  it('orders online devices by their newest live connection', () => {
    const sorted = sortDevicesByActivity([
      device({
        channels: [{ connectedAt: '2026-01-01T00:00:00.000Z' }],
        deviceId: 'stale',
        online: true,
      }),
      device({
        // Multiple live channels → the freshest one is the activity signal.
        channels: [
          { connectedAt: '2026-01-02T00:00:00.000Z' },
          { connectedAt: '2026-06-01T00:00:00.000Z' },
        ],
        deviceId: 'fresh',
        online: true,
      }),
    ]);

    expect(sorted.map((d) => d.deviceId)).toEqual(['fresh', 'stale']);
  });

  it('orders offline devices by lastSeen', () => {
    const sorted = sortDevicesByActivity([
      device({ deviceId: 'older', lastSeen: '2026-01-01T00:00:00.000Z' }),
      device({ deviceId: 'newer', lastSeen: '2026-05-01T00:00:00.000Z' }),
    ]);

    expect(sorted.map((d) => d.deviceId)).toEqual(['newer', 'older']);
  });

  /**
   * These lists poll. Without a total order, two rows sharing a timestamp may
   * swap places between refreshes — under the user's cursor, mid-click.
   */
  it('breaks timestamp ties by deviceId so repeated sorts are stable', () => {
    const tied = [device({ deviceId: 'c' }), device({ deviceId: 'a' }), device({ deviceId: 'b' })];

    expect(sortDevicesByActivity(tied).map((d) => d.deviceId)).toEqual(['a', 'b', 'c']);
    // Re-sorting an already-sorted list must not reshuffle it.
    expect(sortDevicesByActivity(sortDevicesByActivity(tied)).map((d) => d.deviceId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  /**
   * `online: true` with no channels is reachable — the runtime derives `online`
   * as `!!live` and tolerates a gateway that omits `channels`. Such a row must
   * still sort above every offline device rather than crash or sink.
   */
  it('keeps an online device with no channels in the online partition', () => {
    const sorted = sortDevicesByActivity([
      device({ deviceId: 'offline-recent', lastSeen: '2026-09-01T00:00:00.000Z' }),
      device({ deviceId: 'online-legacy', lastSeen: '2026-01-01T00:00:00.000Z', online: true }),
    ]);

    expect(sorted.map((d) => d.deviceId)).toEqual(['online-legacy', 'offline-recent']);
  });

  it('does not mutate the input array', () => {
    const input = [
      device({ deviceId: 'b', online: true }),
      device({ deviceId: 'a', online: true }),
    ];
    sortDevicesByActivity(input);

    expect(input.map((d) => d.deviceId)).toEqual(['b', 'a']);
  });
});

describe('workingDirConfigSchema', () => {
  /**
   * `WorkingDirConfig` is declared twice — once as the interface everything is typed
   * against, once as the zod schema the TRPC routes validate through. Zod STRIPS what
   * it does not declare, so a field added to only the interface type-checks perfectly
   * and is then silently dropped on every write. This pins the two together, and fails
   * to compile the moment they drift.
   */
  it('stays structurally identical to the WorkingDirConfig interface', () => {
    expectTypeOf<z.infer<typeof workingDirConfigSchema>>().toEqualTypeOf<WorkingDirConfig>();
  });

  it('preserves GitHub PR metadata under git.github', () => {
    const value = {
      git: {
        activeWorktree: '/repo-fix',
        branch: 'fix/worktree',
        github: {
          extraPullRequestCount: 1,
          pullRequest: {
            ciStatus: 'pending',
            isDraft: false,
            mergeStateStatus: 'CLEAN',
            mergeable: 'MERGEABLE',
            mergedAt: null,
            number: 123,
            reviewDecision: 'APPROVED',
            state: 'OPEN',
            title: 'Improve worktree handling',
            url: 'https://github.com/lobehub/lobehub/pull/123',
          },
          pullRequestStatus: 'ok',
        },
        isWorktree: true,
      },
      path: '/repo',
      repoType: 'github',
    };

    expect(workingDirConfigSchema.parse(value)).toEqual(value);
  });

  // The remote ref is the whole point of recording git state that outlives this
  // machine — and zod STRIPS what it does not declare, so a field missing from the
  // schema is not just unvalidated, it never survives a write at all.
  it('preserves the upstream remote ref under git.upstream', () => {
    const value = {
      git: {
        branch: 'worktree-feat+claude-code-session-import',
        upstream: { branch: 'feat/hetero-session-import-ui', remote: 'origin' },
      },
      path: '/repo',
      repoType: 'github',
    };

    expect(workingDirConfigSchema.parse(value)).toEqual(value);
  });
});
