'use client';

import type { ChatTopicMetadata, OwnedWorktree } from '@lobechat/types';
import {
  isRetiredTopicStatus,
  resolveOwnedWorktrees,
  SUBMODULE_COMMITS_REASON,
} from '@lobechat/types';
import { Button, confirmModal, cssVar, Flexbox, Text, toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { GitBranchIcon, TriangleAlertIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSingleton } from '@/hooks/useSingleton';
import { useClientDataSWR } from '@/libs/swr';
import { discardOwnedWorktree, keepOwnedWorktree } from '@/services/ownedWorktree';
import { topicService } from '@/services/topic';

import {
  findRemovedWorktree,
  findWorktreesAwaitingChoice,
  worktreeRefreshInterval,
} from './overviewData';
import { OverviewRow } from './OverviewRow';

const styles = stylex.create({
  // Lines up with the row's text, past its icon.
  reason: { paddingInlineStart: '36px', paddingInlineEnd: '8px', wordBreak: 'break-word' },
});

/**
 * The topic's owned worktrees as the server has them now. The topic list row
 * can predate the cleanup (it runs after the archive response), so this reads
 * the topic itself; `status` is in the key so an archive re-reads it.
 */
export const useOwnedWorktrees = (
  topicId: string | undefined,
  status?: string | null,
  enabled = true,
) => {
  const key = topicId && enabled ? ['topic-owned-worktrees', topicId, status ?? ''] : null;
  const keyId = key?.join('\u0000') ?? '';
  // When each key was first read: a new key (an archive) opens a new
  // discovery window for the cleanup to start in.
  const firstReadAt = useSingleton(() => new Map<string, number>());
  return useClientDataSWR(
    key,
    async () => {
      if (!firstReadAt.has(keyId)) firstReadAt.set(keyId, Date.now());
      return resolveOwnedWorktrees((await topicService.getTopicDetail(topicId!))?.metadata);
    },
    {
      refreshInterval: (data?: OwnedWorktree[]) =>
        worktreeRefreshInterval(data, {
          retired: isRetiredTopicStatus(status),
          sinceFirstReadMs: Date.now() - (firstReadAt.get(keyId) ?? Date.now()),
        }),
    },
  );
};

/**
 * What the Overview shows for the topic's app-created worktrees: the ones it
 * owns (`entries`), and — when the cleanup already removed the folder the
 * topic points at — that record, so the git rows stop reading a folder that is
 * gone. Only a topic that owns a worktree is read.
 */
export const useTopicWorktrees = ({
  metadata,
  status,
  topicId,
  workingDirectory,
}: {
  metadata?: ChatTopicMetadata | null;
  status?: string | null;
  topicId?: string;
  workingDirectory?: string;
}) => {
  const ownsWorktree = resolveOwnedWorktrees(metadata).length > 0;
  const { data, mutate } = useOwnedWorktrees(topicId, status, ownsWorktree);
  const entries = data ?? [];
  const removed = findRemovedWorktree(entries, workingDirectory);
  return { entries, mutate, removed };
};

interface KeptWorktreeRowsProps {
  entries: OwnedWorktree[];
  onChange: () => Promise<unknown>;
  topicId?: string;
}

/**
 * A worktree the cleanup kept because it held uncommitted work. Archiving
 * never asks; the choice is offered here instead: discard the work and delete
 * the worktree (its branch's commits are kept), or keep it for good.
 */
const KeptWorktreeRows = memo<KeptWorktreeRowsProps>(({ entries, onChange, topicId }) => {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const mutate = onChange;
  const [busy, setBusy] = useState<string>();
  /** The failed row whose reason is unfolded. */
  const [detailsOpen, setDetailsOpen] = useState<string>();

  const kept = findWorktreesAwaitingChoice(entries);

  const handleDiscard = useCallback(
    (entry: OwnedWorktree) => {
      if (!topicId) return;
      confirmModal({
        cancelText: tCommon('cancel'),
        content: t('workingPanel.overview.keptWorktree.discardConfirm'),
        okButtonProps: { danger: true },
        okText: t('workingPanel.overview.keptWorktree.discard'),
        title: t('workingPanel.overview.keptWorktree.discardConfirmTitle'),
        // Closes at once; a large worktree can take a while to delete.
        onOk: () => {
          setBusy(entry.path);
          const pending = toast.loading(t('workingPanel.overview.keptWorktree.discarding'));
          void (async () => {
            try {
              const written = await discardOwnedWorktree(topicId, entry);
              const state = written?.cleanup?.state;
              if (state === 'removed')
                toast.success(t('workingPanel.overview.keptWorktree.discarded'));
              else if (state === 'pending')
                toast.info(t('workingPanel.overview.keptWorktree.discardPending'));
              else
                // A readable title; the device's own message stays as detail.
                toast.error({
                  description: written?.cleanup?.reason,
                  title: t('workingPanel.overview.keptWorktree.discardFailed'),
                });
            } catch (error) {
              toast.error({
                description: (error as Error)?.message,
                title: t('workingPanel.overview.keptWorktree.discardFailed'),
              });
            } finally {
              pending.close();
              setBusy(undefined);
              await mutate();
            }
          })();
        },
      });
    },
    [mutate, t, tCommon, topicId],
  );

  const handleKeep = useCallback(
    async (entry: OwnedWorktree) => {
      if (!topicId) return;
      setBusy(entry.path);
      try {
        await keepOwnedWorktree(topicId, entry);
        toast.success(t('workingPanel.overview.keptWorktree.keptToast'));
        await mutate();
      } catch (error) {
        toast.error({
          description: (error as Error)?.message,
          title: t('workingPanel.overview.keptWorktree.keepFailed'),
        });
      } finally {
        setBusy(undefined);
      }
    },
    [mutate, t, topicId],
  );

  if (kept.length === 0) return null;

  return (
    <>
      {kept.map((entry) => (
        <Flexbox key={entry.path}>
          <OverviewRow
            icon={TriangleAlertIcon}
            iconColor={cssVar.colorWarning}
            iconSize={14}
            title={entry.path}
            value={
              entry.cleanup?.state === 'failed'
                ? t('workingPanel.overview.keptWorktree.failedTitle')
                : entry.cleanup?.reason === SUBMODULE_COMMITS_REASON
                  ? t('workingPanel.overview.keptWorktree.submoduleTitle')
                  : t('workingPanel.overview.keptWorktree.title', {
                      count: entry.cleanup?.dirtyFiles ?? 0,
                    })
            }
          />
          {entry.cleanup?.state === 'failed' &&
            entry.cleanup.reason &&
            detailsOpen === entry.path && (
              <Text code fontSize={12} type={'secondary'} {...stylex.props(styles.reason)}>
                {entry.cleanup.reason}
              </Text>
            )}
          <Flexbox horizontal gap={4} justify={'flex-end'} paddingInline={8}>
            {entry.cleanup?.state === 'failed' && entry.cleanup.reason && (
              <Button
                size={'small'}
                type={'text'}
                onClick={() =>
                  setDetailsOpen((open) => (open === entry.path ? undefined : entry.path))
                }
              >
                {t(
                  detailsOpen === entry.path
                    ? 'workingPanel.overview.keptWorktree.hideDetails'
                    : 'workingPanel.overview.keptWorktree.details',
                )}
              </Button>
            )}
            <Button
              disabled={busy === entry.path}
              size={'small'}
              type={'text'}
              onClick={() => void handleKeep(entry)}
            >
              {t('workingPanel.overview.keptWorktree.keep')}
            </Button>
            <Button
              danger
              loading={busy === entry.path}
              size={'small'}
              type={'text'}
              onClick={() => handleDiscard(entry)}
            >
              {t('workingPanel.overview.keptWorktree.discard')}
            </Button>
          </Flexbox>
        </Flexbox>
      ))}
    </>
  );
});

KeptWorktreeRows.displayName = 'KeptWorktreeRows';

export default KeptWorktreeRows;

/**
 * The topic's worktree was cleaned up (archived or trashed): its folder is gone,
 * its branch is kept, and the next message checks it out again at the same path.
 */
export const RemovedWorktreeRow = memo<{ entry: OwnedWorktree }>(({ entry }) => {
  const { t } = useTranslation('chat');
  return (
    <OverviewRow
      icon={GitBranchIcon}
      iconSize={14}
      title={t('workingPanel.overview.keptWorktree.removedHint')}
      value={t('workingPanel.overview.keptWorktree.removed', { branch: entry.branch ?? '' })}
    />
  );
});

RemovedWorktreeRow.displayName = 'RemovedWorktreeRow';
