// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { UserModel } from '@/database/models/user';
import { WidgetModel } from '@/database/models/widget';

import { createWidgetDryRunAudit } from '../dryRunAudit';
import { WidgetService } from '../index';

const userId = 'dry-run-audit-user';
const otherUserId = 'dry-run-audit-other';

const statDraft = {
  outputType: 'stat' as const,
  runtime: 'node' as const,
  script: `console.log(JSON.stringify({ type: 'stat', value: 1 }))`,
};

let db: LobeChatDatabase;

beforeEach(async () => {
  db = await getTestDB();
  await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

const draftOf = async (owner: string, manifest: object | null) => {
  const model = new WidgetModel(db, owner);
  const widget = await model.create({ title: 'Stars' });
  const version = await model.createVersion(widget.id, {
    ...statDraft,
    manifest,
    sourceType: 'user',
  } as any);
  return { versionId: version!.id, widgetId: widget.id };
};

describe('createWidgetDryRunAudit', () => {
  it('asks before running the named version when it is networked or credentialed', async () => {
    const audit = createWidgetDryRunAudit(db, userId);
    const networked = await draftOf(userId, { network: { allow: ['api.github.com'] } });
    const credentialed = await draftOf(userId, {
      env: [{ connector: 'github', name: 'GITHUB_TOKEN' }],
    });

    expect(await audit(networked)).toBe(true);
    expect(await audit(credentialed)).toBe(true);
  });

  it('lets a closed draft run unattended', async () => {
    const audit = createWidgetDryRunAudit(db, userId);
    expect(await audit(await draftOf(userId, null))).toBe(false);
  });

  it('fails closed for a version the run user cannot read', async () => {
    const foreign = await draftOf(otherUserId, null);
    expect(await createWidgetDryRunAudit(db, userId)(foreign)).toBe(true);
  });

  it('stops asking once the creator granted that access, and only for that access', async () => {
    const githubManifest = {
      env: [{ connector: 'github', name: 'GITHUB_TOKEN' }],
      network: { allow: ['api.github.com'] },
    };
    const approved = await draftOf(userId, githubManifest);
    const grant = await new WidgetService(db, userId).grantDryRunAccess(
      approved.widgetId,
      approved.versionId,
    );
    expect(grant).toMatchObject({
      connectors: ['github'],
      hosts: ['api.github.com'],
      workspaceId: null,
    });

    const audit = createWidgetDryRunAudit(db, userId);
    // Another widget asking for the same access runs unattended…
    expect(await audit(await draftOf(userId, githubManifest))).toBe(false);
    // …but one more host asks again.
    const wider = await draftOf(userId, {
      ...githubManifest,
      network: { allow: ['api.github.com', 'evil.example'] },
    });
    expect(await audit(wider)).toBe(true);
  });

  it('refuses a grant from someone who cannot author the widget', async () => {
    const foreign = await draftOf(otherUserId, { network: { allow: ['api.github.com'] } });
    await expect(
      new WidgetService(db, userId).grantDryRunAccess(foreign.widgetId, foreign.versionId),
    ).rejects.toThrow();
    const settings = await new UserModel(db, userId).getUserSettings();
    expect(settings?.tool).toBeFalsy();
  });
});
