import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  createMailDraft: vi.fn(),
  deleteMailDrafts: vi.fn(),
  downloadMailAttachment: vi.fn(),
  getMailDraft: vi.fn(),
  getMailConversation: vi.fn(),
  getMailHtml: vi.fn(),
  markMailRead: vi.fn(),
  markMailUnread: vi.fn(),
  restoreMail: vi.fn(),
  sendMail: vi.fn(),
  sendMailDraft: vi.fn(),
  setMailStarred: vi.fn(),
  trashMail: vi.fn(),
  updateMailDraft: vi.fn(),
}));
const AttachmentDownloadError = vi.hoisted(
  () =>
    class extends Error {
      constructor(readonly reason: string) {
        super(reason);
      }
    },
);
vi.mock('@/services/agentAccount', () => ({
  agentAccountService: service,
  AttachmentDownloadError,
}));

const ui = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn((_options: unknown) => ({ close: vi.fn() })),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmModal: ui.confirmModal,
  toast: { error: ui.toastError, success: ui.toastSuccess },
}));

const { default: InboxMessageDetail } = await import('./InboxMessageDetail');
const { useMailWritesStore } = await import('./mailWrites');
const { default: MailComposer } = await import('./MailComposer');
const { DRAFT_SAVE_DELAY_MS } = await import('./compose');

const fresh = (node: React.ReactNode) =>
  render(<SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{node}</SWRConfig>);

const detailProps = {
  accountId: 'acc_1',
  accounts: [
    {
      capabilities: { receive: true, send: true },
      id: 'acc_1',
      identifier: 'agent@lobe.id',
      status: 'active',
    },
  ] as never,
  agentId: 'agt_1',
  hasNext: true,
  hasPrevious: false,
  onBack: vi.fn(),
  onComposeChange: vi.fn(),
  onEmptied: vi.fn(),
  onGoToTrash: vi.fn(),
  onNext: vi.fn(),
  onPrevious: vi.fn(),
  onReseated: vi.fn(),
  onRestored: vi.fn(),
  onViewSent: vi.fn(),
  refresh: vi.fn(async () => undefined),
};

const mailRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  accountId: 'acc_1',
  attachments: [],
  cc: [],
  deliveredAt: new Date('2026-10-02T00:00:00Z'),
  direction: 'inbound',
  fromAddress: `${id}@x.com`,
  fromName: null,
  id,
  inboxMessageId: id,
  isUnread: false,
  replyTo: [],
  starredAt: null,
  subject: 'Hello',
  text: `body of ${id}`,
  to: [{ address: 'agent@lobe.id' }],
  ...overrides,
});

/** The undo action of the last success toast. */
const lastUndo = () => {
  const options = ui.toastSuccess.mock.calls.at(-1)?.[0] as {
    actions?: { onClick: () => void }[];
  };
  return options.actions![0].onClick;
};

beforeEach(() => {
  vi.clearAllMocks();
  useMailWritesStore.setState({ writes: [] });
  service.getMailHtml.mockResolvedValue({ status: 'none' });
  service.markMailRead.mockResolvedValue({ count: 1 });
  service.restoreMail.mockResolvedValue({ count: 1 });
});

