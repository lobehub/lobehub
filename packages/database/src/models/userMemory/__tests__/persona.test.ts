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

  it('returns the existing document without updating unchanged persona content', async () => {
    const { document: created } = await personaModel.upsertPersona({
      memoryIds: ['mem-1'],
      persona: '# stable persona',
      sourceIds: ['src-1'],
      tagline: 'Stable',
    });
    const existingDiffs = await serverDB.query.userPersonaDocumentHistories.findMany({
      where: (t, { eq }) => eq(t.userId, userId),
    });

    const { diff, document } = await personaModel.upsertPersona({
      memoryIds: ['mem-1'],
      persona: '# stable persona',
      sourceIds: ['src-1'],
      tagline: 'Stable',
    });

    expect(diff).toBeUndefined();
    expect(document.id).toBe(created.id);
    expect(document.version).toBe(1);
    expect(document.updatedAt).toEqual(created.updatedAt);
    expect(document.accessedAt).toEqual(created.accessedAt);

    const persisted = await serverDB.query.userPersonaDocumentHistories.findMany({
      where: (t, { eq }) => eq(t.userId, userId),
    });
    expect(persisted).toHaveLength(existingDiffs.length);
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

  describe('appendDiff', () => {
    it('should insert a diff record directly', async () => {
      // First create a persona document to reference
      const { document } = await personaModel.upsertPersona({ persona: '# v1' });

      const diff = await personaModel.appendDiff({
        diffPersona: '- manual change',
        memoryIds: ['mem-manual'],
        nextVersion: 2,
        personaId: document.id,
        previousVersion: 1,
        reasoning: 'Manual diff',
        snapshot: '# v2',
        sourceIds: ['src-manual'],
      });

      expect(diff).toBeDefined();
      expect(diff.personaId).toBe(document.id);
      expect(diff.userId).toBe(userId);
      expect(diff.diffPersona).toBe('- manual change');
      expect(diff.previousVersion).toBe(1);
      expect(diff.nextVersion).toBe(2);
      expect(diff.memoryIds).toEqual(['mem-manual']);
      expect(diff.sourceIds).toEqual(['src-manual']);
    });
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

  describe('restoreVersion', () => {
    it('restores a snapshot as a new current version without deleting history', async () => {
      await personaModel.upsertPersona({
        persona: '# v1',
        snapshot: '# v1',
        tagline: 'First',
      });
      await personaModel.upsertPersona({
        persona: '# v2',
        snapshot: '# v2',
        tagline: 'Second',
      });
      const [firstVersion] = (await personaModel.listDiffs()).toReversed();

      const restored = await personaModel.restoreVersion(firstVersion.id);

      expect(restored.document).toMatchObject({
        persona: '# v1',
        tagline: 'First',
        version: 3,
      });
      expect(restored.diff).toMatchObject({
        editedBy: 'user',
        nextVersion: 3,
        previousVersion: 2,
        snapshotPersona: '# v1',
        snapshotTagline: 'First',
      });
      await expect(personaModel.listDiffs()).resolves.toHaveLength(3);
    });

    it('rejects a history entry owned by another user', async () => {
      const otherUserId = 'persona-other-user';
      await serverDB.insert(users).values({ id: otherUserId });
      const otherModel = new UserPersonaModel(serverDB, otherUserId);
      await otherModel.upsertPersona({ persona: '# private', snapshot: '# private' });
      const [otherVersion] = await otherModel.listDiffs();

      await expect(personaModel.restoreVersion(otherVersion.id)).rejects.toThrow(
        'User persona version was not found',
      );
    });

    it('rejects a history entry without a persona snapshot', async () => {
      const { document } = await personaModel.upsertPersona({ persona: '# current' });
      const [history] = await serverDB
        .insert(userPersonaDocumentHistories)
        .values({
          nextVersion: 1,
          personaId: document.id,
          profile: 'default',
          userId,
        })
        .returning();

      await expect(personaModel.restoreVersion(history.id)).rejects.toThrow(
        'User persona version snapshot is unavailable',
      );
    });
  });
});
