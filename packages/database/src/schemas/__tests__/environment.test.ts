// @vitest-environment node
import { readFile } from 'node:fs/promises';

import type { EnvironmentConfiguration } from '@lobechat/types';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, environments, projectEnvironments, projects, users, workspaces } from '..';

const db = await getTestDB();
const userId = 'environment-schema-user';
const workspaceId = 'environment-schema-workspace';
const configuration: EnvironmentConfiguration = {
  runtime: { image: 'node:22', kind: 'container' },
};

const createEnvironment = async (name = 'Development', scope?: string) => {
  const [environment] = await db
    .insert(environments)
    .values({
      configuration,
      name,
      provider: 'test-provider',
      userId,
      workspaceId: scope,
    })
    .returning();
  return environment;
};

const createProject = async (identifier: string) => {
  const [agent] = await db.insert(agents).values({ userId, virtual: true }).returning();
  const [project] = await db
    .insert(projects)
    .values({
      coordinatorAgentId: agent.id,
      identifier,
      name: identifier,
      userId,
    })
    .returning();
  return project;
};

beforeEach(async () => {
  await db.insert(users).values({ id: userId });
});

afterEach(async () => {
  // Explicit unlink and cleanup mirrors the resource deletion contract.
  await db
    .delete(projectEnvironments)
    .where(
      inArray(
        projectEnvironments.environmentId,
        db
          .select({ id: environments.id })
          .from(environments)
          .where(eq(environments.userId, userId)),
      ),
    );
  await db.delete(environments).where(eq(environments.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('Environment registration schema', () => {
  it('replays the migration without losing existing registrations', async () => {
    const environment = await createEnvironment();
    const migration = await readFile(
      new URL('../../../migrations/0163_environments.sql', import.meta.url),
      'utf8',
    );
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await db.execute(sql.raw(statement));
    }
    expect(
      await db.select().from(environments).where(eq(environments.id, environment.id)),
    ).toHaveLength(1);
  });

  it.each<EnvironmentConfiguration>([
    { runtime: { image: 'node:22', kind: 'container' }, workingDirectory: '/workspace' },
    {
      runtime: { kind: 'virtualMachine', templateId: 'office-desktop' },
      workingDirectory: 'C:\\Work',
    },
    {
      resources: { gpu: { count: 2, memoryGiB: 24 }, memoryGiB: 64 },
      runtime: { kind: 'attached', resourceId: 'gpu-host-1' },
    },
  ])('stores runtime configuration without requiring a repository: %j', async (value) => {
    const [row] = await db
      .insert(environments)
      .values({
        configuration: value,
        name: 'Work environment',
        provider: 'test-provider',
        userId,
      })
      .returning();
    expect(row).toMatchObject({
      configuration: value,
      configurationVersion: 1,
      enabled: true,
      workspaceId: null,
    });
  });

  it('rejects empty names, providers and nonpositive configuration versions', async () => {
    const values = { configuration, name: 'Development', provider: 'test-provider', userId };
    await expect(db.insert(environments).values({ ...values, name: '  ' })).rejects.toThrow();
    await expect(db.insert(environments).values({ ...values, provider: ' ' })).rejects.toThrow();
    await expect(
      db.insert(environments).values({ ...values, configurationVersion: 0 }),
    ).rejects.toThrow();
  });

  it('retains environment records until explicit cleanup on owner or workspace deletion', async () => {
    await db
      .insert(workspaces)
      .values({ id: workspaceId, name: 'Team', primaryOwnerId: userId, slug: workspaceId });
    const environment = await createEnvironment('Team environment', workspaceId);
    await expect(db.delete(workspaces).where(eq(workspaces.id, workspaceId))).rejects.toThrow();
    await expect(db.delete(users).where(eq(users.id, userId))).rejects.toThrow();
    expect(
      await db.select().from(environments).where(eq(environments.id, environment.id)),
    ).toHaveLength(1);
  });

  it('shares one environment between projects with independent default selections', async () => {
    const environment = await createEnvironment();
    const a = await createProject('AAA');
    const b = await createProject('BBB');
    await db.insert(projectEnvironments).values([
      { environmentId: environment.id, isDefault: true, projectId: a.id },
      { environmentId: environment.id, isDefault: true, projectId: b.id },
    ]);
    const links = await db
      .select()
      .from(projectEnvironments)
      .where(eq(projectEnvironments.environmentId, environment.id));
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.enabled && link.isDefault)).toBe(true);
  });

  it('enforces unique associations and at most one enabled default per project', async () => {
    const project = await createProject('AAA');
    const a = await createEnvironment('A');
    const b = await createEnvironment('B');
    const link = { environmentId: a.id, isDefault: true, projectId: project.id };
    await db.insert(projectEnvironments).values(link);
    await expect(
      db.insert(projectEnvironments).values({ ...link, isDefault: false }),
    ).rejects.toThrow();
    await expect(
      db.insert(projectEnvironments).values({ ...link, environmentId: b.id }),
    ).rejects.toThrow();
    await expect(
      db
        .update(projectEnvironments)
        .set({ enabled: false })
        .where(eq(projectEnvironments.projectId, project.id)),
    ).rejects.toThrow();
    await db.transaction(async (tx) => {
      await tx
        .update(projectEnvironments)
        .set({ enabled: false, isDefault: false })
        .where(eq(projectEnvironments.projectId, project.id));
      await tx.insert(projectEnvironments).values({ ...link, environmentId: b.id });
    });
  });

  it('unlinking or deleting a project preserves the shared environment', async () => {
    const environment = await createEnvironment();
    const a = await createProject('AAA');
    const b = await createProject('BBB');
    await db.insert(projectEnvironments).values([
      { environmentId: environment.id, projectId: a.id },
      { environmentId: environment.id, projectId: b.id },
    ]);
    await db.delete(projectEnvironments).where(eq(projectEnvironments.projectId, a.id));
    await db.delete(projects).where(eq(projects.id, b.id));
    expect(
      await db
        .select()
        .from(projectEnvironments)
        .where(eq(projectEnvironments.environmentId, environment.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(environments).where(eq(environments.id, environment.id)),
    ).toHaveLength(1);
  });

  it('requires unlinking before environment deletion and rejects dangling references', async () => {
    const environment = await createEnvironment();
    const project = await createProject('AAA');
    const link = { environmentId: environment.id, projectId: project.id };
    await db.insert(projectEnvironments).values(link);
    await expect(
      db.delete(environments).where(eq(environments.id, environment.id)),
    ).rejects.toThrow();
    await db
      .delete(projectEnvironments)
      .where(eq(projectEnvironments.environmentId, environment.id));
    await db.delete(environments).where(eq(environments.id, environment.id));
    await expect(db.insert(projectEnvironments).values(link)).rejects.toThrow();
  });
});