describe('InboxMessageDetail', () => {
  it('shows a retryable error instead of a skeleton that never resolves', async () => {
    service.getMailConversation.mockRejectedValueOnce(new Error('network down'));

    fresh(<InboxMessageDetail {...detailProps} id={'msg_1'} />);

    expect(await screen.findByText('identity.inbox.detail.loadFailed')).toBeInTheDocument();
  });

  it('says the mail is gone instead of loading forever', async () => {
    service.getMailConversation.mockResolvedValue([]);

    fresh(<InboxMessageDetail {...detailProps} id={'msg_gone'} />);

    expect(await screen.findByText('identity.inbox.detail.gone')).toBeInTheDocument();
  });

  it('reads the conversation in the view it was opened from', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m')]);

    fresh(<InboxMessageDetail {...detailProps} folder={'trash'} id={'m'} />);

    await screen.findByTestId('mail-conversation');
    expect(service.getMailConversation).toHaveBeenCalledWith({ folder: 'trash', id: 'm' });
  });

  it('opens the newest mail and collapses the older one until asked', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('old'), mailRow('new')]);

    fresh(<InboxMessageDetail {...detailProps} id={'new'} />);

    expect(await screen.findAllByText('body of new')).not.toHaveLength(0);
    const [older] = screen.getAllByTestId('mail-summary');
    expect(older).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(older);

    expect(screen.getAllByTestId('mail-summary')[0]).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders HTML in a sandbox with no scripts and no same-origin', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m')]);
    service.getMailHtml.mockResolvedValue({
      hasRemoteContent: true,
      html: '<p>rich</p>',
      status: 'ok',
    });

    fresh(<InboxMessageDetail {...detailProps} id={'m'} />);

    const frame = await screen.findByTestId('mail-html-frame');
    expect(frame.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox');
    expect(frame).toHaveAttribute('data-remote-allowed', 'false');
    expect(service.getMailHtml).toHaveBeenCalledWith('m');

    fireEvent.click(screen.getByText('identity.inbox.detail.showRemote'));

    expect(screen.getByTestId('mail-html-frame')).toHaveAttribute('data-remote-allowed', 'true');
    expect(screen.queryByTestId('mail-remote-notice')).toBeNull();
  });

  it('falls back to the text and says so when the HTML has expired', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m')]);
    service.getMailHtml.mockResolvedValue({ status: 'expired' });

    fresh(<InboxMessageDetail {...detailProps} id={'m'} />);

    expect(await screen.findByText('identity.inbox.detail.htmlExpired')).toBeInTheDocument();
    expect(screen.getByText('body of m')).toBeInTheDocument();
  });

  it('says the formatting could not load when the HTML request itself fails', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m')]);
    service.getMailHtml.mockRejectedValue(new Error('network down'));

    fresh(<InboxMessageDetail {...detailProps} id={'m'} />);

    expect(await screen.findByText('identity.inbox.detail.htmlFailed')).toBeInTheDocument();
    expect(screen.getByText('body of m')).toBeInTheDocument();
  });

  it('marks nothing read for a read-only viewer, on open or on expand', async () => {
    service.getMailConversation.mockResolvedValue([
      mailRow('older', { isUnread: true }),
      mailRow('viewer', { isUnread: true }),
    ]);

    fresh(<InboxMessageDetail {...detailProps} disabled id={'viewer'} />);

    const [older] = await screen.findAllByTestId('mail-summary');
    fireEvent.click(older);
    fireEvent.click(older);

    expect(service.markMailRead).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mail-action-unread')).toBeNull();
  });

  it('stars through the shared mail target and shows it in the list at once', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m')]);
    let settle!: () => void;
    service.setMailStarred.mockReturnValue(
      new Promise((resolve) => {
        settle = () => resolve({ count: 1 });
      }),
    );

    fresh(<InboxMessageDetail {...detailProps} id={'m'} />);
    fireEvent.click(await screen.findByTestId('mail-action-star'));

    await waitFor(() =>
      expect(useMailWritesStore.getState().writes).toEqual([
        expect.objectContaining({ ids: ['m'], patch: { isStarred: true } }),
      ]),
    );
    expect(service.setMailStarred).toHaveBeenCalledWith({ ids: ['m'] }, true);

    settle();
    await waitFor(() => expect(useMailWritesStore.getState().writes).toEqual([]));
  });

  it('puts the star back and offers a retry when the write fails', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m')]);
    service.setMailStarred.mockRejectedValueOnce(new Error('nope'));

    fresh(<InboxMessageDetail {...detailProps} id={'m'} />);

    fireEvent.click(await screen.findByTestId('mail-action-star'));

    await waitFor(() => expect(ui.toastError).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('mail-action-star')).toHaveAttribute('aria-pressed', 'false'),
    );
    expect(useMailWritesStore.getState().writes).toEqual([]);
  });

  it('marks only the unread mails read on open, and counts them down at once', async () => {
    service.getMailConversation.mockResolvedValue([
      mailRow('seen'),
      mailRow('fresh', { isUnread: true }),
    ]);
    // Never settles, so the write is still on screen; its ids are this test's alone,
    // because a later write to the same mail would queue behind it.
    service.markMailRead.mockReturnValue(new Promise(() => {}));

    fresh(<InboxMessageDetail {...detailProps} id={'fresh'} />);

    await waitFor(() => expect(service.markMailRead).toHaveBeenCalledWith({ ids: ['fresh'] }));
    expect(useMailWritesStore.getState().writes).toEqual([
      expect.objectContaining({ ids: ['fresh'], patch: { isUnread: false }, unreadDelta: -1 }),
    ]);
  });

  it('rolls back only the mails a failed mark-read changed', async () => {
    service.getMailConversation.mockResolvedValue([
      mailRow('read'),
      mailRow('unread', { isUnread: true }),
    ]);
    service.markMailRead.mockRejectedValue(new Error('nope'));

    fresh(<InboxMessageDetail {...detailProps} id={'unread'} />);

    await waitFor(() => expect(ui.toastError).toHaveBeenCalled());
    // The mail that failed is unread again; the one that was already read stays read.
    await waitFor(() =>
      expect(screen.getByTestId('mail-action-unread')).toHaveAttribute('data-unread', 'true'),
    );
    expect(useMailWritesStore.getState().writes).toEqual([]);
  });

  it('hands off to the page when trashing empties the conversation', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m')]);
    service.trashMail.mockResolvedValue({ count: 1, ids: ['m'] });

    fresh(<InboxMessageDetail {...detailProps} id={'m'} />);

    fireEvent.click(await screen.findByTestId('mail-action-trash'));

    await waitFor(() => expect(detailProps.onEmptied).toHaveBeenCalled());
    expect(service.trashMail).toHaveBeenCalledWith({ ids: ['m'] });
  });

  it('undoes a trash by restoring only what the server reported moving', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('a'), mailRow('b')]);
    // `b` was already gone (another tab), so only `a` moved.
    service.trashMail.mockResolvedValue({ count: 1, ids: ['a'] });

    fresh(<InboxMessageDetail {...detailProps} id={'b'} />);

    fireEvent.click(await screen.findByTestId('mail-action-trash'));
    await waitFor(() => expect(ui.toastSuccess).toHaveBeenCalled());

    lastUndo()();

    await waitFor(() => expect(service.restoreMail).toHaveBeenCalledWith({ ids: ['a'] }));
    expect(service.restoreMail).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(detailProps.onRestored).toHaveBeenCalledWith('b'));
  });

  it('offers no undo when the trash moved nothing', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m')]);
    service.trashMail.mockResolvedValue({ count: 0, ids: [] });

    fresh(<InboxMessageDetail {...detailProps} id={'m'} />);

    fireEvent.click(await screen.findByTestId('mail-action-trash'));

    await waitFor(() => expect(service.trashMail).toHaveBeenCalled());
    await waitFor(() => expect(detailProps.refresh).toHaveBeenCalled());
    expect(ui.toastSuccess).not.toHaveBeenCalled();
  });

  it('moves the URL to a mail that is left when one mail of the conversation is trashed', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('old'), mailRow('new')]);
    service.trashMail.mockResolvedValue({ count: 1, ids: ['new'] });

    fresh(<InboxMessageDetail {...detailProps} id={'new'} />);

    const newest = (await screen.findAllByTestId('mail-item'))[1];
    fireEvent.click(newest.querySelector('[aria-label="identity.more"]')!);
    fireEvent.click(await screen.findByText('identity.inbox.action.trashOne'));

    await waitFor(() => expect(detailProps.onReseated).toHaveBeenCalledWith('old'));
    expect(detailProps.onEmptied).not.toHaveBeenCalled();
  });

  it('says where to restore from when undo fails', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m')]);
    service.trashMail.mockResolvedValue({ count: 1, ids: ['m'] });
    service.restoreMail.mockRejectedValueOnce(new Error('nope'));

    fresh(<InboxMessageDetail {...detailProps} id={'m'} />);

    fireEvent.click(await screen.findByTestId('mail-action-trash'));
    await waitFor(() => expect(ui.toastSuccess).toHaveBeenCalled());
    lastUndo()();

    await waitFor(() =>
      expect(ui.toastError).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'identity.mailbox.failed.undo' }),
      ),
    );
  });

  it('offers restore instead of trash for mail in the trash', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m')]);

    fresh(<InboxMessageDetail {...detailProps} folder={'trash'} id={'m'} />);

    fireEvent.click(await screen.findByTestId('mail-action-restore'));

    await waitFor(() => expect(service.restoreMail).toHaveBeenCalledWith({ ids: ['m'] }));
    expect(screen.queryByTestId('mail-action-trash')).toBeNull();
    expect(screen.queryByTestId('mail-action-star')).toBeNull();
  });

  it('does not mark the landed-on conversation read until the reader touches it', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m', { isUnread: true })]);

    fresh(<InboxMessageDetail {...detailProps} deferRead id={'m'} />);

    const conversation = await screen.findByTestId('mail-conversation');
    expect(service.markMailRead).not.toHaveBeenCalled();

    fireEvent.pointerDown(conversation);

    await waitFor(() => expect(service.markMailRead).toHaveBeenCalledWith({ ids: ['m'] }));
  });

  it('hides every write for a released address', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m', { accountId: 'gone' })]);

    fresh(<InboxMessageDetail {...detailProps} id={'m'} />);

    expect(await screen.findByText('identity.inbox.detail.released')).toBeInTheDocument();
    expect(screen.queryByTestId('mail-action-trash')).toBeNull();
    expect(screen.queryByTestId('mail-action-star')).toBeNull();
    expect(screen.queryByTestId('mail-action-unread')).toBeNull();
  });
});

