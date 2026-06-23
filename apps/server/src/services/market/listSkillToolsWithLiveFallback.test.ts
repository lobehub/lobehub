// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { listSkillToolsWithLiveFallback } from './listSkillToolsWithLiveFallback';

describe('listSkillToolsWithLiveFallback', () => {
  it('should return live tools when live discovery succeeds', async () => {
    const liveResponse = {
      instruction: 'Use live PostHog tools.',
      tools: [{ inputSchema: { type: 'object' }, name: 'query' }],
    };
    const skills = {
      listLiveTools: vi.fn().mockResolvedValue(liveResponse),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
    };

    await expect(listSkillToolsWithLiveFallback(skills, 'posthog')).resolves.toBe(liveResponse);

    expect(skills.listLiveTools).toHaveBeenCalledWith('posthog');
    expect(skills.listTools).not.toHaveBeenCalled();
  });

  it('should fall back to static tools when live discovery throws', async () => {
    const error = new Error('Live discovery failed');
    const staticResponse = {
      tools: [{ inputSchema: { type: 'object' }, name: 'query' }],
    };
    const onLiveDiscoveryError = vi.fn();
    const skills = {
      listLiveTools: vi.fn().mockRejectedValue(error),
      listTools: vi.fn().mockResolvedValue(staticResponse),
    };

    await expect(
      listSkillToolsWithLiveFallback(skills, 'posthog', onLiveDiscoveryError),
    ).resolves.toBe(staticResponse);

    expect(onLiveDiscoveryError).toHaveBeenCalledWith(error);
    expect(skills.listTools).toHaveBeenCalledWith('posthog');
  });

  it('should fall back to static tools when live discovery returns no response', async () => {
    const staticResponse = {
      tools: [{ inputSchema: { type: 'object' }, name: 'query' }],
    };
    const skills = {
      listLiveTools: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue(staticResponse),
    };

    await expect(listSkillToolsWithLiveFallback(skills, 'posthog')).resolves.toBe(staticResponse);

    expect(skills.listTools).toHaveBeenCalledWith('posthog');
  });

  it('should fall back to static tools when live discovery returns no tools', async () => {
    const staticResponse = {
      tools: [{ inputSchema: { type: 'object' }, name: 'query' }],
    };
    const skills = {
      listLiveTools: vi.fn().mockResolvedValue({ instruction: 'No live tools yet.', tools: [] }),
      listTools: vi.fn().mockResolvedValue(staticResponse),
    };

    await expect(listSkillToolsWithLiveFallback(skills, 'posthog')).resolves.toBe(staticResponse);

    expect(skills.listTools).toHaveBeenCalledWith('posthog');
  });

  it('should use static tools when live discovery is unavailable', async () => {
    const staticResponse = {
      tools: [{ inputSchema: { type: 'object' }, name: 'query' }],
    };
    const skills = {
      listTools: vi.fn().mockResolvedValue(staticResponse),
    };

    await expect(listSkillToolsWithLiveFallback(skills, 'posthog')).resolves.toBe(staticResponse);

    expect(skills.listTools).toHaveBeenCalledWith('posthog');
  });
});
