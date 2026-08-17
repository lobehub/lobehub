import { describe, expect, it, vi } from 'vitest';

import { AGENT_DEFAULT_VALUE, persistCodexPermissionSelection } from './codexPermission';

describe('persistCodexPermissionSelection', () => {
  it('updates the Agent default before the first Topic exists', async () => {
    const updateAgentPermissionMode = vi.fn();
    const updateTopicPermissionMode = vi.fn();

    await persistCodexPermissionSelection({
      activeTopicId: null,
      selection: 'ask',
      updateAgentPermissionMode,
      updateTopicPermissionMode,
    });

    expect(updateAgentPermissionMode).toHaveBeenCalledWith('ask');
    expect(updateTopicPermissionMode).not.toHaveBeenCalled();
  });

  it('updates an existing Topic override without changing the Agent default', async () => {
    const updateAgentPermissionMode = vi.fn();
    const updateTopicPermissionMode = vi.fn();

    await persistCodexPermissionSelection({
      activeTopicId: 'topic-1',
      selection: 'read-only',
      updateAgentPermissionMode,
      updateTopicPermissionMode,
    });

    expect(updateTopicPermissionMode).toHaveBeenCalledWith('topic-1', 'read-only');
    expect(updateAgentPermissionMode).not.toHaveBeenCalled();
  });

  it('clears an existing Topic override when Agent default is selected', async () => {
    const updateAgentPermissionMode = vi.fn();
    const updateTopicPermissionMode = vi.fn();

    await persistCodexPermissionSelection({
      activeTopicId: 'topic-1',
      selection: AGENT_DEFAULT_VALUE,
      updateAgentPermissionMode,
      updateTopicPermissionMode,
    });

    expect(updateTopicPermissionMode).toHaveBeenCalledWith('topic-1', null);
    expect(updateAgentPermissionMode).not.toHaveBeenCalled();
  });
});
