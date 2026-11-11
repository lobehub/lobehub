import { HotkeyScopeEnum } from '@lobechat/const/hotkeys';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  createMailDraft: vi.fn(),
  deleteMailDrafts: vi.fn(),
  getMailAccountCounts: vi.fn(),
  getMailConversation: vi.fn(),
  getMailDraft: vi.fn(),
  getMailHtml: vi.fn(),
  list: vi.fn(),
  listMail: vi.fn(),
  listMailDrafts: vi.fn(),
  markMailRead: vi.fn(),
  markMailUnread: vi.fn(),
  purgeMail: vi.fn(),
  restoreMail: vi.fn(),
  searchMail: vi.fn(),
  setMailStarred: vi.fn(),
  trashMail: vi.fn(),
  updateMailDraft: vi.fn(),
}));
vi.mock('@/services/agentAccount', () => ({ agentAccountService: service }));

const surface = vi.hoisted(() => ({ width: 1280 }));
vi.mock('@/utils/mobileSurface', () => ({ isMobileSurface: () => false }));
vi.mock('ahooks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSize: () => ({ height: 800, width: surface.width }),
}));
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: unknown) => unknown) =>
    selector({
      isMobile: false,
      serverConfig: { agentIdentityProviders: ['agent-mail'] },
      serverConfigLoaded: true,
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

const ui = vi.hoisted(() => ({ confirmModal: vi.fn() }));
const toastApi = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(() => ({ close: vi.fn() })),
}));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmModal: ui.confirmModal,
  toast: toastApi,
}));

const { default: AgentMail } = await import('./index');
const { useMailWritesStore } = await import('./mailWrites');

const account = (id: string, identifier: string, extra: Record<string, unknown> = {}) => ({
  agentId: 'agt_1',
  capabilities: { receive: true, send: true },
  displayName: null,
  id,
  identifier,
  kind: 'mail',
  provider: 'agent-mail',
  status: 'active',
  ...extra,
});

const row = (id: string, subject: string, extra: Record<string, unknown> = {}) => ({
  accountId: 'acc_a',
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
  cc: [],
  codes: [],
  createdAt: new Date(),
  deliveredAt: new Date(),
  direction: 'inbound',
  fromAddress: `${id}@x.com`,
  fromName: null,
  id,
  isUnread: false,
  replyTo: [],
  subject: 'Opened',
  text: `Full body of ${id}`,
  threadKey: null,
  to: [{ address: 'a@lobe.id' }],
  ...extra,
});

const probe = { location: '' };
const recordLocation = (value: string) => {
  probe.location = value;
};
const LocationProbe = () => {
  const { pathname, search } = useLocation();
  useEffect(() => recordLocation(`${pathname}${search}`), [pathname, search]);
  return null;
};

const page = (path = '/agent/agt_1/mail') =>
  render(
    <HotkeysProvider initiallyActiveScopes={[HotkeyScopeEnum.Global]}>
      <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <Routes>
            <Route
              element={<AgentMail agentId={'agt_1'} />}
              path={'/agent/:aid/mail/:messageId?'}
            />
          </Routes>
        </MemoryRouter>
      </SWRConfig>
    </HotkeysProvider>,
  );

const rowNamed = (subject: string) => screen.getByRole('button', { name: new RegExp(subject) });

/** A key as the browser sends it: on whatever holds focus, bubbling to the document. */
const press = (key: string, init: KeyboardEventInit & { code?: string } = {}) => {
  const target = document.activeElement ?? document.body;
  const code = init.code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key);
  act(() => {
    fireEvent.keyDown(target, { code, key, ...init });
    fireEvent.keyUp(target, { code, key, ...init });
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  useMailWritesStore.setState({ writes: [] });
  surface.width = 1280;
  service.list.mockResolvedValue([account('acc_a', 'a@lobe.id')]);
  service.listMail.mockResolvedValue([row('msg_1', 'First'), row('msg_2', 'Second')]);
  service.listMailDrafts.mockResolvedValue([]);
  service.getMailAccountCounts.mockResolvedValue([{ accountId: 'acc_a', drafts: 0, unread: 2 }]);
  service.getMailConversation.mockImplementation(async ({ id }: { id: string }) => [mail(id)]);
  service.getMailHtml.mockResolvedValue({ status: 'none' });
  service.markMailRead.mockResolvedValue({ count: 1 });
  service.markMailUnread.mockResolvedValue({ count: 1 });
  service.setMailStarred.mockResolvedValue({ count: 1 });
  service.trashMail.mockResolvedValue({ count: 1, ids: ['msg_1'] });
  service.restoreMail.mockResolvedValue({ count: 1 });
  service.searchMail.mockResolvedValue({ items: [], truncated: false });
  service.deleteMailDrafts.mockResolvedValue({ count: 1 });
  service.updateMailDraft.mockImplementation(async (id: string, content: object) => ({
    ...content,
    id,
  }));
  service.createMailDraft.mockImplementation(async (input: Record<string, unknown>) => ({
    bcc: [],
    cc: [],
    subject: null,
    text: '',
    to: [],
    ...input,
    id: 'draft_1',
    updatedAt: new Date(),
  }));
});