describe('InboxMessageDetail replies', () => {
  const draftRow = (extra: Record<string, unknown> = {}) => ({
    accountId: 'acc_1',
    bcc: [],
    cc: [],
    id: 'draft_1',
    mode: 'reply',
    sourceMailId: 'in',
    subject: null,
    text: '',
    to: [],
    updatedAt: new Date('2026-10-02T00:00:00Z'),
    ...extra,
  });

  beforeEach(() => {
    service.createMailDraft.mockImplementation(async (input) => draftRow(input));
    service.deleteMailDrafts.mockResolvedValue({ count: 1 });
  });

  it('answers the newest received mail inline, below the conversation', async () => {
    service.getMailConversation.mockResolvedValue([
      mailRow('in', { fromAddress: 'lin@partner.example' }),
      mailRow('out', { direction: 'outbound', fromAddress: 'agent@lobe.id' }),
    ]);
    const onComposeChange = vi.fn();
    fresh(<InboxMessageDetail {...detailProps} id={'in'} onComposeChange={onComposeChange} />);

    fireEvent.click(await screen.findByTestId('mail-action-reply'));

    expect(await screen.findByTestId('mail-composer')).toBeInTheDocument();
    await waitFor(() =>
      expect(service.createMailDraft).toHaveBeenCalledWith({
        accountId: 'acc_1',
        mode: 'reply',
        sourceMailId: 'in',
      }),
    );
    // The draft id goes to the URL, so a reload resumes the reply.
    await waitFor(() => expect(onComposeChange).toHaveBeenCalledWith('draft_1'));
    const chips = await screen.findAllByTestId('recipient-chip');
    expect(chips.map((chip) => chip.textContent)).toEqual(['lin@partner.example']);
  });

  it('cannot reply to a conversation that only holds sent mail', async () => {
    service.getMailConversation.mockResolvedValue([
      mailRow('out', { direction: 'outbound', fromAddress: 'agent@lobe.id' }),
    ]);
    fresh(<InboxMessageDetail {...detailProps} id={'out'} />);

    expect(await screen.findByTestId('mail-action-reply')).toBeDisabled();
    expect(screen.getByTestId('mail-action-reply-all')).toBeDisabled();
    expect(screen.getByTestId('mail-action-forward')).toBeEnabled();
  });

  it('keeps the answers visible but disabled for an address that only receives', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('in')]);
    fresh(
      <InboxMessageDetail
        {...detailProps}
        id={'in'}
        accounts={
          [
            {
              capabilities: { receive: true, send: false },
              id: 'acc_1',
              identifier: 'agent@lobe.id',
              status: 'active',
            },
          ] as never
        }
      />,
    );

    const reply = await screen.findByTestId('mail-action-reply');
    expect(reply).toBeDisabled();
    expect(screen.getByTestId('mail-action-forward')).toBeDisabled();
  });

  it('resumes the reply draft the URL names', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('in')]);
    service.getMailDraft.mockResolvedValue(draftRow({ text: 'Half written' }));
    fresh(<InboxMessageDetail {...detailProps} composeId={'draft_1'} id={'in'} />);

    expect(await screen.findByTestId('mail-composer')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('identity.compose.body')).toHaveValue('Half written'),
    );
    expect(service.createMailDraft).not.toHaveBeenCalled();
  });

  it('does not resume a reply draft of another conversation', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('in')]);
    service.getMailDraft.mockResolvedValue(draftRow({ sourceMailId: 'other', text: 'For A' }));
    fresh(<InboxMessageDetail {...detailProps} composeId={'draft_1'} id={'in'} />);

    await screen.findByTestId('mail-action-reply');
    await waitFor(() => expect(service.getMailDraft).toHaveBeenCalled());
    expect(screen.queryByTestId('mail-composer')).toBeNull();
  });

  it('keeps answering the same mail when a newer one arrives', async () => {
    const onReady = vi.fn();
    const Grab = () => {
      const { mutate } = useSWRConfig();
      useEffect(() => onReady(mutate), [mutate]);
      return null;
    };
    service.getMailConversation.mockResolvedValue([mailRow('in')]);
    fresh(
      <>
        <Grab />
        <InboxMessageDetail {...detailProps} id={'in'} />
      </>,
    );
    fireEvent.click(await screen.findByTestId('mail-action-reply'));
    fireEvent.change(await screen.findByLabelText('identity.compose.body'), {
      target: { value: 'Typing…' },
    });

    // The poll brings a newer received mail into the conversation.
    service.getMailConversation.mockResolvedValue([mailRow('in'), mailRow('in2')]);
    const revalidate = onReady.mock.calls[0][0] as ReturnType<typeof useSWRConfig>['mutate'];
    await act(() => revalidate(['agent-mail-conversation', 'in', undefined]));
    await screen.findByText('body of in2', { exact: false }).catch(() => undefined);

    expect(screen.getByLabelText('identity.compose.body')).toHaveValue('Typing…');
    expect(service.createMailDraft).toHaveBeenCalledTimes(1);
    expect(service.createMailDraft).toHaveBeenCalledWith(
      expect.objectContaining({ sourceMailId: 'in' }),
    );
  });

  it('offers no answers in the trash', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('in')]);
    fresh(<InboxMessageDetail {...detailProps} folder={'trash'} id={'in'} />);
    await screen.findByTestId('mail-action-restore');
    expect(screen.queryByTestId('mail-action-reply')).toBeNull();
  });
});

