import { GoalIdentifier } from '@lobechat/builtin-tool-goal';
import { describe, expect, it, vi } from 'vitest';

import { resolveTurnScopedPluginIds } from './turnContext';

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
