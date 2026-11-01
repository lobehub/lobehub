// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  acceptances,
  scmChangeRequests,
  scmIdentities,
  scmInstallations,
  scmWebhookDeliveries,
  topics,
  users,
} from '..';

const serverDB = await getTestDB();
const userId = 'scm-schema-test-user';
const otherUserId = 'scm-schema-test-user-2';

const installationRow = {
  accountExternalId: '99',
  accountLogin: 'lobehub',
  accountType: 'organization' as const,
  installationId: '12345',
  provider: 'github' as const,
  repositorySelection: 'all' as const,
  userId,
};

const changeRequestRow = {
  number: 42,
  provider: 'github' as const,
  repoFullName: 'lobehub/lobehub',
  state: 'open' as const,
  url: 'https://github.com/lobehub/lobehub/pull/42',
  userId,
};

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(scmWebhookDeliveries);
  await serverDB.delete(users);
});

describe('scm_installations', () => {
  it('keeps one row per provider installation and cascades with its user', async () => {
    const [created] = await serverDB.insert(scmInstallations).values(installationRow).returning();
    expect(created.repositories).toEqual([]);
    expect(created.metadata).toEqual({});

    await expect(
      serverDB.insert(scmInstallations).values({ ...installationRow, userId: otherUserId }),
    ).rejects.toThrow();

    // Same installation id on another provider is a different row.
    await expect(
      serverDB.insert(scmInstallations).values({ ...installationRow, provider: 'gitlab' as any }),
    ).resolves.not.toThrow();

    await serverDB.delete(users).where(eq(users.id, userId));
    const remaining = await serverDB
      .select()
      .from(scmInstallations)
      .where(eq(scmInstallations.userId, userId));
    expect(remaining).toHaveLength(0);
  });
});

describe('scm_identities', () => {
  it('binds one provider account to one LobeHub user, both directions', async () => {
    await serverDB.insert(scmIdentities).values({
      externalLogin: 'arvinxx',
      externalUserId: '1001',
      provider: 'github',
      userId,
    });

    // Same GitHub account cannot bind to a second LobeHub user.
    await expect(
      serverDB.insert(scmIdentities).values({
        externalLogin: 'arvinxx',
        externalUserId: '1001',
        provider: 'github',
        userId: otherUserId,
      }),
    ).rejects.toThrow();

    // Same LobeHub user cannot hold a second GitHub account.
    await expect(
      serverDB.insert(scmIdentities).values({
        externalLogin: 'someone-else',
        externalUserId: '1002',
        provider: 'github',
        userId,
      }),
    ).rejects.toThrow();
  });
});

describe('scm_change_requests', () => {
  it('generates a prefixed id and dedups on (provider, repo, number)', async () => {
    const [created] = await serverDB.insert(scmChangeRequests).values(changeRequestRow).returning();

    expect(created.id).toMatch(/^scr_/);
    expect(created.isDraft).toBe(false);
    expect(created.wakeCount).toBe(0);

    await expect(serverDB.insert(scmChangeRequests).values(changeRequestRow)).rejects.toThrow();

    // Another number in the same repo is a different change request.
    await expect(
      serverDB.insert(scmChangeRequests).values({ ...changeRequestRow, number: 43 }),
    ).resolves.not.toThrow();
  });

  it('keeps the row when its installation, acceptance or topic goes away', async () => {
    const [installation] = await serverDB
      .insert(scmInstallations)
      .values(installationRow)
      .returning();
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({ subjectId: 'scm-subject', subjectType: 'standalone', userId })
      .returning();
    const [topic] = await serverDB
      .insert(topics)
      .values({ title: 'scm topic', userId })
      .returning();

    const [created] = await serverDB
      .insert(scmChangeRequests)
      .values({
        ...changeRequestRow,
        acceptanceId: acceptance.id,
        installationId: installation.id,
        topicId: topic.id,
      })
      .returning();

    await serverDB.delete(scmInstallations).where(eq(scmInstallations.id, installation.id));
    await serverDB.delete(acceptances).where(eq(acceptances.id, acceptance.id));
    await serverDB.delete(topics).where(eq(topics.id, topic.id));

    const [after] = await serverDB
      .select()
      .from(scmChangeRequests)
      .where(eq(scmChangeRequests.id, created.id));
    expect(after).toBeDefined();
    expect(after.installationId).toBeNull();
    expect(after.acceptanceId).toBeNull();
    expect(after.topicId).toBeNull();
  });
});

describe('scm_webhook_deliveries', () => {
  it('rejects a redelivered delivery id at insert time and keeps a surrogate id', async () => {
    const delivery = {
      deliveryId: 'a1b2c3',
      event: 'pull_request',
      provider: 'github' as const,
      status: 'received' as const,
    };

    const [row] = await serverDB.insert(scmWebhookDeliveries).values(delivery).returning();
    expect(row.id).toMatch(/^[\da-f-]{36}$/);
    await expect(serverDB.insert(scmWebhookDeliveries).values(delivery)).rejects.toThrow();

    // The same delivery id from another provider is unrelated.
    await expect(
      serverDB.insert(scmWebhookDeliveries).values({ ...delivery, provider: 'gitlab' as any }),
    ).resolves.not.toThrow();
  });
});
