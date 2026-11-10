'use client';

import type { AgentMailFolder } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { useLatest } from 'ahooks';
import { useTranslation } from 'react-i18next';
import { useSWRConfig } from 'swr';

import {
  agentAccountService,
  type AgentMailRow,
  type AgentMailTarget,
} from '@/services/agentAccount';

import {
  chunk,
  countUnreadInbound,
  type MailPatch,
  mailWriteActions,
  MAX_IDS_PER_WRITE,
  queueRowWrite,
  UNDO_WINDOW_MS,
} from './mailWrites';
import { mailConversationKey, useMailConversation } from './useMailList';
import { useRestoreTrashed } from './useRestoreTrashed';

export interface UseConversationOptions {
  /** The address on screen, whose counts a write moves. */
  accountId?: string;
  /** The list row standing for this conversation, which may carry another mail's id. */
  listRowId?: string;
  /** Every mail left this view; the page picks what to show next. */
  onEmptied: () => void;
  /** Undo failed; the trash is where the mail can still be restored from. */
  onGoToTrash: () => void;
  /** The mail the URL names left this view but its conversation lives on here. */
  onReseated: (id: string) => void;
  /** Undo brought back the mail the URL named. */
  onRestored: (id: string) => void;
  /** Revalidate the list and the counts. */
  refresh: () => Promise<unknown>;
}

/** Sends a write in server-sized batches, after any earlier write to the same mails. */
const send = <R,>(ids: string[], call: (target: AgentMailTarget) => Promise<R>) =>
  queueRowWrite(ids, () =>
    Promise.all(chunk(ids, MAX_IDS_PER_WRITE).map((batch) => call({ ids: batch }))),
  );

/**
 * One open conversation and everything done to its mails.
 *
 * Each write acts on the mails it names, never on a whole conversation in some
 * view, so a single mail can be starred or trashed on its own. It goes through
 * the list's write layer: the list and the counts show it at once, a poll
 * cannot undo it, and a failure puts back exactly what it changed and says so
 * with a retry.
 */
