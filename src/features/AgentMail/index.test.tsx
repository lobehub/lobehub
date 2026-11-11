import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  createMailDraft: vi.fn(),
  deleteMailDrafts: vi.fn(),
  emptyMailTrash: vi.fn(),
  getMailAccountCounts: vi.fn(),
  getMailConversation: vi.fn(),
  getMailDraft: vi.fn(),
  getMailHtml: vi.fn(),
  list: vi.fn(),
  listMail: vi.fn(),
  listMailDrafts: vi.fn(),
  markAllInboxRead: vi.fn(),
  markMailRead: vi.fn(),
  markMailUnread: vi.fn(),
  provision: vi.fn(),
  restoreMail: vi.fn(),
  revoke: vi.fn(),
  searchMail: vi.fn(),
  setMailStarred: vi.fn(),
  trashMail: vi.fn(),
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
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', async () => {
  const { useNavigate } = await import('react-router');
  return { useWorkspaceAwareNavigate: () => useNavigate() };
});
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
  toast: toastApi,
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

const toastApi = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(() => ({ close: vi.fn() })),
}));

const { default: AgentMail } = await import('./index');
const { default: AddMailboxForm } = await import('./AddMailboxForm');
const { IDENTITY_CHANNELS } = await import('./const');
const { useMailWritesStore } = await import('./mailWrites');

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

const row = (id: string, subject: string, extra: Record<string, unknown> = {}) => ({
  accountId: id === 'msg_b' ? 'acc_b' : 'acc_a',
  agentId: 'agt_1',
  direction: 'inbound',
  fromAddress: `${id}@x.com`,
  fromName: null,
  hasAttachments: false,
  id,
  isStarred: false,
  isUnread: true,
  mailCount: 1,
  preview: `preview of ${subject}`,
  sortAt: new Date(),
  subject,
  threadKey: null,
  to: [{ address: 'a@lobe.id' }],
  trashedAt: null,
  ...extra,
});

const mail = (id: string, extra: Record<string, unknown> = {}) => ({
  accountId: 'acc_a',
  agentId: 'agt_1',
  attachments: [],
  codes: [],
  createdAt: new Date(),
  deliveredAt: new Date(),
  fromAddress: `${id}@x.com`,
  fromName: null,
  id,
  isUnread: true,
  subject: 'Opened',
  text: `Full body of ${id}`,
  threadKey: null,
  to: [{ address: 'agent@lobe.id' }],
  ...extra,
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
  useMailWritesStore.setState({ writes: [] });
  surface.mobile = false;
  server.providers = ['agent-mail'];
  server.loaded = true;
  service.list.mockResolvedValue([account('acc_a', 'a@lobe.id'), account('acc_b', 'b@lobe.id')]);
  service.listMail.mockImplementation(async ({ accountId }: { accountId?: string }) =>
    accountId === 'acc_b' ? [row('msg_b', 'For B')] : [row('msg_a', 'For A')],
  );
  service.listMailDrafts.mockResolvedValue([]);
  service.searchMail.mockResolvedValue({ items: [row('msg_hit', 'Search hit')], truncated: false });
  service.getMailAccountCounts.mockImplementation(async (accountIds: string[]) =>
    accountIds.map((accountId) => ({ accountId, drafts: 0, unread: 1 })),
  );
  service.markMailRead.mockResolvedValue({ count: 1 });
  service.markMailUnread.mockResolvedValue({ count: 1 });
  service.setMailStarred.mockResolvedValue({ count: 1 });
  service.trashMail.mockResolvedValue({ count: 1, ids: ['msg_a'] });
  service.restoreMail.mockResolvedValue({ count: 1 });
  service.getMailConversation.mockImplementation(async ({ id }: { id: string }) => [mail(id)]);
  service.getMailHtml.mockResolvedValue({ status: 'none' });
});

