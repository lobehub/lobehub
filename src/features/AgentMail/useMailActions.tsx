'use client';

import {
  Button,
  Checkbox,
  confirmModal,
  createModal,
  Flexbox,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentAccountService, type AgentMailTarget } from '@/services/agentAccount';

import { type MailPatch, mailWriteActions } from './mailWrites';
import { mailFolderOf, type MailListItem, type MailView } from './useMailList';

/** What the undo toast and the spec's undo window promise. */
const UNDO_WINDOW_MS = 8000;
/** The server's cap on ids per write. */
const MAX_IDS_PER_WRITE = 200;

interface WriteResult<R> {
  failed: MailListItem[];
  values: R[];
}

const chunk = <T,>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const unreadInbound = (items: MailListItem[]) =>
  items.filter((item) => item.isUnread && item.direction === 'inbound').length;

export interface UseMailActionsParams {
  accountId?: string;
  agentId: string;
  /** Drop rows the action took out of this view from whatever is showing them. */
  onRemoved: (ids: string[]) => void;
  onViewChange: (view: MailView) => void;
  /** Revalidate the list and the counts. */
  refresh: () => Promise<unknown>;
  /** Search results span views, so each row then acts within its own. */
  searching: boolean;
  view: MailView;
}

const EmptyTrashConfirm = ({ onConfirm }: { onConfirm: () => void }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { close } = useModalContext();
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Flexbox gap={16}>
      {t('identity.mailbox.emptyTrash.content')}
      <Checkbox checked={acknowledged} onChange={setAcknowledged}>
        {t('identity.mailbox.emptyTrash.acknowledge')}
      </Checkbox>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          danger
          disabled={!acknowledged}
          type={'primary'}
          onClick={() => {
            close();
            onConfirm();
          }}
        >
          {t('identity.mailbox.emptyTrash.confirm')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

/**
 * Everything a person does to rows in a mail view.
 *
 * Every write shows at once, then settles: on success the refreshed list takes
 * over; on failure the row goes back and a toast says so, with a retry. Silent
 * rollback is never acceptable here, because the row would just appear to have
 * changed its mind.
 */
export const useMailActions = ({
  accountId,
  agentId,
  onRemoved,
  onViewChange,
  refresh,
  searching,
  view,
}: UseMailActionsParams) => {
  const { t } = useTranslation(['setting', 'common']);

  const folderOf = (item: MailListItem) =>
    searching ? (item.direction === 'outbound' ? 'sent' : 'inbox') : mailFolderOf(view);

  const failureToast = (title: string, failed: number, total: number, retry: () => unknown) =>
    toast.error({
      actions: [{ label: t('identity.mailbox.retry'), onClick: () => void retry() }],
      duration: UNDO_WINDOW_MS,
      title:
        failed < total
          ? t('identity.mailbox.failed.partial', { done: total - failed, failed })
          : title,
    });

  /** Show `patch` now, send the write in server-sized batches, then settle. */
  const perform = async <R,>({
    call,
    draftDelta = 0,
    failure,
    items,
    patch,
    prepare,
    retry,
    unreadDelta = 0,
  }: {
    call: (target: AgentMailTarget) => Promise<R>;
    draftDelta?: number;
    failure: string;
    items: MailListItem[];
    patch: MailPatch;
    prepare?: () => Promise<unknown>;
    retry: (failed: MailListItem[]) => unknown;
    unreadDelta?: number;
  }): Promise<WriteResult<R>> => {
    const writeId = mailWriteActions.begin({
      accountId,
      draftDelta,
      ids: items.map((item) => item.id),
      patch,
      unreadDelta,
    });

    const groups = new Map<string | undefined, MailListItem[]>();
    for (const item of items) {
      const folder = folderOf(item);
      groups.set(folder, [...(groups.get(folder) ?? []), item]);
    }
    const batches = [...groups.entries()].flatMap(([folder, grouped]) =>
      chunk(grouped, MAX_IDS_PER_WRITE).map((batch) => ({ batch, folder })),
    );

    const failed: MailListItem[] = [];
    const values: R[] = [];
    try {
      await prepare?.();
      const results = await Promise.allSettled(
        batches.map(({ batch, folder }) =>
          call({
            conversationIn: folder as AgentMailTarget['conversationIn'],
            ids: batch.map((item) => item.id),
          }),
        ),
      );
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') values.push(result.value);
        else {
          console.error('[AgentMail] write failed', result.reason);
          failed.push(...batches[index].batch);
        }
      });
    } catch (error) {
      console.error('[AgentMail] write failed', error);
      failed.push(...items);
    }

    if (failed.length > 0) {
      // The row goes back first, so the toast describes what is on screen.
      mailWriteActions.end(writeId);
      failureToast(failure, failed.length, items.length, () => retry(failed));
      void refresh().catch(() => undefined);
    } else {
      // Held until the refresh lands, or the row flickers back to its old state.
      await refresh().catch(() => undefined);
      mailWriteActions.end(writeId);
    }

    return { failed, values };
  };

  const setStarred = (items: MailListItem[], starred: boolean): Promise<WriteResult<unknown>> => {
    const targets = items.filter((item) => item.isStarred !== starred);
    if (targets.length === 0) return Promise.resolve({ failed: [], values: [] });

    return perform({
      call: (target) => agentAccountService.setMailStarred(target, starred),
      failure: t('identity.mailbox.failed.star'),
      items: targets,
      patch: { isStarred: starred },
      retry: (failed) => setStarred(failed, starred),
    });
  };

  const setRead = (items: MailListItem[], read: boolean): Promise<WriteResult<unknown>> => {
    const targets = items.filter((item) => item.isUnread === read);
    if (targets.length === 0) return Promise.resolve({ failed: [], values: [] });
    const inbound = targets.filter((item) => item.direction === 'inbound').length;

    return perform({
      call: (target) =>
        read
          ? agentAccountService.markMailRead(target)
          : agentAccountService.markMailUnread(target),
      failure: read
        ? t('identity.mailbox.failed.markRead')
        : t('identity.mailbox.failed.markUnread'),
      items: targets,
      patch: { isUnread: !read },
      retry: (failed) => setRead(failed, read),
      unreadDelta: read ? -inbound : inbound,
    });
  };

  const undoTrash = async (ids: string[]) => {
    try {
      await Promise.all(
        chunk(ids, MAX_IDS_PER_WRITE).map((batch) =>
          agentAccountService.restoreMail({ ids: batch }),
        ),
      );
      await refresh().catch(() => undefined);
      toast.success({ title: t('identity.mailbox.undone') });
    } catch (error) {
      console.error('[AgentMail] undo failed', error);
      toast.error({
        actions: [{ label: t('identity.mailbox.goToTrash'), onClick: () => onViewChange('trash') }],
        title: t('identity.mailbox.failed.undo'),
      });
    }
  };

  /** Trashing is written at once; undo is a restore, so closing the page loses nothing. */
  const trash = async (items: MailListItem[]) => {
    onRemoved(items.map((item) => item.id));
    const pending = perform({
      call: (target) => agentAccountService.trashMail(target),
      failure: t('identity.mailbox.failed.delete'),
      items,
      patch: { removed: true },
      retry: trash,
      unreadDelta: -unreadInbound(items),
    });
    const undoToast = toast.success({
      actions: [
        {
          label: t('identity.mailbox.undo'),
          onClick: () => {
            undoToast.close();
            void pending.then(({ values }) => undoTrash(values.flatMap((value) => value.ids)));
          },
        },
      ],
      duration: UNDO_WINDOW_MS,
      title: t('identity.mailbox.toast.trashed'),
    });

    const result = await pending;
    if (result.failed.length > 0) undoToast.close();
    return result;
  };

  const restore = async (items: MailListItem[]) => {
    onRemoved(items.map((item) => item.id));
    const result = await perform({
      call: (target) => agentAccountService.restoreMail(target),
      failure: t('identity.mailbox.failed.restore'),
      items,
      patch: { removed: true },
      retry: restore,
    });
    if (result.failed.length === 0) toast.success({ title: t('identity.mailbox.toast.restored') });
    return result;
  };

  const runPurge = async (items: MailListItem[]) => {
    onRemoved(items.map((item) => item.id));
    const result = await perform({
      call: (target) => agentAccountService.purgeMail(target),
      failure: t('identity.mailbox.failed.purge'),
      items,
      patch: { removed: true },
      retry: runPurge,
    });
    if (result.failed.length > 0) return result;

    // The provider can refuse some mails of an accepted batch; they stay in trash.
    const failed = result.values.reduce((sum, value) => sum + value.failed, 0);
    if (failed > 0) {
      toast.error({
        title: t('identity.mailbox.failed.purgePartial', {
          done: result.values.reduce((sum, value) => sum + value.count, 0),
          failed,
        }),
      });
    } else {
      toast.success({ title: t('identity.mailbox.toast.purged') });
    }
    return result;
  };

  const purge = (items: MailListItem[], onDone?: () => void) => {
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('identity.mailbox.purge.content', { count: items.length }),
      okButtonProps: { danger: true },
      okText: t('identity.mailbox.purge.confirm'),
      // Closes straight away; the rows leave and any failure is reported on the list.
      onOk: () => {
        onDone?.();
        void runPurge(items);
      },
      title: t('identity.mailbox.purge.title'),
    });
  };

  /**
   * A discarded draft never goes to the trash, so it has nothing to restore
   * from: the delete waits out the undo window instead.
   */
  const discard = (items: MailListItem[]) => {
    const ids = items.map((item) => item.id);
    onRemoved(ids);
    const writeId = mailWriteActions.begin({
      accountId,
      draftDelta: -items.length,
      ids,
      patch: { removed: true },
      unreadDelta: 0,
    });

    const timer = setTimeout(async () => {
      try {
        await Promise.all(
          chunk(ids, MAX_IDS_PER_WRITE).map((batch) => agentAccountService.deleteMailDrafts(batch)),
        );
        await refresh().catch(() => undefined);
        mailWriteActions.end(writeId);
      } catch (error) {
        console.error('[AgentMail] discard failed', error);
        mailWriteActions.end(writeId);
        failureToast(t('identity.mailbox.failed.discard'), items.length, items.length, () =>
          discard(items),
        );
      }
    }, UNDO_WINDOW_MS);

    const undoToast = toast.success({
      actions: [
        {
          label: t('identity.mailbox.undo'),
          onClick: () => {
            clearTimeout(timer);
            undoToast.close();
            mailWriteActions.end(writeId);
          },
        },
      ],
      duration: UNDO_WINDOW_MS,
      title: t('identity.mailbox.toast.discarded'),
    });
  };

  const markAllRead = (
    loadedUnread: MailListItem[],
    total: number,
  ): Promise<WriteResult<unknown>> | undefined => {
    if (!accountId) return;

    return perform({
      call: (target) => agentAccountService.markMailRead(target),
      failure: t('identity.mailbox.failed.markRead'),
      items: loadedUnread,
      patch: { isUnread: false },
      // Rows someone marked unread by hand are covered by `call`; only loaded ones can be.
      prepare: () => agentAccountService.markAllInboxRead(agentId, accountId),
      retry: () => markAllRead(loadedUnread, total),
      unreadDelta: -total,
    });
  };

  const emptyTrash = (items: MailListItem[]) => {
    if (!accountId) return;

    const run = async () => {
      const writeId = mailWriteActions.begin({
        accountId,
        draftDelta: 0,
        ids: items.map((item) => item.id),
        patch: { removed: true },
        unreadDelta: 0,
      });
      let count = 0;
      let failed = 0;
      try {
        for (;;) {
          const result = await agentAccountService.emptyMailTrash(accountId);
          count += result.count;
          failed += result.failed;
          if (!result.hasMore) break;
        }
        if (failed > 0) {
          toast.error({ title: t('identity.mailbox.emptyTrash.partial', { count, failed }) });
        } else {
          toast.success({ title: t('identity.mailbox.emptyTrash.done') });
        }
        await refresh().catch(() => undefined);
      } catch (error) {
        console.error('[AgentMail] empty trash failed', error);
        failureToast(t('identity.mailbox.failed.emptyTrash'), 1, 1, run);
        void refresh().catch(() => undefined);
      } finally {
        mailWriteActions.end(writeId);
      }
    };

    createModal({
      content: <EmptyTrashConfirm onConfirm={() => void run()} />,
      footer: null,
      title: t('identity.mailbox.emptyTrash.confirm'),
      width: 420,
    });
  };

  return { discard, emptyTrash, markAllRead, purge, restore, setRead, setStarred, trash };
};

export type MailActions = ReturnType<typeof useMailActions>;