export const useConversation = (
  id: string,
  folder: AgentMailFolder | undefined,
  options: UseConversationOptions,
) => {
  const { t } = useTranslation('setting');
  const swr = useMailConversation(id, folder);
  const { data, mutate } = swr;
  const { mutate: mutateCache } = useSWRConfig();
  const optionsRef = useLatest(options);

  const failureToast = (title: string, retry: () => unknown) =>
    toast.error({
      actions: [{ label: t('identity.mailbox.retry'), onClick: () => void retry() }],
      duration: UNDO_WINDOW_MS,
      title,
    });

  /** Show `patch` on `rows` here and in the list, send the write, then settle. */
  const perform = async <R,>({
    call,
    failure,
    listIds = [],
    listPatch,
    patch,
    retry,
    rows,
    unreadDelta = 0,
  }: {
    call: (target: AgentMailTarget) => Promise<R>;
    failure: string;
    /** Rows to patch beyond the mails written, such as the row standing for them. */
    listIds?: string[];
    listPatch: MailPatch;
    patch: (row: AgentMailRow) => AgentMailRow;
    retry: () => unknown;
    rows: AgentMailRow[];
    unreadDelta?: number;
  }): Promise<R[] | undefined> => {
    const ids = rows.map((row) => row.id);
    const targets = new Set(ids);
    const before = new Map(rows.map((row) => [row.id, row]));
    const writeId = mailWriteActions.begin({
      accountId: optionsRef.current.accountId,
      draftDelta: 0,
      ids: [...new Set([...ids, ...listIds])],
      patch: listPatch,
      unreadDelta,
    });
    await mutate((current) => current?.map((row) => (targets.has(row.id) ? patch(row) : row)), {
      revalidate: false,
    });

    try {
      const values = await send(ids, call);
      // Held until the refresh lands, or the row flickers back to its old state.
      await Promise.all([mutate(), optionsRef.current.refresh().catch(() => undefined)]);
      mailWriteActions.end(writeId);
      return values;
    } catch (error) {
      console.error('[AgentMail] write failed', error);
      mailWriteActions.end(writeId);
      // Only what this write changed goes back; a later write to other mails stays.
      await mutate(
        (current) => current?.map((row) => (targets.has(row.id) ? before.get(row.id)! : row)),
        { revalidate: false },
      );
      failureToast(failure, retry);
      void optionsRef.current.refresh().catch(() => undefined);
      return undefined;
    }
  };

  const setStarred = (rows: AgentMailRow[], starred: boolean): Promise<unknown> => {
    const targets = rows.filter((row) => Boolean(row.starredAt) !== starred);
    if (targets.length === 0) return Promise.resolve(undefined);

    return perform({
      call: (target) => agentAccountService.setMailStarred(target, starred),
      failure: t('identity.mailbox.failed.star'),
      listPatch: { isStarred: starred },
      patch: (row) => ({ ...row, starredAt: starred ? new Date() : null }),
      retry: () => setStarred(targets, starred),
      rows: targets,
    });
  };

  const setUnread = (rows: AgentMailRow[], unread: boolean): Promise<unknown> => {
    // Only mails that actually flip, so a rollback flips exactly those back.
    const targets = rows.filter((row) => row.isUnread !== unread);
    if (targets.length === 0) return Promise.resolve(undefined);
    const inbound = targets.filter((row) => row.direction === 'inbound').length;
    // The row shows the conversation as unread while any mail is, so it flips
    // with this write only when no other unread mail is left behind.
    const flipsRow =
      unread ||
      (data ?? []).every((row) => !row.isUnread || targets.some(({ id }) => id === row.id));
    const { listRowId } = optionsRef.current;

    return perform({
      call: (target) =>
        unread
          ? agentAccountService.markMailUnread(target)
          : agentAccountService.markMailRead(target),
      failure: unread
        ? t('identity.mailbox.failed.markUnread')
        : t('identity.mailbox.failed.markRead'),
      listIds: flipsRow && listRowId ? [listRowId] : [],
      listPatch: { isUnread: unread },
      patch: (row) => ({ ...row, isUnread: unread }),
      retry: () => setUnread(targets, unread),
      rows: targets,
      unreadDelta: unread ? inbound : -inbound,
    });
  };

  /**
   * Take mails out of this view, here at once. When none are left the
   * conversation leaves the list too; when the one the URL names went but
   * others stay, the URL moves to the newest one left.
   */
  const remove = async <R,>({
    call,
    failure,
    retry,
    rows,
    unreadDelta,
  }: {
    call: (target: AgentMailTarget) => Promise<R>;
    failure: string;
    retry: () => unknown;
    rows: AgentMailRow[];
    unreadDelta: number;
  }): Promise<R[] | undefined> => {
    const ids = new Set(rows.map((row) => row.id));
    const remaining = data?.filter((row) => !ids.has(row.id)) ?? [];
    const emptied = remaining.length === 0;
    const writeId = mailWriteActions.begin({
      accountId: optionsRef.current.accountId,
      draftDelta: 0,
      ids: [...ids],
      // A row stands for the whole conversation, so it only leaves with the last mail.
      patch: emptied ? { removed: true } : {},
      unreadDelta,
    });

    await mutate(remaining, { revalidate: false });
    const reseatId =
      !emptied && rows.some((row) => row.id === id || row.inboxMessageId === id)
        ? remaining.at(-1)!.id
        : undefined;
    if (emptied) optionsRef.current.onEmptied();
    else if (reseatId) {
      // The pane remounts under the new id; seeded so it never shows a read
      // that raced the write and still holds the mail just taken out.
      await mutateCache(mailConversationKey(reseatId, folder), remaining, { revalidate: false });
      optionsRef.current.onReseated(reseatId);
    }

    try {
      const values = await send([...ids], call);
      await Promise.all([
        optionsRef.current.refresh().catch(() => undefined),
        reseatId && mutateCache(mailConversationKey(reseatId, folder)),
      ]);
      mailWriteActions.end(writeId);
      return values;
    } catch (error) {
      console.error('[AgentMail] write failed', error);
      mailWriteActions.end(writeId);
      // The server is the record of what moved; a partial batch may have.
      await mutate();
      if (emptied) optionsRef.current.onRestored(id);
      failureToast(failure, retry);
      void optionsRef.current.refresh().catch(() => undefined);
      return undefined;
    }
  };

  const restoreTrashed = useRestoreTrashed(() => optionsRef.current.onGoToTrash());

  /** Undo restores exactly what the trash reported moving, and reopens the mail. */
  const undoTrash = async (moved: string[]) => {
    const restored = await restoreTrashed(moved, () =>
      Promise.all([mutate(), optionsRef.current.refresh()]),
    );
    if (restored) optionsRef.current.onRestored(id);
  };

  const trash = async (rows: AgentMailRow[]): Promise<void> => {
    const values = await remove({
      call: (target) => agentAccountService.trashMail(target),
      failure: t('identity.mailbox.failed.delete'),
      retry: () => trash(rows),
      rows,
      unreadDelta: -countUnreadInbound(rows),
    });
    const moved = values?.flatMap((value) => value.ids) ?? [];
    // Nothing moved, nothing to undo: another tab may have trashed it first.
    if (moved.length === 0) return;

    const undoToast = toast.success({
      actions: [
        {
          label: t('identity.mailbox.undo'),
          onClick: () => {
            undoToast.close();
            void undoTrash(moved);
          },
        },
      ],
      duration: UNDO_WINDOW_MS,
      title: t('identity.mailbox.toast.trashed'),
    });
  };

  /** Out of the trash, back to the view each mail came from. */
  const restore = async (rows: AgentMailRow[]): Promise<void> => {
    const values = await remove({
      call: (target) => agentAccountService.restoreMail(target),
      failure: t('identity.mailbox.failed.restore'),
      retry: () => restore(rows),
      rows,
      unreadDelta: countUnreadInbound(rows),
    });
    if (values) toast.success({ title: t('identity.mailbox.toast.restored') });
  };

  return { ...swr, restore, setStarred, setUnread, trash };
};
