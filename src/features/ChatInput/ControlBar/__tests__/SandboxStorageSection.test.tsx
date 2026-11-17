import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  consumePendingSandboxSelection,
  toSandboxTopicMetadata,
} from '@/store/chat/pendingSandboxSelection';

import SandboxStorageSection from '../SandboxStorageSection';
import type { SandboxSelection } from '../useSandboxPlacement';

const AGENT = 'agent-remember';

const state = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    listeners,
    // Bumped on every change so subscribed components re-render, as the real
    // store would make them.
    notify: () => {
      for (const listener of listeners) listener();
    },
    topicId: null as string | null,
    userId: 'user-a' as string | undefined,
    topics: {} as Record<string, Record<string, unknown>>,
    updateTopicMetadata: vi.fn(),
    version: 0,
  };
});

const useVersion = () =>
  useSyncExternalStore(
    (listener) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    () => state.version,
  );

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: object) => unknown) => {
    useVersion();
    return selector({
      activeTopicId: state.topicId ?? undefined,
      refreshTopicDetail: vi.fn(),
      topicDataMap: {},
      topicDetailMap: Object.fromEntries(
        Object.entries(state.topics).map(([id, metadata]) => [id, { id, metadata }]),
      ),
      updateTopicMetadata: state.updateTopicMetadata,
      useFetchTopicDetail: vi.fn(),
    });
  },
}));

vi.mock('../../hooks/useTopicId', () => ({
  useTopicId: () => {
    useVersion();
    return state.topicId;
  },
}));
vi.mock('../useSandboxStorageAccess', () => ({
  useSandboxStorageAccess: () => ({ eligible: true, status: 'ready' }),
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: object) => unknown) => {
    useVersion();
    return selector({ user: { id: state.userId } });
  },
}));
// The execution-environment menu and its temporary/persistent preference are
// covered by their own tests; here the member cannot use that menu, so the
// folder chip is the only place the sandbox is chosen.
vi.mock('@/features/ChatInput/hooks/useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => ({ canConfigureResource: true, canUseResource: false }),
}));
vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    canDisplayExecutionTarget: false,
    canSelectExecutionTarget: false,
  }),
}));
vi.mock('../temporarySandboxPreference', () => ({ usePrefersTemporarySandbox: () => false }));
vi.mock('../useFollowSandboxModePreference', () => ({ useFollowSandboxModePreference: () => {} }));
vi.mock('@/services/sandboxStorage', () => ({
  sandboxStorageService: { getEntitlement: vi.fn() },
}));
vi.mock('@/store/sandbox', () => ({
  sandboxSelectors: { entitlement: () => ({ entitled: true }) },
  useSandboxStore: { getState: () => ({}) },
}));

// The picker's menu is covered by its own tests; here it only names the
// current folder and makes the picks a person would.
vi.mock('../SandboxDrivePicker', () => ({
  default: ({
    onChange,
    value,
  }: {
    onChange: (s: SandboxSelection) => Promise<void>;
    value: SandboxSelection;
  }) => (
    <div>
      <span data-testid="chip">{value.workingDirectory ?? 'temporary'}</span>
      {/* The real picker catches a failed save and says so. */}
      <button onClick={() => onChange({ workingDirectory: 'projects/demo' }).catch(() => {})}>
        pick-folder
      </button>
      <button onClick={() => onChange({}).catch(() => {})}>pick-temporary</button>
    </div>
  ),
}));

beforeEach(() => {
  state.topicId = null;
  state.userId = 'user-a';
  state.topics = {};
  state.updateTopicMetadata.mockReset().mockImplementation(async (id, metadata) => {
    state.topics[id] = { ...state.topics[id], ...metadata };
    commit();
  });
});

afterEach(() => {
  consumePendingSandboxSelection(AGENT);
  localStorage.clear();
});

const commit = () => {
  state.version += 1;
  state.notify();
};

/** The first send: the pending pick becomes the new topic's metadata. */
const send = (topicId: string) =>
  act(() => {
    state.topics[topicId] = { ...toSandboxTopicMetadata(consumePendingSandboxSelection(AGENT)) };
    state.topicId = topicId;
    commit();
  });

/** "New topic" in the sidebar. */
const openNewConversation = () =>
  act(() => {
    state.topicId = null;
    commit();
  });

describe('SandboxStorageSection — T-14158', () => {
  it('starts the next new conversation in the folder picked in the last one', async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    // A first conversation starts at the drive's root.
    expect(screen.getByTestId('chip').textContent).toBe('.');

    send('topic-1');
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    expect(state.updateTopicMetadata).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ sandboxWorkingDirectory: 'projects/demo' }),
    );
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');

    // "New topic": previously this went back to the root every time.
    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');

    // And the conversation it creates is born there, still marked as a default
    // nobody picked for it, so a project conversation can take its checkout.
    send('topic-2');
    expect(state.topics['topic-2']).toMatchObject({
      sandboxSeeded: true,
      sandboxWorkingDirectory: 'projects/demo',
    });
  });

  it('goes back to the root after the temporary sandbox is picked on purpose', async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    send('topic-1');

    await act(async () => fireEvent.click(screen.getByText('pick-temporary')));

    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('.');
  });

  it('does not remember a pick that failed to save', async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    send('topic-1');
    state.updateTopicMetadata.mockRejectedValueOnce(new Error('offline'));

    await act(async () => {
      fireEvent.click(screen.getByText('pick-folder'));
    });

    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('.');
  });
});
