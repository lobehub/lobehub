import { extractActivatedToolIdsFromMessages } from '@lobechat/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

import { createHistoryMessagesLoader } from '../operationPrep';

vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFileAccessUrl = vi.fn();
  },
}));

const GROUP_ID = 'cg_test_group';
const TOPIC_ID = 'tpc_test_topic';
const SUPERVISOR_ID = 'agt_test_supervisor';

// A prior group-supervisor turn that activated lobe-agent-management.
const groupTopicMessages = [
  {
    agentId: SUPERVISOR_ID,
    content: 'Activate agent management',
    groupId: GROUP_ID,
    id: 'msg_prev_user',
    role: 'user',
  },
  {
    agentId: SUPERVISOR_ID,
    content: '',
    groupId: GROUP_ID,
    id: 'msg_prev_assistant',
    role: 'assistant',
  },
  {
    agentId: SUPERVISOR_ID,
    content: 'Activated',
    groupId: GROUP_ID,
    id: 'msg_prev_tool',
    plugin: { apiName: 'activateTools', identifier: 'lobe-activator' },
    pluginState: {
      activatedTools: [
        { apiCount: 9, identifier: 'lobe-agent-management', name: 'Agent Management' },
      ],
    },
    role: 'tool',
  },
  {
    agentId: SUPERVISOR_ID,
    content: 'Call the writer',
    groupId: GROUP_ID,
    id: 'msg_current_user',
    role: 'user',
  },
];

/**
 * Mirrors `MessageModel.query` scoping: a `groupId` selects the group
 * conversation, while omitting it filters to `groupId IS NULL` rows.
 */
const createMessageModel = () => ({
  query: vi.fn(async (params: { groupId?: string; topicId?: string }) =>
    groupTopicMessages.filter(
      (msg) =>
        msg.groupId === (params.groupId ?? null) &&
        (!params.topicId || params.topicId === TOPIC_ID),
    ),
  ),
});

const createLoader = (messageModel: ReturnType<typeof createMessageModel>, existingIds = []) =>
  createHistoryMessagesLoader(
    {
      db: {} as any,
      isShareVisitorRun: false,
      messageModel: messageModel as any,
      userId: 'user_agent_testing_001',
    },
    {
      appContext: { groupId: GROUP_ID, orchestrationRole: 'supervisor', topicId: TOPIC_ID },
      effectiveResume: false,
      existingMessageIds: existingIds,
      resumeParentMessage: undefined,
      selfMessageIds: new Set(['msg_current_user']),
    },
  );

describe('createHistoryMessagesLoader', () => {
  describe('group supervisor runs', () => {
    it('should load the group conversation so prior tool activations can be restored', async () => {
      const messageModel = createMessageModel();

      const history = await createLoader(messageModel)();

      expect(messageModel.query).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: GROUP_ID, topicId: TOPIC_ID }),
        expect.anything(),
      );
      expect(history.map((msg) => msg.id)).toEqual([
        'msg_prev_user',
        'msg_prev_assistant',
        'msg_prev_tool',
      ]);
      expect(extractActivatedToolIdsFromMessages(history as any)).toEqual([
        'lobe-agent-management',
      ]);
    });

    it('should scope explicit message ids to the group conversation', async () => {
      const messageModel = createMessageModel();

      const history = await createLoader(messageModel, ['msg_prev_tool'] as any)();

      expect(history.map((msg) => msg.id)).toEqual(['msg_prev_tool']);
    });
  });
});
