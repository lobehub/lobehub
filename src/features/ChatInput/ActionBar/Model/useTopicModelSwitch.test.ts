import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicModelSwitch } from './useTopicModelSwitch';

interface ModelPin {
  model: string;
  provider: string;
}

const state = vi.hoisted(() => ({
  /** `undefined`: the host publishes no topic; `null`: its conversation has none. */
  composerTopicId: undefined as string | null | undefined,
  globalActiveTopicId: undefined as string | undefined,
  selectModel: vi.fn(),
  topicModels: {} as Record<string, ModelPin>,
  updateTopicModel: vi.fn(),
}));

vi.mock('../../store', () => ({
  useChatInputStore: (selector: (s: object) => unknown) =>
    selector({ topicId: state.composerTopicId }),
}));

// Store boundary: the real topic selectors run against this state.
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: object) => unknown) =>
    selector({
      activeTopicId: state.globalActiveTopicId,
      topicDataMap: {},
      useFetchTopicDetail: () => {},
      topicDetailMap: Object.fromEntries(
        Object.entries(state.topicModels).map(([id, pin]) => [id, { id, ...pin }]),
      ),
      updateTopicModel: state.updateTopicModel,
    }),
}));

const picked = { model: 'picked-model', provider: 'picked' };

const renderSwitch = (
  canSelectModel = true,
  selectsSharedDefault = false,
  defaultProviders?: readonly string[],
) =>
  renderHook(() =>
    useTopicModelSwitch({
      canSelectModel,
      defaultProviders,
      model: 'agent-model',
      provider: 'agent-provider',
      selectModel: state.selectModel,
      selectsSharedDefault,
    }),
  );

beforeEach(() => {
  state.composerTopicId = undefined;
  state.globalActiveTopicId = 'outer-topic';
  state.topicModels = {
    'outer-topic': { model: 'outer-model', provider: 'outer-provider' },
    'own-topic': { model: 'own-model', provider: 'own-provider' },
  };
  state.selectModel.mockReset();
  state.updateTopicModel.mockReset();
});

describe('useTopicModelSwitch', () => {
  // A page copilot embedded beside a chat runs with `topicId: null` while the
  // outer chat's topic is still the global active one.
  it('shows and switches the agent model when the composer conversation has no topic', async () => {
    state.composerTopicId = null;
    const { result } = renderSwitch();

    expect(result.current).toMatchObject({ model: 'agent-model', provider: 'agent-provider' });
    await act(() => result.current.switchModel(picked));

    expect(state.selectModel).toHaveBeenCalledWith(picked);
    expect(state.updateTopicModel).not.toHaveBeenCalled();
  });

  it("shows and pins the composer's own topic, not the global active topic", async () => {
    state.composerTopicId = 'own-topic';
    const { result } = renderSwitch();

    expect(result.current).toMatchObject({ model: 'own-model', provider: 'own-provider' });
    await act(() => result.current.switchModel(picked));

    expect(state.updateTopicModel).toHaveBeenCalledWith('own-topic', picked);
  });

  // The next new topic snapshots the agent selection, so a switch inside a
  // topic must also become that selection or the next chat reverts to the old model.
  it('carries a switch inside a topic over to the next new topic', async () => {
    state.composerTopicId = 'own-topic';
    const { result } = renderSwitch();

    await act(() => result.current.switchModel(picked));

    expect(state.updateTopicModel).toHaveBeenCalledWith('own-topic', picked);
    expect(state.selectModel).toHaveBeenCalledWith(picked);
  });

  // The picker closes at once; a new topic opened while the pin is still
  // saving must already see the new selection.
  it('updates the selection without waiting for the topic pin to save', async () => {
    state.composerTopicId = 'own-topic';
    let finishPin!: () => void;
    state.updateTopicModel.mockReturnValue(new Promise<void>((resolve) => (finishPin = resolve)));
    const { result } = renderSwitch();

    let switching!: Promise<void>;
    act(() => {
      switching = result.current.switchModel(picked);
    });

    expect(state.selectModel).toHaveBeenCalledWith(picked);
    finishPin();
    await act(() => switching);
  });

  it('keeps a switch inside a topic out of a default other Workspace members share', async () => {
    state.composerTopicId = 'own-topic';
    const { result } = renderSwitch(true, true);

    await act(() => result.current.switchModel(picked));

    expect(state.updateTopicModel).toHaveBeenCalledWith('own-topic', picked);
    expect(state.selectModel).not.toHaveBeenCalled();
  });

  // A live Agent Share rejects a default outside its providers; carrying the
  // switch over would fail with a save error after the topic already switched.
  it('keeps a switch to a provider a live share rejects inside the topic', async () => {
    state.composerTopicId = 'own-topic';
    const { result } = renderSwitch(true, false, ['lobehub']);

    await act(() => result.current.switchModel(picked));

    expect(state.updateTopicModel).toHaveBeenCalledWith('own-topic', picked);
    expect(state.selectModel).not.toHaveBeenCalled();

    await act(() => result.current.switchModel({ model: 'hosted', provider: 'lobehub' }));

    expect(state.selectModel).toHaveBeenCalledWith({ model: 'hosted', provider: 'lobehub' });
  });

  it('follows the global active topic when the host publishes no topic', async () => {
    const { result } = renderSwitch();

    expect(result.current).toMatchObject({ model: 'outer-model', provider: 'outer-provider' });
    await act(() => result.current.switchModel(picked));

    expect(state.updateTopicModel).toHaveBeenCalledWith('outer-topic', picked);
  });

  it('ignores a switch when the model cannot be selected', async () => {
    state.composerTopicId = 'own-topic';
    const { result } = renderSwitch(false);

    await act(() => result.current.switchModel(picked));

    expect(state.updateTopicModel).not.toHaveBeenCalled();
    expect(state.selectModel).not.toHaveBeenCalled();
  });
});
