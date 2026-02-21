// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { userPersonaDocumentHistories, userPersonaDocuments, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { UserPersonaModel } from '../persona';

const userId = 'persona-user';

let personaModel: UserPersonaModel;
const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  await serverDB.delete(userPersonaDocumentHistories);
  await serverDB.delete(userPersonaDocuments);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: userId }]);

  personaModel = new UserPersonaModel(serverDB, userId);
});

describe('UserPersonaModel', () => {
  it('creates a new persona document with optional diff', async () => {
    const { document, diff } = await personaModel.upsertPersona({
      diffPersona: '- added intro',
      editedBy: 'user',
      memoryIds: ['mem-1'],
      reasoning: 'First draft',
      snapshot: '# Persona',
      sourceIds: ['src-1'],
      persona: '# Persona',
    });

    expect(document.userId).toBe(userId);
    expect(document.version).toBe(1);
    expect(document.persona).toBe('# Persona');
    expect(diff?.previousVersion ?? undefined).toBeUndefined();
    expect(diff?.nextVersion).toBe(1);
    expect(diff?.memoryIds).toEqual(['mem-1']);
    expect(diff?.sourceIds).toEqual(['src-1']);
  });

  it('increments version and records diff on update', async () => {
    await personaModel.upsertPersona({
      persona: '# v1',
    });

    const { document, diff } = await personaModel.upsertPersona({
      diffPersona: '- updated section',
      reasoning: 'Second draft',
      memoryIds: ['mem-2'],
      snapshot: '# v2',
      sourceIds: ['src-2'],
      persona: '# v2',
    });

    expect(document.version).toBe(2);
    expect(diff?.previousVersion).toBe(1);
    expect(diff?.nextVersion).toBe(2);
    expect(diff?.personaId).toBe(document.id);

    const persisted = await serverDB.query.userPersonaDocumentHistories.findMany({
      where: (t, { eq }) => eq(t.userId, userId),
    });
    expect(persisted).toHaveLength(1);
  });

  it('skips diff insert when no diff content supplied', async () => {
    const { diff } = await personaModel.upsertPersona({
      persona: '# only persona',
    });

    expect(diff).toBeUndefined();
    const persisted = await serverDB.query.userPersonaDocumentHistories.findMany({
      where: (t, { eq }) => eq(t.userId, userId),
    });
    expect(persisted).toHaveLength(0);
  });

  it('returns latest document for user', async () => {
    await personaModel.upsertPersona({ persona: '# v1' });
    await personaModel.upsertPersona({ persona: '# v2' });

    const latest = await personaModel.getLatestPersonaDocument();
    expect(latest?.persona).toBe('# v2');
    expect(latest?.version).toBe(2);
  });

  it('lists diffs ordered by createdAt desc', async () => {
    await personaModel.upsertPersona({
      diffPersona: '- change',
      memoryIds: ['mem-1'],
      sourceIds: ['src-1'],
      persona: '# v1',
    });

    await personaModel.upsertPersona({
      diffPersona: '- change 2',
      memoryIds: ['mem-2'],
      sourceIds: ['src-2'],
      persona: '# v2',
    });

    const diffs = await personaModel.listDiffs();
    expect(diffs).toHaveLength(2);
  });
});
