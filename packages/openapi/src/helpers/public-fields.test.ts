import { describe, expect, it } from 'vitest';

import type {
  AgentItem,
  AiProviderSelectItem,
  ChatGroupAgentItem,
  ChatGroupItem,
  FileItem,
  UserItem,
} from '@/database/schemas';

import {
  projectPublicAgent,
  projectPublicChatGroup,
  projectPublicFile,
  projectPublicProvider,
  projectPublicUser,
  PUBLIC_AGENT_FIELDS,
  PUBLIC_CHAT_GROUP_FIELDS,
} from './public-fields';

describe('public response field projections', () => {
  it('keeps the Agent contract at the documented allowlist including plugin modes', () => {
    const projected = projectPublicAgent({
      agencyConfig: null,
      avatar: null,
      chatConfig: null,
      clientId: 'internal-client',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      description: null,
      id: 'agent-1',
      marketIdentifier: 'internal-market-id',
      model: 'model-1',
      params: {},
      provider: 'provider-1',
      slug: 'agent-slug',
      systemRole: null,
      title: 'Agent',
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as unknown as AgentItem);

    expect(Object.keys(projected).sort()).toEqual(
      [...PUBLIC_AGENT_FIELDS, 'personal', 'plugins'].sort(),
    );
    expect(projected).not.toHaveProperty('clientId');
    expect(projected).not.toHaveProperty('marketIdentifier');
    expect(projected).not.toHaveProperty('userId');
    expect(projected).not.toHaveProperty('workspaceId');
  });

  it('never returns Provider ownership fields, surrogate ids, or credentials', () => {
    const projected = projectPublicProvider({
      _id: 'internal-id',
      createdAt: new Date(),
      id: 'openai',
      keyVaults: 'encrypted-secret',
      updatedAt: new Date(),
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as unknown as AiProviderSelectItem);

    expect(projected).not.toHaveProperty('_id');
    expect(projected).not.toHaveProperty('keyVaults');
    expect(projected).not.toHaveProperty('userId');
    expect(projected).not.toHaveProperty('workspaceId');
  });

  it('does not expose internal file identity or hashing fields', () => {
    const projected = projectPublicFile({
      clientId: 'internal-client',
      createdAt: new Date(),
      fileHash: 'internal-hash',
      fileType: 'text/plain',
      id: 'file-1',
      name: 'notes.txt',
      size: 12,
      updatedAt: new Date(),
      url: '/files/notes.txt',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    } as unknown as FileItem);

    expect(projected).not.toHaveProperty('clientId');
    expect(projected).not.toHaveProperty('fileHash');
    expect(projected).not.toHaveProperty('userId');
    expect(projected).not.toHaveProperty('workspaceId');
  });

  it('returns only the stable public profile instead of the full auth row', () => {
    const projected = projectPublicUser({
      banReason: 'internal',
      createdAt: new Date(),
      email: 'user@example.com',
      id: 'user-1',
      normalizedEmail: 'user@example.com',
      onboarding: { finishedAt: 'secret-state' },
      preference: { telemetry: true },
      updatedAt: new Date(),
    } as unknown as UserItem);

    expect(projected).toMatchObject({ email: 'user@example.com', id: 'user-1' });
    expect(projected).not.toHaveProperty('banReason');
    expect(projected).not.toHaveProperty('normalizedEmail');
    expect(projected).not.toHaveProperty('onboarding');
    expect(projected).not.toHaveProperty('preference');
  });

  it('keeps chat group config, editor content and market fields out of the contract', () => {
    const projected = projectPublicChatGroup(
      {
        avatar: null,
        backgroundColor: null,
        clientId: 'internal-client',
        config: { systemPrompt: 'secret' },
        content: 'internal',
        createdAt: new Date(),
        description: null,
        editorData: { root: {} },
        id: 'cg-1',
        marketIdentifier: 'market-id',
        pinned: false,
        title: 'Group',
        updatedAt: new Date(),
        userId: 'user-1',
        visibility: 'public',
        workspaceId: 'workspace-1',
      } as unknown as ChatGroupItem,
      [
        {
          agentId: 'agt-1',
          chatGroupId: 'cg-1',
          enabled: true,
          order: 0,
          role: 'participant',
          userId: 'user-1',
          workspaceId: 'workspace-1',
        } as unknown as ChatGroupAgentItem,
      ],
    );

    expect(Object.keys(projected).sort()).toEqual(
      [...PUBLIC_CHAT_GROUP_FIELDS, 'members', 'personal'].sort(),
    );
    expect(projected.personal).toBe(false);
    expect(projected).not.toHaveProperty('config');
    expect(projected.members).toEqual([
      { agentId: 'agt-1', enabled: true, order: 0, role: 'participant' },
    ]);
  });
});
