// @vitest-environment node
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveRunRequester } from './resolveRunRequester';

const mocks = vi.hoisted(() => ({
  findByExternalUser: vi.fn(),
  findById: vi.fn(),
  findByPlatformUser: vi.fn(),
}));

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: { findByPlatformUser: mocks.findByPlatformUser },
}));

vi.mock('@/database/models/scm', () => ({
  ScmChangeRequestModel: { findById: mocks.findById },
  ScmIdentityModel: { findByExternalUser: mocks.findByExternalUser },
}));

const db = {} as any;
const owner = 'user-owner';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findByPlatformUser.mockResolvedValue(undefined);
  mocks.findById.mockResolvedValue(null);
  mocks.findByExternalUser.mockResolvedValue(null);
});

describe('resolveRunRequester', () => {
  it.each([
    RequestTrigger.Chat,
    RequestTrigger.Cli,
    RequestTrigger.Cron,
    RequestTrigger.Scheduled,
    RequestTrigger.Task,
    RequestTrigger.TaskCallback,
    RequestTrigger.Goal,
    RequestTrigger.Notify,
    undefined,
  ])('attributes a %s run to its owner', async (trigger) => {
    await expect(resolveRunRequester(db, { ownerUserId: owner, trigger })).resolves.toBe(owner);
  });

  it('attributes a shared-agent visit to the visitor, not the agent owner', async () => {
    await expect(
      resolveRunRequester(db, {
        ownerUserId: owner,
        shareVisitorUserId: 'user-visitor',
        trigger: 'channel',
      }),
    ).resolves.toBe('user-visitor');
  });

  it('attributes a plain channel run to its owner', async () => {
    await expect(resolveRunRequester(db, { ownerUserId: owner, trigger: 'channel' })).resolves.toBe(
      owner,
    );
  });

  it('attributes a bot message from the owner to the owner', async () => {
    await expect(
      resolveRunRequester(db, {
        botIsOwner: true,
        botSender: { id: 'u-1', platform: 'slack' },
        ownerUserId: owner,
        trigger: RequestTrigger.Bot,
      }),
    ).resolves.toBe(owner);
    expect(mocks.findByPlatformUser).not.toHaveBeenCalled();
  });

  it('attributes a bot message to the member linked to its sender', async () => {
    mocks.findByPlatformUser.mockResolvedValue({ userId: 'user-linked' });

    await expect(
      resolveRunRequester(db, {
        botSender: { id: 'u-2', platform: 'slack' },
        ownerUserId: owner,
        trigger: RequestTrigger.Bot,
      }),
    ).resolves.toBe('user-linked');
    expect(mocks.findByPlatformUser).toHaveBeenCalledWith(db, 'slack', 'u-2');
  });

  it('finds no requester for a bot message from an unlinked sender', async () => {
    await expect(
      resolveRunRequester(db, {
        botSender: { id: 'u-3', platform: 'slack' },
        ownerUserId: owner,
        trigger: RequestTrigger.Bot,
      }),
    ).resolves.toBeUndefined();
  });

  it('finds no requester for a bot message without a sender', async () => {
    await expect(
      resolveRunRequester(db, { ownerUserId: owner, trigger: RequestTrigger.Bot }),
    ).resolves.toBeUndefined();
  });

  it('attributes an SCM wake to the linked pull request author', async () => {
    mocks.findById.mockResolvedValue({ authorExternalId: 'gh-7', provider: 'github' });
    mocks.findByExternalUser.mockResolvedValue({ userId: 'user-author' });

    await expect(
      resolveRunRequester(db, {
        ownerUserId: 'user-installer',
        scmChangeRequestId: 'scmcr_1',
        trigger: RequestTrigger.Scm,
      }),
    ).resolves.toBe('user-author');
    expect(mocks.findByExternalUser).toHaveBeenCalledWith(db, 'github', 'gh-7');
  });

  it('finds no requester for an SCM wake whose author is not linked', async () => {
    mocks.findById.mockResolvedValue({ authorExternalId: 'gh-8', provider: 'github' });

    await expect(
      resolveRunRequester(db, {
        ownerUserId: 'user-installer',
        scmChangeRequestId: 'scmcr_2',
        trigger: RequestTrigger.Scm,
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    RequestTrigger.Inbox,
    RequestTrigger.AgentSignal,
    RequestTrigger.McpEvent,
    RequestTrigger.Webhook,
    RequestTrigger.Eval,
    RequestTrigger.AgentShare,
    RequestTrigger.Scm,
  ])('finds no requester for a %s run without a human behind it', async (trigger) => {
    await expect(resolveRunRequester(db, { ownerUserId: owner, trigger })).resolves.toBeUndefined();
  });
});
