import { describe, expect, it } from 'vitest';

import type { AgentItem, AiProviderSelectItem, FileItem, UserItem } from '@/database/schemas';

import {
  projectPublicAgent,
  projectPublicFile,
  projectPublicProvider,
  projectPublicUser,
  PUBLIC_AGENT_FIELDS,
} from './public-fields';

describe('public response field projections', () => {
  it('keeps the Agent contract at the documented 12-field allowlist', () => {
    const projected = projectPublicAgent({
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

    expect(Object.keys(projected).sort()).toEqual([...PUBLIC_AGENT_FIELDS].sort());
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
});
