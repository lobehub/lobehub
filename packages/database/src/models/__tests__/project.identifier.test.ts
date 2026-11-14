import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { ProjectRepository } from '../../repositories/project';
import { agents, environments, projectEnvironments, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ProjectModel } from '../project';
import { isProjectIdentifierConflict, ProjectIdentifierTakenError } from '../projectIdentifier';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'project-identifier-user';
const otherUserId = 'project-identifier-other-user';

describe('ProjectModel identifier allocation', () => {
  const model = new ProjectModel(serverDB, userId);
  const repo = new ProjectRepository(serverDB, userId);
  const otherRepo = new ProjectRepository(serverDB, otherUserId);

  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await serverDB.delete(projectEnvironments);
    await serverDB.delete(environments);
    await serverDB.delete(users);
  });

  it('normalizes identifiers and enforces uniqueness within their ownership scope', async () => {
    const first = await repo.create({ identifier: ' lobe ', name: 'First' });
    expect(first.identifier).toBe('LOBE');

    await expect(repo.create({ identifier: 'LOBE', name: 'Duplicate' })).rejects.toThrow();
    await expect(otherRepo.create({ identifier: 'LOBE', name: 'Other user' })).resolves.toEqual(
      expect.objectContaining({ identifier: 'LOBE' }),
    );

    await serverDB.insert(workspaces).values({
      id: 'identifier-workspace',
      name: 'Identifier Workspace',
      primaryOwnerId: userId,
      slug: 'identifier-workspace',
    });
    const ownerRepo = new ProjectRepository(serverDB, userId, 'identifier-workspace');
    const memberRepo = new ProjectRepository(serverDB, otherUserId, 'identifier-workspace');
    await ownerRepo.create({ identifier: 'TEAM', name: 'Workspace project' });
    await expect(
      memberRepo.create({ identifier: 'TEAM', name: 'Workspace duplicate' }),
    ).rejects.toThrow();
  });

  it('reports a taken identifier as a field error and leaves no orphan coordinator', async () => {
    await repo.create({ identifier: 'LOBE', name: 'First' });

    expect(await model.isIdentifierTaken('lobe')).toBe(true);
    expect(await model.isIdentifierTaken('MOBILE')).toBe(false);

    const agentsBefore = await serverDB.select().from(agents).where(eq(agents.userId, userId));

    await expect(repo.create({ identifier: 'LOBE', name: 'Second' })).rejects.toThrow(
      ProjectIdentifierTakenError,
    );
    // The check runs before the coordinator is inserted, so a collision must not
    // leak an agent the failed transaction created.
    expect(await serverDB.select().from(agents).where(eq(agents.userId, userId))).toHaveLength(
      agentsBefore.length,
    );
  });

  it('treats another member private project as occupying the identifier', async () => {
    await serverDB.insert(workspaces).values({
      id: 'private-identifier-workspace',
      name: 'Private Identifier Workspace',
      primaryOwnerId: userId,
      slug: 'private-identifier-workspace',
    });
    const ownerRepo = new ProjectRepository(serverDB, userId, 'private-identifier-workspace');
    const member = new ProjectModel(serverDB, otherUserId, 'private-identifier-workspace');
    const memberRepo = new ProjectRepository(serverDB, otherUserId, 'private-identifier-workspace');
    const hidden = await ownerRepo.create({
      identifier: 'PRIV',
      name: 'Private',
      visibility: 'private',
    });

    // The member cannot see the project — which is exactly why a visibility-aware
    // check would wrongly report the identifier as free.
    expect(await member.findById(hidden.id)).toBeNull();
    // The unique index is scope-wide regardless of visibility, so it is taken.
    expect(await member.isIdentifierTaken('PRIV')).toBe(true);
    await expect(memberRepo.create({ identifier: 'PRIV', name: 'Clash' })).rejects.toThrow(
      ProjectIdentifierTakenError,
    );
  });

  it('requires identifiers to contain between 3 and 6 characters', async () => {
    await expect(repo.create({ identifier: 'AB', name: 'Too short' })).rejects.toThrow(
      'Project identifier must be between 3 and 6 characters',
    );
    await expect(repo.create({ identifier: 'ABCDEFG', name: 'Too long' })).rejects.toThrow(
      'Project identifier must be between 3 and 6 characters',
    );
    await expect(repo.create({ identifier: 'ABC', name: 'Minimum' })).resolves.toEqual(
      expect.objectContaining({ identifier: 'ABC' }),
    );
    await expect(repo.create({ identifier: 'ABCDEF', name: 'Maximum' })).resolves.toEqual(
      expect.objectContaining({ identifier: 'ABCDEF' }),
    );
  });
});

describe('isProjectIdentifierConflict', () => {
  it('matches the identifier indexes by constraint name', () => {
    expect(
      isProjectIdentifierConflict({ constraint: 'projects_identifier_user_id_key', code: '23505' }),
    ).toBe(true);
  });

  it('matches a bare unique violation that names the identifier constraint', () => {
    expect(
      isProjectIdentifierConflict({
        code: '23505',
        message: 'duplicate key value violates unique constraint "projects_identifier_pkey"',
      }),
    ).toBe(true);
  });

  it('ignores unrelated unique violations and non-string messages', () => {
    expect(isProjectIdentifierConflict({ code: '23505', message: 42 })).toBe(false);
    expect(isProjectIdentifierConflict({ code: '23505', constraint: 'projects_slug_key' })).toBe(
      false,
    );
    expect(isProjectIdentifierConflict({ cause: new Error('plain') })).toBe(false);
    expect(isProjectIdentifierConflict(null)).toBe(false);
  });
});
