/**
 * @vitest-environment happy-dom
 */
import { AccordionRoot } from '@lobehub/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicListScopeContext } from '../../TopicListScope';
import GroupItem from './GroupItem';

const subGroupModes: Record<string, string> = {};
let registeredMeta: { avatar?: string; name?: string; title?: string } = {};
const agencyConfigById: Record<
  string,
  { boundDeviceId?: string; executionTarget?: string; executionTargetSelectionPolicy?: string }
> = {};

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) => selector({ activeAgentId: 'agent-1' }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: (id: string) => () => agencyConfigById[id],
  },
  agentSelectors: {
    currentAgentMeta: () => ({ title: '验收合并-Alpha', avatar: '🅰️' }),
    getAgentMetaById: () => () => registeredMeta,
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: unknown) => unknown) =>
    selector({ updateSystemStatus: vi.fn() }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    projectTopicSubGroupMode: (id: string) => () => subGroupModes[id] ?? 'none',
  },
}));

const directories: {
  deviceId: string;
  environmentId?: string;
  id: string;
  instanceId?: string;
  permission?: string;
  runnable?: boolean;
}[] = [];
const runnable = (instanceId: string) => ({
  environmentId: 'env-1',
  instanceId,
  permission: 'readWrite',
  runnable: true,
});

vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectories: () => directories,
  useProjectDirectoryStore: (selector: (state: object) => unknown) =>
    selector({ createProjectTopic, startTopic: vi.fn() }),
}));

const { createProjectTopic, navigate, startProjectTopicDraft } = vi.hoisted(() => ({
  createProjectTopic: vi.fn(async () => ({ id: 'tpc_new' })),
  navigate: vi.fn(),
  startProjectTopicDraft: vi.fn(),
}));
vi.mock(
  '@/features/Projects/WorkingDirectories/startProjectTopicDraft',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    startProjectTopicDraft,
  }),
);
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));

