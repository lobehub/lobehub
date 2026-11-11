import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const { default: MailComposer } = await import('./MailComposer');
const { DRAFT_SAVE_DELAY_MS } = await import('./compose');

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

  describe('MailComposer — Codex on 94a2f6b1f07', () => {
    it('does not steer the page once closed, while its first save finishes', async () => {
      let finishCreate!: () => void;
      service.createMailDraft.mockImplementation(
        (input) =>
          new Promise((resolve) => {
            finishCreate = () => resolve(composerDraft({ ...input, id: 'draft_late' }));
          }),
      );
      const onDraftCreated = vi.fn();
      const { onClose } = setupComposer({ onDraftCreated });
      fireEvent.change(screen.getByLabelText('identity.compose.body'), {
        target: { value: 'Bye' },
      });
      fireEvent.click(screen.getByLabelText('identity.compose.close'));
      expect(onClose).toHaveBeenCalled();

      await act(async () => finishCreate());
      expect(service.createMailDraft).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Bye' }),
      );
      expect(onDraftCreated).not.toHaveBeenCalled();
    });

    it('keeps a quoted name whole when typed one character at a time', () => {
      setupComposer();
      const input = screen.getByLabelText('identity.compose.to');
      let typed = '';
      for (const char of '"Doe, John" <j@x.com>') {
        typed += char;
        fireEvent.change(input, { target: { value: typed } });
      }
      expect(screen.queryByTestId('recipient-chip')).toBeNull();
      fireEvent.change(input, { target: { value: `${typed},` } });
      expect(screen.getAllByTestId('recipient-chip').map((chip) => chip.textContent)).toEqual([
        'Doe, John <j@x.com>',
      ]);
    });
  });

  describe('MailComposer — Codex on 47f900b87c2', () => {
    it('shows Cc restored from this browser', async () => {
      localStorage.setItem(
        'lobe-agent-mail:draft:agt_1:acc_a:draft_1',
        JSON.stringify({
          fields: { bcc: [], cc: [{ address: 'cc@x.com' }], subject: 'S', text: 'T', to: [] },
          pending: true,
          savedAt: 1,
        }),
      );
      setupComposer({ draft: composerDraft({ subject: 'S', text: 'T' }) });
      await waitFor(() => expect(screen.getByLabelText('identity.compose.cc')).toBeInTheDocument());
      expect(screen.getByText('cc@x.com')).toBeInTheDocument();
    });

    it('closes on discard at once, before the pending save finishes', async () => {
      let finishCreate!: () => void;
      service.createMailDraft.mockImplementation(
        (input) =>
          new Promise((resolve) => {
            finishCreate = () => resolve(composerDraft({ ...input, id: 'draft_d' }));
          }),
      );
      const { onClose } = setupComposer();
      fireEvent.change(screen.getByLabelText('identity.compose.body'), { target: { value: 'x' } });
      await act(() => vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS + 10));
      fireEvent.click(screen.getByLabelText('identity.mailbox.action.discard'));
      expect(onClose).toHaveBeenCalledTimes(1);
      await act(async () => finishCreate());
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('MailComposer — Codex on ca8f8261cd0', () => {
    it('finishes a send after the editor is gone without steering the page', async () => {
      let finishSend!: () => void;
      service.sendMailDraft.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishSend = () => resolve({ mailId: 'sent_9', providerMessageId: 'p9' });
          }),
      );
      const { onClose, unmount } = setupComposer({
        draft: composerDraft({ subject: 'S', text: 'Body', to: [{ address: 'a@b.com' }] }),
      });
      await waitFor(() =>
        expect(screen.getByLabelText('identity.compose.body')).toHaveValue('Body'),
      );
      fireEvent.click(screen.getByTestId('mail-send'));
      await waitFor(() => expect(service.sendMailDraft).toHaveBeenCalled());
      unmount();
      await act(async () => finishSend());

      expect(onClose).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(ui.toastSuccess).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'identity.compose.sent.title' }),
        ),
      );
    });

    it('keeps the local copy when deleting a discarded draft fails', async () => {
      service.deleteMailDrafts.mockRejectedValue(new TypeError('Failed to fetch'));
      const forwardSource = composerSource({
        attachments: [
          { filename: 'plan.pdf', index: 0 },
          { filename: 'secret.csv', index: 1 },
        ],
      });
      setupComposer({ inline: true, mode: 'forward', source: forwardSource });
      await screen.findAllByTestId('compose-attachment');
      fireEvent.click(screen.getAllByLabelText('identity.compose.removeAttachment')[1]);
      fireEvent.click(screen.getByLabelText('identity.mailbox.action.discard'));
      await waitFor(() => expect(ui.toastSuccess).toHaveBeenCalled());
      await act(() => vi.advanceTimersByTimeAsync(9000));

      expect(service.deleteMailDrafts).toHaveBeenCalled();
      expect(
        JSON.parse(localStorage.getItem('lobe-agent-mail:draft:agt_1:acc_a:draft_1')!)
          .excludedAttachments,
      ).toEqual([1]);
    });
  });

  describe('MailComposer — Codex on f28b53e4cf4', () => {
    it('discards a new mail whose first save is still on its way', async () => {
      let finishCreate!: () => void;
      service.createMailDraft.mockImplementation(
        (input) =>
          new Promise((resolve) => {
            finishCreate = () => resolve(composerDraft({ ...input, id: 'draft_new' }));
          }),
      );
      setupComposer();
      fireEvent.change(screen.getByLabelText('identity.compose.body'), {
        target: { value: 'Oops' },
      });
      await act(() => vi.advanceTimersByTimeAsync(DRAFT_SAVE_DELAY_MS + 10));
      fireEvent.click(screen.getByLabelText('identity.mailbox.action.discard'));
      await act(async () => finishCreate());

      await act(() => vi.advanceTimersByTimeAsync(9000));
      expect(service.deleteMailDrafts).toHaveBeenCalledWith(['draft_new']);
    });

    it("keeps a forward's removed attachments through the discard undo window", async () => {
      const forwardSource = composerSource({
        attachments: [
          { filename: 'plan.pdf', index: 0 },
          { filename: 'secret.csv', index: 1 },
        ],
      });
      setupComposer({ inline: true, mode: 'forward', source: forwardSource });
      await screen.findAllByTestId('compose-attachment');
      fireEvent.click(screen.getAllByLabelText('identity.compose.removeAttachment')[1]);
      fireEvent.click(screen.getByLabelText('identity.mailbox.action.discard'));
      await waitFor(() => expect(ui.toastSuccess).toHaveBeenCalled());

      const key = 'lobe-agent-mail:draft:agt_1:acc_a:draft_1';
      expect(JSON.parse(localStorage.getItem(key)!).excludedAttachments).toEqual([1]);
      await act(() => vi.advanceTimersByTimeAsync(9000));
      expect(localStorage.getItem(key)).toBeNull();
    });
  });

  describe('MailComposer — after the verification round', () => {
    it("forwards a mail with no plain text without asking for words of one's own", async () => {
      setupComposer({ inline: true, mode: 'forward', source: composerSource({ text: '' }) });
      await waitFor(() =>
        expect(screen.getByLabelText('identity.compose.subject')).toHaveValue('Fwd: Q3 plan'),
      );
      typeRecipient('identity.compose.to', 'boss@corp.example');
      expect(screen.getByTestId('mail-send')).toBeEnabled();
    });

    it('keeps typing a quoted name with a comma in it', () => {
      setupComposer();
      const input = screen.getByLabelText('identity.compose.to');
      fireEvent.change(input, { target: { value: '"Doe,' } });
      expect(screen.queryByTestId('recipient-chip')).toBeNull();
      fireEvent.change(input, { target: { value: '"Doe, John" <j@x.com>,' } });
      expect(screen.getAllByTestId('recipient-chip').map((chip) => chip.textContent)).toEqual([
        'Doe, John <j@x.com>',
      ]);
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
