import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAgentStoreState } from '@/store/agent/store';
import { getFollowUpActionStoreState } from '@/store/followUpAction/store';

import { applyPromptSuggestion, resolvePromptSuggestionArgs } from './promptSuggestions';

const getChatConfigById = vi.hoisted(() => vi.fn());

vi.mock('@/store/agent/selectors', () => ({
  chatConfigByIdSelectors: { getChatConfigById },
}));
vi.mock('@/store/agent/store', () => ({ getAgentStoreState: vi.fn(() => ({})) }));
vi.mock('@/store/followUpAction/store', () => ({ getFollowUpActionStoreState: vi.fn() }));

describe('resolvePromptSuggestionArgs', () => {
  const withConfig = (enableFollowUpChips?: boolean) =>
    getChatConfigById.mockReturnValue(() => ({ enableFollowUpChips }));

  beforeEach(() => {
    vi.mocked(getAgentStoreState).mockReturnValue({} as any);
  });

  it('asks Claude Code for suggestions when the agent turned them on', () => {
    withConfig(true);
    expect(
      resolvePromptSuggestionArgs({ adapterType: 'claude-code', agentId: 'a', args: ['--x'] }),
    ).toEqual(['--x', '--prompt-suggestions=true']);
  });

  it('leaves args alone when the toggle is off', () => {
    withConfig(false);
    expect(
      resolvePromptSuggestionArgs({ adapterType: 'claude-code', agentId: 'a', args: ['--x'] }),
    ).toEqual(['--x']);
  });

  it('never adds the flag to another CLI', () => {
    withConfig(true);
    expect(resolvePromptSuggestionArgs({ adapterType: 'codex', agentId: 'a', args: [] })).toEqual(
      [],
    );
  });
});

describe('applyPromptSuggestion', () => {
  const setNativeSuggestion = vi.fn();
  const base = { assistantMessageId: 'a2', conversationKey: 'key', suggestion: 'next' };

  beforeEach(() => {
    setNativeSuggestion.mockClear();
    vi.mocked(getFollowUpActionStoreState).mockReturnValue({ setNativeSuggestion } as any);
  });

  it('shows the suggestion under the latest reply', () => {
    applyPromptSuggestion({
      ...base,
      messages: [
        { id: 'u1', role: 'user' },
        { id: 'a2', role: 'assistant' },
      ],
    });
    expect(setNativeSuggestion).toHaveBeenCalledWith('key', {
      messageId: 'a2',
      suggestion: 'next',
    });
  });

  it('drops a suggestion when the user already sent the next message', () => {
    applyPromptSuggestion({
      ...base,
      messages: [
        { id: 'a2', role: 'assistant' },
        { id: 'u3', role: 'user' },
      ],
    });
    expect(setNativeSuggestion).not.toHaveBeenCalled();
  });

  it('drops a suggestion whose reply is no longer loaded', () => {
    applyPromptSuggestion({ ...base, messages: [{ id: 'other', role: 'assistant' }] });
    applyPromptSuggestion({ ...base, messages: undefined });
    expect(setNativeSuggestion).not.toHaveBeenCalled();
  });
});
