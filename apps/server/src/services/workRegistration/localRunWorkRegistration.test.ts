import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerShellWorksForLocalRun } from './localRunWorkRegistration';

const anchor = {
  agentId: 'agent-1',
  id: 'msg-anchor',
  metadata: null as Record<string, any> | null,
  role: 'assistant',
  threadId: null,
  topicId: 'topic-1',
};

/** A claude-code Bash tool row whose stdout carries a gh-created PR URL. */
const ghCreateRow = (id: string) => ({
  apiName: 'Bash',
  arguments: JSON.stringify({ command: 'gh pr create --title test' }),
  content: 'https://github.com/acme/repo/pull/7\n',
  createdAt: new Date('2026-08-17T08:30:46.000Z'),
  error: undefined,
  id,
  identifier: 'claude-code',
  state: undefined,
  toolCallId: `call-${id}`,
  type: 'default',
  userId: 'user-1',
});

const createModels = () => {
  const messageModel = {
    findById: vi.fn(async () => ({ ...anchor })),
    listMessagePluginsByIds: vi.fn(async () => [ghCreateRow('msg-tool-1')]),
    update: vi.fn(async () => ({ success: true })),
  };
  const workModel = {
    registerShellGithubResult: vi.fn(async () => ({ id: 'wk-1' })),
  };
  return { messageModel: messageModel as any, workModel: workModel as any };
};

const baseParams = (models: ReturnType<typeof createModels>) => ({
  anchorMessageId: 'msg-anchor',
  messageIds: ['msg-tool-1'],
  topicId: 'topic-1',
  ...models,
});

describe('registerShellWorksForLocalRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a github work from a gh create row and stamps the anchor', async () => {
    const models = createModels();

    const result = await registerShellWorksForLocalRun(baseParams(models));

    expect(result).toEqual({
      failed: 0,
      registered: 1,
      rootOperationId: 'localrun_msg-anchor',
    });
    expect(models.workModel.registerShellGithubResult).toHaveBeenCalledWith(
      expect.objectContaining({
        // Local runs carry no server-side usage snapshot — cost must stay
        // unknown (null), never zero.
        cumulativeCost: null,
        data: expect.objectContaining({ command: 'gh pr create --title test' }),
        messageId: 'msg-tool-1',
        rootOperationId: 'localrun_msg-anchor',
        toolCallId: 'call-msg-tool-1',
        topicId: 'topic-1',
      }),
    );
    expect(models.messageModel.update).toHaveBeenCalledWith('msg-anchor', {
      metadata: { work: { rootOperationId: 'localrun_msg-anchor' } },
    });
  });

  it('rejects an anchor that is missing, foreign-topic, or not an assistant message', async () => {
    for (const badAnchor of [
      undefined,
      { ...anchor, topicId: 'topic-other' },
      { ...anchor, role: 'user' },
    ]) {
      const models = createModels();
      models.messageModel.findById.mockResolvedValue(badAnchor as any);

      const result = await registerShellWorksForLocalRun(baseParams(models));

      expect(result).toEqual({ failed: 0, registered: 0, rootOperationId: null });
      expect(models.messageModel.listMessagePluginsByIds).not.toHaveBeenCalled();
      expect(models.workModel.registerShellGithubResult).not.toHaveBeenCalled();
    }
  });

  it('reuses an already-stamped rootOperationId and does not re-stamp', async () => {
    const models = createModels();
    models.messageModel.findById.mockResolvedValue({
      ...anchor,
      metadata: { work: { rootOperationId: 'localrun_prior' } },
    } as any);

    const result = await registerShellWorksForLocalRun(baseParams(models));

    expect(result.rootOperationId).toBe('localrun_prior');
    expect(models.workModel.registerShellGithubResult).toHaveBeenCalledWith(
      expect.objectContaining({ rootOperationId: 'localrun_prior' }),
    );
    expect(models.messageModel.update).not.toHaveBeenCalled();
  });

  it('registers nothing and never stamps when rows carry no registerable command', async () => {
    const models = createModels();
    models.messageModel.listMessagePluginsByIds.mockResolvedValue([
      { ...ghCreateRow('msg-tool-1'), arguments: JSON.stringify({ command: 'ls -la' }) },
    ] as any);

    const result = await registerShellWorksForLocalRun(baseParams(models));

    expect(result).toEqual({ failed: 0, registered: 0, rootOperationId: null });
    expect(models.workModel.registerShellGithubResult).not.toHaveBeenCalled();
    expect(models.messageModel.update).not.toHaveBeenCalled();
  });

  it('skips failed commands and unexecuted intervention rows', async () => {
    const models = createModels();
    models.messageModel.listMessagePluginsByIds.mockResolvedValue([
      { ...ghCreateRow('msg-err'), error: { message: 'boom' } },
      { ...ghCreateRow('msg-pending'), intervention: { status: 'pending' } },
    ] as any);

    const result = await registerShellWorksForLocalRun(baseParams(models));

    expect(result.registered).toBe(0);
    expect(models.workModel.registerShellGithubResult).not.toHaveBeenCalled();
  });

  it('counts a failed anchor stamp into failed', async () => {
    const models = createModels();
    models.messageModel.update.mockResolvedValue({ success: false } as any);

    const result = await registerShellWorksForLocalRun(baseParams(models));

    expect(result.registered).toBe(1);
    expect(result.failed).toBe(1);
  });
});
