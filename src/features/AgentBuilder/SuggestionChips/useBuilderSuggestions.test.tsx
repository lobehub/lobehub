import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiChatService } from '@/services/aiChat';

import { useBuilderSuggestions } from './useBuilderSuggestions';

type GenerateJSONResult = Awaited<ReturnType<typeof aiChatService.generateJSON>>;
type RecordTracingFeedbackResult = Awaited<ReturnType<typeof aiChatService.recordTracingFeedback>>;

const makeEnvelope = (label: string) =>
  ({
    data: {
      suggestions: [
        {
          prompt: `${label} prompt`,
          title: `${label} title`,
        },
      ],
    },
    tracingId: `trace-${label}`,
  }) as GenerateJSONResult;

const baseParams = {
  builderAgentId: 'builder-agent',
  contextSummary: 'initial context',
  enabled: true,
  locale: 'zh-CN',
  mode: 'agent',
  model: 'model-a',
  provider: 'provider-a',
  targetId: 'target-agent',
} satisfies Parameters<typeof useBuilderSuggestions>[0];

const createSWRWrapper = () => {
  const value = { provider: () => new Map() };

  return function SWRTestWrapper({ children }: PropsWithChildren) {
    return createElement(SWRConfig, { value }, children);
  };
};

const waitForNextTick = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const getGeneratedUserContent = (callIndex: number) => {
  const [params] = vi.mocked(aiChatService.generateJSON).mock.calls[callIndex];
  const userMessage = params.messages.find((message) => message.role === 'user');

  return String(userMessage?.content ?? '');
};

describe('useBuilderSuggestions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(aiChatService, 'generateJSON').mockResolvedValue(makeEnvelope('first'));
    vi.spyOn(aiChatService, 'recordTracingFeedback').mockResolvedValue({
      ok: true,
    } as RecordTracingFeedbackResult);
  });

  it('does not regenerate when autosave updates context for the same target', async () => {
    const { rerender, result } = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
      wrapper: createSWRWrapper(),
    });

    await waitFor(() => {
      expect(result.current.suggestions[0]?.title).toBe('first title');
    });
    expect(aiChatService.generateJSON).toHaveBeenCalledTimes(1);

    rerender({ ...baseParams, contextSummary: 'autosaved updated context' });
    await waitForNextTick();

    expect(aiChatService.generateJSON).toHaveBeenCalledTimes(1);
    expect(result.current.suggestions[0]?.title).toBe('first title');
  });

  it('uses the latest context when the user manually refreshes suggestions', async () => {
    vi.mocked(aiChatService.generateJSON)
      .mockResolvedValueOnce(makeEnvelope('first'))
      .mockResolvedValueOnce(makeEnvelope('second'));

    const { rerender, result } = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
      wrapper: createSWRWrapper(),
    });

    await waitFor(() => {
      expect(result.current.suggestions[0]?.title).toBe('first title');
    });

    rerender({ ...baseParams, contextSummary: 'manual refresh context' });

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(aiChatService.generateJSON).toHaveBeenCalledTimes(2);
    });

    expect(getGeneratedUserContent(1)).toContain('manual refresh context');
    expect(result.current.suggestions[0]?.title).toBe('second title');
  });

  it('regenerates when the edited target changes', async () => {
    vi.mocked(aiChatService.generateJSON)
      .mockResolvedValueOnce(makeEnvelope('first'))
      .mockResolvedValueOnce(makeEnvelope('second'));

    const { rerender, result } = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
      wrapper: createSWRWrapper(),
    });

    await waitFor(() => {
      expect(result.current.suggestions[0]?.title).toBe('first title');
    });

    rerender({
      ...baseParams,
      contextSummary: 'new target context',
      targetId: 'target-agent-2',
    });

    await waitFor(() => {
      expect(aiChatService.generateJSON).toHaveBeenCalledTimes(2);
    });

    expect(getGeneratedUserContent(1)).toContain('new target context');
  });
});
