import { describe, expect, it, vi } from 'vitest';

import { agentShareService } from './agentShare';

const { getSharedAgentQuery } = vi.hoisted(() => ({ getSharedAgentQuery: vi.fn() }));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    share: { getSharedAgent: { query: getSharedAgentQuery } },
  },
}));

describe('agentShareService', () => {
  it('keeps unauthorized visitors on the share page instead of the global 401 redirect', async () => {
    await agentShareService.getSharedAgent('share-id');

    expect(getSharedAgentQuery).toHaveBeenCalledWith(
      { shareId: 'share-id', trackView: true },
      { context: { showNotification: false } },
    );
  });

  it('lets a status re-check opt out of counting another page view', async () => {
    await agentShareService.getSharedAgent('share-id', false);

    expect(getSharedAgentQuery).toHaveBeenCalledWith(
      { shareId: 'share-id', trackView: false },
      { context: { showNotification: false } },
    );
  });
});
