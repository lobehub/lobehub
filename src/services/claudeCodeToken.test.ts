import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteClaudeCodeToken, saveClaudeCodeToken } from './claudeCodeToken';

const { mockCreds } = vi.hoisted(() => ({
  mockCreds: { createKV: vi.fn(), delete: vi.fn(), share: vi.fn(), update: vi.fn() },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    market: {
      creds: {
        createKV: { mutate: mockCreds.createKV },
        delete: { mutate: mockCreds.delete },
        share: { mutate: mockCreds.share },
        update: { mutate: mockCreds.update },
      },
    },
  },
}));

const values = { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-test' };

describe('saveClaudeCodeToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreds.createKV.mockResolvedValue({ id: 9 });
    mockCreds.update.mockResolvedValue({ id: 7 });
    mockCreds.share.mockResolvedValue({ id: 7 });
  });

  it('creates a personal token outside a workspace without sharing it', async () => {
    const result = await saveClaudeCodeToken({ inWorkspace: false, token: 'sk-ant-test' });

    expect(result).toEqual({ ok: true });
    expect(mockCreds.createKV).toHaveBeenCalledWith(expect.objectContaining({ values }));
    expect(mockCreds.share).not.toHaveBeenCalled();
  });

  it('updates the existing token and shares it to the active workspace', async () => {
    const result = await saveClaudeCodeToken({
      inWorkspace: true,
      personalCred: { id: 7, type: 'kv-env' },
      token: 'sk-ant-test',
    });

    expect(result).toEqual({ ok: true });
    expect(mockCreds.update).toHaveBeenCalledWith({ id: 7, values });
    expect(mockCreds.createKV).not.toHaveBeenCalled();
    expect(mockCreds.share).toHaveBeenCalledWith({ id: 7 });
  });

  it('shares a newly created token by its new id', async () => {
    await saveClaudeCodeToken({ inWorkspace: true, token: 'sk-ant-test' });

    expect(mockCreds.share).toHaveBeenCalledWith({ id: 9 });
  });

  it('reports a failed share separately from a failed save', async () => {
    mockCreds.share.mockRejectedValue(new Error('market unavailable'));

    const result = await saveClaudeCodeToken({
      inWorkspace: true,
      personalCred: { id: 7, type: 'kv-env' },
      token: 'sk-ant-test',
    });

    expect(result).toEqual({ failedStep: 'share', ok: false });
    expect(mockCreds.update).toHaveBeenCalled();
  });

  it('leaves a same-key credential of another type untouched', async () => {
    const result = await saveClaudeCodeToken({
      inWorkspace: true,
      personalCred: { id: 7, type: 'kv-header' },
      token: 'sk-ant-test',
    });

    expect(result).toEqual({ failedStep: 'type', ok: false });
    expect(mockCreds.update).not.toHaveBeenCalled();
    expect(mockCreds.share).not.toHaveBeenCalled();
  });

  it('reports a failed save without sharing', async () => {
    mockCreds.update.mockRejectedValue(new Error('market unavailable'));

    const result = await saveClaudeCodeToken({
      inWorkspace: true,
      personalCred: { id: 7, type: 'kv-env' },
      token: 'sk-ant-test',
    });

    expect(result).toEqual({ failedStep: 'save', ok: false });
    expect(mockCreds.share).not.toHaveBeenCalled();
  });
});

describe('deleteClaudeCodeToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the personal token credential by id', async () => {
    mockCreds.delete.mockResolvedValue({ success: true });

    await expect(deleteClaudeCodeToken({ id: 7 })).resolves.toBe(true);
    expect(mockCreds.delete).toHaveBeenCalledWith({ id: 7 });
  });

  it('reports a failed delete', async () => {
    mockCreds.delete.mockRejectedValue(new Error('market unavailable'));

    await expect(deleteClaudeCodeToken({ id: 7 })).resolves.toBe(false);
  });
});
