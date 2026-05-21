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

  it('triggerExtract skips when disabled', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: false,
        isGreeting: false,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
      }),
    );
    await result.current.triggerExtract(TOPIC_ID, 'discovery');
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('triggerExtract skips when phase is undefined', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: true,
        isGreeting: false,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
      }),
    );
    await result.current.triggerExtract(TOPIC_ID, undefined);
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('triggerExtract skips when phase is summary', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: true,
        isGreeting: false,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
      }),
    );
    await result.current.triggerExtract(TOPIC_ID, 'summary');
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('triggerExtract skips when isGreeting is true', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: true,
        isGreeting: true,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
      }),
    );
    await result.current.triggerExtract(TOPIC_ID, 'agent_identity');
    expect(fetchFor).not.toHaveBeenCalled();
  });

  it('triggerExtract fires fetchFor with onboarding hint on a normal turn', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: true,
        isGreeting: false,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
      }),
    );
    await result.current.triggerExtract(TOPIC_ID, 'discovery');
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
      }),
    );
    await result.current.onBeforeSendMessage(TOPIC_ID);
    expect(clear).toHaveBeenCalledWith(CONVERSATION_KEY);
  });

  it('onBeforeSendMessage does nothing when disabled', async () => {
    const { result } = renderHook(() =>
      useOnboardingFollowUp({
        enabled: false,
        isGreeting: false,
        modelConfig: MODEL_CONFIG,
        onboardingAgentId: AGENT_ID,
      }),
    );
    await result.current.onBeforeSendMessage(TOPIC_ID);
    expect(clear).not.toHaveBeenCalled();
  });
});
