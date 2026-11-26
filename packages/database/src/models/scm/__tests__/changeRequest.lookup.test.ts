// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { scmChangeRequests, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ScmChangeRequestModel } from '../changeRequest';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'scm-lookup-user';
const otherUserId = 'scm-lookup-other-user';
const scope = { userId, workspaceId: null };

const row = (number: number, overrides: Record<string, unknown> = {}) =>
  ScmChangeRequestModel.upsert(serverDB, {
    headRef: `feat/${number}`,
    headSha: String(number).repeat(40).slice(0, 40),
    number,
    provider: 'github',
    repoFullName: 'LobeHub/LobeHub',
    state: 'open',
    url: `https://github.com/LobeHub/LobeHub/pull/${number}`,
    userId,
    ...overrides,
  });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(scmChangeRequests);
  await serverDB.delete(users);
});

describe('ScmChangeRequestModel.listByIdentities', () => {
  it('matches owner/repo#number case-insensitively within the scope', async () => {
    await row(1);
    await row(2);
    await row(3, { userId: otherUserId });

    const rows = await ScmChangeRequestModel.listByIdentities(serverDB, scope, [
      { number: 1, repoFullName: 'lobehub/lobehub' },
      { number: 3, repoFullName: 'lobehub/lobehub' },
      { number: 9, repoFullName: 'lobehub/lobehub' },
    ]);

    expect(rows.map((r) => r.number)).toEqual([1]);
    expect(await ScmChangeRequestModel.listByIdentities(serverDB, scope, [])).toEqual([]);
  });
});

describe('ScmChangeRequestModel.listOpenByHeadRefs', () => {
  it('finds the open pull requests whose head a push updated', async () => {
    await row(1, { headRef: 'feat/x' });
    await row(2, { headRef: 'feat/x', state: 'closed' });
    await row(3, { headRef: 'feat/y' });
    await row(4, { headRef: 'feat/x', repoFullName: 'lobehub/other' });
    await row(5, { headRef: 'feat/x', userId: otherUserId });

    const rows = await ScmChangeRequestModel.listOpenByHeadRefs(
      serverDB,
      scope,
      'lobehub/LOBEHUB',
      ['feat/x'],
    );

    expect(rows.map((r) => r.number)).toEqual([1]);
    expect(await ScmChangeRequestModel.listOpenByHeadRefs(serverDB, scope, 'a/b', [])).toEqual([]);
  });
});
