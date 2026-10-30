import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users, userSettings } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { UserModel } from '../user';

const userId = 'user-widget-dry-run-grant-test';

const serverDB: LobeChatDatabase = await getTestDB();
const userModel = new UserModel(serverDB, userId);

const grant = {
  connectors: ['github'],
  grantedAt: '2026-10-25T00:00:00.000Z',
  hosts: ['api.github.com'],
  workspaceId: null,
};

const readTool = async () =>
  (await serverDB.query.userSettings.findFirst({ where: eq(userSettings.id, userId) }))?.tool;

describe('UserModel.appendWidgetDryRunGrant', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('should create the settings row when none exists', async () => {
    await userModel.appendWidgetDryRunGrant(grant);

    expect(await readTool()).toEqual({ widgetDryRunGrants: [grant] });
  });

  it('should append after stored grants while preserving sibling tool keys', async () => {
    const earlier = { ...grant, hosts: ['api.linear.app'] };
    await serverDB.insert(userSettings).values({
      id: userId,
      tool: { humanIntervention: { approvalMode: 'manual' }, widgetDryRunGrants: [earlier] },
    });

    await userModel.appendWidgetDryRunGrant(grant);

    expect(await readTool()).toEqual({
      humanIntervention: { approvalMode: 'manual' },
      widgetDryRunGrants: [earlier, grant],
    });
  });
});