vi.mock('@/store/device', () => ({
  deviceSelectors: { deviceList: (s: { devices: unknown[] }) => s.devices },
  useDeviceStore: (selector: (state: object) => unknown) =>
    selector({
      devices: [
        { deviceId: 'device-1', friendlyName: 'MacBook' },
        { deviceId: 'device-2', friendlyName: 'Studio Linux' },
      ],
      useFetchDevices: () => ({}),
    }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  preferenceSelectors: { topicSortBy: () => 'updatedAt' },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: {
    unreadCompletedCountForTopics: () => () => 0,
    visiblyRunningTopicIds: () => new Set(),
  },
}));

vi.mock('./DevicePresenceDot', () => ({ default: () => null }));

vi.mock('@/components/RingLoading', () => ({ default: () => <span /> }));

// Capture what the group hands each row: by-agent buckets are named in the
// group header, and the whole list already sits inside one project.
vi.mock('../../List/Item', () => ({
  default: (props: {
    showWorkingDirectory?: boolean;
    suppressAgentAvatar?: boolean;
    title: string;
  }) => (
    <div
      data-directory={props.showWorkingDirectory ? 'yes' : 'no'}
      data-suppress={props.suppressAgentAvatar ? 'yes' : 'no'}
    >
      {props.title}
    </div>
  ),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const GROUP_ID = 'agent:agt_acc_merge_alpha';

const renderGroup = () =>
  render(
    <TopicListScopeContext value={{ projectId: 'project-1' }}>
      <AccordionRoot defaultValue={[GROUP_ID]}>
        <GroupItem
          expanded
          group={{
            children: [
              {
                createdAt: 1,
                id: 't1',
                projectWorkingDirectoryId: 'binding-mac',
                title: 'A1-目录A任务',
                updatedAt: 1,
              },
              {
                createdAt: 2,
                id: 't2',
                projectWorkingDirectoryId: 'binding-linux',
                title: 'A2-目录B任务',
                updatedAt: 2,
              },
            ],
            id: GROUP_ID,
            title: '验收合并-Alpha',
          }}
        />
      </AccordionRoot>
    </TopicListScopeContext>,
  );

describe('TopicByAgentGroupItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(subGroupModes)) delete subGroupModes[key];
    registeredMeta = {};
    for (const key of Object.keys(agencyConfigById)) delete agencyConfigById[key];
    directories.splice(
      0,
      directories.length,
      { deviceId: 'device-1', id: 'binding-mac' },
      { deviceId: 'device-2', id: 'binding-linux' },
    );
  });

  /** @example Review feedback: rows under an agent-named bucket must not repeat the avatar. */
  it('suppresses the row leading agent avatar because the group header already identifies the agent', () => {
    // ROOT CAUSE: the by-agent grouping named every bucket after its agent,
    // but each row still rendered the same avatar at its leading position —
    // the same identity twice in one row.
    renderGroup();

    expect(screen.getByText('A1-目录A任务').getAttribute('data-suppress')).toBe('yes');
  });

  /** @example User report: project sidebar rows repeated "develop-center · branch" on every topic. */
  it('does not repeat the working directory on rows that already sit inside the project', () => {
    renderGroup();

    expect(screen.getByText('A1-目录A任务').getAttribute('data-directory')).toBe('no');
    expect(screen.getByText('A2-目录B任务').getAttribute('data-directory')).toBe('no');
  });

  it('offers a second-level grouping and sections the agent topics by device', () => {
    subGroupModes[GROUP_ID] = 'byDevice';
    renderGroup();

    expect(screen.getByRole('button', { name: 'topics.subGroup.title' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'MacBook' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Studio Linux' })).toBeTruthy();
    expect(screen.getByText('A1-目录A任务').getAttribute('data-suppress')).toBe('yes');
  });

  /** @example Acceptance: a device without an environment opened the modal on a raw directory id. */
  it('offers a device section "+" only where that device has an instance-bound directory', () => {
    // ROOT CAUSE: the section "+" preselected any project directory on the
    // device, but the new-topic modal only lists instance-bound directories,
    // so a legacy directory opened with an unselectable raw id.
    subGroupModes[GROUP_ID] = 'byDevice';
    directories[0] = { ...directories[0], ...runnable('ins-mac') };
    renderGroup();

    expect(screen.getAllByRole('button', { name: 'directories.start' })).toHaveLength(1);
  });

  /** @example User report: the device "+" popped a "new topic" modal instead of opening the composer. */
  it('starts a blank conversation on the device directory from the section "+" without a modal', () => {
    // ROOT CAUSE: the project sidebar "+" always opened the work-location
    // modal and created the topic row up front, unlike an agent's "+", which
    // only opens the composer and lets the first message create the topic.
    subGroupModes[GROUP_ID] = 'byDevice';
    directories[1] = { ...directories[1], ...runnable('ins-linux') };
    renderGroup();

    fireEvent.click(screen.getByRole('button', { name: 'directories.start' }));

    expect(startProjectTopicDraft).toHaveBeenCalledWith({
      agentId: 'agt_acc_merge_alpha',
      directoryId: 'binding-linux',
      navigate,
      projectId: 'project-1',
    });
    expect(createProjectTopic).not.toHaveBeenCalled();
  });

  /** @example Review: the agent "+" staged a read-only directory, so the first send was refused. */
  it('skips a directory that cannot run when the agent "+" picks the default', () => {
    directories[0] = { ...directories[0], ...runnable('ins-mac'), permission: 'read' };
    directories[1] = { ...directories[1], ...runnable('ins-linux') };
    renderGroup();

    fireEvent.click(screen.getByRole('button', { name: 'sidebar.newConversation' }));

    expect(startProjectTopicDraft).toHaveBeenCalledWith(
      expect.objectContaining({ directoryId: 'binding-linux' }),
    );
  });

  /** @example Review: an agent fixed to one device staged a directory on another, so the first send was refused. */
  it('picks a directory on the device a fixed agent is bound to', () => {
    // ROOT CAUSE: the agent "+" took the first runnable directory whatever the
    // agent's fixed execution target was, and `resolveProjectDirectoryRun`
    // throws "Agent is fixed to another execution target" on the first send.
    directories[0] = { ...directories[0], ...runnable('ins-mac') };
    directories[1] = { ...directories[1], ...runnable('ins-linux') };
    agencyConfigById.agt_acc_merge_alpha = {
      boundDeviceId: 'device-2',
      executionTargetSelectionPolicy: 'fixed',
    };
    renderGroup();

    fireEvent.click(screen.getByRole('button', { name: 'sidebar.newConversation' }));

    expect(startProjectTopicDraft).toHaveBeenCalledWith(
      expect.objectContaining({ directoryId: 'binding-linux' }),
    );
  });

  /** @example Review: a fixed agent's "+" staged another device's directory, so the first send threw. */
  it('offers a device section "+" only on the device a fixed agent is bound to', () => {
    subGroupModes[GROUP_ID] = 'byDevice';
    agencyConfigById.agt_acc_merge_alpha = {
      boundDeviceId: 'device-2',
      executionTargetSelectionPolicy: 'fixed',
    };
    directories[0] = { ...directories[0], ...runnable('ins-mac') };
    directories[1] = { ...directories[1], ...runnable('ins-linux') };
    renderGroup();

    // Only the fixed device's section offers a "+".
    expect(screen.getAllByRole('button', { name: 'directories.start' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'sidebar.newConversation' }));

    expect(startProjectTopicDraft).toHaveBeenCalledWith(
      expect.objectContaining({ directoryId: 'binding-linux' }),
    );
  });

  it('opens a conversation-only draft for an agent fixed to a non-device target', () => {
    subGroupModes[GROUP_ID] = 'byDevice';
    directories[0] = { ...directories[0], ...runnable('ins-mac') };
    directories[1] = { ...directories[1], ...runnable('ins-linux') };
    agencyConfigById.agt_acc_merge_alpha = { executionTargetSelectionPolicy: 'fixed' };
    renderGroup();

    expect(screen.queryAllByRole('button', { name: 'directories.start' })).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'sidebar.newConversation' }));

    expect(startProjectTopicDraft).toHaveBeenCalledWith({
      agentId: 'agt_acc_merge_alpha',
      directoryId: undefined,
      navigate,
      projectId: 'project-1',
    });
    expect(createProjectTopic).not.toHaveBeenCalled();
  });

  /** @example User report: the project "+" left an empty "未命名话题" row behind before anything was sent. */
  it('opens a blank conversation-only draft when the project has no runnable directory', () => {
    // ROOT CAUSE: the draft could only be staged on a directory, so a project
    // without a runnable one fell back to creating an untitled topic up front.
    renderGroup();

    fireEvent.click(screen.getByRole('button', { name: 'sidebar.newConversation' }));

    expect(startProjectTopicDraft).toHaveBeenCalledWith({
      agentId: 'agt_acc_merge_alpha',
      directoryId: undefined,
      navigate,
      projectId: 'project-1',
    });
    expect(createProjectTopic).not.toHaveBeenCalled();
  });

  /** @example User report: the project sidebar hid devices that had no topics yet. */
  it('lists every startable device and offers a new topic inside an empty device section', () => {
    // ROOT CAUSE: device sections were built from topics only, so a bound
    // device without topics never showed up and could not start one in place.
    subGroupModes[GROUP_ID] = 'byDevice';
    directories.splice(
      0,
      directories.length,
      { deviceId: 'device-1', id: 'binding-mac', ...runnable('ins-mac') },
      { deviceId: 'device-2', id: 'binding-linux-new', ...runnable('ins-linux') },
    );
    renderGroup();
    // Topics now only run on the MacBook; the Linux box has none.
    expect(screen.getByRole('button', { name: 'Studio Linux' })).toBeTruthy();

    fireEvent.click(screen.getByText('actions.addNewTopic'));

    expect(startProjectTopicDraft).toHaveBeenCalledWith(
      expect.objectContaining({ directoryId: 'binding-linux-new' }),
    );
  });

  /** @example Review: an agent fixed to one device cannot start on another. */
  it('offers no empty device section on a device the fixed agent cannot run on', () => {
    subGroupModes[GROUP_ID] = 'byDevice';
    agencyConfigById.agt_acc_merge_alpha = {
      boundDeviceId: 'device-1',
      executionTargetSelectionPolicy: 'fixed',
    };
    directories.splice(
      0,
      directories.length,
      // Otherwise fully startable: only the agent's fixed device rules device-2 out.
      {
        deviceId: 'device-1',
        environmentId: 'env-1',
        id: 'binding-mac',
        instanceId: 'ins-mac',
        permission: 'readWrite',
        runnable: true,
      },
      {
        deviceId: 'device-2',
        environmentId: 'env-1',
        id: 'binding-linux-new',
        instanceId: 'ins-linux',
        permission: 'readWrite',
        runnable: true,
      },
    );
    renderGroup();

    expect(screen.queryByRole('button', { name: 'Studio Linux' })).toBeNull();
    expect(screen.queryByText('actions.addNewTopic')).toBeNull();
  });

  /** @example Review: a fixed non-device target (sandbox) binds no device to start on. */
  it('offers no device start for an agent fixed to a sandbox target', () => {
    subGroupModes[GROUP_ID] = 'byDevice';
    agencyConfigById.agt_acc_merge_alpha = {
      executionTarget: 'sandbox',
      executionTargetSelectionPolicy: 'fixed',
    };
    directories.splice(
      0,
      directories.length,
      {
        deviceId: 'device-1',
        environmentId: 'env-1',
        id: 'binding-mac',
        instanceId: 'ins-mac',
        permission: 'readWrite',
        runnable: true,
      },
      {
        deviceId: 'device-2',
        environmentId: 'env-1',
        id: 'binding-linux-new',
        instanceId: 'ins-linux',
        permission: 'readWrite',
        runnable: true,
      },
    );
    renderGroup();

    expect(screen.queryByRole('button', { name: 'Studio Linux' })).toBeNull();
    expect(screen.queryByText('actions.addNewTopic')).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'directories.start' })).toHaveLength(0);
  });

  /** @example Acceptance: a fixed agent not opened in this session still got a start on another device. */
  it('reads the fixed device from the project topic rows when the agent is not loaded', () => {
    // ROOT CAUSE: the agent store only holds agents the client has opened, so
    // a sidebar group for any other agent saw no fixed target at all.
    subGroupModes[GROUP_ID] = 'byDevice';
    directories.splice(
      0,
      directories.length,
      {
        deviceId: 'device-1',
        environmentId: 'env-1',
        id: 'binding-mac',
        instanceId: 'ins-mac',
        permission: 'readWrite',
        runnable: true,
      },
      {
        deviceId: 'device-2',
        environmentId: 'env-1',
        id: 'binding-linux-new',
        instanceId: 'ins-linux',
        permission: 'readWrite',
        runnable: true,
      },
    );
    render(
      <TopicListScopeContext value={{ projectId: 'project-1' }}>
        <AccordionRoot defaultValue={[GROUP_ID]}>
          <GroupItem
            expanded
            group={{
              children: [
                {
                  agentBoundDeviceId: 'device-1',
                  agentExecutionTargetSelectionPolicy: 'fixed',
                  agentId: 'agt_acc_merge_alpha',
                  createdAt: 1,
                  id: 't1',
                  title: 'Loose topic',
                  updatedAt: 1,
                },
              ] as any,
              id: GROUP_ID,
              title: '验收合并-Alpha',
            }}
          />
        </AccordionRoot>
      </TopicListScopeContext>,
    );

    expect(screen.getByRole('button', { name: 'MacBook' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Studio Linux' })).toBeNull();
  });

  const renderInProject = (agentId: string) =>
    render(
      <TopicListScopeContext value={{ coordinatorAgentId: 'agt_lead', projectId: 'prj_1' }}>
        <AccordionRoot>
          <GroupItem
            expanded={false}
            group={{
              children: [{ createdAt: 1, id: 't1', title: 'Plan', updatedAt: 1 }],
              id: `agent:${agentId}`,
              title: agentId,
            }}
          />
        </AccordionRoot>
      </TopicListScopeContext>,
    );

  /** @example User report: the project sidebar named an agent bucket by its role, not its name. */
  it('names an untitled bucket after the registered agent name, not its title', () => {
    // ROOT CAUSE: the registry fallback read `title` before `name`, so a named
    // agent ("Cook") showed its role ("公共CC(美国 100刀)") as the group label.
    registeredMeta = { name: 'Cook', title: '公共CC(美国 100刀)' };
    render(
      <TopicListScopeContext value={{ coordinatorAgentId: 'agt_lead', projectId: 'prj_1' }}>
        <AccordionRoot>
          <GroupItem
            expanded={false}
            group={{
              children: [{ createdAt: 1, id: 't1', title: 'Plan', updatedAt: 1 }],
              id: 'agent:agt_cook',
            }}
          />
        </AccordionRoot>
      </TopicListScopeContext>,
    );

    expect(screen.getAllByText('Cook').length).toBeGreaterThan(0);
    expect(screen.queryByText('公共CC(美国 100刀)')).toBeNull();
  });

  /** @example Review feedback: a project with no topic should show the main agent group with "new topic". */
  it('offers a new topic inside the main agent group before the project has any topic', () => {
    directories[0] = { ...directories[0], ...runnable('ins-mac') };
    render(
      <TopicListScopeContext
        value={{
          coordinatorAgent: { avatar: '🚀', title: '官网改版 Coordinator' },
          coordinatorAgentId: 'agt_lead',
          projectId: 'prj_1',
        }}
      >
        <AccordionRoot defaultValue={['agent:agt_lead']}>
          <GroupItem
            expanded
            group={{ children: [], id: 'agent:agt_lead', title: '官网改版 Coordinator' }}
          />
        </AccordionRoot>
      </TopicListScopeContext>,
    );

    expect(screen.getAllByText('官网改版 Coordinator').length).toBeGreaterThan(0);
    // The header "+" shares the label; the extra match is the row inside the empty group.
    const entries = screen.getAllByText('sidebar.newConversation');
    expect(entries).toHaveLength(2);
    fireEvent.click(entries[1]);

    expect(startProjectTopicDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt_lead',
        directoryId: 'binding-mac',
        projectId: 'prj_1',
      }),
    );
  });

  it('adds no extra "new topic" row to a group that already has topics', () => {
    renderInProject('agt_lead');

    // Only the header "+" carries the label.
    expect(screen.getAllByText('sidebar.newConversation')).toHaveLength(1);
  });

  it("tags the project's main agent as its lead", () => {
    renderInProject('agt_lead');

    expect(screen.getByText('sidebar.coordinatorTag')).toBeTruthy();
  });

  it('leaves other member agents untagged', () => {
    renderInProject('agt_writer');

    expect(screen.queryByText('sidebar.coordinatorTag')).toBeNull();
  });
});
