// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messengerInstallations } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { MessengerInstallationModel } from '../messengerInstallation';

const serverDB: LobeChatDatabase = await getTestDB();

// Rows carry no user FK, so every row this file writes is scoped by its own platform.
const platform = 't863-msg-install';

afterEach(async () => {
  await serverDB
    .delete(messengerInstallations)
    .where(eq(messengerInstallations.platform, platform));
});

describe('MessengerInstallationModel coverage', () => {
  it('findById returns null for an unknown id', async () => {
    const result = await MessengerInstallationModel.findById(
      serverDB,
      '00000000-0000-4000-8000-000000000863',
    );

    expect(result).toBeNull();
  });

  it('updateRotatedToken clears the expiry when the rotation reports none', async () => {
    const created = await MessengerInstallationModel.upsert(serverDB, {
      applicationId: 'app-rotate',
      credentials: { botToken: 'old' },
      platform,
      tenantId: 'tenant-rotate',
      tokenExpiresAt: new Date('2030-01-01T00:00:00Z'),
    });

    const updated = await MessengerInstallationModel.updateRotatedToken(serverDB, created.id, {
      credentials: { botToken: 'new' },
    });

    expect(updated?.tokenExpiresAt).toBeNull();
    expect(updated?.credentials).toBe(JSON.stringify({ botToken: 'new' }));
  });

  it('decrypts an empty stored credential blob to an empty object', async () => {
    const [row] = await serverDB
      .insert(messengerInstallations)
      .values({ applicationId: 'app-empty', credentials: '', platform, tenantId: 'tenant-empty' })
      .returning();

    const result = await MessengerInstallationModel.findById(serverDB, row.id);

    expect(result?.id).toBe(row.id);
    expect(result?.credentials).toEqual({});
  });

  it('decrypts an unparseable credential blob to an empty object', async () => {
    const [row] = await serverDB
      .insert(messengerInstallations)
      .values({
        applicationId: 'app-bad',
        credentials: 'not-json',
        platform,
        tenantId: 'tenant-bad',
      })
      .returning();

    const result = await MessengerInstallationModel.findById(serverDB, row.id);

    expect(result?.id).toBe(row.id);
    expect(result?.credentials).toEqual({});
  });
});
