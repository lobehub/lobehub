// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, devices, projects, projectWorkingDirectories, topics, users } from '..';

const serverDB = await getTestDB();
const userId = 'project-working-directory-schema-user';

const createProjectFixture = async () => {
  const [coordinator] = await serverDB
    .insert(agents)
    .values({ title: 'Coordinator', userId, virtual: true })
    .returning();
  const [project] = await serverDB
    .insert(projects)
    .values({
      coordinatorAgentId: coordinator.id,
      identifier: 'PWD',
      name: 'Directory project',
      userId,
    })
    .returning();
  const [device] = await serverDB
    .insert(devices)
    .values({ deviceId: 'project-working-directory-device', identitySource: 'fallback', userId })
    .returning();

  return { coordinator, device, project };
};

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('Project working directory schema', () => {
  it('persists a device-backed project directory with safe defaults', async () => {
    const { device, project } = await createProjectFixture();
    const [directory] = await serverDB
      .insert(projectWorkingDirectories)
      .values({
        deviceId: device.id,
        isPrimary: true,
        name: 'lobehub',
        path: '/Users/name/Code/lobehub',
        projectId: project.id,
      })
      .returning();

    expect(directory).toMatchObject({
      deviceId: device.id,
      isPrimary: true,
      permission: 'readWrite',
      projectId: project.id,
    });
  });

  it('allows only one primary directory and one binding per project, device, and path', async () => {
    const { device, project } = await createProjectFixture();
    const values = {
      deviceId: device.id,
      isPrimary: true,
      name: 'lobehub',
      path: '/Users/name/Code/lobehub',
      projectId: project.id,
    };

    await serverDB.insert(projectWorkingDirectories).values(values);
    await expect(serverDB.insert(projectWorkingDirectories).values(values)).rejects.toThrow();
    await expect(
      serverDB.insert(projectWorkingDirectories).values({
        ...values,
        name: 'lobehub-cloud',
        path: '/Users/name/Code/lobehub-cloud',
      }),
    ).rejects.toThrow();
  });

  it('keeps project membership when a topic directory is unbound', async () => {
    const { coordinator, device, project } = await createProjectFixture();
    const [directory] = await serverDB
      .insert(projectWorkingDirectories)
      .values({
        deviceId: device.id,
        name: 'lobehub',
        path: '/Users/name/Code/lobehub',
        projectId: project.id,
      })
      .returning();
    const [topic] = await serverDB
      .insert(topics)
      .values({
        agentId: coordinator.id,
        projectId: project.id,
        projectWorkingDirectoryId: directory.id,
        title: 'Implement project grouping',
        userId,
      })
      .returning();

    await serverDB
      .delete(projectWorkingDirectories)
      .where(eq(projectWorkingDirectories.id, directory.id));

    const [persisted] = await serverDB.select().from(topics).where(eq(topics.id, topic.id));
    expect(persisted).toMatchObject({
      projectId: project.id,
      projectWorkingDirectoryId: null,
    });
  });

  it('retains a repairable directory record when its device is removed', async () => {
    const { device, project } = await createProjectFixture();
    const [directory] = await serverDB
      .insert(projectWorkingDirectories)
      .values({
        deviceId: device.id,
        name: 'lobehub',
        path: '/Users/name/Code/lobehub',
        projectId: project.id,
      })
      .returning();

    await serverDB.delete(devices).where(eq(devices.id, device.id));

    const [persisted] = await serverDB
      .select()
      .from(projectWorkingDirectories)
      .where(eq(projectWorkingDirectories.id, directory.id));
    expect(persisted).toMatchObject({ deviceId: null, path: '/Users/name/Code/lobehub' });
  });
});
