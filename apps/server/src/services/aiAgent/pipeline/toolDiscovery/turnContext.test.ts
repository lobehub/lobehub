import { ArtboardIdentifier } from '@lobechat/builtin-tool-artboard';
import { GoalIdentifier } from '@lobechat/builtin-tool-goal';
import { describe, expect, it, vi } from 'vitest';

import { collectSelectedToolIds, resolveTurnScopedPluginIds } from './turnContext';

vi.mock('../../helpers/mediaAvailability', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isMultimodalUnderstandingConfigured: () => false,
}));

const resolve = (history: any[]) =>
  resolveTurnScopedPluginIds({
    attachedFileTypes: [],
    isBotConversation: false,
    loadHistoryMessages: async () => history,
    modelMediaCapabilities: { audio: true, video: true, vision: true },
  });

const goalCall = (pluginState?: Record<string, unknown>, identifier = 'lobe-goal') => ({
  plugin: { apiName: 'createGoal', identifier },
  pluginState,
  role: 'tool',
});

describe('resolveTurnScopedPluginIds goal follow-up', () => {
  it('keeps the goal tool after the user rejected a goal proposal', async () => {
    expect(await resolve([{ role: 'user' }, goalCall(), { role: 'user' }])).toContain(
      GoalIdentifier,
    );
  });

  it('drops the goal tool once the latest proposal created a goal', async () => {
    expect(
      await resolve([goalCall(), goalCall({ goalId: 'goal_1' }, GoalIdentifier)]),
    ).not.toContain(GoalIdentifier);
  });

  it('does not add the goal tool to a conversation without goal proposals', async () => {
    expect(await resolve([{ role: 'user' }, { role: 'assistant' }])).toEqual([]);
  });
});

describe('resolveTurnScopedPluginIds artboard', () => {
  const resolveIn = (isProjectConversation: boolean) =>
    resolveTurnScopedPluginIds({
      attachedFileTypes: [],
      isBotConversation: false,
      isProjectConversation,
      loadHistoryMessages: async () => [],
      modelMediaCapabilities: { audio: true, video: true, vision: true },
    });

  it('offers the artboard tool only in a project conversation', async () => {
    expect(await resolveIn(true)).toContain(ArtboardIdentifier);
    expect(await resolveIn(false)).not.toContain(ArtboardIdentifier);
  });
});

describe('collectSelectedToolIds', () => {
  it('keeps tools earlier user turns selected and merges the current turn selection', () => {
    const history = [
      { metadata: { selectedToolIds: ['xmind'] }, role: 'user' },
      { metadata: null, role: 'assistant' },
      { metadata: { selectedToolIds: ['lobe-web-browsing', 'xmind'] }, role: 'user' },
    ];

    expect(
      collectSelectedToolIds(history, ['feishu', 'xmind'], { hasMentionedAgents: true }),
    ).toEqual(['xmind', 'lobe-web-browsing', 'feishu', 'lobe-agent-management']);
  });

  it('recovers tool action tags and agent mentions from legacy user turns without metadata.selectedToolIds', () => {
    const history = [
      {
        content: '<mention name="Writer" id="agt_writer" /> Draft an outline',
        editorData: {
          root: {
            children: [
              {
                children: [
                  {
                    actionCategory: 'tool',
                    actionLabel: 'XMind',
                    actionType: 'xmind',
                    type: 'action-tag',
                  },
                  {
                    label: 'Writer',
                    metadata: { id: 'agt_writer', type: 'agent' },
                    type: 'mention',
                  },
                ],
                type: 'paragraph',
              },
            ],
            type: 'root',
          },
        },
        role: 'user',
      },
      {
        compressedMessages: [
          {
            content: '<mention name="Reviewer" id="market:reviewer" /> Check it',
            role: 'user',
          },
        ],
        role: 'compressedGroup',
      },
    ];

    expect(collectSelectedToolIds(history)).toEqual(['xmind', 'lobe-agent-management']);
  });

  it('does not enable lobe-agent-management from @mentions inside a group conversation', () => {
    const history = [
      {
        content: '<mention name="Writer" id="agt_writer" /> Hello',
        editorData: {
          root: {
            children: [
              {
                label: 'Writer',
                metadata: { id: 'agt_writer', type: 'agent' },
                type: 'mention',
              },
            ],
            type: 'root',
          },
        },
        role: 'user',
      },
    ];

    expect(
      collectSelectedToolIds(history, [], {
        hasMentionedAgents: true,
        isGroupConversation: true,
      }),
    ).toEqual([]);
  });

  it('ignores non-user rows, external/bot messages, other agents rows, and malformed metadata', () => {
    const history = [
      { metadata: { selectedToolIds: ['from-assistant'] }, role: 'assistant' },
      { metadata: { selectedToolIds: 'not-an-array' }, role: 'user' },
      { metadata: { selectedToolIds: [42, '', 'kept'] }, role: 'user' },
      {
        content: '<mention name="Writer" id="agt_writer" /> From bot sender',
        metadata: {
          botSender: { platform: 'discord', userId: 'u1' },
          selectedToolIds: ['from-bot'],
        },
        role: 'user',
      },
      {
        content: '<mention name="Writer" id="agt_writer" /> From external event',
        metadata: {
          externalOrigin: { provider: 'github' },
          selectedToolIds: ['from-webhook'],
        },
        role: 'user',
      },
      {
        agentId: 'agt_supervisor',
        metadata: { selectedToolIds: ['supervisor-only-connector'] },
        role: 'user',
      },
      { content: 'plain text without mention tags', role: 'user' },
    ];

    expect(collectSelectedToolIds(history, [], { resolvedAgentId: 'agt_member' })).toEqual([
      'kept',
    ]);
    expect(collectSelectedToolIds(history, [], { isInGroupMember: true })).toEqual([]);
  });
});
