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
    // The agent's drive switched off for its new conversations.
    temporary: false,
    workspaceId: null as string | null,
    environmentsLoaded: true,
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
    projectEnvironments: {} as Record<string, { configuration?: unknown; id: string }[]>,
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
const ENVIRONMENTS = [
  {
    configuration: { sources: [{ kind: 'git', url: 'https://github.com/lobehub/lobe-chat' }] },
    id: 'env_repo',
    name: 'Chat',
    visibility: 'private',
  },
];

vi.mock('../useSandboxEnvironmentList', () => ({
  useIsSharedAgent: () => false,
  useSandboxEnvironmentList: () => ({
    environments: state.environmentsLoaded ? ENVIRONMENTS : [],
    loaded: state.environmentsLoaded,
  }),
  useProjectSandboxEnvironments: (projectId?: string) => ({
    environments: projectId ? (state.projectEnvironments[projectId] ?? []) : [],
  }),
}));
vi.mock('@/services/sandboxStorage', () => ({
  sandboxStorageService: { getEntitlement: vi.fn() },
}));
vi.mock('@/store/sandbox', () => ({
  sandboxSelectors: { entitlement: () => ({ entitled: true }) },
  useSandboxStore: { getState: () => ({}) },
}));

const label = (value: SandboxSelection) =>
  value.workingDirectory !== undefined
    ? value.environmentId
      ? `${value.workingDirectory}+repo:${value.environmentId}`
      : value.workingDirectory
    : value.environmentId
      ? `repo:${value.environmentId}`
      : 'temporary';

// The chips' menus are covered by their own tests; here they only name the
// current placement and make the picks a person would. The real chips catch a
// failed save and say so.
vi.mock('../SandboxDriveChip', () => ({
  default: ({
    onChange,
    onToggle,
    toggleDisabled,
    value,
  }: {
    onChange: (s: SandboxSelection) => Promise<void>;
    onToggle: (enabled: boolean) => Promise<void>;
    toggleDisabled?: boolean;
    value: SandboxSelection;
  }) => (
    <div>
      <span data-testid="chip">{label(value)}</span>
      <span data-testid="toggle-disabled">{String(!!toggleDisabled)}</span>
      <button onClick={() => onChange({ workingDirectory: 'projects/demo' }).catch(() => {})}>
        pick-folder
      </button>
      <button
        onClick={() =>
          onChange({ ...value, drive: 'public', workingDirectory: 'team' }).catch(() => {})
        }
      >
        pick-public-folder
      </button>
      <button onClick={() => onToggle(false).catch(() => {})}>drive-off</button>
      <button onClick={() => onToggle(true).catch(() => {})}>drive-on</button>
    </div>
  ),
}));
vi.mock('../SandboxEnvironmentChip', () => ({
  default: ({
    onChange,
    projectId,
    value,
  }: {
    onChange: (s: SandboxSelection) => Promise<void>;
    projectId?: string;
    value: SandboxSelection;
  }) => (
    <div>
      <span data-testid="project">{projectId ?? ''}</span>
      <button
        onClick={() =>
          onChange(
            value.workingDirectory === undefined
              ? { environmentId: 'env_repo' }
              : { ...value, environmentId: 'env_repo' },
          ).catch(() => {})
        }
      >
        pick-repo
      </button>
      <button
        onClick={() =>
          onChange(
            value.workingDirectory === undefined
              ? {}
              : { workingDirectory: value.workingDirectory },
          ).catch(() => {})
        }
      >
        pick-none
      </button>
    </div>
  ),
}));

