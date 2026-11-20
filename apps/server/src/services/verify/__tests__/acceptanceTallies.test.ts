// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import { acceptances, users, verifyCheckResults, verifyRuns } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = `acceptance-tallies-${randomUUID()}`;
const otherUserId = `acceptance-tallies-other-${randomUUID()}`;

const planItem = (id: string) => ({
  id,
  index: 0,
  onFail: 'manual' as const,
  required: true,
  title: id,
  verifierConfig: {},
  verifierType: 'llm' as const,
});

const seedAcceptance = async (owner = userId) => {
  const [row] = await serverDB
    .insert(acceptances)
    .values({ subjectId: randomUUID(), subjectType: 'standalone', userId: owner })
    .returning();
  return row.id;
};

const seedRound = async (
  acceptanceId: string,
  roundIndex: number,
  plan: string[],
  results: [checkItemId: string, verdict: 'passed' | 'failed' | 'uncertain'][],
  owner = userId,
) => {
  const [run] = await serverDB
    .insert(verifyRuns)
    .values({
      acceptanceId,
      plan: plan.map(planItem),
      roundIndex,
      title: `round ${roundIndex}`,
      userId: owner,
    })
    .returning();

  if (results.length > 0)
    await serverDB.insert(verifyCheckResults).values(
      results.map(([checkItemId, verdict]) => ({
        checkItemId,
        // `uncertain` is a verdict, not a run status; the union reads the
        // verdict first, so the status only has to be a legal value.
        status: verdict === 'uncertain' ? ('running' as const) : verdict,
        userId: owner,
        verdict,
        verifierType: 'llm' as const,
        verifyRunId: run.id,
      })),
    );

  return run.id;
};

const talliesOf = (ids: string[]) =>
  new AcceptanceService(serverDB, userId).getCheckTalliesByAcceptances(ids);

beforeAll(async () => {
  await serverDB
    .insert(users)
    .values([{ id: userId }, { id: otherUserId }])
    .onConflictDoNothing();
});

afterAll(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('AcceptanceService.getCheckTalliesByAcceptances', () => {
  it('tallies a repaired acceptance by its union, not by the repair round alone', async () => {
    const acceptanceId = await seedAcceptance();
    await seedRound(
      acceptanceId,
      1,
      ['c1', 'c2'],
      [
        ['c1', 'passed'],
        ['c2', 'failed'],
      ],
    );
    // The repair round re-runs only the check it was asked to fix; c1 is
    // carried forward. Counting this round's own rows would report one passed
    // beside a list that expands to two.
    await seedRound(acceptanceId, 2, ['c1', 'c2'], [['c2', 'passed']]);

    const tallies = await talliesOf([acceptanceId]);

    expect(tallies.get(acceptanceId)).toEqual({ failed: 0, passed: 2, total: 2, unjudged: 0 });
  });

  it('leaves an acceptance with no round out of the map — absent is not zero', async () => {
    const withRun = await seedAcceptance();
    const withoutRun = await seedAcceptance();
    await seedRound(withRun, 1, ['c1'], [['c1', 'passed']]);

    const tallies = await talliesOf([withRun, withoutRun]);

    expect(tallies.has(withoutRun)).toBe(false);
    expect(tallies.get(withRun)).toEqual({ failed: 0, passed: 1, total: 1, unjudged: 0 });
  });

  it('counts a round that judged nothing as its planned checks, unjudged', async () => {
    const acceptanceId = await seedAcceptance();
    await seedRound(acceptanceId, 1, ['c1', 'c2'], []);

    const tallies = await talliesOf([acceptanceId]);

    // The level expands to two checks, so it says two — not nothing.
    expect(tallies.get(acceptanceId)).toEqual({ failed: 0, passed: 0, total: 2, unjudged: 2 });
  });

  it('never reads another user’s acceptances', async () => {
    const theirs = await seedAcceptance(otherUserId);
    await seedRound(theirs, 1, ['c1'], [['c1', 'passed']], otherUserId);

    const tallies = await talliesOf([theirs]);

    expect(tallies.size).toBe(0);
  });
});
