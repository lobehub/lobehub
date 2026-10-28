// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { ProjectDirectoryRepository } from '../../repositories/projectDirectory';
import {
  agents,
  devices,
  environmentInstances,
  environments,
  projectEnvironments,
  projects,
  projectWorkingDirectories,
  topics,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  normalizeProjectDirectory,
  ProjectWorkingDirectoryModel,
} from '../projectWorkingDirectory';

const userId = 't863-proj-dir-user';
const projectId = 't863-proj-dir-project';

const serverDB: LobeChatDatabase = await getTestDB();

const model = new ProjectWorkingDirectoryModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(projects).values({ id: projectId, name: 'Directory', userId });
});

afterEach(async () => {
  // Environment rows restrict deletes, so they go first; everything else cascades with the owner.
  const ownEnvironments = serverDB
    .select({ id: environments.id })
    .from(environments)
    .where(eq(environments.userId, userId));
  await serverDB.delete(projectEnvironments).where(eq(projectEnvironments.projectId, projectId));
  await serverDB
    .delete(environmentInstances)
    .where(inArray(environmentInstances.environmentId, ownEnvironments));
  await serverDB.delete(environments).where(eq(environments.userId, userId));
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

const createDirectory = async () => {
  const [device] = await serverDB
    .insert(devices)
    .values({
      deviceId: 't863-proj-dir-device',
      identitySource: 'fallback',
      platform: 'linux',
      userId,
    })
    .returning();
  const [directory] = await serverDB
    .insert(projectWorkingDirectories)
    .values({ deviceId: device.id, name: 'Repo', path: '/work/repo', projectId })
    .returning();
  return directory;
};

describe('normalizeProjectDirectory coverage', () => {
  it('keeps a filesystem root as is', () => {
    expect(normalizeProjectDirectory('/', 'linux')).toBe('/');
    expect(normalizeProjectDirectory('C:\\', 'win32')).toBe('C:\\');
  });
});

describe('ProjectWorkingDirectoryModel coverage', () => {
  it('refuses to list the directories of a project the caller cannot see', async () => {
    await expect(model.list('t863-proj-dir-missing')).rejects.toThrow(
      'Project not found or access denied',
    );
  });

  it('refuses a directory-bound conversation that lost its project', async () => {
    const directory = await createDirectory();
    const [topic] = await serverDB
      .insert(topics)
      .values({ projectWorkingDirectoryId: directory.id, title: 'Orphan', userId })
      .returning();

    await expect(model.resolveForTopic(topic.id)).rejects.toThrow(
      'Project directory has no owning project',
    );
  });

  it('refuses a conversation whose directory differs from its project binding', async () => {
    await serverDB.insert(agents).values({ id: 't863-proj-dir-agent', userId });
    await serverDB.insert(devices).values({
      deviceId: 't863-proj-dir-device',
      identitySource: 'fallback',
      platform: 'linux',
      userId,
    });
    const directory = await new ProjectDirectoryRepository(serverDB, userId).bind({
      deviceId: 't863-proj-dir-device',
      name: 'Repo',
      path: '/work/repo',
      projectId,
    });
    const [topic] = await serverDB
      .insert(topics)
      .values({
        agentId: 't863-proj-dir-agent',
        metadata: { workingDirectory: '/work/elsewhere' },
        projectId,
        projectWorkingDirectoryId: directory.id,
        title: 'Moved',
        userId,
      })
      .returning();

    await expect(model.resolveForTopic(topic.id)).rejects.toThrow(
      'Conversation directory differs from its project binding',
    );
  });
});
