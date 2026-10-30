// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { userPersonaDocuments, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserPersonaModel } from '../persona';

const userId = 'persona-guards-user';
const otherUserId = 'persona-guards-other-user';
const missingUserId = 'persona-guards-missing-user';

const serverDB: LobeChatDatabase = await getTestDB();

const cleanup = () =>
  serverDB.delete(users).where(inArray(users.id, [userId, otherUserId, missingUserId]));

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(cleanup);

describe('UserPersonaModel guards', () => {
  it('refuses to write a persona for a user that does not exist', async () => {
    const model = new UserPersonaModel(serverDB, missingUserId);

    await expect(model.upsertPersona({ persona: 'ghost' })).rejects.toThrow(
      'User persona owner was not found',
    );
    expect(
      await serverDB
        .select()
        .from(userPersonaDocuments)
        .where(inArray(userPersonaDocuments.userId, [missingUserId])),
    ).toEqual([]);
  });

  it('records a diff when only source ids are provided', async () => {
    const model = new UserPersonaModel(serverDB, userId);

    const { diff, document } = await model.upsertPersona({
      persona: 'sourced persona',
      sourceIds: ['source-1'],
    });

    expect(document.sourceIds).toEqual(['source-1']);
    expect(diff).toMatchObject({
      editedBy: 'agent',
      nextVersion: 1,
      personaId: document.id,
      snapshot: 'sourced persona',
      sourceIds: ['source-1'],
    });
  });

  it('reads the default profile through the getLatestDocument alias', async () => {
    const model = new UserPersonaModel(serverDB, userId);
    await model.upsertPersona({ persona: 'default persona' });
    await model.upsertPersona({ persona: 'work persona', profile: 'work' });

    expect((await model.getLatestDocument())?.persona).toBe('default persona');
    expect((await model.getLatestDocument('work'))?.persona).toBe('work persona');
    expect(await new UserPersonaModel(serverDB, otherUserId).getLatestDocument()).toBeUndefined();
  });

  it('lists default-profile versions of the user with the default limit', async () => {
    const model = new UserPersonaModel(serverDB, userId);
    await model.upsertPersona({ persona: 'v1', snapshot: 'v1' });
    await model.upsertPersona({ persona: 'v2', snapshot: 'v2' });
    await model.upsertPersona({ persona: 'work', profile: 'work', snapshot: 'work' });
    await new UserPersonaModel(serverDB, otherUserId).upsertPersona({
      persona: 'theirs',
      snapshot: 'theirs',
    });

    const versions = await model.listVersions();

    expect(versions.map(({ snapshotPersona }) => snapshotPersona).sort()).toEqual(['v1', 'v2']);
  });

  describe('deletePersona', () => {
    it('is a no-op when the profile has no persona', async () => {
      const model = new UserPersonaModel(serverDB, userId);
      await model.upsertPersona({ persona: 'work persona', profile: 'work' });

      await expect(model.deletePersona()).resolves.toBeUndefined();

      expect((await model.getLatestDocument('work'))?.persona).toBe('work persona');
    });

    it('deletes the default profile of the user only', async () => {
      const model = new UserPersonaModel(serverDB, userId);
      const otherModel = new UserPersonaModel(serverDB, otherUserId);
      await model.upsertPersona({ persona: 'mine' });
      await model.upsertPersona({ persona: 'work persona', profile: 'work' });
      await otherModel.upsertPersona({ persona: 'theirs' });

      await model.deletePersona();

      expect(await model.getLatestDocument()).toBeUndefined();
      expect((await model.getLatestDocument('work'))?.persona).toBe('work persona');
      expect((await otherModel.getLatestDocument())?.persona).toBe('theirs');
    });
  });
});
