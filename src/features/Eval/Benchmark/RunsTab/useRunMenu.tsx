import type { AgentEvalRunListItem } from '@lobechat/types';
import { confirmModal, type DropdownItem, toast } from '@lobehub/ui/base-ui';
import { Pencil, Play, Square, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useEvalStore } from '@/store/eval';

interface UseRunMenuOptions {
  onEdit?: (run: AgentEvalRunListItem) => void;
  onRefresh?: () => Promise<void>;
}

/** Start / edit / abort / delete for one run — shared by the run row and run card. */
export const useRunMenu = (
  run: AgentEvalRunListItem,
  { onEdit, onRefresh }: UseRunMenuOptions,
): DropdownItem[] => {
  const { t } = useTranslation('eval');
  const deleteRun = useEvalStore((s) => s.deleteRun);
  const startRun = useEvalStore((s) => s.startRun);
  const abortRun = useEvalStore((s) => s.abortRun);

  const canStart = run.status === 'idle' || run.status === 'failed' || run.status === 'aborted';
  const isActive = run.status === 'running' || run.status === 'pending';

  const handleStart = () =>
    confirmModal({
      content: t('run.actions.start.confirm'),
      okText: t('run.actions.start'),
      onOk: async () => {
        try {
          await startRun(run.id, run.status !== 'idle');
          await onRefresh?.();
        } catch (error: any) {
          toast.error(error?.message || t('run.actions.start'));
        }
      },
      title: t('run.actions.start'),
    });

  const handleAbort = () =>
    confirmModal({
      content: t('run.actions.abort.confirm'),
      okButtonProps: { danger: true },
      okText: t('run.actions.abort'),
      onOk: async () => {
        await abortRun(run.id);
        await onRefresh?.();
      },
      title: t('run.actions.abort'),
    });

  const handleDelete = () =>
    confirmModal({
      content: t('run.actions.delete.confirm'),
      okButtonProps: { danger: true },
      okText: t('run.actions.delete'),
      onOk: async () => {
        await deleteRun(run.id);
        await onRefresh?.();
      },
      title: t('run.actions.delete'),
    });

  return [
    ...(canStart
      ? [
          {
            icon: <Play size={14} />,
            key: 'start',
            label: t('run.actions.start'),
            onClick: handleStart,
          },
          { type: 'divider' as const },
        ]
      : []),
    ...(onEdit
      ? [
          {
            icon: <Pencil size={14} />,
            key: 'edit',
            label: t('run.actions.edit'),
            onClick: () => onEdit(run),
          },
        ]
      : []),
    ...(isActive
      ? [
          {
            danger: true,
            icon: <Square size={14} />,
            key: 'abort',
            label: t('run.actions.abort'),
            onClick: handleAbort,
          },
        ]
      : []),
    { type: 'divider' as const },
    {
      danger: true,
      icon: <Trash2 size={14} />,
      key: 'delete',
      label: t('run.actions.delete'),
      onClick: handleDelete,
    },
  ];
};
