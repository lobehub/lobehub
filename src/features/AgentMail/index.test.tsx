import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  getInboxMessage: vi.fn(),
  getInboxUnreadCount: vi.fn(),
  list: vi.fn(),
  listInbox: vi.fn(),
  markAllInboxRead: vi.fn(),
  markInboxRead: vi.fn(),
  provision: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock('@/services/agentAccount', () => ({ agentAccountService: service }));

const surface = vi.hoisted(() => ({ mobile: false }));
const server = vi.hoisted(() => ({ loaded: true, providers: ['agent-mail'] }));
vi.mock('@/utils/mobileSurface', () => ({ isMobileSurface: () => surface.mobile }));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: unknown) => unknown) =>
    selector({
      serverConfig: { agentIdentityProviders: server.providers },
      serverConfigLoaded: server.loaded,
    }),
}));
vi.mock('@/features/NavHeader', () => ({ default: () => null }));
vi.mock('@/features/AgentBreadcrumb', () => ({ default: () => null }));
vi.mock('@/features/AgentProfileTabs', () => ({
  AGENT_PROFILE_TABS_CENTER_STYLE: {},
  default: () => null,
}));
vi.mock('@/features/WideScreenContainer', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const ui = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  createModal: vi.fn(() => ({ close: vi.fn() })),
}));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmModal: ui.confirmModal,
  createModal: ui.createModal,
  DropdownMenu: ({
    children,
    items,
  }: {
    children: React.ReactNode;
    items: { key?: string; label?: string; onClick?: () => void }[];
  }) => (
    <div>
      {children}
      {items
        .filter((item) => item.key)
        .map((item) => (
          <button key={item.key} onClick={item.onClick}>
            {`menu:${item.label}`}
          </button>
        ))}
    </div>
  ),
}));

const { default: AgentMail } = await import('./index');
const { default: AddMailboxForm } = await import('./AddMailboxForm');
const { IDENTITY_CHANNELS } = await import('./const');

const account = (id: string, identifier: string) => ({
  agentId: 'agt_1',
  capabilities: { receive: true, send: true },
  displayName: null,
  id,
  identifier,
  kind: 'mail',
  provider: 'agent-mail',
  status: 'active',
});

const row = (id: string, subject: string) => ({
  agentId: 'agt_1',
  createdAt: new Date(),
  from: `${id}@x.com`,
  id,
  preview: `preview of ${subject}`,
  readAt: null,
  receivedAt: new Date(),
  subject,
});

const page = (path = '/agent/agt_1/mail', disabled = false) =>
  render(
    <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            element={<AgentMail agentId={'agt_1'} disabled={disabled} />}
            path={'/agent/:aid/mail/:messageId?'}
          />
          <Route element={<div>profile page</div>} path={'/agent/:aid/profile'} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  surface.mobile = false;
  server.providers = ['agent-mail'];
  server.loaded = true;
  service.list.mockResolvedValue([account('acc_a', 'a@lobe.id'), account('acc_b', 'b@lobe.id')]);
  service.listInbox.mockImplementation(async ({ accountId }: { accountId?: string }) =>
    accountId === 'acc_b' ? [row('msg_b', 'For B')] : [row('msg_a', 'For A')],
  );
  service.getInboxUnreadCount.mockResolvedValue(1);
  service.markInboxRead.mockResolvedValue({ count: 1 });
  service.getInboxMessage.mockImplementation(async (id: string) => ({
    ...row(id, 'Opened'),
    attachments: [],
    text: `Full body of ${id}`,
    to: 'agent@lobe.id',
  }));
});

