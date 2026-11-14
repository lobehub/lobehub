'use client';

import {
  Button,
  confirmModal,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Edit, EllipsisVertical, type LucideIcon, Server, Trash2, User } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useEvalStore } from '@/store/eval';

import { createBenchmarkEditModal } from '../../../../features/BenchmarkEditModal';

const styles = stylex.create({
  description: {
    margin: 0,
    marginBlockStart: 2,
    fontSize: cssVar.fontSize,
    color: cssVar.colorTextTertiary,
  },
  iconBox: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: cssVar.borderRadiusLG,
  },
  iconSystem: { backgroundColor: cssVar.colorPrimaryBg, color: cssVar.colorPrimary },
  iconUser: { backgroundColor: cssVar.colorSuccessBg, color: cssVar.colorSuccess },
  title: {
    margin: 0,
    fontSize: cssVar.fontSizeHeading3,
    fontWeight: 600,
    color: cssVar.colorText,
  },
});

export interface BenchmarkTitleBarProps {
  benchmark: any;
  /** What the delete confirm says, when deleting does more than drop the benchmark. */
  deleteConfirm?: string;
  onBenchmarkUpdate?: (benchmark: any) => void;
  /** Deletes the benchmark instead of the default (delete it, then open the Evaluation Lab). */
  onDelete?: () => Promise<void>;
  systemIcon?: LucideIcon;
}

/**
 * A benchmark's name and description with its Edit and more menu: the same
 * row on the Evaluation Lab's page and on Lobe Bench's.
 */
const BenchmarkTitleBar = memo<BenchmarkTitleBarProps>(
  ({ benchmark, deleteConfirm, onBenchmarkUpdate, onDelete, systemIcon = Server }) => {
    const { t } = useTranslation(['eval', 'common']);
    const navigate = useWorkspaceAwareNavigate();
    const deleteBenchmark = useEvalStore((s) => s.deleteBenchmark);
    const refreshBenchmarkDetail = useEvalStore((s) => s.refreshBenchmarkDetail);

    const handleEditSuccess = async () => {
      await refreshBenchmarkDetail(benchmark.id);
      onBenchmarkUpdate?.(benchmark);
    };

    const handleEdit = () => createBenchmarkEditModal({ benchmark, onSuccess: handleEditSuccess });

    const handleDelete = () => {
      confirmModal({
        content: deleteConfirm ?? t('benchmark.actions.delete.confirm'),
        okButtonProps: { danger: true },
        okText: t('benchmark.actions.delete'),
        onOk: async () => {
          try {
            if (onDelete) {
              await onDelete();
              return;
            }
            await deleteBenchmark(benchmark.id);
            navigate('/eval');
          } catch (error) {
            // Stay on the page: the row was rolled back and the user can retry.
            toast.error(error instanceof Error ? error.message : t('benchmark.delete.error'));
          }
        },
        title: t('benchmark.actions.delete'),
      });
    };

    // Built-in benchmarks (every account sees them) cannot be deleted; say so in the
    // menu instead of failing after the confirm.
    const builtIn = Boolean(benchmark.isSystem);
    const menuItems: DropdownItem[] = [
      {
        danger: !builtIn,
        disabled: builtIn,
        icon: <Trash2 size={16} />,
        key: 'delete',
        label: builtIn ? t('benchmark.actions.delete.builtIn') : t('common.delete'),
        onClick: handleDelete,
      },
    ];

    const byUser = benchmark.source === 'user';

    return (
      <Flexbox horizontal align="start" justify="space-between">
        <Flexbox horizontal align="start" gap={12}>
          <div {...stylex.props(styles.iconBox, byUser ? styles.iconUser : styles.iconSystem)}>
            <Icon icon={byUser ? User : systemIcon} size={20} />
          </div>
          <Flexbox gap={4}>
            <h1 {...stylex.props(styles.title)}>{benchmark.name}</h1>
            {benchmark.description && (
              <p {...stylex.props(styles.description)}>{benchmark.description}</p>
            )}
          </Flexbox>
        </Flexbox>

        <Flexbox horizontal gap={8}>
          <Button icon={Edit} size="small" onClick={handleEdit}>
            {t('common.edit')}
          </Button>
          <DropdownMenu items={menuItems} placement="bottomRight">
            <Button icon={EllipsisVertical} size="small" title={t('more', { ns: 'common' })} />
          </DropdownMenu>
        </Flexbox>
      </Flexbox>
    );
  },
);

BenchmarkTitleBar.displayName = 'BenchmarkTitleBar';

export default BenchmarkTitleBar;
