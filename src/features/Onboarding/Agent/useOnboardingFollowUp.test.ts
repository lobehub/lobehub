import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useFollowUpActionStore } from '@/store/followUpAction';

import { useOnboardingFollowUp } from './useOnboardingFollowUp';

const MODEL_CONFIG = {
  model: 'scene-model',
  provider: 'scene-provider',
};
const AGENT_ID = 'agent-onboarding';
const TOPIC_ID = 'topic-1';
const CONVERSATION_KEY = messageMapKey({ agentId: AGENT_ID, topicId: TOPIC_ID });

describe('useOnboardingFollowUp', () => {
  let fetchFor: ReturnType<typeof vi.fn>;
  let clear: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFor = vi.fn();
    clear = vi.fn();
    vi.spyOn(useFollowUpActionStore, 'getState').mockReturnValue({
      fetchFor,
      clear,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns no hooks when disabled', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: false,
        isGreeting: false,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
        phase: 'discovery',
        topicId: TOPIC_ID,
      }),
    );
    expect(result.current.onAssistantTurnSettled).toBeUndefined();
    expect(result.current.onBeforeSendMessage).toBeUndefined();
  });

  it('returns no hooks when onboardingAgentId is missing', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: true,
        isGreeting: false,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: undefined,
        phase: 'discovery',
        topicId: TOPIC_ID,
      }),
    );
    expect(result.current.onAssistantTurnSettled).toBeUndefined();
    expect(result.current.onBeforeSendMessage).toBeUndefined();
  });

  it('returns no hooks when topicId is missing', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: true,
        isGreeting: false,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
        phase: 'discovery',
        topicId: undefined,
      }),
    );
    expect(result.current.onAssistantTurnSettled).toBeUndefined();
    expect(result.current.onBeforeSendMessage).toBeUndefined();
  });

  it('onAssistantTurnSettled skips when phase is undefined', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: true,
        isGreeting: false,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
        phase: undefined,
        topicId: TOPIC_ID,
      }),
    );
    await result.current.onAssistantTurnSettled?.('msg-1', { reason: 'completed' });
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('onAssistantTurnSettled skips when phase is summary', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: true,
        isGreeting: false,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
        phase: 'summary',
        topicId: TOPIC_ID,
      }),
    );
    await result.current.onAssistantTurnSettled?.('msg-1', { reason: 'completed' });
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('onAssistantTurnSettled skips when isGreeting is true', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: true,
        isGreeting: true,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
        phase: 'agent_identity',
        topicId: TOPIC_ID,
      }),
    );
    await result.current.onAssistantTurnSettled?.('msg-1', { reason: 'completed' });
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('onAssistantTurnSettled skips when reason is stopped', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: true,
        isGreeting: false,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
        phase: 'discovery',
        topicId: TOPIC_ID,
      }),
    );
    await result.current.onAssistantTurnSettled?.('msg-1', { reason: 'stopped' });
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('onAssistantTurnSettled fires fetchFor with onboarding hint on a normal turn', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: true,
        isGreeting: false,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
        phase: 'discovery',
        topicId: TOPIC_ID,
      }),
    );
    await result.current.onAssistantTurnSettled?.('msg-1', { reason: 'completed' });
    expect(fetchFor).toHaveBeenCalledWith(CONVERSATION_KEY, {
      hint: {
        kind: 'onboarding',
        phase: 'discovery',
      },
      modelConfig: MODEL_CONFIG,
      topicId: TOPIC_ID,
    });
  });

  it('onAssistantTurnSettled uses the phase snapshot captured at memoize time', async () => {
    const { result, rerender } = renderHook(
      (props: { phase: 'discovery' | 'agent_identity' }) =>
        useOnboardingFollowUp({
          enabled: true,
          isGreeting: false,
          modelConfig: MODEL_CONFIG,
          onboardingAgentId: AGENT_ID,
          phase: props.phase,
          topicId: TOPIC_ID,
        }),
      { initialProps: { phase: 'discovery' } },
    );
    const fired = result.current.onAssistantTurnSettled;
    rerender({ phase: 'agent_identity' });
    await fired?.('msg-1', { reason: 'completed' });
    expect(fetchFor).toHaveBeenCalledWith(CONVERSATION_KEY, {
      hint: {
        kind: 'onboarding',
        phase: 'discovery',
      },
      modelConfig: MODEL_CONFIG,
      topicId: TOPIC_ID,
    });
  });

  it('onBeforeSendMessage clears when enabled', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: true,
        isGreeting: false,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
        phase: 'discovery',
        topicId: TOPIC_ID,
      }),
    );
    await result.current.onBeforeSendMessage?.({} as any);
    expect(clear).toHaveBeenCalledWith(CONVERSATION_KEY);
  });

  it('onBeforeSendMessage is absent when disabled', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: false,
        isGreeting: false,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
        phase: 'discovery',
        topicId: TOPIC_ID,
      }),
    );
    expect(result.current.onBeforeSendMessage).toBeUndefined();
    expect(clear).not.toHaveBeenCalled();
  });
});
