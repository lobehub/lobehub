/**
 * @vitest-environment happy-dom
 */
import { randomUUID } from 'node:crypto';

import { RequestTrigger } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, replicaKeys } from '@/libs/replica';
import { CACHE_TIERS } from '@/libs/swr/localStorageProvider';
import { aiChatService } from '@/services/aiChat';

import { builderSuggestionResource } from './projection';
import { initialBuilderSuggestionState, useBuilderSuggestionStore } from './suggestionStore';
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

const seedPersisted = (scope: string, params: typeof baseParams, title: string) =>
  builderSuggestionResource.storage!.set(
    { queryKey: builderSuggestionResource.storageKey(params), scope },
    {
      data: { suggestions: [{ prompt: `${title} prompt`, title }], tracingId: `trace-${title}` },
      updatedAt: 1,
    },
  );

describe('useBuilderSuggestions', () => {
  let scope = '';

  beforeEach(() => {
    scope = `builder-user-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useBuilderSuggestionStore.setState(initialBuilderSuggestionState));
    vi.spyOn(aiChatService, 'generateJSON').mockResolvedValue(makeEnvelope('first'));
    vi.spyOn(aiChatService, 'recordTracingFeedback').mockResolvedValue({
      ok: true,
    } as RecordTracingFeedbackResult);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // The SWR tier persists every key whose serialized form contains a
  // CACHE_TIERS pattern; the replica must stay the only persisted copy.
  it('keeps the replica sync key out of the SWR persistence tiers', () => {
    const serialized = JSON.stringify(
      replicaKeys.sync(
        builderSuggestionResource.name,
        builderSuggestionResource.version,
        scope,
        'key',
        baseParams,
      ),
    );

    expect(builderSuggestionResource.namespace).toBe('replica:agentBuilderSuggestions:v1');
    expect(
      [...CACHE_TIERS.idb, ...CACHE_TIERS.local].filter((p) => serialized.includes(p)),
    ).toEqual([]);
  });

  it('tags suggestion requests with the builder suggestion trigger', async () => {
    const { result } = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
    });

    await waitFor(() => {
      expect(result.current.suggestions[0]?.title).toBe('first title');
    });
    expect(vi.mocked(aiChatService.generateJSON).mock.calls[0][0].metadata).toEqual({
      trigger: RequestTrigger.BuilderSuggestion,
    });
  });

  it('does not regenerate when autosave updates context for the same target', async () => {
    const { rerender, result } = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
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
    });

    await waitFor(() => {
      expect(result.current.suggestions[0]?.title).toBe('first title');
    });

    rerender({ ...baseParams, contextSummary: 'manual refresh context' });

    act(() => {
      result.current.refresh();
    });
    // The discarded batch leaves the screen while the new one generates.
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.suggestions[0]?.title).toBe('second title');
    });

    expect(aiChatService.generateJSON).toHaveBeenCalledTimes(2);
    expect(getGeneratedUserContent(1)).toContain('manual refresh context');
  });

  // Regression: the chips used to be persisted by the SWR localStorage tier.
  // They are a localStorage replica now: a reload paints the persisted batch and
  // must not pay another LLM generation for it.
  it('serves the persisted batch after a reload without regenerating', async () => {
    const first = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
    });
    await waitFor(() => {
      expect(first.result.current.suggestions[0]?.title).toBe('first title');
    });
    first.unmount();
    expect(aiChatService.generateJSON).toHaveBeenCalledTimes(1);

    // Reload: the memory store starts empty.
    act(() => useBuilderSuggestionStore.setState(initialBuilderSuggestionState));
    const { result } = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: { ...baseParams, contextSummary: 'context after reload' },
    });

    await waitFor(() => {
      expect(result.current.suggestions[0]?.title).toBe('first title');
    });
    expect(result.current.tracingId).toBe('trace-first');
    await waitForNextTick();

    expect(aiChatService.generateJSON).toHaveBeenCalledTimes(1);
  });

  it('paints a persisted row without generating', async () => {
    await seedPersisted(scope, baseParams, 'cached title');

    const { result } = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
    });

    await waitFor(() => {
      expect(result.current.suggestions[0]?.title).toBe('cached title');
    });
    await waitForNextTick();

    expect(aiChatService.generateJSON).not.toHaveBeenCalled();
  });

  it('switching to a target with a persisted batch paints it without generating', async () => {
    await seedPersisted(scope, { ...baseParams, targetId: 'target-agent-2' }, 'second target');

    const { rerender, result } = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
    });
    await waitFor(() => {
      expect(result.current.suggestions[0]?.title).toBe('first title');
    });

    rerender({ ...baseParams, targetId: 'target-agent-2' });

    await waitFor(() => {
      expect(result.current.suggestions[0]?.title).toBe('second target');
    });
    await waitForNextTick();
    expect(aiChatService.generateJSON).toHaveBeenCalledTimes(1);
  });

  it('never paints another identity’s persisted batch', async () => {
    await seedPersisted('someone-else:personal', baseParams, 'other title');

    const { result } = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
    });

    await waitFor(() => {
      expect(result.current.suggestions[0]?.title).toBe('first title');
    });
  });

  // Persisted entries are generated in the UI language, so a language switch
  // must miss the cache and regenerate instead of serving old-locale chips.
  it('regenerates when the UI locale changes', async () => {
    vi.mocked(aiChatService.generateJSON)
      .mockResolvedValueOnce(makeEnvelope('first'))
      .mockResolvedValueOnce(makeEnvelope('second'));

    const { rerender, result } = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
    });

    await waitFor(() => {
      expect(result.current.suggestions[0]?.title).toBe('first title');
    });

    rerender({ ...baseParams, locale: 'en-US' });

    await waitFor(() => {
      expect(result.current.suggestions[0]?.title).toBe('second title');
    });
    expect(aiChatService.generateJSON).toHaveBeenCalledTimes(2);
  });

  it('regenerates when the edited target changes', async () => {
    vi.mocked(aiChatService.generateJSON)
      .mockResolvedValueOnce(makeEnvelope('first'))
      .mockResolvedValueOnce(makeEnvelope('second'));

    const { rerender, result } = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
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

  it('does not retry a failed generation on its own', async () => {
    vi.mocked(aiChatService.generateJSON).mockRejectedValue(new Error('llm down'));

    const { rerender, result } = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
    });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.isLoading).toBe(false);
    rerender({ ...baseParams, contextSummary: 'autosaved after failure' });
    await waitForNextTick();
    expect(aiChatService.generateJSON).toHaveBeenCalledTimes(1);
  });

  // Regression: refresh hid the rejected batch in memory only (`persist: false`),
  // so a failed regeneration followed by a reload restored the rejected batch
  // and skipped generation because the entry looked filled.
  it('drops a rejected batch from persistence even when its regeneration fails', async () => {
    const { result, unmount } = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
    });
    await waitFor(() => expect(result.current.suggestions[0]?.title).toBe('first title'));
    await waitFor(async () => {
      const row = await builderSuggestionResource.storage!.get({
        queryKey: builderSuggestionResource.storageKey(baseParams),
        scope,
      });
      expect(row?.data).toBeTruthy();
    });

    vi.mocked(aiChatService.generateJSON).mockRejectedValue(new Error('llm down'));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    unmount();

    await waitFor(async () => {
      const row = await builderSuggestionResource.storage!.get({
        queryKey: builderSuggestionResource.storageKey(baseParams),
        scope,
      });
      expect(row).toBeUndefined();
    });

    // Reload: the rejected batch is not restored; the entry generates again.
    act(() => useBuilderSuggestionStore.setState(initialBuilderSuggestionState));
    vi.mocked(aiChatService.generateJSON).mockResolvedValue(makeEnvelope('second'));
    const reloaded = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
    });
    await waitFor(() => expect(reloaded.result.current.suggestions[0]?.title).toBe('second title'));
    expect(aiChatService.generateJSON).toHaveBeenCalledTimes(3);
  });

  // Regression: hydration started in a passive effect, so a reload with a
  // persisted batch rendered the skeleton for at least its first frame.
  it('paints a persisted batch on the very first render', async () => {
    await seedPersisted(scope, baseParams, 'persisted');
    const renders: Array<{ isLoading: boolean; title?: string }> = [];

    renderHook(
      (props) => {
        const result = useBuilderSuggestions(props);
        renders.push({ isLoading: result.isLoading, title: result.suggestions[0]?.title });
        return result;
      },
      { initialProps: baseParams },
    );

    expect(renders[0]).toEqual({ isLoading: false, title: 'persisted' });
    await waitForNextTick();
    expect(renders.every((r) => !r.isLoading)).toBe(true);
    expect(aiChatService.generateJSON).not.toHaveBeenCalled();
  });

  // Regression: generation errors were keyed by entry only, so identity A's
  // failure showed as identity B's (not loading) for the same entry key.
  it('does not carry a generation error over to another identity', async () => {
    vi.mocked(aiChatService.generateJSON).mockRejectedValue(new Error('llm down'));
    const { rerender, result } = renderHook((props) => useBuilderSuggestions(props), {
      initialProps: baseParams,
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());

    vi.mocked(aiChatService.generateJSON).mockImplementation(() => new Promise(() => {}));
    scope = `builder-user-${randomUUID()}:personal`;
    rerender({ ...baseParams });
    await waitForNextTick();

    expect(result.current.error).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });
});
