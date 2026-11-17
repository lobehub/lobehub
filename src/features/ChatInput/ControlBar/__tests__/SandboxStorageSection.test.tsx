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
    // The execution-environment menu: usable, and the agent moved to the
    // temporary sandbox there.
    inMenu: false,
    temporary: false,
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
  useChatInputResourceAccess: () => ({ canConfigureResource: true, canUseResource: state.inMenu }),
}));
vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: () => ({
    canDisplayExecutionTarget: state.inMenu,
    canSelectExecutionTarget: state.inMenu,
  }),
}));
vi.mock('../temporarySandboxPreference', () => ({
  usePrefersTemporarySandbox: () => state.temporary,
}));
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
      <span data-testid="chip">
        {value.workingDirectory ??
          (value.environmentId ? `repo:${value.environmentId}` : 'temporary')}
      </span>
      <button onClick={() => onChange({ environmentId: 'env_repo' }).catch(() => {})}>
        pick-repo
      </button>
      {/* The real picker catches a failed save and says so. */}
      <button onClick={() => onChange({ workingDirectory: 'projects/demo' }).catch(() => {})}>
        pick-folder
      </button>
      <button onClick={() => onChange({}).catch(() => {})}>pick-temporary</button>
    </div>
  ),
}));

beforeEach(() => {
  state.inMenu = false;
  state.temporary = false;
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

  // Using the temporary sandbox once does not erase the persistent sandbox's
  // folder: the next conversation on the drive still starts there.
  it('keeps the folder after a temporary sandbox is used once', async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    await send('topic-1');

    await act(async () => fireEvent.click(screen.getByText('pick-temporary')));

    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');
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

  describe('in the temporary sandbox', () => {
    beforeEach(() => {
      state.inMenu = true;
      state.temporary = true;
    });

    it('starts the next new conversation from the repository the last one used', async () => {
      render(<SandboxStorageSection agentId={AGENT} />);
      expect(screen.getByTestId('chip').textContent).toBe('temporary');
      await send('topic-1');

      await act(async () => fireEvent.click(screen.getByText('pick-repo')));

      openNewConversation();
      expect(screen.getByTestId('chip').textContent).toBe('repo:env_repo');
      await send('topic-2');
      expect(state.topics['topic-2']).toMatchObject({
        sandboxEnvironmentId: 'env_repo',
        sandboxSeeded: true,
      });
    });

    it('starts the next new conversation without a repository when the last one used none', async () => {
      render(<SandboxStorageSection agentId={AGENT} />);
      await send('topic-1');
      await act(async () => fireEvent.click(screen.getByText('pick-repo')));
      await act(async () => fireEvent.click(screen.getByText('pick-temporary')));

      openNewConversation();
      expect(screen.getByTestId('chip').textContent).toBe('temporary');
    });
  });
});