describe('AgentMail', () => {
  it('leaves mail unread until the reader picks a message', async () => {
    page();

    await screen.findByText('preview of For A');

    expect(service.getInboxMessage).not.toHaveBeenCalled();
    expect(service.markInboxRead).not.toHaveBeenCalled();
  });

  it('reads a picked message beside the list, without a modal', async () => {
    page();

    fireEvent.click(await screen.findByRole('button', { name: 'msg_a@x.com — For A' }));

    expect(await screen.findByText('Full body of msg_a')).toBeInTheDocument();
    expect(ui.createModal).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'msg_a@x.com — For A' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(service.markInboxRead).toHaveBeenCalledWith(['msg_a']);
  });

  it('switches the list, the count and the open message to the chosen mailbox', async () => {
    page('/agent/agt_1/mail/msg_a');
    expect(await screen.findByText('Full body of msg_a')).toBeInTheDocument();

    fireEvent.click(await screen.findByText('menu:b@lobe.id'));

    expect(await screen.findByText('preview of For B')).toBeInTheDocument();
    expect(screen.queryByText('preview of For A')).not.toBeInTheDocument();
    expect(screen.queryByText('Full body of msg_a')).not.toBeInTheDocument();
    expect(service.getInboxUnreadCount).toHaveBeenCalledWith('agt_1', 'acc_b');
  });

  it('restores the mailbox of a message opened straight from its URL', async () => {
    service.getInboxMessage.mockResolvedValue({
      ...row('msg_b', 'For B'),
      accountId: 'acc_b',
      attachments: [],
      text: 'Full body of msg_b',
      to: 'b@lobe.id',
    });
    page('/agent/agt_1/mail/msg_b');

    expect(await screen.findByText('preview of For B')).toBeInTheDocument();
    expect(screen.queryByText('preview of For A')).not.toBeInTheDocument();
    expect(service.listInbox).not.toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc_a' }),
    );
  });

  it('marks a message read when it is opened straight from its URL', async () => {
    page('/agent/agt_1/mail/msg_a');

    expect(await screen.findByText('Full body of msg_a')).toBeInTheDocument();
    await waitFor(() => expect(service.markInboxRead).toHaveBeenCalledWith(['msg_a']));
    expect(service.markInboxRead).toHaveBeenCalledTimes(1);
    // The list and count load after the mark, so neither shows it as unread.
    expect(service.markInboxRead.mock.invocationCallOrder[0]).toBeLessThan(
      service.listInbox.mock.invocationCallOrder[0],
    );
  });

  it('does not re-stamp a read message opened from its URL', async () => {
    service.getInboxMessage.mockResolvedValue({
      ...row('msg_a', 'For A'),
      attachments: [],
      readAt: new Date(),
      text: 'Full body of msg_a',
      to: 'a@lobe.id',
    });
    page('/agent/agt_1/mail/msg_a');

    expect(await screen.findByText('Full body of msg_a')).toBeInTheDocument();
    expect(service.markInboxRead).not.toHaveBeenCalled();
  });

  it('asks for confirmation before releasing the mailbox on screen', async () => {
    page();

    fireEvent.click(await screen.findByText('menu:identity.release'));

    expect(ui.confirmModal).toHaveBeenCalledTimes(1);
  });

  it('moves off the open message once its mailbox is released', async () => {
    service.revoke.mockResolvedValue({});
    page('/agent/agt_1/mail/msg_a');
    expect(await screen.findByText('Full body of msg_a')).toBeInTheDocument();

    fireEvent.click(await screen.findByText('menu:identity.release'));
    const [{ onOk }] = ui.confirmModal.mock.calls[0] as unknown as [{ onOk: () => Promise<void> }];
    await onOk();

    expect(service.revoke).toHaveBeenCalledWith('acc_a');
    expect(await screen.findByText('preview of For B')).toBeInTheDocument();
    // Switching the list and leaving the message are separate updates; wait for both.
    await waitFor(() => expect(screen.queryByText('Full body of msg_a')).not.toBeInTheDocument());
  });

  it('adds another mailbox through a dialog', async () => {
    page();

    fireEvent.click(await screen.findByText('menu:identity.add'));

    expect(ui.createModal).toHaveBeenCalledTimes(1);
  });

  it('offers to open an address when the agent has none', async () => {
    service.list.mockResolvedValue([]);
    service.listInbox.mockResolvedValue([]);
    page();

    expect(await screen.findByText('identity.empty.open')).toBeInTheDocument();
    expect(screen.queryByText('menu:identity.release')).not.toBeInTheDocument();
    expect(await screen.findByText('identity.empty.title')).toBeInTheDocument();
    expect(screen.getByText('@lobe.id')).toBeInTheDocument();
    expect(screen.queryByText('identity.inbox.title')).not.toBeInTheDocument();
    expect(screen.queryByText('identity.inbox.detail.placeholder')).not.toBeInTheDocument();
  });

  it('keeps the action unavailable until a prefix is typed', async () => {
    service.list.mockResolvedValue([]);
    service.listInbox.mockResolvedValue([]);
    page();

    await screen.findByText('identity.empty.title');
    const action = screen.getByRole('button', { name: 'identity.empty.open' });
    expect(action).toBeDisabled();

    fireEvent.change(screen.getByLabelText('identity.prefix.required'), {
      target: { value: '   ' },
    });
    expect(action).toBeDisabled();
    expect(service.provision).not.toHaveBeenCalled();
  });

  it('shows a refused opening inside the form and clears it on the next edit', async () => {
    service.list.mockResolvedValue([]);
    service.listInbox.mockResolvedValue([]);
    service.provision.mockRejectedValue(new Error('prefix is taken'));
    page();

    const input = await screen.findByLabelText('identity.prefix.required');
    fireEvent.change(input, { target: { value: 'taken' } });
    fireEvent.click(screen.getByRole('button', { name: 'identity.empty.open' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('identity.provision.failed');
    expect(input).toHaveValue('taken');

    fireEvent.change(input, { target: { value: 'other' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('leaves the page when the deployment cannot open a mailbox and the agent has none', async () => {
    server.providers = [];
    service.list.mockResolvedValue([]);
    service.listInbox.mockResolvedValue([]);
    page();

    expect(await screen.findByText('profile page')).toBeInTheDocument();
  });

  it('keeps mail from a released address readable instead of the full-page offer', async () => {
    service.list.mockResolvedValue([]);
    page('/agent/agt_1/mail/msg_a');

    expect(await screen.findByText('For A')).toBeInTheDocument();
    expect(await screen.findByText('Full body of msg_a')).toBeInTheDocument();
    expect(screen.queryByText('identity.empty.title')).not.toBeInTheDocument();
    expect(screen.getByText('identity.empty.open')).toBeInTheDocument();
  });

  it('does not leave the page while retained mail exists and no provider is configured', async () => {
    server.providers = [];
    service.list.mockResolvedValue([]);
    page();

    expect(await screen.findByText('For A')).toBeInTheDocument();
    expect(screen.queryByText('profile page')).not.toBeInTheDocument();
  });

  it('does not leave the page while the server config is still loading', async () => {
    server.loaded = false;
    server.providers = [];
    service.list.mockResolvedValue([]);
    service.listInbox.mockResolvedValue([]);
    page();

    await waitFor(() => expect(service.list).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('profile page')).not.toBeInTheDocument();
  });

  it('keeps an existing mailbox readable after the provider is removed', async () => {
    server.providers = [];
    page();

    expect(await screen.findByText('a@lobe.id')).toBeInTheDocument();
    expect(screen.queryByText('profile page')).not.toBeInTheDocument();
  });

  it('shows the address on one row without labelling a working mailbox', async () => {
    page();

    expect(await screen.findByText('a@lobe.id')).toBeInTheDocument();
    expect(screen.queryByText('identity.status.active')).not.toBeInTheDocument();
  });

  it('opens the first mailbox and moves on to it', async () => {
    service.list.mockResolvedValueOnce([]);
    // No mail before the first address; the new address then has its own.
    service.listInbox.mockImplementation(async ({ accountId }: { accountId?: string }) =>
      accountId ? [row('msg_a', 'For A')] : [],
    );
    service.provision.mockResolvedValue(account('acc_a', 'a@lobe.id'));
    page();

    fireEvent.change(await screen.findByLabelText('identity.prefix.required'), {
      target: { value: 'growth' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'identity.empty.open' }));

    expect(await screen.findByText('For A')).toBeInTheDocument();
    expect(service.provision).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agt_1', prefix: 'growth', provider: 'agent-mail' }),
    );
    expect(screen.queryByText('identity.empty.title')).not.toBeInTheDocument();
  });

  it('states the absence to a read-only viewer without offering to open one', async () => {
    service.list.mockResolvedValue([]);
    service.listInbox.mockResolvedValue([]);
    page('/agent/agt_1/mail', true);

    expect(await screen.findByText('identity.empty.readOnly')).toBeInTheDocument();
    expect(screen.queryByText('identity.empty.open')).not.toBeInTheDocument();
  });

  it('does not mistake a failed read for an agent with no mailbox', async () => {
    service.list.mockRejectedValue(new Error('network down'));
    page();

    expect(await screen.findByText('identity.loadFailed')).toBeInTheDocument();
    expect(screen.queryByText('identity.empty.title')).not.toBeInTheDocument();
  });

  it('keeps the mailbox on screen when a later refresh fails', async () => {
    service.list
      .mockResolvedValueOnce([account('acc_user', 'me@example.com')])
      .mockRejectedValue(new Error('network down'));
    render(
      <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map(), refreshInterval: 20 }}>
        <MemoryRouter initialEntries={['/agent/agt_1/mail']}>
          <Routes>
            <Route
              element={<AgentMail agentId={'agt_1'} />}
              path={'/agent/:aid/mail/:messageId?'}
            />
          </Routes>
        </MemoryRouter>
      </SWRConfig>,
    );

    expect(await screen.findByText('me@example.com')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('identity.loadFailed')).toBeInTheDocument());
    expect(screen.getByText('me@example.com')).toBeInTheDocument();
  });

  it('gives a message its own page on a phone, and no modal', async () => {
    surface.mobile = true;
    page();

    fireEvent.click(await screen.findByRole('button', { name: 'msg_a@x.com — For A' }));

    expect(await screen.findByText('Full body of msg_a')).toBeInTheDocument();
    expect(ui.createModal).not.toHaveBeenCalled();
  });
});

describe('AddMailboxForm', () => {
  const setup = () => {
    const onAdded = vi.fn();
    render(
      <AddMailboxForm
        agentId={'agt_1'}
        channel={IDENTITY_CHANNELS[0]}
        onAdded={onAdded}
        onChanged={vi.fn()}
      />,
    );
    return onAdded;
  };

  it('shows the fixed domain and waits for a prefix', () => {
    setup();

    expect(screen.getByText('@lobe.id')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'identity.provision' })).toBeDisabled();
  });

  it('opens the mailbox for the typed prefix and reports it', async () => {
    const issued = account('acc_new', 'growth@lobe.id');
    service.provision.mockResolvedValue(issued);
    const onAdded = setup();

    fireEvent.change(screen.getByPlaceholderText('identity.prefix.required'), {
      target: { value: 'growth' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'identity.provision' }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(issued));
    expect(service.provision).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agt_1', prefix: 'growth', provider: 'agent-mail' }),
    );
  });
});