beforeEach(() => {
  state.temporary = false;
  state.workspaceId = null;
  state.environmentsLoaded = true;
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

    await act(async () => fireEvent.click(screen.getByText('drive-off')));
    expect(state.setPrefersTemporary).toHaveBeenCalledWith(expect.anything(), AGENT, true);

    act(() => {
      state.temporary = false;
      commit();
    });
    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('projects/demo');
  });

  // T-14791: the drive and the environment are options of one cloud sandbox,
  // picked together and remembered together.
  it("switches the drive on into the environment's own folder and keeps both for the next conversation", async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    send('topic-1');
    await act(async () => fireEvent.click(screen.getByText('drive-off')));
    await act(async () => fireEvent.click(screen.getByText('pick-repo')));
    expect(screen.getByTestId('chip').textContent).toBe('repo:env_repo');

    await act(async () => fireEvent.click(screen.getByText('drive-on')));
    expect(state.updateTopicMetadata).toHaveBeenLastCalledWith(
      'topic-1',
      expect.objectContaining({
        sandboxEnvironmentId: 'env_repo',
        sandboxWorkingDirectory: 'lobe-chat-nvrepo',
      }),
    );
    expect(state.setPrefersTemporary).toHaveBeenLastCalledWith(expect.anything(), AGENT, false);

    openNewConversation();
    expect(screen.getByTestId('chip').textContent).toBe('lobe-chat-nvrepo+repo:env_repo');
    send('topic-2');
    expect(state.topics['topic-2']).toMatchObject({
      sandboxEnvironmentId: 'env_repo',
      sandboxSeeded: true,
      sandboxWorkingDirectory: 'lobe-chat-nvrepo',
    });
  });

  // The folder and the environment are remembered apart, so a new
  // conversation must not pair a folder with an environment it was never set
  // up from: in a folder that holds files the setup would be skipped.
  it('does not pair the remembered folder with an environment picked off the drive', async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
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
  // is not carried into a folder there.
  it("drops a private environment when a folder on the workspace's public drive is picked", async () => {
    state.workspaceId = 'ws-1';
    render(<SandboxStorageSection agentId={AGENT} />);
    send('topic-1');
    await act(async () => fireEvent.click(screen.getByText('pick-repo')));

    await act(async () => fireEvent.click(screen.getByText('pick-public-folder')));
    expect(state.updateTopicMetadata).toHaveBeenLastCalledWith(
      'topic-1',
      expect.objectContaining({ sandboxEnvironmentId: undefined, sandboxWorkingDirectory: 'team' }),
    );
  });

  it('drops an environment not known to be published when a public-drive folder is picked', async () => {
    state.workspaceId = 'ws-1';
    render(<SandboxStorageSection agentId={AGENT} />);
    send('topic-1');
    await act(async () => fireEvent.click(screen.getByText('pick-repo')));
    act(() => {
      state.environmentsLoaded = false;
      commit();
    });

    await act(async () => fireEvent.click(screen.getByText('pick-public-folder')));
    expect(state.updateTopicMetadata).toHaveBeenLastCalledWith(
      'topic-1',
      expect.objectContaining({ sandboxEnvironmentId: undefined, sandboxWorkingDirectory: 'team' }),
    );
  });

  // The drive is switched on into the environment's own folder, named after
  // it: until the list says what the environment is, the switch waits.
  it('holds the drive switch while the picked environment is not known yet', async () => {
    state.temporary = true;
    render(<SandboxStorageSection agentId={AGENT} />);
    send('topic-1');
    await act(async () => fireEvent.click(screen.getByText('pick-repo')));
    expect(screen.getByTestId('toggle-disabled').textContent).toBe('false');

    act(() => {
      state.environmentsLoaded = false;
      commit();
    });
    expect(screen.getByTestId('toggle-disabled').textContent).toBe('true');
  });

  it('keeps the environment when the drive is switched off', async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    send('topic-1');
    await act(async () => fireEvent.click(screen.getByText('pick-repo')));
    expect(screen.getByTestId('chip').textContent).toBe('.+repo:env_repo');

    await act(async () => fireEvent.click(screen.getByText('drive-off')));
    expect(screen.getByTestId('chip').textContent).toBe('repo:env_repo');
  });

  // A project conversation starts off the drive, in its project's
  // environment, whatever the agent's drive preference elsewhere.
  it("starts a project draft off the drive on the project's environment", () => {
    render(<SandboxStorageSection agentId={AGENT} />);
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
    render(<SandboxStorageSection agentId={AGENT} />);
    state.topicProjects['topic-1'] = 'project-1';
    send('topic-1');

    await act(async () => fireEvent.click(screen.getByText('drive-on')));
    expect(state.setPrefersTemporary).not.toHaveBeenCalled();
  });

  // A drive folder is usable anywhere, so one picked in a project is kept for
  // the agent's next conversation like any other.
  it('remembers a drive folder picked in a project conversation', async () => {
    render(<SandboxStorageSection agentId={AGENT} />);
    state.topicProjects['topic-1'] = 'project-1';
    send('topic-1');

    await act(async () => fireEvent.click(screen.getByText('pick-folder')));

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

    // A project conversation runs in its project's environment, which the
    // agent's conversations elsewhere cannot use: picking it there must not
    // become where the next one starts.
    it("does not carry a project conversation's environment to the next conversation", async () => {
      render(<SandboxStorageSection agentId={AGENT} />);
      state.topicProjects['topic-1'] = 'project-1';
      await send('topic-1');
      expect(screen.getByTestId('project').textContent).toBe('project-1');

      await act(async () => fireEvent.click(screen.getByText('pick-repo')));
      expect(state.updateTopicMetadata).toHaveBeenCalledWith(
        'topic-1',
        expect.objectContaining({ sandboxEnvironmentId: 'env_repo' }),
      );

      openNewConversation();
      expect(screen.getByTestId('project').textContent).toBe('');
      expect(screen.getByTestId('chip').textContent).toBe('temporary');
    });

    // A project's blank draft starts where the server will put it — the
    // project's environment — not on the agent's repository from elsewhere.
    it("starts a project draft on the project's environment", async () => {
      render(<SandboxStorageSection agentId={AGENT} />);
      await send('topic-1');
      await act(async () => fireEvent.click(screen.getByText('pick-repo')));

      openNewConversation();
      expect(screen.getByTestId('chip').textContent).toBe('repo:env_repo');

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
      render(<SandboxStorageSection agentId={AGENT} />);
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
      render(<SandboxStorageSection agentId={AGENT} />);
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
      render(<SandboxStorageSection agentId={AGENT} />);
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
      render(<SandboxStorageSection agentId={AGENT} />);
      await send('topic-1');
      await act(async () => fireEvent.click(screen.getByText('pick-repo')));
      await act(async () => fireEvent.click(screen.getByText('pick-none')));

      openNewConversation();
      expect(screen.getByTestId('chip').textContent).toBe('temporary');
    });
  });
});
