import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cloudSandboxService } from '@/services/cloudSandbox';

import { skillsExecutor } from '../lobe-skills';

vi.mock('@lobechat/builtin-skills', () => ({ builtinSkills: [] }));
vi.mock('@/helpers/skillFilters', () => ({ filterBuiltinSkills: () => [] }));
vi.mock('@/services/cloudSandbox', () => ({ cloudSandboxService: { callTool: vi.fn() } }));
vi.mock('@/services/skill', () => ({
  agentSkillService: {
    getByName: async (name: string) => ({ id: name, identifier: name }),
    readResource: async (id: string) => ({ content: `Reference for ${id}` }),
  },
}));
vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({
    agentMap: {
      member: { plugins: ['member-skill'] },
      supervisor: { plugins: ['supervisor-skill'] },
    },
  }),
}));
vi.mock('@/store/chat', () => ({
  getChatStoreState: () => ({
    dbMessagesMap: {
      group_agent_group_topic_member: [
        { metadata: { selectedSkillIds: ['selected-skill'] }, role: 'user' },
      ],
      main_agent_topic: [{ metadata: { selectedSkillIds: ['main-skill'] }, role: 'user' }],
      page_agent_doc: [
        {
          editorData: {
            root: {
              children: [{ actionCategory: 'skill', actionType: 'page-skill', type: 'action-tag' }],
            },
          },
          role: 'user',
        },
      ],
      task_agent_topic: [{ metadata: { selectedSkillIds: ['task-skill'] }, role: 'user' }],
    },
  }),
  useChatStore: { getState: () => ({ activeTopicId: 'test-topic' }) },
}));

describe('Web Skills conversation selection', () => {
  it('uses the group member profile and selections from its conversation', async () => {
    const context = {
      agentId: 'supervisor',
      groupId: 'group',
      messageId: 'message',
      scope: 'group_agent',
      subAgentId: 'member',
      topicId: 'topic',
    };
    const read = (id: string) =>
      skillsExecutor.invoke('readReference', { id, path: 'guide.md' }, context);

    expect(await read('member-skill')).toMatchObject({ success: true });
    expect(await read('supervisor-skill')).toMatchObject({ success: false });
    expect(await read('selected-skill')).toMatchObject({ success: true });
  });

  it.each([
    { scope: 'task', topicId: 'topic' },
    { documentId: 'doc', scope: 'page' },
  ])('reads a reference selected in the $scope conversation', async (context) => {
    const id = `${context.scope}-skill`;
    const read = (skill: string) =>
      skillsExecutor.invoke(
        'readReference',
        { id: skill, path: 'guide.md' },
        { ...context, agentId: 'agent', messageId: 'message' },
      );

    expect(await read(id)).toMatchObject({ content: `Reference for ${id}`, success: true });
    expect(await read('main-skill')).toMatchObject({ success: false });
  });
});

describe.each(['runCommand', 'execScript'] as const)('Web Skills %s recreation', (api) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([true, false])('warns when sandbox transport success is %s', async (success) => {
    vi.mocked(cloudSandboxService.callTool).mockResolvedValue({
      error: success ? undefined : { message: 'missing input file' },
      result: { exitCode: success ? 0 : 1, stdout: 'command output' },
      sessionExpiredAndRecreated: true,
      success,
    });

    const result = await skillsExecutor.invoke(
      api,
      { command: 'cat /tmp/input', description: 'Read input' },
      { messageId: 'test-message', operationId: 'test-operation' },
    );

    expect(result.content).toContain('sandbox session expired and was recreated');
    expect(result.content).toContain(success ? 'command output' : 'missing input file');
    expect(result.success).toBe(success);
    if (success) expect(result.state).toMatchObject({ sessionExpiredAndRecreated: true });
  });
});