describe('InboxMessageDetail attachments', () => {
  const withAttachments = () =>
    service.getMailConversation.mockResolvedValue([
      mailRow('msg_photo', {
        attachments: [
          { contentType: 'image/jpeg', filename: 'photo.jpg', index: 0, size: 2_516_582 },
          { contentType: 'application/pdf', index: 1 },
        ],
        text: '',
      }),
    ]);

  it('lists what an attachment-only message carried instead of a blank body', async () => {
    withAttachments();

    fresh(<InboxMessageDetail {...detailProps} id={'msg_photo'} />);

    expect(await screen.findByText('photo.jpg')).toBeInTheDocument();
    expect(screen.getByText('2.4 MB')).toBeInTheDocument();
    expect(screen.getByText('application/pdf')).toBeInTheDocument();
    expect(screen.getAllByTestId('mail-attachment')).toHaveLength(2);
  });

  it('marks an expired attachment and stops offering the download', async () => {
    withAttachments();
    service.downloadMailAttachment.mockRejectedValueOnce(new AttachmentDownloadError('expired'));

    fresh(<InboxMessageDetail {...detailProps} id={'msg_photo'} />);

    const [first] = await screen.findAllByTestId('mail-attachment');
    fireEvent.click(first.querySelector('button')!);

    expect(await screen.findByText('identity.inbox.detail.attachmentExpired')).toBeInTheDocument();
    expect(service.downloadMailAttachment).toHaveBeenCalledWith('msg_photo', 0);
    expect(first.querySelector('button')).toBeDisabled();
  });

  it('warns before downloading a program, and downloads only once confirmed', async () => {
    service.getMailConversation.mockResolvedValue([
      mailRow('msg_exe', {
        attachments: [{ contentType: 'application/octet-stream', filename: 'setup.EXE', index: 0 }],
      }),
    ]);
    service.downloadMailAttachment.mockResolvedValue(new Blob(['x']));

    fresh(<InboxMessageDetail {...detailProps} id={'msg_exe'} />);

    const [row] = await screen.findAllByTestId('mail-attachment');
    fireEvent.click(row.querySelector('button')!);

    expect(ui.confirmModal).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'identity.inbox.detail.executable.title' }),
    );
    expect(service.downloadMailAttachment).not.toHaveBeenCalled();

    (ui.confirmModal.mock.calls[0][0] as { onOk: () => void }).onOk();

    await waitFor(() => expect(service.downloadMailAttachment).toHaveBeenCalledWith('msg_exe', 0));
  });

  it('keeps an outage retryable', async () => {
    withAttachments();
    service.downloadMailAttachment.mockRejectedValueOnce(
      new AttachmentDownloadError('unavailable'),
    );

    fresh(<InboxMessageDetail {...detailProps} id={'msg_photo'} />);

    const [first] = await screen.findAllByTestId('mail-attachment');
    fireEvent.click(first.querySelector('button')!);

    expect(await screen.findByText('identity.inbox.detail.attachmentFailed')).toBeInTheDocument();
    expect(first.querySelector('button')).not.toBeDisabled();
  });
});

