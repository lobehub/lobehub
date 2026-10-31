import type { LoaderFunctionArgs } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { agentAccessLoader, agentGroupAccessLoader } from './resourceAccessLoader';

vi.mock('@/features/ResourcePermission/accessLoader', () => ({
  preHydrateResourceAccess: vi.fn(async () => null),
}));

const args = (params: Record<string, string>) => ({ params }) as unknown as LoaderFunctionArgs;

describe('resource access route loaders', () => {
  it('pre-hydrates the route resource through the real loader', async () => {
    const { preHydrateResourceAccess } = await import('@/features/ResourcePermission/accessLoader');

    await expect(agentAccessLoader(args({ aid: 'agt_1' }))).resolves.toBeNull();
    await expect(agentGroupAccessLoader(args({ gid: 'grp_1' }))).resolves.toBeNull();

    expect(preHydrateResourceAccess).toHaveBeenCalledWith('agent', 'agt_1');
    expect(preHydrateResourceAccess).toHaveBeenCalledWith('agentGroup', 'grp_1');
  });
});