describe('mail hotkeys', () => {
  it('moves the row focus with j / k without opening anything', async () => {
    page();
    await screen.findByText('preview of First');

    press('j');
    expect(rowNamed('First')).toHaveFocus();
    press('j');
    expect(rowNamed('Second')).toHaveFocus();
    press('k');
    expect(rowNamed('First')).toHaveFocus();

    expect(service.getMailConversation).not.toHaveBeenCalled();
    expect(probe.location).toBe('/agent/agt_1/mail');
  });

  it('stays out of the way while typing in a field', async () => {
    page();
    await screen.findByText('preview of First');
    const search = screen.getByRole('textbox', { name: 'identity.mailbox.search.placeholder' });
    search.focus();

    press('j');
    press('c');
    press('s');

    expect(search).toHaveFocus();
    expect(probe.location).toBe('/agent/agt_1/mail');
    expect(service.setMailStarred).not.toHaveBeenCalled();
  });

  it('ignores a key that is part of an input method composition', async () => {
    page();
    await screen.findByText('preview of First');

    press('j', { isComposing: true });

    expect(document.body).toHaveFocus();
  });

  it('focuses the search box with /', async () => {
    page();
    await screen.findByText('preview of First');

    press('/', { code: 'Slash' });

    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'identity.mailbox.search.placeholder' }),
      ).toHaveFocus(),
    );
  });

  it('stars, trashes and undoes on the focused row', async () => {
    page();
    await screen.findByText('preview of First');
    press('j');

    press('s');
    await waitFor(() =>
      expect(service.setMailStarred).toHaveBeenCalledWith(
        { conversationIn: 'inbox', ids: ['msg_1'] },
        true,
      ),
    );

    press('#', { code: 'Digit3', shiftKey: true });
    await waitFor(() =>
      expect(service.trashMail).toHaveBeenCalledWith({ conversationIn: 'inbox', ids: ['msg_1'] }),
    );
    // The list closes up and focus carries on to the next row.
    await waitFor(() => expect(rowNamed('Second')).toHaveFocus());

    press('z');
    await waitFor(() => expect(service.restoreMail).toHaveBeenCalledWith({ ids: ['msg_1'] }));
    // The window is spent: a second z has nothing left to undo.
    press('z');
    expect(service.restoreMail).toHaveBeenCalledTimes(1);
  });

  it('marks the focused row read and unread with Shift+I / Shift+U', async () => {
    page();
    await screen.findByText('preview of First');
    press('j');

    press('I', { code: 'KeyI', shiftKey: true });
    await waitFor(() =>
      expect(service.markMailRead).toHaveBeenCalledWith({
        conversationIn: 'inbox',
        ids: ['msg_1'],
      }),
    );
  });

  it('selects with x and acts on the selection', async () => {
    page();
    await screen.findByText('preview of First');
    press('j');
    press('x');
    press('j');
    press('x');

    expect(screen.getByText('identity.mailbox.bulk.selected')).toBeInTheDocument();

    press('s');
    await waitFor(() =>
      expect(service.setMailStarred).toHaveBeenCalledWith(
        { conversationIn: 'inbox', ids: ['msg_1', 'msg_2'] },
        true,
      ),
    );
  });

  it('selects every loaded row with * a and clears it with Esc', async () => {
    page();
    await screen.findByText('preview of First');

    press('*', { code: 'Digit8', shiftKey: true });
    press('a');
    expect(screen.getByText('identity.mailbox.bulk.selected')).toBeInTheDocument();
    // `a` finished the sequence; it is not also "reply all".
    expect(screen.queryByTestId('mail-composer')).not.toBeInTheDocument();

    press('Escape');
    expect(screen.queryByText('identity.mailbox.bulk.selected')).not.toBeInTheDocument();
  });

  it('goes to a view with g then a letter, without also acting on that letter', async () => {
    page();
    await screen.findByText('preview of First');
    press('j');

    press('g');
    press('s');

    await waitFor(() => expect(probe.location).toBe('/agent/agt_1/mail?folder=starred'));
    expect(service.setMailStarred).not.toHaveBeenCalled();

    press('g');
    press('t');
    await waitFor(() => expect(probe.location).toBe('/agent/agt_1/mail?folder=sent'));
  });

  it('opens a reply to the open mail with r, and Esc leaves the mail for its row', async () => {
    page();
    await screen.findByText('preview of First');
    press('j');
    press('Enter', { code: 'Enter' });
    expect(await screen.findByText('Full body of msg_1')).toBeInTheDocument();

    // Focus on the page itself, as after clicking into the reading pane.
    act(() => (document.activeElement as HTMLElement).blur());
    press('r');
    expect(await screen.findByTestId('mail-composer')).toBeInTheDocument();
    expect(service.createMailDraft).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'reply', sourceMailId: 'msg_1' }),
    );

    // Esc in the editor closes it for good (the URL still naming its draft must
    // not reopen it), and focus goes back to the Reply that opened it.
    await waitFor(() => expect(probe.location).toContain('compose=draft_1'));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'identity.compose.body' }), {
      code: 'Escape',
      key: 'Escape',
    });
    await waitFor(() => expect(screen.queryByTestId('mail-composer')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('mail-action-reply')).toHaveFocus());
    expect(probe.location).toBe('/agent/agt_1/mail/msg_1');

    act(() => (document.activeElement as HTMLElement).blur());
    press('Escape');
    await waitFor(() => expect(probe.location).toBe('/agent/agt_1/mail'));
    await waitFor(() => expect(rowNamed('First')).toHaveFocus());
  });

  it('says why sending is off instead of ignoring r or c', async () => {
    service.list.mockResolvedValue([
      account('acc_a', 'a@lobe.id', { capabilities: { receive: true, send: false } }),
    ]);
    page('/agent/agt_1/mail/msg_1');
    expect(await screen.findByText('Full body of msg_1')).toBeInTheDocument();

    press('r');
    press('c');

    expect(toastApi.info).toHaveBeenCalledTimes(2);
    expect(toastApi.info).toHaveBeenCalledWith({ title: 'identity.compose.block.receiveOnly' });
    expect(screen.queryByTestId('mail-composer')).not.toBeInTheDocument();
    expect(probe.location).toBe('/agent/agt_1/mail/msg_1');
  });

  it('opens a new mail with c', async () => {
    page();
    await screen.findByText('preview of First');

    press('c');

    await waitFor(() => expect(probe.location).toBe('/agent/agt_1/mail?compose=new'));
  });

  it('does nothing while a modal dialog is open', async () => {
    page();
    await screen.findByText('preview of First');
    const dialog = document.createElement('div');
    // As the hotkey help renders it: a dialog that leaves `aria-modal` out.
    dialog.setAttribute('role', 'dialog');
    dialog.textContent = 'open';
    document.body.append(dialog);

    press('j');
    press('c');

    expect(document.body).toHaveFocus();
    expect(probe.location).toBe('/agent/agt_1/mail');
    dialog.remove();
  });

  it('still deletes the open Trash mail for good under the narrow overlay', async () => {
    surface.width = 600;
    page('/agent/agt_1/mail/msg_1?folder=trash');
    expect(await screen.findByText('Full body of msg_1')).toBeInTheDocument();
    await screen.findByText('preview of First');

    // The covered list takes no keys of its own…
    press('j');
    press('x');
    expect(screen.queryByText('identity.mailbox.bulk.selected')).not.toBeInTheDocument();

    // …but the reading pane has no permanent delete, so the open row keeps it.
    press('Delete', { code: 'Delete', shiftKey: true });
    expect(ui.confirmModal).toHaveBeenCalledTimes(1);
  });

  it('takes turns between the list and the open mail on a narrow page', async () => {
    surface.width = 600;
    page();
    await screen.findByText('preview of First');
    expect(screen.queryByText('identity.inbox.detail.placeholder')).not.toBeInTheDocument();

    fireEvent.click(rowNamed('First'));
    expect(await screen.findByText('Full body of msg_1')).toBeInTheDocument();
    const back = screen.getByTestId('mail-narrow-back');
    await waitFor(() => expect(back).toHaveFocus());

    fireEvent.click(back);
    await waitFor(() => expect(probe.location).toBe('/agent/agt_1/mail'));
    expect(screen.queryByText('Full body of msg_1')).not.toBeInTheDocument();
    // The list never unmounted, so its rows (and their scroll) are where they were.
    expect(rowNamed('First')).toBeInTheDocument();
  });
});