describe('AgentMail', () => {
  it('leaves mail unread until the reader picks a message', async () => {
    page();

    await screen.findByText('preview of For A');

    expect(service.getMailConversation).not.toHaveBeenCalled();
    expect(service.markMailRead).not.toHaveBeenCalled();
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
    // The reading pane marks exactly the mails it opened, once; the row click does not.
    await waitFor(() => expect(service.markMailRead).toHaveBeenCalledWith({ ids: ['msg_a'] }));
    expect(service.markMailRead).toHaveBeenCalledTimes(1);
  });

  it('leaves mail unread for a read-only viewer who follows a link to it', async () => {
    page('/agent/agt_1/mail/msg_a', true);

    expect(await screen.findByText('Full body of msg_a')).toBeInTheDocument();
    await screen.findByText('preview of For A');
    expect(service.markMailRead).not.toHaveBeenCalled();
  });

  it('clears the row dot at once when the unread mail is not the one the row carries', async () => {
    service.listMail.mockResolvedValue([row('msg_head', 'Thread', { mailCount: 2 })]);
    service.getMailConversation.mockResolvedValue([
      mail('msg_older', { isUnread: true }),
      mail('msg_head', { isUnread: false }),
    ]);
    service.markMailRead.mockReturnValue(new Promise(() => {}));
    page();

    fireEvent.click(await screen.findByRole('button', { name: /Thread/ }));

    await waitFor(() => expect(service.markMailRead).toHaveBeenCalledWith({ ids: ['msg_older'] }));
    // Still pending, yet the row already reads as read.
    await waitFor(() =>
      expect(useMailWritesStore.getState().writes).toEqual([
        expect.objectContaining({ ids: ['msg_older', 'msg_head'], patch: { isUnread: false } }),
      ]),
    );
  });

  it('leaves mail unread for a read-only viewer who opens it', async () => {
    page('/agent/agt_1/mail', true);

    fireEvent.click(await screen.findByRole('button', { name: 'msg_a@x.com — For A' }));

    expect(await screen.findByText('Full body of msg_a')).toBeInTheDocument();
    expect(service.markMailRead).not.toHaveBeenCalled();
  });

  it('switches the list, the count and the open message to the chosen mailbox', async () => {
    page('/agent/agt_1/mail/msg_a');
    expect(await screen.findByText('Full body of msg_a')).toBeInTheDocument();
    // Opening reads msg_a, and that write refreshes the counts once it lands.
    await waitFor(() => expect(useMailWritesStore.getState().writes).toEqual([]));
    service.getMailAccountCounts.mockClear();

    fireEvent.click(await screen.findByText(/menu:b@lobe.id/));

    expect(await screen.findByText('preview of For B')).toBeInTheDocument();
    expect(screen.queryByText('preview of For A')).not.toBeInTheDocument();
    expect(screen.queryByText('Full body of msg_a')).not.toBeInTheDocument();
    // One request answers every address, so switching asks for nothing new.
    expect(service.getMailAccountCounts).not.toHaveBeenCalled();
  });

  it('restores the mailbox of a message opened straight from its URL', async () => {
    service.getMailConversation.mockResolvedValue([mail('msg_b', { accountId: 'acc_b' })]);
    page('/agent/agt_1/mail/msg_b');

    expect(await screen.findByText('preview of For B')).toBeInTheDocument();
    expect(screen.queryByText('preview of For A')).not.toBeInTheDocument();
    expect(service.listMail).not.toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc_a' }),
    );
  });

  it('marks a message read when it is opened straight from its URL', async () => {
    page('/agent/agt_1/mail/msg_a');

    expect(await screen.findByText('Full body of msg_a')).toBeInTheDocument();
    await waitFor(() => expect(service.markMailRead).toHaveBeenCalledWith({ ids: ['msg_a'] }));
    expect(service.markMailRead).toHaveBeenCalledTimes(1);
  });

  it('opens the older unread mails of a conversation reached by its link', async () => {
    service.getMailConversation.mockResolvedValue([
      mail('msg_old', { isUnread: true, text: 'Old unread body' }),
      mail('msg_mid', { isUnread: false, text: 'Middle read body' }),
      mail('msg_a', { isUnread: false }),
    ]);
    page('/agent/agt_1/mail/msg_a');

    // Read by the pane, after it decided what opens, so the unread mail is open too.
    expect(await screen.findByText('Old unread body')).toBeInTheDocument();
    expect(screen.queryByText('Middle read body', { selector: 'iframe *' })).toBeNull();
    await waitFor(() => expect(service.markMailRead).toHaveBeenCalledWith({ ids: ['msg_old'] }));
    expect(service.markMailRead).toHaveBeenCalledTimes(1);
  });

  it('starts the pane afresh when the same mail is opened in another view', async () => {
    service.getMailConversation.mockImplementation(async ({ folder }: { folder?: string }) =>
      folder === 'trash'
        ? [mail('msg_t', { isUnread: false, text: 'Trashed body' })]
        : [mail('msg_a', { isUnread: false })],
    );
    page();
    // Opened from its row, so the mailbox is pinned and the page does not reload it.
    fireEvent.click(await screen.findByRole('button', { name: 'msg_a@x.com — For A' }));
    expect(await screen.findByText('Full body of msg_a')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('tab', { name: /identity.mailbox.folder.trash/ }));

    // The newest mail of the trash's set opens, instead of everything staying collapsed.
    await waitFor(() =>
      expect(screen.getByTestId('mail-item')).toHaveAttribute('data-mail-id', 'msg_t'),
    );
    expect(screen.getByTestId('mail-summary')).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens a link saved with the inbox item id and marks the mail itself read', async () => {
    service.getMailConversation.mockResolvedValue([mail('msg_a', { inboxMessageId: 'inbox_a' })]);
    page('/agent/agt_1/mail/inbox_a');

    expect(await screen.findByText('Full body of msg_a')).toBeInTheDocument();
    expect(service.getMailConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inbox_a' }),
    );
    expect(service.markMailRead).toHaveBeenCalledWith({ ids: ['msg_a'] });
  });

  it('does not re-stamp a read message opened from its URL', async () => {
    service.getMailConversation.mockResolvedValue([mail('msg_a', { isUnread: false })]);
    page('/agent/agt_1/mail/msg_a');

    expect(await screen.findByText('Full body of msg_a')).toBeInTheDocument();
    expect(service.markMailRead).not.toHaveBeenCalled();
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
    // The confirmation resolves asynchronously: releasing revalidates the list and
    // the navigation off the message lands in the same commit, so the updates have
    // to be flushed before the routing is asserted.
    await act(async () => {
      await onOk();
    });

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
    service.listMail.mockResolvedValue([]);
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
    service.listMail.mockResolvedValue([]);
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
    service.listMail.mockResolvedValue([]);
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
    service.listMail.mockResolvedValue([]);
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

  it('keeps sent mail of a released address readable instead of the full-page offer', async () => {
    service.list.mockResolvedValue([]);
    service.listMail.mockImplementation(async ({ folder }: { folder: string }) =>
      folder === 'sent' ? [row('msg_s', 'Sent one', { direction: 'outbound' })] : [],
    );
    page('/agent/agt_1/mail?folder=sent');

    expect(await screen.findByText('preview of Sent one')).toBeInTheDocument();
    expect(screen.queryByText('identity.empty.title')).not.toBeInTheDocument();
  });

  it('does not leave the page while the server config is still loading', async () => {
    server.loaded = false;
    server.providers = [];
    service.list.mockResolvedValue([]);
    service.listMail.mockResolvedValue([]);
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
    service.listMail.mockImplementation(async ({ accountId }: { accountId?: string }) =>
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
    service.listMail.mockResolvedValue([]);
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

describe('AgentMail list', () => {
  const firstRow = () => screen.findByRole('button', { name: 'msg_a@x.com — For A' });
  const within = async (label: string) =>
    (await firstRow()).querySelector(`[aria-label="${label}"]`) as HTMLElement;

  it('reports a failed mark-all-read even when no unread row is loaded', async () => {
    // The unread mail sits beyond the loaded page, so no loaded row is affected.
    service.listMail.mockResolvedValue([row('msg_a', 'For A', { isUnread: false })]);
    service.getMailAccountCounts.mockImplementation(async (accountIds: string[]) =>
      accountIds.map((accountId) => ({ accountId, drafts: 0, unread: 5 })),
    );
    service.markAllInboxRead.mockRejectedValue(new Error('down'));
    page();

    fireEvent.click(
      await screen.findByRole('button', { name: 'identity.mailbox.action.markAllRead' }),
    );

    await waitFor(() => expect(toastApi.error).toHaveBeenCalledTimes(1));
    expect(toastApi.error.mock.calls[0][0]).toMatchObject({
      actions: [{ label: 'identity.mailbox.retry' }],
      title: 'identity.mailbox.failed.markRead',
    });
  });

  it('closes an open trashed mail once the trash is emptied', async () => {
    service.listMail.mockResolvedValue([row('msg_t', 'Trashed one', { trashedAt: new Date() })]);
    service.emptyMailTrash.mockResolvedValue({ count: 1, failed: 0, hasMore: false });
    service.getMailConversation.mockImplementation(async ({ id }: { id: string }) => [mail(id)]);
    page('/agent/agt_1/mail/msg_t?folder=trash');

    expect(await screen.findByText('Full body of msg_t')).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole('button', { name: 'identity.mailbox.emptyTrash.confirm' }),
    );
    const [{ content }] = ui.createModal.mock.calls.at(-1) as unknown as [
      { content: React.ReactElement<{ onConfirm: () => void }> },
    ];
    content.props.onConfirm();

    await waitFor(() => expect(screen.queryByText('Full body of msg_t')).not.toBeInTheDocument());
    expect(service.emptyMailTrash).toHaveBeenCalledWith('acc_a');
  });

  it('lists the view named in the URL', async () => {
    service.listMail.mockResolvedValue([row('msg_s', 'Sent one', { direction: 'outbound' })]);
    page('/agent/agt_1/mail?folder=sent');

    expect(await screen.findByText('preview of Sent one')).toBeInTheDocument();
    expect(service.listMail).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc_a', folder: 'sent' }),
    );
  });

  it('searches from the URL and tells no results from a failure', async () => {
    service.searchMail.mockResolvedValueOnce({ items: [], truncated: false });
    page('/agent/agt_1/mail?q=nothing');

    expect(await screen.findByText('identity.mailbox.search.empty')).toBeInTheDocument();
    expect(screen.queryByText('identity.mailbox.search.failed')).not.toBeInTheDocument();
  });

  it('says when a search stopped at its best matches', async () => {
    service.searchMail.mockResolvedValueOnce({
      items: [row('msg_hit', 'Search hit')],
      truncated: true,
    });
    page('/agent/agt_1/mail?q=invoice');

    expect(await screen.findByText('preview of Search hit')).toBeInTheDocument();
    expect(screen.getByText('identity.mailbox.search.truncated')).toBeInTheDocument();
    expect(service.searchMail).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc_a', query: 'invoice' }),
    );
  });

  it('acts on a search hit as its whole conversation, received and sent alike', async () => {
    // The newest mail is the agent's reply; the unread mail it answers is in the inbox.
    service.searchMail.mockResolvedValue({
      items: [row('msg_hit', 'Search hit', { direction: 'outbound' })],
      truncated: false,
    });
    service.trashMail.mockImplementation(async ({ conversationIn }: { conversationIn: string }) =>
      conversationIn === 'inbox' ? { count: 1, ids: ['msg_in'] } : { count: 1, ids: ['msg_hit'] },
    );
    page('/agent/agt_1/mail?q=hit');

    const hit = await screen.findByRole('button', { name: 'a@lobe.id — Search hit' });
    fireEvent.click(hit.querySelector('[aria-label="identity.mailbox.action.delete"]')!);

    await waitFor(() => expect(service.trashMail).toHaveBeenCalledTimes(2));
    expect(service.trashMail).toHaveBeenCalledWith({ conversationIn: 'inbox', ids: ['msg_hit'] });
    expect(service.trashMail).toHaveBeenCalledWith({ conversationIn: 'sent', ids: ['msg_hit'] });

    const [options] = toastApi.success.mock.calls[0] as unknown as [
      { actions: { onClick: () => void }[] },
    ];
    options.actions[0].onClick();
    await waitFor(() =>
      expect(service.restoreMail).toHaveBeenCalledWith({
        ids: expect.arrayContaining(['msg_in', 'msg_hit']),
      }),
    );
  });

  it('shows a failed view as a failure, never as empty', async () => {
    service.listMail.mockRejectedValue(new Error('down'));
    page();

    expect(await screen.findByText('identity.mailbox.loadFailed')).toBeInTheDocument();
    expect(screen.queryByText('identity.mailbox.empty.inbox')).not.toBeInTheDocument();
  });

  it('removes a trashed row at once and undoes exactly what was trashed', async () => {
    // The server moved the conversation's other mail too, but one was already in the trash.
    service.trashMail.mockResolvedValue({ count: 2, ids: ['msg_a', 'msg_a_reply'] });
    page();

    fireEvent.click(await within('identity.mailbox.action.delete'));

    await waitFor(() => expect(screen.queryByText('preview of For A')).not.toBeInTheDocument());
    const [options] = toastApi.success.mock.calls[0] as unknown as [
      { actions: { onClick: () => void }[] },
    ];
    options.actions[0].onClick();
    await waitFor(() =>
      expect(service.restoreMail).toHaveBeenCalledWith({ ids: ['msg_a', 'msg_a_reply'] }),
    );
    expect(service.trashMail).toHaveBeenCalledWith({ conversationIn: 'inbox', ids: ['msg_a'] });
  });

  it('rolls a failed star back and offers a retry', async () => {
    service.setMailStarred.mockRejectedValue(new Error('nope'));
    page();

    fireEvent.click(await within('identity.mailbox.action.star'));

    await waitFor(() => expect(toastApi.error).toHaveBeenCalledTimes(1));
    expect(await within('identity.mailbox.action.star')).toBeInTheDocument();
    expect(toastApi.error.mock.calls[0][0]).toMatchObject({
      actions: [{ label: 'identity.mailbox.retry' }],
      title: 'identity.mailbox.failed.star',
    });
  });

  it('shows the bulk toolbar once a row is selected, and clears it after acting', async () => {
    page();

    const box = (await firstRow()).querySelector('[role="checkbox"]')!;
    fireEvent.click(box.parentElement!);

    expect(await screen.findByText('identity.mailbox.bulk.selected')).toBeInTheDocument();
    // The toolbar sits above the rows, so its button comes first.
    fireEvent.click(screen.getAllByRole('button', { name: 'identity.mailbox.action.markRead' })[0]);

    await waitFor(() =>
      expect(service.markMailRead).toHaveBeenCalledWith({
        conversationIn: 'inbox',
        ids: ['msg_a'],
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText('identity.mailbox.bulk.selected')).not.toBeInTheDocument(),
    );
  });
});

describe('AgentMail reading pane', () => {
  const threeRows = () =>
    service.listMail.mockResolvedValue([
      row('msg_1', 'First', { isUnread: false }),
      row('msg_2', 'Second'),
      row('msg_3', 'Third'),
    ]);

  it('steps to the conversations either side of the open one', async () => {
    threeRows();
    page('/agent/agt_1/mail/msg_2');
    expect(await screen.findByText('Full body of msg_2')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('mail-nav-next')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('mail-nav-next'));
    expect(await screen.findByText('Full body of msg_3')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mail-nav-previous'));
    expect(await screen.findByText('Full body of msg_2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mail-nav-previous'));
    expect(await screen.findByText('Full body of msg_1')).toBeInTheDocument();
    expect(screen.getByTestId('mail-nav-previous')).toBeDisabled();
  });

  it('lands on the older conversation after a trash, without reading it', async () => {
    threeRows();
    service.trashMail.mockResolvedValue({ count: 1, ids: ['msg_2'] });
    page('/agent/agt_1/mail/msg_2');
    expect(await screen.findByText('Full body of msg_2')).toBeInTheDocument();
    await waitFor(() => expect(service.markMailRead).toHaveBeenCalled());
    service.markMailRead.mockClear();

    fireEvent.click(await screen.findByTestId('mail-action-trash'));

    expect(await screen.findByText('Full body of msg_3')).toBeInTheDocument();
    expect(service.trashMail).toHaveBeenCalledWith({ ids: ['msg_2'] });
    // Landing is automatic, so the mail landed on waits for the reader.
    expect(service.markMailRead).not.toHaveBeenCalled();
  });

  it('does not read the landed-on conversation when the reader steps past it', async () => {
    threeRows();
    service.trashMail.mockResolvedValue({ count: 1, ids: ['msg_2'] });
    page('/agent/agt_1/mail/msg_2');
    expect(await screen.findByText('Full body of msg_2')).toBeInTheDocument();
    // The server no longer lists the trashed conversation.
    service.listMail.mockResolvedValue([
      row('msg_1', 'First', { isUnread: false }),
      row('msg_3', 'Third'),
    ]);
    fireEvent.click(await screen.findByTestId('mail-action-trash'));
    expect(await screen.findByText('Full body of msg_3')).toBeInTheDocument();
    service.markMailRead.mockClear();

    fireEvent.pointerDown(screen.getByTestId('mail-nav-previous'));
    fireEvent.click(screen.getByTestId('mail-nav-previous'));

    expect(await screen.findByText('Full body of msg_1')).toBeInTheDocument();
    expect(service.markMailRead).not.toHaveBeenCalledWith({ ids: ['msg_3'] });
  });

  it('offers no step for a conversation outside the loaded list', async () => {
    service.listMail.mockResolvedValue(
      Array.from({ length: 50 }, (_, index) => row(`msg_${index}`, `Row ${index}`)),
    );
    page('/agent/agt_1/mail/msg_far');
    expect(await screen.findByText('Full body of msg_far')).toBeInTheDocument();
    await screen.findByText('preview of Row 0');

    // A full page means more mail, but there is no row here to step from.
    expect(screen.getByTestId('mail-nav-next')).toBeDisabled();
    expect(screen.getByTestId('mail-nav-previous')).toBeDisabled();
  });

  it('highlights the row of the open conversation when the URL names another of its mails', async () => {
    service.listMail.mockResolvedValue([row('msg_head', 'Thread', { mailCount: 2 })]);
    service.getMailConversation.mockResolvedValue([
      mail('msg_older', { isUnread: false }),
      mail('msg_head', { isUnread: false }),
    ]);
    page('/agent/agt_1/mail/msg_older');

    const thread = await screen.findByRole('button', { name: /Thread/ });
    await waitFor(() => expect(thread).toHaveAttribute('aria-current', 'true'));
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

describe('AgentMail composer', () => {
  const Location = () => {
    const location = useLocation();
    return <div data-testid={'location'}>{`${location.pathname}${location.search}`}</div>;
  };

  const composePage = (path: string) =>
    render(
      <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path={'/agent/:aid/mail/:messageId?'}
              element={
                <>
                  <AgentMail agentId={'agt_1'} />
                  <Location />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </SWRConfig>,
    );

  const draft = (extra: Record<string, unknown> = {}) => ({
    accountId: 'acc_a',
    bcc: [],
    cc: [],
    id: 'draft_1',
    mode: 'compose',
    sourceMailId: null,
    subject: 'Plan',
    text: 'Half written',
    to: [{ address: 'lin@partner.example' }],
    updatedAt: new Date(),
    ...extra,
  });

  it('writes a new mail in the reading pane, from the address on screen', async () => {
    composePage('/agent/agt_1/mail?compose=new');

    const composer = await screen.findByTestId('mail-composer');
    expect(within(composer).getByText('a@lobe.id')).toBeInTheDocument();
    expect(within(composer).getByText('identity.compose.fromNote')).toBeInTheDocument();
  });

  it('resumes a draft from the URL with everything it held', async () => {
    service.getMailDraft.mockResolvedValue(draft());
    composePage('/agent/agt_1/mail?folder=drafts&compose=draft_1');

    expect(await screen.findByTestId('mail-composer')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('identity.compose.body')).toHaveValue('Half written'),
    );
    expect(screen.getByLabelText('identity.compose.subject')).toHaveValue('Plan');
    expect(screen.getByText('lin@partner.example')).toBeInTheDocument();
  });

  it('takes a reply draft back to the conversation it answers', async () => {
    service.getMailDraft.mockResolvedValue(draft({ mode: 'reply', sourceMailId: 'msg_a' }));
    composePage('/agent/agt_1/mail?folder=drafts&compose=draft_1');

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/agent/agt_1/mail/msg_a?folder=drafts&compose=draft_1',
      ),
    );
  });

  it('reads a just-created draft again after leaving its editor', async () => {
    const saved = draft({ id: 'draft_new', subject: 'Plan', text: 'First words' });
    service.createMailDraft.mockResolvedValue(saved);
    service.getMailDraft.mockResolvedValue(saved);
    service.listMailDrafts.mockResolvedValue([saved]);
    composePage('/agent/agt_1/mail?compose=new');

    fireEvent.change(await screen.findByLabelText('identity.compose.body'), {
      target: { value: 'First words' },
    });
    await waitFor(
      () => expect(screen.getByTestId('location')).toHaveTextContent('compose=draft_new'),
      { timeout: 4000 },
    );
    expect(service.getMailDraft).not.toHaveBeenCalled();

    // Leave for Drafts, then open the same draft from there: it is read, not a blank editor.
    fireEvent.click(screen.getByRole('tab', { name: /identity.mailbox.folder.drafts/ }));
    await waitFor(() => expect(screen.queryByTestId('mail-composer')).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: 'lin@partner.example — Plan' }));

    await waitFor(() => expect(service.getMailDraft).toHaveBeenCalledWith('draft_new'));
    await waitFor(() =>
      expect(screen.getByLabelText('identity.compose.body')).toHaveValue('First words'),
    );
  });

  it('says up front that an address only receives, and keeps reading working', async () => {
    service.list.mockResolvedValue([
      { ...account('acc_a', 'a@lobe.id'), capabilities: { receive: true, send: false } },
    ]);
    composePage('/agent/agt_1/mail');

    expect(await screen.findByTestId('mail-send-block')).toHaveTextContent(
      'identity.compose.block.receiveOnly',
    );
    expect(await screen.findByText('preview of For A')).toBeInTheDocument();
  });
});
