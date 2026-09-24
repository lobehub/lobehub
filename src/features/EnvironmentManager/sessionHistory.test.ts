import { describe, expect, it } from 'vitest';

import { withoutBuildVehicles } from './SessionHistorySection';

const session = (overrides: Partial<any>): any => ({
  buildId: null,
  endedAt: null,
  endReason: null,
  environment: 'inst-a',
  id: 1,
  instanceId: 'inst-a',
  instanceName: 'Lobehub Dev',
  kind: 'session',
  management: false,
  sessionId: 'sess-1',
  sessionUserId: 'user_1',
  snapshotBytes: null,
  startedAt: '2026-09-24T02:00:00.000Z',
  topicId: null,
  topicTitle: null,
  ...overrides,
});

describe('withoutBuildVehicles', () => {
  it('shows one run for a build, not two', () => {
    // The trail records a build twice — once when its sandbox starts, as a
    // management session, once when the build does — and the panel listed both
    // side by side, the first labelled "file browser".
    const rows = [
      session({ buildId: 'build-1', id: 2, kind: 'build', management: true }),
      session({ id: 1, management: true }),
    ];

    const kept = withoutBuildVehicles(rows);

    expect(kept.map((row) => row.kind)).toEqual(['build']);
  });

  it('keeps a console session that no build rode in on', () => {
    // The file browser opens one of these on its own; nothing else explains it.
    const rows = [session({ id: 1, management: true, sessionId: 'sess-console' })];

    expect(withoutBuildVehicles(rows)).toEqual(rows);
  });

  it('keeps a console session running beside an unrelated build', () => {
    const rows = [
      session({ buildId: 'build-1', id: 3, kind: 'build', management: true }),
      session({ id: 2, management: true, sessionId: 'sess-console' }),
    ];

    expect(withoutBuildVehicles(rows).map((row) => row.sessionId)).toEqual([
      'sess-1',
      'sess-console',
    ]);
  });

  it("never drops a conversation's own run", () => {
    // A conversation is not a management session, so even sharing a sandbox
    // with a build could not remove it from the list.
    const rows = [
      session({ buildId: 'build-1', id: 2, kind: 'build', management: true }),
      session({ id: 1, topicId: 'tpc-1', topicTitle: 'Some topic' }),
    ];

    expect(withoutBuildVehicles(rows).map((row) => row.topicId)).toEqual([null, 'tpc-1']);
  });

  it('leaves a list with no builds in it alone', () => {
    const rows = [session({ id: 1, topicId: 'tpc-1' })];

    expect(withoutBuildVehicles(rows)).toBe(rows);
  });
});
