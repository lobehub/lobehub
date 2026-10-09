/** @vitest-environment happy-dom */
import type { UIChatMessage } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageActionContext } from '../types';
import { branchingAction } from './branching';

const forkCodexMessage = vi.fn();
const openThreadCreator = vi.fn();
const state = {
  dbMessages: [] as UIChatMessage[],
  forkCodexMessage,
  isInputLoading: false,
};
const agentState = { isCodex: true };

vi.mock('@/features/Conversation/store', () => ({
  messageStateSelectors: { isInputLoading: (s: typeof state) => s.isInputLoading },
  useConversationStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: typeof agentState) => unknown) => selector(agentState),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentHeterogeneousProviderType: (s: typeof agentState) =>
      s.isCodex ? 'codex' : undefined,
  },
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (
    selector: (s: {
      activeTopicId: string;
      openThreadCreator: typeof openThreadCreator;
    }) => unknown,
  ) => selector({ activeTopicId: 'topic', openThreadCreator }),
}));

const nativeMetadata = { codexTurnId: 'turn', heteroSessionId: 'thread' };
const message = (
  role: 'user' | 'assistant',
  metadata?: UIChatMessage['metadata'],
): UIChatMessage => ({
  id: 'source',
  role,
  content: 'saved message',
  createdAt: 0,
  updatedAt: 0,
  metadata,
});
const build = (data: UIChatMessage, contentBlock?: MessageActionContext['contentBlock']) =>
  renderHook(() =>
    branchingAction.useBuild({
      data,
      contentBlock,
      id: data.id,
      role: data.role === 'user' ? 'user' : 'assistant',
    }),
  ).result.current!;

/** @example Native history is required only for Codex Fork actions. */
describe('branchingAction native provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.dbMessages = [];
    state.isInputLoading = false;
    agentState.isCodex = true;
  });

  // ROOT CAUSE:
  // CLI/legacy messages carry a session id but no native turn boundary. The menu
  // enabled Fork, then resolveCodexForkTarget always failed after the click.
  // Gate the same persisted source row that forkCodexMessage uses, including
  // the final assistant in a tool-separated group, before exposing an action.
  /** @example Neither message role can dispatch without a native turn. */
  it.each(['user', 'assistant'] as const)('disables a legacy %s message', async (role) => {
    const source = message(role, { heteroSessionId: 'exec-session' });
    state.dbMessages = [source];
    const action = build(source);
    /** @example Legacy rows visibly disable Fork. */
    expect(action.disabled).toBe(true);
    await action.handleClick?.();
    /** @example A programmatic click cannot bypass the menu guard. */
    expect(forkCodexMessage).not.toHaveBeenCalled();
  });

  /** @example A turn without its native session is not a usable boundary. */
  it('disables a native turn with no session provenance', () => {
    const source = message('assistant', { codexTurnId: 'turn' });
    state.dbMessages = [source];
    /** @example Both provenance fields are necessary. */
    expect(build(source).disabled).toBe(true);
  });

  /** @example Complete native user and assistant boundaries remain usable. */
  it.each(['user', 'assistant'] as const)('forks a native %s message', async (role) => {
    const source = message(role, nativeMetadata);
    state.dbMessages = [source];
    const action = build(source);
    /** @example Native messages keep the existing enabled menu. */
    expect(action.disabled).toBe(false);
    await action.handleClick?.();
    /** @example The selected persisted source is dispatched. */
    expect(forkCodexMessage).toHaveBeenCalledWith('source');
  });

  /** @example Group-level metadata must not override the selected final child. */
  it('uses the final assistant row instead of group provenance', async () => {
    const source = message('assistant', nativeMetadata);
    const group = {
      ...source,
      id: 'group',
      metadata: {},
      children: [{ id: source.id, content: source.content }],
    };
    state.dbMessages = [source];
    const action = build(group);
    /** @example Durable final-child provenance enables its group action. */
    expect(action.disabled).toBe(false);
    await action.handleClick?.();
    /** @example Fork targets the final assistant, never the synthetic group. */
    expect(forkCodexMessage).toHaveBeenCalledWith('source');
  });

  /** @example Partial content blocks cannot branch an unfinished native turn. */
  it('keeps nonfinal content blocks disabled', () => {
    const source = message('assistant', nativeMetadata);
    state.dbMessages = [source];
    const first = { id: source.id, content: source.content };
    const group = { ...source, children: [first, { id: 'later', content: 'later' }] };
    /** @example Valid provenance does not bypass the existing partial-turn guard. */
    expect(build(group, first).disabled).toBe(true);
  });

  /** @example Ordinary agent branching does not require Codex metadata. */
  it('preserves ordinary agent branching', async () => {
    agentState.isCodex = false;
    const action = build(message('assistant'));
    /** @example Ordinary branching remains available. */
    expect(action.disabled).toBe(false);
    await action.handleClick?.();
    /** @example The existing thread creator receives the original message. */
    expect(openThreadCreator).toHaveBeenCalledWith('source');
  });

  /** @example Codex keeps the shared branching entry and only shortens its label to Fork. */
  it('labels the shared branching entry Fork for Codex and Create Subtopic otherwise', () => {
    const source = message('user', nativeMetadata);
    state.dbMessages = [source];
    expect(build(source)).toMatchObject({ key: 'branching', label: 'codexFork' });

    const legacy = message('user', { heteroSessionId: 'exec-session' });
    state.dbMessages = [legacy];
    expect(build(legacy).label).toBe('codexForkUnavailable');

    agentState.isCodex = false;
    expect(build(legacy)).toMatchObject({ key: 'branching', label: 'branching' });
  });
});
