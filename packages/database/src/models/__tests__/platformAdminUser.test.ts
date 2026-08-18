import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { platformAdminSessions, platformAdminUsers } from '../../schemas/aicoOrganization';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';
import {
  hashOperatorPassword,
  hashSessionToken,
  verifyOperatorPassword,
} from '../../utils/operatorPassword';
import { PlatformAdminUserModel } from '../platformAdminUser';

const serverDB: LobeChatDatabase = await getTestDB();
const model = new PlatformAdminUserModel(serverDB);

beforeEach(async () => {
  await serverDB.delete(platformAdminSessions);
  await serverDB.delete(platformAdminUsers);
});

afterEach(async () => {
  await serverDB.delete(platformAdminSessions);
  await serverDB.delete(platformAdminUsers);
});

describe('PlatformAdminUserModel', () => {
  it('stores operators independently of chat users and looks up by email', async () => {
    const passwordHash = await hashOperatorPassword('Operator1');
    const created = await model.create({
      email: 'Ali@Admin.test',
      name: 'Ali',
      passwordHash,
    });

    expect(created.email).toBe('ali@admin.test');
    const found = await model.findByEmail('ALI@admin.test');
    expect(found?.id).toBe(created.id);
    expect(await verifyOperatorPassword('Operator1', found!.passwordHash)).toBe(true);
  });

  it('allows the same email as a chat user with a different password hash', async () => {
    const chatUserId = 'user_same_email_ops';
    await serverDB.delete(users).where(eq(users.id, chatUserId));
    await serverDB.insert(users).values({ email: 'shared@example.com', id: chatUserId });
    const operator = await model.create({
      email: 'shared@example.com',
      passwordHash: await hashOperatorPassword('AdminPass1'),
    });
    expect(operator.email).toBe('shared@example.com');
    const chat = await serverDB.query.users.findFirst({
      where: eq(users.id, chatUserId),
    });
    expect(chat?.email).toBe('shared@example.com');
    await serverDB.delete(users).where(eq(users.id, chatUserId));
  });

  it('upserts bootstrap password for the same email', async () => {
    await model.create({
      email: 'ops@example.com',
      passwordHash: await hashOperatorPassword('OldPass1'),
    });
    const updated = await model.upsertByEmail({
      email: 'ops@example.com',
      passwordHash: await hashOperatorPassword('NewPass2'),
    });
    expect(await verifyOperatorPassword('NewPass2', updated.passwordHash)).toBe(true);
    expect(await verifyOperatorPassword('OldPass1', updated.passwordHash)).toBe(false);
  });

  it('resolves a live session by token hash and ignores expired ones', async () => {
    const admin = await model.create({
      email: 'sess@example.com',
      passwordHash: await hashOperatorPassword('SessPass1'),
    });
    const token = 'live-session-token';
    await model.createSession({
      adminUserId: admin.id,
      expiresAt: new Date(Date.now() + 60_000),
      tokenHash: hashSessionToken(token),
    });
    const live = await model.findValidSessionByTokenHash(hashSessionToken(token));
    expect(live?.admin.id).toBe(admin.id);

    await model.createSession({
      adminUserId: admin.id,
      expiresAt: new Date(Date.now() - 1000),
      tokenHash: hashSessionToken('expired-token'),
    });
    expect(
      await model.findValidSessionByTokenHash(hashSessionToken('expired-token')),
    ).toBeUndefined();
  });
});
