// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { VerifyCriterionModel } from '../verifyCriterion';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-criterion-coverage-user';
const documentId = 'verify-criterion-coverage-doc';

beforeEach(async () => {
  // Documents and criteria cascade from the owning user.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('VerifyCriterionModel coverage', () => {
  it('freezes a document fixture without content as an empty string', async () => {
    await serverDB.insert(documents).values({
      content: null,
      fileType: 'text/plain',
      id: documentId,
      source: 'test',
      sourceType: 'api',
      title: 'Empty fixture',
      totalCharCount: 0,
      totalLineCount: 0,
      userId,
    });

    const [result] = await new VerifyCriterionModel(serverDB, userId).materialize(
      [
        {
          definition: {
            fixtures: [
              { id: 'fixture', name: 'Input', resource: { id: documentId, type: 'document' } },
            ],
          },
          id: 'empty-fixture-check',
          index: 0,
          onFail: 'manual',
          required: true,
          title: 'Empty fixture check',
          verifierConfig: {},
          verifierType: 'agent',
        } as any,
      ],
      'verify-criterion-coverage-context',
    );

    expect(result.resourceSnapshot).toEqual({
      fixtures: [{ content: '', fixtureId: 'fixture' }],
    });
  });
});
