import { describe, expect, it } from 'vitest';

import { runningSessionIds, withoutBuildVehicles } from './SessionHistorySection';

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

describe('runningSessionIds', () => {
  const free = { held: new Set<string>(), unknown: false };
  const holding = (...ids: string[]) => ({ held: new Set(ids), unknown: false });
  const running = (rows: any[], occupancy: any) => [...runningSessionIds(rows, occupancy)];

  it('is running while its instance is actually held', () => {
    expect(running([session({})], holding('inst-a'))).toEqual([1]);
  });

  // The bug this exists for: a sandbox that went away without a teardown never
  // gets an `endedAt`, so the row said "running" for twelve hours while the
  // composer's own menu offered the same instance as free.
  it('is not running once the lease on its instance has gone', () => {
    expect(running([session({})], free)).toEqual([]);
  });

  // "Not known" is not "free". A reader that collapses the two would retire
  // every live session on the page the moment the lease store hiccuped.
  it('stays running when the lease store did not answer', () => {
    expect(running([session({})], { held: new Set<string>(), unknown: true })).toEqual([1]);
  });

  it('is never running once an end was recorded, whoever holds the instance', () => {
    const ended = session({ endReason: 'idle', endedAt: '2026-09-24T03:00:00.000Z' });

    expect(running([ended], holding('inst-a'))).toEqual([]);
    expect(running([ended], { held: new Set(['inst-a']), unknown: true })).toEqual([]);
  });

  // The second bug: the lease belongs to the INSTANCE, so one live run made
  // every abandoned record on the same instance read "running" again — three
  // rows at once, two of them 55 and 61 hours old. The execution plane runs one
  // session per instance, so only the newest of them can be the live one.
  it('marks only the newest open run on a held instance', () => {
    const rows = [
      session({ id: 1, startedAt: '2026-09-22T01:00:00.000Z' }),
      session({ id: 2, startedAt: '2026-09-24T09:00:00.000Z' }),
      session({ id: 3, startedAt: '2026-09-23T05:00:00.000Z' }),
    ];

    expect(running(rows, holding('inst-a'))).toEqual([2]);
  });

  it('picks the newest per instance, not one winner for the whole page', () => {
    const rows = [
      session({ environment: 'inst-a', id: 1, startedAt: '2026-09-22T01:00:00.000Z' }),
      session({ environment: 'inst-a', id: 2, startedAt: '2026-09-24T09:00:00.000Z' }),
      session({ environment: 'inst-b', id: 3, startedAt: '2026-09-23T05:00:00.000Z' }),
    ];

    expect(running(rows, holding('inst-a', 'inst-b')).sort()).toEqual([2, 3]);
  });

  // An ended run is not a candidate at all, so it cannot shadow the open one
  // behind it just by being more recent.
  it('ignores ended runs when picking the newest', () => {
    const rows = [
      session({ id: 1, startedAt: '2026-09-22T01:00:00.000Z' }),
      session({
        endReason: 'idle',
        endedAt: '2026-09-24T10:00:00.000Z',
        id: 2,
        startedAt: '2026-09-24T09:00:00.000Z',
      }),
    ];

    expect(running(rows, holding('inst-a'))).toEqual([1]);
  });

  // A build's own record is a run like any other, and it is held by the
  // instance it builds — nothing about it should read differently here.
  it('judges a build the same way', () => {
    const build = session({ buildId: 'build-1', kind: 'build', management: true });

    expect(running([build], holding('inst-a'))).toEqual([1]);
    expect(running([build], free)).toEqual([]);
  });

  it('does not match an instance it has no id for', () => {
    expect(running([session({ environment: null })], holding('inst-a'))).toEqual([]);
  });
});