const composerAccount = (extra: Record<string, unknown> = {}) =>
  ({
    agentId: 'agt_1',
    capabilities: { receive: true, send: true },
    displayName: 'Scout',
    id: 'acc_a',
    identifier: 'scout@lobe.id',
    kind: 'mail',
    provider: 'agent-mail',
    status: 'active',
    ...extra,
  }) as never;

const composerSource = (extra: Record<string, unknown> = {}) =>
  ({
    accountId: 'acc_a',
    attachments: [],
    cc: [{ address: 'ops@team.example' }],
    deliveredAt: new Date('2026-11-10T08:00:00Z'),
    direction: 'inbound',
    fromAddress: 'lin@partner.example',
    fromName: 'Lin',
    id: 'mail_1',
    replyTo: [],
    subject: 'Q3 plan',
    text: 'Final plan attached.',
    to: [{ address: 'scout@lobe.id' }, { address: 'zhou@team.example' }],
    ...extra,
  }) as never;

const composerDraft = (extra: Record<string, unknown> = {}) => ({
  accountId: 'acc_a',
  bcc: [],
  cc: [],
  id: 'draft_1',
  mode: 'compose',
  sourceMailId: null,
  subject: null,
  text: '',
  to: [],
  updatedAt: new Date('2026-11-10T08:00:00Z'),
  ...extra,
});

const composerRefresh = vi.fn(() => Promise.resolve());

const setupComposer = (props: Record<string, unknown> = {}) => {
  const onClose = vi.fn();
  const onViewSent = vi.fn();
  const view = render(
    <MailComposer
      account={composerAccount()}
      agentId={'agt_1'}
      mode={'compose'}
      refresh={composerRefresh}
      onClose={onClose}
      onViewSent={onViewSent}
      {...props}
    />,
  );
  return { ...view, onClose, onViewSent };
};

