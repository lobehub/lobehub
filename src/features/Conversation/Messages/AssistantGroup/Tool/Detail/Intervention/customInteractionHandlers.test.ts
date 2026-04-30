import { AgentMarketplaceIdentifier } from '@lobechat/builtin-tool-agent-marketplace';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  prepareCustomInteractionSubmit,
  recordCustomInteractionResolution,
} from './customInteractionHandlers';
import { installMarketplaceAgents } from './installMarketplaceAgents';

vi.mock('./installMarketplaceAgents', () => ({
  installMarketplaceAgents: vi.fn(),
}));

describe('customInteractionHandlers', () => {
  const updateTopicMetadata = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T10:00:00.000Z'));
    vi.mocked(installMarketplaceAgents).mockReset();
    updateTopicMetadata.mockReset();
    updateTopicMetadata.mockResolvedValue(undefined);
  });

  it('persists submitted marketplace picks to onboardingSession metadata', async () => {
    vi.mocked(installMarketplaceAgents).mockResolvedValue({
      installedAgentIds: ['agent-1'],
      skippedAgentIds: ['template-existing'],
    });

    const result = await prepareCustomInteractionSubmit(
      AgentMarketplaceIdentifier,
      {
        categoryHints: ['engineering'],
        requestId: 'req-1',
        selectedTemplateIds: ['template-1', 'template-existing'],
      },
      {
        topicId: 'topic-1',
        updateTopicMetadata,
      },
    );

    expect(updateTopicMetadata).toHaveBeenCalledWith('topic-1', {
      onboardingSession: {
        agentMarketplacePick: {
          categoryHints: ['engineering'],
          installedAgentIds: ['agent-1'],
          requestId: 'req-1',
          resolvedAt: '2026-04-29T10:00:00.000Z',
          selectedTemplateIds: ['template-1', 'template-existing'],
          skippedAgentIds: ['template-existing'],
          status: 'submitted',
        },
        lastActiveAt: '2026-04-29T10:00:00.000Z',
      },
    });
    expect(result.payload).toMatchObject({
      installedAgentIds: ['agent-1'],
      skippedAgentIds: ['template-existing'],
    });
    expect(result.options?.createUserMessage).toBe(false);
  });

  it('persists skipped marketplace picks from the original tool arguments', async () => {
    await recordCustomInteractionResolution(
      AgentMarketplaceIdentifier,
      'skipped',
      undefined,
      {
        requestArgs: {
          categoryHints: ['design-creative'],
          requestId: 'req-2',
        },
        topicId: 'topic-1',
        updateTopicMetadata,
      },
      'not now',
    );

    expect(updateTopicMetadata).toHaveBeenCalledWith('topic-1', {
      onboardingSession: {
        agentMarketplacePick: {
          categoryHints: ['design-creative'],
          requestId: 'req-2',
          resolvedAt: '2026-04-29T10:00:00.000Z',
          skipReason: 'not now',
          status: 'skipped',
        },
        lastActiveAt: '2026-04-29T10:00:00.000Z',
      },
    });
  });
});
