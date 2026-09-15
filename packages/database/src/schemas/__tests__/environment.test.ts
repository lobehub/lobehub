// @vitest-environment node
import { readFile } from 'node:fs/promises';

import type { EnvironmentConfiguration } from '@lobechat/types';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  devices,
  environmentInstances,
  environments,
  projectEnvironments,
  projects,
  users,
  workspaces,
} from '..';

const db = await getTestDB();
const userId = 'environment-schema-user';
const workspaceId = 'environment-schema-workspace';
const configuration: EnvironmentConfiguration = {
  sources: [{ kind: 'git', url: 'https://github.com/lobehub/lobehub.git' }],
};

const createEnvironment = async (name = 'Development', scope?: string) => {
  const [environment] = await db
    .insert(environments)
    .values({
      configuration,
      name,
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
  await db
    .delete(environmentInstances)
    .where(
      inArray(
        environmentInstances.environmentId,
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
    { sources: [{ kind: 'git', url: 'https://github.com/lobehub/lobehub.git' }] },
    { sources: [{ kind: 'files', uri: 's3://work-assets/documents/' }] },
    { requirements: { gpu: { count: 2, memoryGiB: 24 }, memoryGiB: 64 } },
  ])('stores portable configuration without an execution target: %j', async (value) => {
    const [row] = await db
      .insert(environments)
      .values({
        configuration: value,
        name: 'Work environment',
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

  it('rejects empty names and nonpositive configuration versions', async () => {
    const values = { configuration, name: 'Development', userId };
    await expect(db.insert(environments).values({ ...values, name: '  ' })).rejects.toThrow();
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

const instanceValues = (environmentId: string) => ({
  configurationSnapshot: configuration,
  configurationVersion: 1,
  environmentId,
  name: 'Instance',
  workingDirectory: '/workspace/lobehub',
});

const createDevice = async () => {
  const [device] = await db
    .insert(devices)
    .values({ deviceId: 'test-device', identitySource: 'fallback', userId })
    .returning();
  return device;
};

describe('Environment instances', () => {
  it('materializes the same definition on a device, a sandbox and an rc cluster', async () => {
    const environment = await createEnvironment();
    const device = await createDevice();
    const common = instanceValues(environment.id);
    const rows = await db
      .insert(environmentInstances)
      .values([
        { ...common, deviceId: device.id, kind: 'device' },
        {
          ...common,
          kind: 'sandbox',
          provider: 'sandbox-adapter',
          providerScope: 'account-1',
          providerResourceId: 'sandbox-1',
        },
        {
          ...common,
          kind: 'cluster',
          provider: 'rc',
          providerScope: 'cluster-1',
          providerResourceId: 'allocation-1',
        },
      ])
      .returning();
    expect(rows.map((row) => row.kind).sort()).toEqual(['cluster', 'device', 'sandbox']);
    expect(rows.every((row) => row.configurationVersion === 1 && row.status === 'pending')).toBe(
      true,
    );
    const a = await createProject('AAA');
    const b = await createProject('BBB');
    await db.insert(projectEnvironments).values([
      { projectId: a.id, environmentId: environment.id, defaultInstanceId: rows[0].id },
      { projectId: b.id, environmentId: environment.id, defaultInstanceId: rows[1].id },
    ]);
    await db.delete(projects).where(eq(projects.id, a.id));
    expect(
      await db
        .select()
        .from(environmentInstances)
        .where(eq(environmentInstances.environmentId, environment.id)),
    ).toHaveLength(3);
  });

  it('rejects missing or mixed binding targets', async () => {
    const environment = await createEnvironment();
    const device = await createDevice();
    const common = instanceValues(environment.id);
    await expect(
      db.insert(environmentInstances).values({ ...common, kind: 'device' }),
    ).rejects.toThrow();
    await expect(
      db.insert(environmentInstances).values({ ...common, kind: 'sandbox' }),
    ).rejects.toThrow();
    await expect(
      db.insert(environmentInstances).values({
        ...common,
        kind: 'cluster',
        provider: 'rc',
        providerScope: 'cluster-1',
        providerResourceId: ' ',
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(environmentInstances).values({
        ...common,
        kind: 'sandbox',
        deviceId: device.id,
        provider: 'test',
        providerScope: 'account-1',
        providerResourceId: 'sandbox-1',
      }),
    ).rejects.toThrow();
  });

  it('keeps distinct folders on a device and scopes remote identities to the provider account', async () => {
    const environment = await createEnvironment();
    const device = await createDevice();
    const local = {
      ...instanceValues(environment.id),
      deviceId: device.id,
      kind: 'device' as const,
    };
    await db.insert(environmentInstances).values(local);
    await expect(db.insert(environmentInstances).values(local)).rejects.toThrow();
    await db
      .insert(environmentInstances)
      .values({ ...local, workingDirectory: '/workspace/another-checkout' });
    const remote = {
      ...instanceValues(environment.id),
      kind: 'sandbox' as const,
      provider: 'test',
      providerScope: 'account-1',
      providerResourceId: 'same-id',
    };
    await db.insert(environmentInstances).values(remote);
    await expect(db.insert(environmentInstances).values(remote)).rejects.toThrow();
    await db.insert(environmentInstances).values({ ...remote, providerScope: 'account-2' });
  });

  it('only permits default instances belonging to the associated environment', async () => {
    const environment = await createEnvironment();
    const another = await createEnvironment('Another');
    const device = await createDevice();
    const project = await createProject('AAA');
    const [instance] = await db
      .insert(environmentInstances)
      .values({ ...instanceValues(environment.id), deviceId: device.id, kind: 'device' })
      .returning();
    await expect(
      db.insert(projectEnvironments).values({
        projectId: project.id,
        environmentId: another.id,
        defaultInstanceId: instance.id,
      }),
    ).rejects.toThrow();
    const [link] = await db
      .insert(projectEnvironments)
      .values({
        projectId: project.id,
        environmentId: environment.id,
        defaultInstanceId: instance.id,
      })
      .returning();
    await expect(
      db.delete(environmentInstances).where(eq(environmentInstances.id, instance.id)),
    ).rejects.toThrow();
    await db
      .update(projectEnvironments)
      .set({ defaultInstanceId: null })
      .where(eq(projectEnvironments.id, link.id));
    await db.delete(environmentInstances).where(eq(environmentInstances.id, instance.id));
    expect(
      await db.select().from(environments).where(eq(environments.id, environment.id)),
    ).toHaveLength(1);
  });

  it('preserves an instance snapshot when the abstract definition changes', async () => {
    const environment = await createEnvironment();
    const device = await createDevice();
    const [instance] = await db
      .insert(environmentInstances)
      .values({ ...instanceValues(environment.id), deviceId: device.id, kind: 'device' })
      .returning();
    await db
      .update(environments)
      .set({ configuration: { bootstrapCommand: 'pnpm install' }, configurationVersion: 2 })
      .where(eq(environments.id, environment.id));
    const [saved] = await db
      .select()
      .from(environmentInstances)
      .where(eq(environmentInstances.id, instance.id));
    expect(saved).toMatchObject({ configurationSnapshot: configuration, configurationVersion: 1 });
    await expect(db.delete(devices).where(eq(devices.id, device.id))).rejects.toThrow();
    await expect(
      db.delete(environments).where(eq(environments.id, environment.id)),
    ).rejects.toThrow();
  });
});
