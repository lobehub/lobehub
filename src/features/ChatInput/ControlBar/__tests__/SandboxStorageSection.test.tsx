import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  consumePendingSandboxSelection,
  toSandboxTopicMetadata,
} from '@/store/chat/pendingSandboxSelection';

import { useTopicId } from '../../hooks/useTopicId';
import SandboxStorageSection from '../SandboxStorageSection';
import { useSandboxOptions } from '../useSandboxOptions';
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
    // The agent's drive switched off for its new conversations.
    temporary: false,
    workspaceId: null as string | null,
    setPrefersTemporary: vi.fn(),
    topicId: null as string | null,
    userId: 'user-a' as string | undefined,
    topics: {} as Record<string, Record<string, unknown>>,
    /** The project each conversation belongs to, when it does. */
    topicProjects: {} as Record<string, string>,
    /** Topics a first send is creating, before the pane moves to them. */
    creating: [] as string[],
    /** The blank project draft a sidebar "+" staged. */
    draft: undefined as { agentId: string; projectId: string } | undefined,
    /** Each project's environments. */
    projectEnvironments: {} as Record<
      string,
      { configuration?: unknown; id: string; visibility?: string }[]
    >,
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
      creatingTopicIds: state.creating,
      pendingNewTopicDirectory: state.draft,
      refreshTopicDetail: vi.fn(),
      topicDataMap: {},
      topicDetailMap: Object.fromEntries(
        Object.entries(state.topics).map(([id, metadata]) => [
          id,
          { id, metadata, projectId: state.topicProjects[id], sessionId: AGENT },
        ]),
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
  useActiveWorkspaceId: () => state.workspaceId,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: object) => unknown) => {
    useVersion();
    return selector({ user: { id: state.userId } });
  },
}));
vi.mock('../temporarySandboxPreference', () => ({
  setPrefersTemporarySandbox: state.setPrefersTemporary,
  usePrefersTemporarySandbox: () => state.temporary,
}));
vi.mock('../useFollowSandboxModePreference', () => ({ useFollowSandboxModePreference: () => {} }));
vi.mock('../useSandboxEnvironmentList', () => ({
  useIsSharedAgent: () => false,
  useProjectSandboxEnvironments: (projectId?: string) => ({
    environments: projectId ? (state.projectEnvironments[projectId] ?? []) : [],
  }),
}));
vi.mock('@/services/sandboxStorage', () => ({
  sandboxStorageService: { getEntitlement: vi.fn() },
}));
vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ENABLE_BUSINESS_FEATURES: true,
}));
vi.mock('@/store/sandbox', () => {
  const useSandboxStore = (selector: (s: object) => unknown) => selector({});
  useSandboxStore.getState = () => ({});
  return {
    sandboxActions: { useFetchEntitlement: () => undefined },
    sandboxSelectors: { entitlement: () => ({ entitled: true }) },
    useSandboxStore,
  };
});

const label = (value: SandboxSelection) =>
  value.workingDirectory !== undefined
    ? value.environmentId
      ? `${value.workingDirectory}+repo:${value.environmentId}`
      : value.workingDirectory
    : value.environmentId
      ? `repo:${value.environmentId}`
      : 'temporary';

// The menu's rows are covered by their own tests; here a stand-in makes the
// picks a person would through the same hook, and names the placement. The
// real menu catches a failed save and says so. The menu no longer offers an
// environment: `pick-repo` stands for one a topic carries from before — or,
// in a project, the project's own.
const Options = () => {
  const topicId = useTopicId();
  const options = useSandboxOptions(AGENT, { enabled: true, topicId });
  const { pick, pickFolder, projectId, selection: value, toTemporary } = options;
  return (
    <div>
      <span data-testid="chip">{label(value)}</span>
      <span data-testid="project">{projectId ?? ''}</span>
      <button onClick={() => pickFolder({ workingDirectory: 'projects/demo' }).catch(() => {})}>
        pick-folder
      </button>
      <button
        onClick={() => pickFolder({ drive: 'public', workingDirectory: 'team' }).catch(() => {})}
      >
        pick-public-folder
      </button>
      <button onClick={() => toTemporary().catch(() => {})}>drive-off</button>
      <button
        onClick={() =>
          pick(
            value.workingDirectory === undefined
              ? { environmentId: 'env-project' }
              : { ...value, environmentId: 'env-project' },
          ).catch(() => {})
        }
      >
        pick-repo
      </button>
      <button
        onClick={() =>
          pick(
            value.workingDirectory === undefined
              ? {}
              : { workingDirectory: value.workingDirectory },
          ).catch(() => {})
        }
      >
        pick-none
      </button>
    </div>
  );
};

const renderSection = () =>
  render(
    <>
      <SandboxStorageSection agentId={AGENT} />
      <Options />
    </>,
  );