const typeRecipient = (label: string, value: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

const failure = (code: string, message = 'refused') =>
  Object.assign(new Error(message), { data: { errorData: { code } } });

describe('MailComposer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    for (const fn of [
      service.createMailDraft,
      service.deleteMailDrafts,
      service.sendMail,
      service.sendMailDraft,
      service.updateMailDraft,
    ])
      fn.mockReset();
    ui.toastError.mockClear();
    ui.toastSuccess.mockClear();
    composerRefresh.mockClear();
    localStorage.clear();
    service.createMailDraft.mockImplementation(async (input) =>
      composerDraft({ ...input, id: 'draft_1' }),
    );
    service.updateMailDraft.mockImplementation(async (id, content) =>
      composerDraft({ ...content, id }),
    );
    service.deleteMailDrafts.mockResolvedValue({ count: 1 });
    service.sendMailDraft.mockResolvedValue({ mailId: 'sent_1', providerMessageId: 'p1' });
    service.sendMail.mockResolvedValue({ mailId: 'sent_1', providerMessageId: 'p1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('MailComposer — new mail', () => {
    it('saves the draft after a pause, keeps saving edits, then sends it once', async () => {
      const { onClose, onViewSent } = setupComposer();

      typeRecipient('identity.compose.to', 'Lin <lin@partner.example>');
      fireEvent.change(screen.getByLabelText('identity.compose.subject'), {
        target: { value: 'Hello' },
      });
      fireEvent.change(screen.getByLabelText('identity.compose.body'), {
        target: { value: 'First line' },
      });
      expect(service.createMailDraft).not.toHaveBeenCalled();

      await act(() => vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS + 10));
      expect(service.createMailDraft).toHaveBeenCalledWith({
        accountId: 'acc_a',
        bcc: [],
        cc: [],
        mode: 'compose',
        sourceMailId: undefined,
        subject: 'Hello',
        text: 'First line',
        to: [{ address: 'lin@partner.example', name: 'Lin' }],
      });
      await waitFor(() =>
        expect(screen.getByTestId('mail-save-state')).toHaveTextContent(
          'identity.compose.save.saved',
        ),
      );

      fireEvent.change(screen.getByLabelText('identity.compose.body'), {
        target: { value: 'First line\nSecond line' },
      });
      fireEvent.click(screen.getByTestId('mail-send'));

      await waitFor(() => expect(service.sendMailDraft).toHaveBeenCalledWith('draft_1'));
      // The edit made just before sending is saved first, so the mail carries it.
      expect(service.updateMailDraft).toHaveBeenCalledWith(
        'draft_1',
        expect.objectContaining({ text: 'First line\nSecond line' }),
      );
      expect(service.updateMailDraft.mock.invocationCallOrder[0]).toBeLessThan(
        service.sendMailDraft.mock.invocationCallOrder[0],
      );
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      const sentToast = ui.toastSuccess.mock.calls.at(-1)![0] as {
        actions: { label: string; onClick: () => void }[];
        title: string;
      };
      expect(sentToast.title).toBe('identity.compose.sent.title');
      sentToast.actions[0].onClick();
      expect(onViewSent).toHaveBeenCalledWith({ mailId: 'sent_1', providerMessageId: 'p1' });
    });

    it('marks a bad address on its chip and refuses to send', async () => {
      setupComposer();
      typeRecipient('identity.compose.to', 'good@partner.example, not-an-address');
      fireEvent.change(screen.getByLabelText('identity.compose.body'), { target: { value: 'Hi' } });

      const chips = screen.getAllByTestId('recipient-chip');
      expect(chips[0]).not.toHaveAttribute('aria-invalid');
      expect(chips[1]).toHaveAttribute('aria-invalid', 'true');

      fireEvent.click(screen.getByTestId('mail-send'));
      await waitFor(() => expect(ui.toastError).toHaveBeenCalled());
      expect(service.sendMailDraft).not.toHaveBeenCalled();
      expect(service.sendMail).not.toHaveBeenCalled();
    });

    it('saves the draft without a malformed address, which stays marked on screen', async () => {
      setupComposer();
      typeRecipient('identity.compose.to', 'good@partner.example, bad-address');
      fireEvent.change(screen.getByLabelText('identity.compose.body'), { target: { value: 'Hi' } });
      await act(() => vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS + 10));

      expect(service.createMailDraft).toHaveBeenCalledWith(
        expect.objectContaining({ to: [{ address: 'good@partner.example' }] }),
      );
      await waitFor(() =>
        expect(screen.getByTestId('mail-save-state')).toHaveTextContent(
          'identity.compose.save.saved',
        ),
      );
      expect(screen.getAllByTestId('recipient-chip')[1]).toHaveAttribute('aria-invalid', 'true');
      // Only this browser holds the malformed one, so its copy outlives the save.
      expect(
        JSON.parse(localStorage.getItem('lobe-agent-mail:draft:agt_1:acc_a:draft_1')!).fields.to,
      ).toHaveLength(2);
    });

    it('keeps Send disabled with a reason until there is a recipient and a body', () => {
      setupComposer();
      expect(screen.getByTestId('mail-send')).toBeDisabled();
      expect(screen.getByText('identity.compose.disabled.recipient')).toBeInTheDocument();
      typeRecipient('identity.compose.to', 'a@b.com');
      expect(screen.getByText('identity.compose.disabled.body')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('identity.compose.body'), { target: { value: 'x' } });
      expect(screen.getByTestId('mail-send')).toBeEnabled();
    });

    it('asks before sending without a subject', async () => {
      setupComposer();
      typeRecipient('identity.compose.to', 'a@b.com');
      fireEvent.change(screen.getByLabelText('identity.compose.body'), { target: { value: 'x' } });
      fireEvent.click(screen.getByTestId('mail-send'));

      expect(ui.confirmModal).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'identity.compose.noSubject.title' }),
      );
      expect(service.sendMailDraft).not.toHaveBeenCalled();
      act(() => ui.confirmModal.mock.calls[0][0].onOk());
      await waitFor(() => expect(service.sendMailDraft).toHaveBeenCalledWith('draft_1'));
    });

    it('shows Cc and Bcc only when asked', () => {
      setupComposer();
      expect(screen.queryByLabelText('identity.compose.cc')).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('identity.compose.showCopies'));
      expect(screen.getByLabelText('identity.compose.cc')).toBeInTheDocument();
      expect(screen.getByLabelText('identity.compose.bcc')).toBeInTheDocument();
    });

    it('restores what this browser kept when a save never reached the server', async () => {
      localStorage.setItem(
        'lobe-agent-mail:draft:agt_1:acc_a:new',
        JSON.stringify({
          fields: { bcc: [], cc: [], subject: 'Kept', text: 'Typed offline', to: [] },
          savedAt: Date.now(),
        }),
      );
      setupComposer();
      await waitFor(() =>
        expect(screen.getByLabelText('identity.compose.body')).toHaveValue('Typed offline'),
      );
      expect(screen.getByLabelText('identity.compose.subject')).toHaveValue('Kept');
      // …and saves it to the server on its own.
      await act(() => vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS + 10));
      expect(service.createMailDraft).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Typed offline' }),
      );
    });

    it('keeps the content and offers a retry when saving fails', async () => {
      service.createMailDraft.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      setupComposer();
      fireEvent.change(screen.getByLabelText('identity.compose.body'), {
        target: { value: 'Do not lose me' },
      });
      await act(() => vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS + 10));

      await waitFor(() =>
        expect(screen.getByTestId('mail-save-state')).toHaveTextContent(
          'identity.compose.save.failed',
        ),
      );
      expect(screen.getByLabelText('identity.compose.body')).toHaveValue('Do not lose me');
      expect(
        JSON.parse(localStorage.getItem('lobe-agent-mail:draft:agt_1:acc_a:new')!).fields.text,
      ).toBe('Do not lose me');

      fireEvent.click(screen.getByTestId('mail-save-state'));
      await waitFor(() => expect(service.createMailDraft).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.getByTestId('mail-save-state')).toHaveTextContent(
          'identity.compose.save.saved',
        ),
      );
    });

    it('saves silently on close', async () => {
      const { onClose, unmount } = setupComposer();
      fireEvent.change(screen.getByLabelText('identity.compose.body'), {
        target: { value: 'Later' },
      });
      fireEvent.click(screen.getByLabelText('identity.compose.close'));
      expect(onClose).toHaveBeenCalled();
      unmount();
      await waitFor(() =>
        expect(service.createMailDraft).toHaveBeenCalledWith(
          expect.objectContaining({ text: 'Later' }),
        ),
      );
    });
  });

  describe('MailComposer — review fixes', () => {
    it('waits for a save already on its way before sending the draft', async () => {
      let finishUpdate!: () => void;
      service.updateMailDraft.mockImplementation(
        (id, content) =>
          new Promise((resolve) => {
            finishUpdate = () => resolve(composerDraft({ ...content, id }));
          }),
      );
      setupComposer({
        draft: composerDraft({ subject: 'S', text: 'Old', to: [{ address: 'a@b.com' }] }),
      });
      await waitFor(() =>
        expect(screen.getByLabelText('identity.compose.body')).toHaveValue('Old'),
      );

      fireEvent.change(screen.getByLabelText('identity.compose.body'), {
        target: { value: 'New' },
      });
      await act(() => vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS + 10));
      expect(service.updateMailDraft).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId('mail-send'));
      await act(() => vi.advanceTimersByTimeAsync(50));
      // The update has not landed, so the send must not read the old draft yet.
      expect(service.sendMailDraft).not.toHaveBeenCalled();
      await act(async () => finishUpdate());
      await waitFor(() => expect(service.sendMailDraft).toHaveBeenCalledWith('draft_1'));
    });

    it('remembers removed forward attachments across a save and a reopen', async () => {
      const forwardSource = composerSource({
        attachments: [
          { filename: 'plan.pdf', index: 0 },
          { filename: 'secret.csv', index: 1 },
        ],
      });
      const first = setupComposer({ inline: true, mode: 'forward', source: forwardSource });
      await screen.findAllByTestId('compose-attachment');
      fireEvent.click(screen.getAllByLabelText('identity.compose.removeAttachment')[1]);
      fireEvent.change(screen.getByLabelText('identity.compose.body'), {
        target: { value: 'FYI' },
      });
      await act(() => vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS + 10));
      await waitFor(() =>
        expect(screen.getByTestId('mail-save-state')).toHaveTextContent(
          'identity.compose.save.saved',
        ),
      );
      first.unmount();

      service.createMailDraft.mockResolvedValue(
        composerDraft({
          mode: 'forward',
          sourceMailId: 'mail_1',
          subject: 'Fwd: Q3 plan',
          text: 'FYI',
        }),
      );
      setupComposer({ inline: true, mode: 'forward', source: forwardSource });
      await waitFor(() =>
        expect(screen.getByLabelText('identity.compose.body')).toHaveValue('FYI'),
      );
      expect(screen.getAllByTestId('compose-attachment')[1]).toHaveAttribute(
        'data-excluded',
        'true',
      );
    });

    it('brings back unsaved edits when answering the same mail again', async () => {
      // Resuming touches the draft's `updatedAt`, so this must not hinge on timestamps.
      localStorage.setItem(
        'lobe-agent-mail:draft:agt_1:acc_a:draft_7',
        JSON.stringify({
          fields: { bcc: [], cc: [], subject: '', text: 'Written offline', to: [] },
          pending: true,
          savedAt: 1,
        }),
      );
      service.createMailDraft.mockResolvedValue(
        composerDraft({
          id: 'draft_7',
          mode: 'reply',
          sourceMailId: 'mail_1',
          text: 'Saved earlier',
        }),
      );
      setupComposer({ inline: true, mode: 'reply', source: composerSource() });
      await waitFor(() =>
        expect(screen.getByLabelText('identity.compose.body')).toHaveValue('Written offline'),
      );
    });

    it('keeps a discarded draft that is opened again within the undo window', async () => {
      setupComposer({
        draft: composerDraft({ subject: 'S', text: 'Keep me', to: [{ address: 'a@b.com' }] }),
      });
      await waitFor(() =>
        expect(screen.getByLabelText('identity.compose.body')).toHaveValue('Keep me'),
      );
      fireEvent.click(screen.getByLabelText('identity.mailbox.action.discard'));
      await waitFor(() => expect(ui.toastSuccess).toHaveBeenCalled());

      setupComposer({
        draft: composerDraft({ subject: 'S', text: 'Keep me', to: [{ address: 'a@b.com' }] }),
      });
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(service.deleteMailDrafts).not.toHaveBeenCalled();
    });
  });

  describe('MailComposer — sending states', () => {
    const fill = () => {
      typeRecipient('identity.compose.to', 'a@b.com');
      fireEvent.change(screen.getByLabelText('identity.compose.subject'), {
        target: { value: 'S' },
      });
      fireEvent.change(screen.getByLabelText('identity.compose.body'), {
        target: { value: 'Body' },
      });
    };

    it('locks the form while sending and keeps everything after a failure', async () => {
      let reject!: (error: unknown) => void;
      service.sendMailDraft.mockImplementation(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      );
      const { onClose } = setupComposer();
      fill();
      fireEvent.click(screen.getByTestId('mail-send'));

      await waitFor(() => expect(service.sendMailDraft).toHaveBeenCalledTimes(1));
      expect(screen.getByLabelText('identity.compose.body')).toHaveAttribute('readonly');
      expect(screen.getByTestId('mail-send')).toHaveTextContent('identity.compose.sending');
      // A second click while sending sends nothing more.
      fireEvent.click(screen.getByTestId('mail-send'));
      expect(service.sendMailDraft).toHaveBeenCalledTimes(1);

      await act(async () => reject(failure('send_failed')));
      await waitFor(() =>
        expect(screen.getByTestId('mail-send-failure')).toHaveTextContent(
          'identity.compose.error.failed',
        ),
      );
      expect(screen.getByLabelText('identity.compose.body')).toHaveValue('Body');
      expect(screen.getByLabelText('identity.compose.body')).not.toHaveAttribute('readonly');
      expect(onClose).not.toHaveBeenCalled();
    });

    it('says a receive-only address cannot send, and says so up front the next time', async () => {
      service.sendMailDraft.mockRejectedValue(failure('send_disabled'));
      const first = setupComposer();
      fill();
      fireEvent.click(screen.getByTestId('mail-send'));
      await waitFor(() => expect(screen.getByTestId('mail-send-failure')).toBeInTheDocument());
      expect(screen.getByTestId('mail-send-block')).toHaveTextContent(
        'identity.compose.block.receiveOnly',
      );
      first.unmount();

      setupComposer();
      expect(screen.getByTestId('mail-send-block')).toBeInTheDocument();
      fill();
      expect(screen.getByTestId('mail-send')).toBeDisabled();
    });

    it('blocks an address that only receives before anything is written', () => {
      setupComposer({ account: composerAccount({ capabilities: { receive: true, send: false } }) });
      expect(screen.getByTestId('mail-send-block')).toHaveTextContent(
        'identity.compose.block.receiveOnly',
      );
      fill();
      expect(screen.getByTestId('mail-send')).toBeDisabled();
    });
  });

  describe('MailComposer — replies and forwards', () => {
    it('opens the one draft for this reply, with the original’s recipients and a quote', async () => {
      setupComposer({ inline: true, mode: 'replyAll', source: composerSource() });

      await waitFor(() =>
        expect(service.createMailDraft).toHaveBeenCalledWith({
          accountId: 'acc_a',
          mode: 'replyAll',
          sourceMailId: 'mail_1',
        }),
      );
      const chips = await screen.findAllByTestId('recipient-chip');
      expect(chips.map((chip) => chip.textContent)).toEqual([
        'Lin <lin@partner.example>',
        'zhou@team.example',
        'ops@team.example',
      ]);
      expect(screen.getByLabelText('identity.compose.subject')).toHaveValue('Re: Q3 plan');
      expect(screen.getByLabelText('identity.compose.subject')).toHaveAttribute('readonly');
      expect(screen.getByLabelText('identity.compose.body')).toHaveValue(
        '\n\nidentity.compose.quoteHeader\n> Final plan attached.',
      );
    });

    it('removes a reply draft nobody wrote in when closed', async () => {
      const { onClose } = setupComposer({ inline: true, mode: 'reply', source: composerSource() });
      await screen.findAllByTestId('recipient-chip');
      fireEvent.click(screen.getByLabelText('identity.compose.close'));
      expect(onClose).toHaveBeenCalled();
      await waitFor(() => expect(service.deleteMailDrafts).toHaveBeenCalledWith(['draft_1']));
    });

    it('resumes what was written last time instead of starting over', async () => {
      service.createMailDraft.mockResolvedValue(
        composerDraft({
          id: 'draft_9',
          mode: 'reply',
          sourceMailId: 'mail_1',
          text: 'Half an answer',
        }),
      );
      setupComposer({ inline: true, mode: 'reply', source: composerSource() });
      await waitFor(() =>
        expect(screen.getByLabelText('identity.compose.body')).toHaveValue('Half an answer'),
      );
      fireEvent.change(screen.getByLabelText('identity.compose.body'), {
        target: { value: 'Half an answer, finished' },
      });
      fireEvent.click(screen.getByTestId('mail-send'));
      await waitFor(() => expect(service.sendMailDraft).toHaveBeenCalledWith('draft_9'));
      // A reply never stores a subject: the server answers under the original's.
      expect(service.updateMailDraft).toHaveBeenCalledWith(
        'draft_9',
        expect.objectContaining({ subject: null, text: 'Half an answer, finished' }),
      );
      expect(ui.confirmModal).not.toHaveBeenCalled();
    });

    it('forwards with Fwd:, the quote, and only the attachments left in', async () => {
      setupComposer({
        inline: true,
        mode: 'forward',
        source: composerSource({
          attachments: [
            { filename: 'plan.pdf', index: 0 },
            { filename: 'budget.csv', index: 1 },
          ],
        }),
      });
      await waitFor(() =>
        expect(screen.getByLabelText('identity.compose.subject')).toHaveValue('Fwd: Q3 plan'),
      );
      expect(
        (screen.getByLabelText('identity.compose.body') as HTMLTextAreaElement).value,
      ).toContain('---------- Forwarded message ---------');
      expect(screen.getAllByTestId('compose-attachment')).toHaveLength(2);

      typeRecipient('identity.compose.to', 'boss@corp.example');
      fireEvent.click(screen.getAllByLabelText('identity.compose.removeAttachment')[0]);
      fireEvent.click(screen.getByTestId('mail-send'));

      await waitFor(() =>
        expect(service.sendMail).toHaveBeenCalledWith(
          expect.objectContaining({
            accountId: 'acc_a',
            forwardAttachmentIndexes: [1],
            mode: 'forward',
            sourceMailId: 'mail_1',
            subject: 'Fwd: Q3 plan',
            to: [{ address: 'boss@corp.example' }],
          }),
        ),
      );
      expect(service.sendMailDraft).not.toHaveBeenCalled();
      await waitFor(() => expect(service.deleteMailDrafts).toHaveBeenCalledWith(['draft_1']));
    });

    it('sends a forward that keeps every attachment through its draft', async () => {
      setupComposer({
        inline: true,
        mode: 'forward',
        source: composerSource({ attachments: [{ filename: 'plan.pdf', index: 0 }] }),
      });
      await screen.findAllByTestId('compose-attachment');
      typeRecipient('identity.compose.to', 'boss@corp.example');
      fireEvent.click(screen.getByTestId('mail-send'));
      await waitFor(() => expect(service.sendMailDraft).toHaveBeenCalledWith('draft_1'));
      expect(service.sendMail).not.toHaveBeenCalled();
    });

    it('cannot send a reply whose original is gone, and says why', async () => {
      setupComposer({ draft: composerDraft({ mode: 'reply', text: 'Orphan' }), mode: 'reply' });
      await waitFor(() =>
        expect(screen.getByLabelText('identity.compose.body')).toHaveValue('Orphan'),
      );
      expect(screen.getByTestId('mail-send')).toBeDisabled();
      expect(screen.getByText('identity.compose.error.targetGone')).toBeInTheDocument();
    });
  });
});
