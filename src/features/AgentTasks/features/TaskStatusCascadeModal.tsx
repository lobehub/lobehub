'use client';

import type { TaskStatus } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, createModal, ScrollArea, Text, toast, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { STATUS_META } from './taskStatusMeta';

const styles = createStaticStyles(({ css }) => ({
  actions: css`
    padding: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  content: css`
    padding-block: 20px 16px;
    padding-inline: 20px;
  `,
  list: css`
    max-height: 280px;
    margin-block-start: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    > [role='presentation'] > [role='presentation'] {
      gap: 0;
    }
  `,
  row: css`
    padding-block: 6px;
    padding-inline: 12px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
}));

interface TaskStatusCascadeModalContentProps {
  onApply: (includeSubtasks: boolean) => Promise<void>;
  onCancel: () => void;
  subtasks: TaskStatusCascadeItem[];
  targetStatus: TaskStatus;
}

export interface TaskStatusCascadeItem {
  identifier: string;
  name?: string | null;
  status?: string;
}

/**
 * Apply-and-close flow shared by the modal buttons: on failure the modal stays
 * open with an error toast so the user can retry or cancel explicitly, instead
 * of the rejection being silently discarded.
 */
export const useCascadeApply = (onApply: (includeSubtasks: boolean) => Promise<void>) => {
  const { t } = useTranslation('chat');
  const { close } = useModalContext();
  const [loadingAction, setLoadingAction] = useState<'all' | 'parent' | null>(null);

  const handleApply = async (includeSubtasks: boolean) => {
    setLoadingAction(includeSubtasks ? 'all' : 'parent');
    try {
      await onApply(includeSubtasks);
      close();
    } catch (error) {
      console.error('[TaskStatusCascadeModal] Failed to apply status change:', error);
      toast.error(t('taskDetail.statusCascade.applyFailed'));
    } finally {
      setLoadingAction(null);
    }
  };

  return { handleApply, loadingAction };
};

const TaskStatusCascadeModalContent = ({
  onApply,
  onCancel,
  subtasks,
  targetStatus,
}: TaskStatusCascadeModalContentProps) => {
  const { t } = useTranslation('chat');
  const { close, setCanDismissByClickOutside } = useModalContext();
  const { handleApply, loadingAction } = useCascadeApply(onApply);

  useEffect(() => {
    setCanDismissByClickOutside(!loadingAction);
  }, [loadingAction, setCanDismissByClickOutside]);

  useEffect(() => {
    if (!loadingAction) return;
    const preventEscapeDismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', preventEscapeDismiss, true);
    return () => window.removeEventListener('keydown', preventEscapeDismiss, true);
  }, [loadingAction]);

  const handleCancel = () => {
    onCancel();
    close();
  };

  return (
    <Flexbox>
      <Flexbox className={styles.content} gap={8}>
        <Text as={'h3'} weight={'bold'}>
          {t('taskDetail.statusCascade.title')}
        </Text>
        <Text color={cssVar.colorTextSecondary}>
          {t('taskDetail.statusCascade.description', {
            count: subtasks.length,
            status: t(`taskDetail.status.${targetStatus}`),
          })}
        </Text>
        <ScrollArea className={styles.list}>
          {subtasks.map((task) => {
            const status = task.status as TaskStatus | undefined;
            const meta = status ? STATUS_META[status] : STATUS_META.backlog;

            return (
              <Flexbox
                horizontal
                align={'center'}
                className={styles.row}
                gap={10}
                key={task.identifier}
              >
                <Icon color={meta.color} icon={meta.icon} size={16} />
                <Flexbox flex={1}>
                  <Text ellipsis>{task.name || task.identifier}</Text>
                </Flexbox>
                <Text color={cssVar.colorTextTertiary}>
                  {t(`taskDetail.status.${status ?? 'backlog'}`, { defaultValue: meta.label })}
                </Text>
              </Flexbox>
            );
          })}
        </ScrollArea>
      </Flexbox>
      <Flexbox horizontal className={styles.actions} gap={8} justify={'space-between'}>
        <Button disabled={!!loadingAction} onClick={handleCancel}>
          {t('taskDetail.statusCascade.cancel')}
        </Button>
        <Flexbox horizontal gap={8}>
          <Button
            disabled={!!loadingAction}
            loading={loadingAction === 'parent'}
            onClick={() => void handleApply(false)}
          >
            {t('taskDetail.statusCascade.parentOnly')}
          </Button>
          <Button
            disabled={!!loadingAction}
            loading={loadingAction === 'all'}
            type={'primary'}
            onClick={() => void handleApply(true)}
          >
            {t('taskDetail.statusCascade.updateAll')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

interface CreateTaskStatusCascadeModalOptions {
  onApply: (includeSubtasks: boolean) => Promise<void>;
  subtasks: TaskStatusCascadeItem[];
  targetStatus: TaskStatus;
}

export const createTaskStatusCascadeModal = ({
  onApply,
  subtasks,
  targetStatus,
}: CreateTaskStatusCascadeModalOptions): Promise<boolean> =>
  new Promise((resolve) => {
    let applied = false;
    createModal({
      content: (
        <TaskStatusCascadeModalContent
          subtasks={subtasks}
          targetStatus={targetStatus}
          onCancel={() => resolve(false)}
          onApply={async (includeSubtasks) => {
            await onApply(includeSubtasks);
            applied = true;
            resolve(true);
          }}
        />
      ),
      maskClosable: true,
      footer: null,
      onOpenChangeComplete: (open) => {
        if (!open && !applied) resolve(false);
      },
      styles: { content: { padding: 0 } },
      title: false,
      width: 'min(92vw, 620px)',
    });
  });
