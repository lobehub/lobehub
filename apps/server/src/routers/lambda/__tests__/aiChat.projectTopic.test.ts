// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { ProjectModel } from '@/database/models/project';
import { TopicRepository } from '@/database/repositories/topic';
import { AiChatService } from '@/server/services/aiChat';

import { aiChatRouter } from '../aiChat';

vi.mock('@/server/routers/lambda/_helpers/resolveContext', () => ({
  resolveContext: vi.fn(async (input) => ({
    ...input,
    agentId: input.agentId ?? null,
    sessionId: input.sessionId ?? null,
  })),
}));
vi.mock('@/database/models/agent');
vi.mock('@/database/models/message');
vi.mock('@/database/models/project');
vi.mock('@/database/models/thread');
vi.mock('@/database/repositories/topic');
vi.mock('@/server/services/aiChat');
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));

const createTopic = vi.fn();
const findProject = vi.fn();

const send = () =>
  aiChatRouter.createCaller({ userId: 'u1' } as any).sendMessageInServer({
    newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
    newTopic: { projectId: 'prj_1', title: 'T' },
    newUserMessage: { content: 'hi' },
    sessionId: 's1',
  } as any);

describe('aiChatRouter.sendMessageInServer in a project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTopic.mockResolvedValue({ id: 't1' });
    vi.mocked(TopicRepository).mockImplementation(function () {
      return { create: createTopic } as any;
    });
    vi.mocked(ProjectModel).mockImplementation(function () {
      return { findById: findProject } as any;
    });
    vi.mocked(MessageModel).mockImplementation(function () {
      return {
        createUserAndAssistantMessages: vi.fn(async () => ({
          assistantMessage: { id: 'm-assistant' },
          userMessage: { id: 'm-user' },
        })),
      } as any;
    });
    vi.mocked(AiChatService).mockImplementation(function () {
      return {
        getMessagesAndTopics: vi.fn().mockResolvedValue({ messages: [], topics: undefined }),
      } as any;
    });
  });

  /** @example User report: a project "+" with no runnable directory left an untitled topic behind. */
  it('creates the first-send topic inside the project the blank draft was staged in', async () => {
    findProject.mockResolvedValue({ id: 'prj_1' });

    await send();

    expect(findProject).toHaveBeenCalledWith('prj_1');
    expect(createTopic).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'prj_1', title: 'T' }),
      undefined,
    );
  });

  it('refuses a project the user cannot read', async () => {
    findProject.mockResolvedValue(undefined);

    await expect(send()).rejects.toThrow('Project not found');
    expect(createTopic).not.toHaveBeenCalled();
  });
});
