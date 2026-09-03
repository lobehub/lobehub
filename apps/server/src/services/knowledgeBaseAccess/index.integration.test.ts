// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  documents,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  resourcePermissions,
  users,
  workspaces,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { assertFileNotInRestrictedKnowledgeBase, getRestrictedKnowledgeBasePolicy } from './index';

vi.mock('@/server/services/workspacePermission', () => ({
  getWorkspaceScopedPermissionMatches: vi.fn(async () => ({
    hasAllScope: false,
    hasOwnerScope: true,
  })),
}));

const serverDB: LobeChatDatabase = await getTestDB();
const ownerId = 'kb-access-policy-owner';
const memberId = 'kb-access-policy-member';
const workspaceId = 'kb-access-policy-workspace';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: ownerId }, { id: memberId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'KB access policy',
    primaryOwnerId: ownerId,
    slug: workspaceId,
  });
  await serverDB.insert(knowledgeBases).values([
    {
      id: 'kb-live-open',
      name: 'Live open',
      userId: ownerId,
      visibility: 'public',
      workspaceId,
    },
    {
      id: 'kb-live-restricted',
      name: 'Live restricted',
      userId: ownerId,
      visibility: 'public',
      workspaceId,
    },
    {
      id: 'kb-trashed-restricted',
      isDeleted: true,
      name: 'Trashed restricted',
      userId: ownerId,
      visibility: 'public',
      workspaceId,
    },
  ]);
  await serverDB.insert(resourcePermissions).values([
    {
      accessLevel: 'use',
      createdBy: ownerId,
      resourceId: 'kb-live-restricted',
      resourceType: 'knowledgeBase',
      workspaceId,
    },
    {
      accessLevel: 'use',
      createdBy: ownerId,
      resourceId: 'kb-trashed-restricted',
      resourceType: 'knowledgeBase',
      workspaceId,
    },
  ]);
  await serverDB.insert(files).values([
    {
      fileType: 'text/plain',
      id: 'file-trashed-exclusive',
      name: 'exclusive.txt',
      size: 1,
      url: 'files/exclusive.txt',
      userId: ownerId,
      visibility: 'public',
      workspaceId,
    },
    {
      fileType: 'text/plain',
      id: 'file-trashed-shared',
      name: 'shared.txt',
      size: 1,
      url: 'files/shared.txt',
      userId: ownerId,
      visibility: 'public',
      workspaceId,
    },
  ]);
  await serverDB.insert(knowledgeBaseFiles).values([
    {
      fileId: 'file-trashed-exclusive',
      knowledgeBaseId: 'kb-trashed-restricted',
      userId: ownerId,
      workspaceId,
    },
    {
      fileId: 'file-trashed-shared',
      knowledgeBaseId: 'kb-trashed-restricted',
      userId: ownerId,
      workspaceId,
    },
    {
      fileId: 'file-trashed-shared',
      knowledgeBaseId: 'kb-live-open',
      userId: ownerId,
      workspaceId,
    },
  ]);
  await serverDB.insert(documents).values([
    {
      fileType: 'custom/document',
      id: 'docs-live-exclusive',
      knowledgeBaseId: 'kb-trashed-restricted',
      source: '',
      sourceType: 'api',
      title: 'Live exclusive page',
      totalCharCount: 0,
      totalLineCount: 0,
      userId: ownerId,
      visibility: 'public',
      workspaceId,
    },
    {
      fileType: 'custom/document',
      id: 'docs-trashed-exclusive',
      isDeleted: true,
      knowledgeBaseId: 'kb-trashed-restricted',
      source: '',
      sourceType: 'api',
      title: 'Exclusive page',
      totalCharCount: 0,
      totalLineCount: 0,
      userId: ownerId,
      visibility: 'public',
      workspaceId,
    },
    {
      fileId: 'file-trashed-shared',
      fileType: 'text/plain',
      id: 'docs-trashed-shared',
      isDeleted: true,
      knowledgeBaseId: 'kb-trashed-restricted',
      source: 'files/shared.txt',
      sourceType: 'file',
      title: 'Shared page',
      totalCharCount: 0,
      totalLineCount: 0,
      userId: ownerId,
      visibility: 'public',
      workspaceId,
    },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('restricted knowledge-base policy integration', () => {
  it('uses real soft-delete state and preserves a live browsable membership', async () => {
    const ctx = { serverDB, userId: memberId, workspaceId };

    const policy = await getRestrictedKnowledgeBasePolicy(ctx);
    expect(policy.allRestrictedKnowledgeBaseIds.sort()).toEqual(
      ['kb-live-restricted', 'kb-trashed-restricted'].sort(),
    );
    expect(policy.liveRestrictedKnowledgeBaseIds).toEqual(['kb-live-restricted']);
    expect(policy.trashedExclusiveDocumentIds).toEqual(['docs-live-exclusive']);
    expect(policy.trashedExclusiveFileIds).toEqual(['file-trashed-exclusive']);
    const trashPolicy = await getRestrictedKnowledgeBasePolicy(ctx, {
      includeTrashedDocuments: true,
    });
    expect(trashPolicy.trashedExclusiveDocumentIds.sort()).toEqual(
      ['docs-live-exclusive', 'docs-trashed-exclusive'].sort(),
    );
    await expect(
      assertFileNotInRestrictedKnowledgeBase(ctx, 'file-trashed-exclusive'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      assertFileNotInRestrictedKnowledgeBase(ctx, 'file-trashed-shared'),
    ).resolves.toBeUndefined();
  });
});