beforeEach(() => {
  state.temporary = false;
  state.workspaceId = null;
  state.setPrefersTemporary.mockReset();
  state.topicId = null;
  state.userId = 'user-a';
  state.topics = {};
  state.topicProjects = {};
  state.draft = undefined;
  state.creating = [];
  state.projectEnvironments = {
    'project-1': [
      {
        configuration: { sources: [{ kind: 'git', url: 'https://github.com/lobehub/lobe-write' }] },
        id: 'env-project',
      },
    ],
    'project-empty': [{ configuration: { sources: [] }, id: 'env-empty' }],
  };
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
    renderSection();
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
    renderSection();
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    await send('topic-1');

    await act(async () => fireEvent.click(screen.getByText('drive-off')));
    expect(state.setPrefersTemporary).toHaveBeenCalledWith(expect.anything(), AGENT, true);

    act(() => {
      state.temporary = false;
      commit();
    });
    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');
  });

  // The folder and the environment are remembered apart, so a new
  // conversation must not pair a folder with an environment it was never set
  // up from: in a folder that holds files the setup would be skipped.
  it('does not pair the remembered folder with an environment picked off the drive', async () => {
    renderSection();
    send('topic-1');
    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    await act(async () => fireEvent.click(screen.getByText('drive-off')));
    await act(async () => fireEvent.click(screen.getByText('pick-repo')));

    act(() => {
      state.temporary = false;
      commit();
    });
    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');
  });

  // Every member browses the workspace's public drive: a private environment
  // — or one not known to be published — is not carried into a folder there.
  it("drops a project's private environment when a folder on the workspace's public drive is picked", async () => {
    state.workspaceId = 'ws-1';
    renderSection();
    state.topicProjects['topic-1'] = 'project-1';
    send('topic-1');
    await act(async () => fireEvent.click(screen.getByText('pick-repo')));

    await act(async () => fireEvent.click(screen.getByText('pick-public-folder')));
    expect(state.updateTopicMetadata).toHaveBeenLastCalledWith(
      'topic-1',
      expect.objectContaining({ sandboxEnvironmentId: undefined, sandboxWorkingDirectory: 'team' }),
    );
  });

  it("keeps a project's published environment on a public-drive folder", async () => {
    state.workspaceId = 'ws-1';
    state.projectEnvironments['project-1'][0].visibility = 'public';
    renderSection();
    state.topicProjects['topic-1'] = 'project-1';
    send('topic-1');
    await act(async () => fireEvent.click(screen.getByText('pick-repo')));

    await act(async () => fireEvent.click(screen.getByText('pick-public-folder')));
    expect(state.updateTopicMetadata).toHaveBeenLastCalledWith(
      'topic-1',
      expect.objectContaining({
        sandboxEnvironmentId: 'env-project',
        sandboxWorkingDirectory: 'team',
      }),
    );
  });

  // T-14791: storage is picked as a folder or 临时, and a folder is where the
  // agent's new conversations start. T-14825: the cloud sandbox is not set up
  // from an environment any more — one a conversation carries from before is
  // dropped with the pick.
  it('drops an environment from before when a folder is picked from a temporary sandbox', async () => {
    renderSection();
    send('topic-1');
    await act(async () => fireEvent.click(screen.getByText('drive-off')));
    act(() => {
      state.topics['topic-1'] = { sandboxEnvironmentId: 'env_repo' };
      commit();
    });
    expect(screen.getByTestId('chip').textContent).toBe('repo:env_repo');

    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');
    expect(state.setPrefersTemporary).toHaveBeenLastCalledWith(expect.anything(), AGENT, false);
  });

  it('drops an environment from before when the drive is switched off', async () => {
    renderSection();
    send('topic-1');
    act(() => {
      state.topics['topic-1'] = { sandboxEnvironmentId: 'env_repo', sandboxWorkingDirectory: '.' };
      commit();
    });

    await act(async () => fireEvent.click(screen.getByText('drive-off')));
    expect(screen.getByTestId('chip').textContent).toBe('temporary');
  });

  it("keeps a project's environment when the drive is switched on and off", async () => {
    renderSection();
    state.topicProjects['topic-1'] = 'project-1';
    send('topic-1');
    await act(async () => fireEvent.click(screen.getByText('pick-repo')));

    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo+repo:env-project');

    await act(async () => fireEvent.click(screen.getByText('drive-off')));
    expect(screen.getByTestId('chip').textContent).toBe('repo:env-project');
  });

  // A project conversation starts off the drive, in its project's
  // environment, whatever the agent's drive preference elsewhere.
  it("starts a project draft off the drive on the project's environment", () => {
    renderSection();
    expect(screen.getByTestId('chip').textContent).toBe('.');

    act(() => {
      state.draft = { agentId: AGENT, projectId: 'project-1' };
      commit();
    });
    expect(screen.getByTestId('chip').textContent).toBe('repo:env-project');
  });

  // Switching the drive in a project is about that conversation, not where
  // the agent's conversations elsewhere start.
  it('does not move the agent preference from a project conversation', async () => {
    renderSection();
    state.topicProjects['topic-1'] = 'project-1';
    send('topic-1');

    await act(async () => fireEvent.click(screen.getByText('pick-folder')));
    expect(state.setPrefersTemporary).not.toHaveBeenCalled();
  });

  // A drive folder is usable anywhere, so one picked in a project is kept for
  // the agent's next conversation like any other.
  it('remembers a drive folder picked in a project conversation', async () => {
    renderSection();
    state.topicProjects['topic-1'] = 'project-1';
    send('topic-1');

    await act(async () => fireEvent.click(screen.getByText('pick-folder')));

    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');
  });

  it('does not remember a pick that failed to save', async () => {
    renderSection();
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
      state.temporary = true;
    });

    // A project conversation runs in its project's environment, which the
    // agent's conversations elsewhere cannot use: picking it there must not
    // become where the next one starts.
    it("does not carry a project conversation's environment to the next conversation", async () => {
      renderSection();
      state.topicProjects['topic-1'] = 'project-1';
      await send('topic-1');
      expect(screen.getByTestId('project').textContent).toBe('project-1');

      await act(async () => fireEvent.click(screen.getByText('pick-repo')));
      expect(state.updateTopicMetadata).toHaveBeenCalledWith(
        'topic-1',
        expect.objectContaining({ sandboxEnvironmentId: 'env-project' }),
      );

      openNewConversation();
      expect(screen.getByTestId('project').textContent).toBe('');
      expect(screen.getByTestId('chip').textContent).toBe('temporary');
    });

    // A project's blank draft starts where the server will put it — the
    // project's environment — not on the agent's repository from elsewhere.
    it("starts a project draft on the project's environment", async () => {
      renderSection();
      await send('topic-1');

      openNewConversation();
      expect(screen.getByTestId('chip').textContent).toBe('temporary');

      act(() => {
        state.draft = { agentId: AGENT, projectId: 'project-1' };
        commit();
      });
      expect(screen.getByTestId('project').textContent).toBe('project-1');
      expect(screen.getByTestId('chip').textContent).toBe('repo:env-project');

      // Still a default nobody picked: the server keeps applying the project's.
      send('topic-2');
      expect(state.topics['topic-2']).toMatchObject({
        sandboxEnvironmentId: 'env-project',
        sandboxSeeded: true,
      });
    });

    // The send reads the draft's default after it has minted the topic and
    // dropped the draft, but before this pane moves to the topic. Read as
    // outside the project then, the composer re-seeded the agent's repository
    // from elsewhere, and the conversation started in it.
    it("keeps a project draft's default while its first send creates the topic", async () => {
      renderSection();
      await send('topic-1');
      await act(async () => fireEvent.click(screen.getByText('pick-repo')));
      openNewConversation();

      act(() => {
        state.draft = { agentId: AGENT, projectId: 'project-1' };
        commit();
      });
      expect(screen.getByTestId('chip').textContent).toBe('repo:env-project');

      act(() => {
        state.draft = undefined;
        state.topics['minted-topic'] = {};
        state.topicProjects['minted-topic'] = 'project-1';
        state.creating = ['minted-topic'];
        commit();
      });
      expect(screen.getByTestId('chip').textContent).toBe('repo:env-project');
    });

    // The draft's default is kept by agent, not by project: the agent's next
    // conversation outside the project must not inherit the project's.
    it("does not carry a project draft's environment to the agent's next conversation", async () => {
      renderSection();
      act(() => {
        state.draft = { agentId: AGENT, projectId: 'project-1' };
        commit();
      });
      expect(screen.getByTestId('chip').textContent).toBe('repo:env-project');

      act(() => {
        state.draft = undefined;
        commit();
      });
      expect(screen.getByTestId('project').textContent).toBe('');
      expect(screen.getByTestId('chip').textContent).toBe('temporary');
    });

    it('starts a project draft on no environment when the project checks out no repository', async () => {
      renderSection();
      await send('topic-1');
      await act(async () => fireEvent.click(screen.getByText('pick-repo')));
      openNewConversation();

      act(() => {
        state.draft = { agentId: AGENT, projectId: 'project-empty' };
        commit();
      });
      expect(screen.getByTestId('chip').textContent).toBe('temporary');
    });

    it('starts the next new conversation without a repository when the last one used none', async () => {
      renderSection();
      await send('topic-1');
      await act(async () => fireEvent.click(screen.getByText('pick-repo')));
      await act(async () => fireEvent.click(screen.getByText('pick-none')));

      openNewConversation();
      expect(screen.getByTestId('chip').textContent).toBe('temporary');
    });
  });
});
