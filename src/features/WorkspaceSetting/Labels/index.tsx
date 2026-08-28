'use client';

import { type AgentLabelListItem } from '@lobechat/types';
import { Empty, Flexbox, Icon, SearchBar, Tooltip } from '@lobehub/ui';
import { ActionIcon, Button, confirmModal, DropdownMenu, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import isEqual from 'fast-deep-equal';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  EllipsisIcon,
  ListFilterIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchAgentLabels } from '@/hooks/useFetchAgentLabels';
import { usePermission } from '@/hooks/usePermission';
import { useHomeStore } from '@/store/home';
import { agentLabelSelectors } from '@/store/home/selectors';

import { openDeleteLabelModal } from './DeleteLabelModal';
import { isDuplicateLabelNameError } from './errors';
import { openLabelFormModal } from './LabelFormModal';

const styles = createStaticStyles(({ css, cssVar }) => ({
  dot: css`
    flex: none;

    width: 10px;
    height: 10px;
    border-radius: 50%;

    background: ${cssVar.colorFill};
  `,
  row: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface LabelRowProps {
  canManage: boolean;
  label: AgentLabelListItem;
  manageBlockedReason?: string;
  onDelete: (label: AgentLabelListItem) => void;
  onEdit: (label: AgentLabelListItem) => void;
  /** Restoring hit an active label with the same name — offer rename-and-restore. */
  onRestoreConflict: (label: AgentLabelListItem) => void;
}

/** Shared column widths so the header and rows stay aligned. */
const NAME_COL_WIDTH = 200;
const USAGE_COL_WIDTH = 88;
const CREATED_COL_WIDTH = 96;
const ACTION_COL_WIDTH = 32;

const LabelRow = memo<LabelRowProps>(
  ({ canManage, label, manageBlockedReason, onDelete, onEdit, onRestoreConflict }) => {
    const { t } = useTranslation(['setting', 'common']);
    const updateAgentLabel = useHomeStore((s) => s.updateAgentLabel);

    const toggleArchive = () => {
      if (label.archived) {
        // Unarchive is non-destructive — no confirm needed.
        updateAgentLabel(label.id, { archived: false }).catch((error) => {
          // The name freed up by archiving may have been taken since. Archived
          // labels have no Edit action, so without this the label would be
          // stuck: hand the user a rename-and-restore form instead of a
          // dead-end "operation failed".
          if (isDuplicateLabelNameError(error)) {
            onRestoreConflict(label);
            return;
          }
          toast.error(t('operationFailed', { ns: 'common' }));
        });
        return;
      }
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('workspaceSetting.labels.archive.desc'),
        okText: t('workspaceSetting.labels.actions.archive'),
        onOk: async () => {
          try {
            await updateAgentLabel(label.id, { archived: true });
            toast.success(t('workspaceSetting.labels.archive.success'));
          } catch (error) {
            console.error('Failed to archive label:', error);
            toast.error(t('operationFailed', { ns: 'common' }));
          }
        },
        title: t('workspaceSetting.labels.archive.title', { name: label.name }),
      });
    };

    // Archived labels are frozen: restore or delete only (mirrors Linear) —
    // editing would suggest they're still in active use.
    const menuItems = [
      ...(label.archived
        ? []
        : [
            {
              icon: <Icon icon={PencilIcon} />,
              key: 'edit',
              label: t('edit', { ns: 'common' }),
              onClick: () => onEdit(label),
            },
          ]),
      {
        icon: <Icon icon={label.archived ? ArchiveRestoreIcon : ArchiveIcon} />,
        key: 'archive',
        label: label.archived
          ? t('workspaceSetting.labels.actions.unarchive')
          : t('workspaceSetting.labels.actions.archive'),
        onClick: toggleArchive,
      },
      { type: 'divider' as const },
      {
        danger: true,
        icon: <Icon icon={Trash2Icon} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: () => onDelete(label),
      },
    ];

    const actions = canManage ? (
      <DropdownMenu items={menuItems}>
        <ActionIcon icon={EllipsisIcon} size={'small'} />
      </DropdownMenu>
    ) : (
      <Tooltip title={manageBlockedReason ?? t('workspaceSetting.labels.manageBlocked')}>
        <ActionIcon disabled icon={EllipsisIcon} size={'small'} />
      </Tooltip>
    );

    return (
      <Flexbox horizontal align={'center'} className={styles.row} gap={12}>
        <Flexbox
          horizontal
          align={'center'}
          flex={'none'}
          gap={12}
          style={{ width: NAME_COL_WIDTH }}
        >
          <span
            className={styles.dot}
            style={label.color ? { background: label.color } : undefined}
          />
          <Text ellipsis weight={500}>
            {label.name}
          </Text>
        </Flexbox>
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          {label.description ? (
            <Text ellipsis fontSize={12} type={'secondary'}>
              {label.description}
            </Text>
          ) : null}
        </Flexbox>
        <Text
          fontSize={12}
          style={{ flex: 'none', textAlign: 'end', width: USAGE_COL_WIDTH }}
          type={'secondary'}
        >
          {t('workspaceSetting.labels.usage', { count: label.usageCount })}
        </Text>
        <Text
          fontSize={12}
          style={{ flex: 'none', textAlign: 'end', width: CREATED_COL_WIDTH }}
          type={'secondary'}
        >
          {dayjs(label.createdAt).format('YYYY-MM-DD')}
        </Text>
        <Flexbox align={'center'} flex={'none'} style={{ width: ACTION_COL_WIDTH }}>
          {actions}
        </Flexbox>
      </Flexbox>
    );
  },
);

LabelRow.displayName = 'WorkspaceLabelRow';

/** Column header row, aligned with LabelRow via the shared widths. */
const LabelTableHeader = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox horizontal align={'center'} gap={12} paddingInline={12} style={{ paddingBlock: 4 }}>
      <Text fontSize={12} style={{ flex: 'none', width: NAME_COL_WIDTH }} type={'secondary'}>
        {t('workspaceSetting.labels.columns.name')}
      </Text>
      <Text ellipsis fontSize={12} style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
        {t('workspaceSetting.labels.columns.description')}
      </Text>
      <Text
        fontSize={12}
        style={{ flex: 'none', textAlign: 'end', width: USAGE_COL_WIDTH }}
        type={'secondary'}
      >
        {t('workspaceSetting.labels.columns.usage')}
      </Text>
      <Text
        fontSize={12}
        style={{ flex: 'none', textAlign: 'end', width: CREATED_COL_WIDTH }}
        type={'secondary'}
      >
        {t('workspaceSetting.labels.columns.created')}
      </Text>
      <span style={{ flex: 'none', width: ACTION_COL_WIDTH }} />
    </Flexbox>
  );
});

LabelTableHeader.displayName = 'WorkspaceLabelTableHeader';

/**
 * Workspace Settings → Labels — the agent-label registry management page:
 * create / edit (name, description, color), archive / unarchive, and
 * type-to-confirm delete with an archive escape hatch.
 */
const WorkspaceLabelsContent = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const { error, isLoading, mutate } = useFetchAgentLabels();

  const isInit = useHomeStore(agentLabelSelectors.isLabelsInit);
  const allLabels = useHomeStore(agentLabelSelectors.allLabels, isEqual);

  // Inside a workspace, label management shares the workspace-settings gate:
  // admin/owner only, with buttons visible but disabled for members
  // (consistent with the rest of the settings surface). In personal mode the
  // registry belongs to the single user who owns it, so there is nobody to
  // gate against — `manage_settings` is a workspace-role signal and would
  // wrongly lock a personal user out of their own labels.
  const activeWorkspaceId = useActiveWorkspaceId();
  const { allowed: workspaceCanManage, reason: workspaceBlockedReason } =
    usePermission('manage_settings');
  const canManage = activeWorkspaceId ? workspaceCanManage : true;
  const manageBlockedReason = activeWorkspaceId ? workspaceBlockedReason : undefined;

  const [keyword, setKeyword] = useState('');
  // Linear-style scope filter: the default "workspace" scope lists active
  // labels; "archived" surfaces archived ones so they can be restored.
  const [scope, setScope] = useState<'archived' | 'workspace'>('workspace');
  const visibleLabels = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    const matched = query
      ? allLabels.filter((label) => label.name.toLowerCase().includes(query))
      : allLabels;
    return matched.filter((label) => (scope === 'archived' ? label.archived : !label.archived));
  }, [allLabels, keyword, scope]);

  const renderRow = (label: AgentLabelListItem) => (
    <LabelRow
      canManage={canManage}
      key={label.id}
      label={label}
      manageBlockedReason={manageBlockedReason}
      onDelete={(target) => openDeleteLabelModal(target)}
      onEdit={(target) => openLabelFormModal({ label: target })}
      onRestoreConflict={(target) => openLabelFormModal({ label: target, restoreOnSave: true })}
    />
  );

  const newLabelButton = (
    <Button
      disabled={!canManage}
      icon={PlusIcon}
      type={'primary'}
      onClick={() => openLabelFormModal()}
    >
      {t('workspaceSetting.labels.actions.create')}
    </Button>
  );

  // The active-labels scope is named after where the registry lives, so it
  // reads "Workspace" for a team and "Personal" for a single user.
  const activeScopeLabel = t(
    activeWorkspaceId
      ? 'workspaceSetting.labels.scope.workspace'
      : 'workspaceSetting.labels.scope.personal',
  );
  const scopeLabel = (value: 'archived' | 'workspace') =>
    value === 'archived' ? t('workspaceSetting.labels.scope.archived') : activeScopeLabel;

  const scopeMenuItems = (['workspace', 'archived'] as const).map((value) => ({
    icon: value === scope ? <Icon icon={CheckIcon} /> : undefined,
    key: value,
    label: scopeLabel(value),
    onClick: () => setScope(value),
  }));

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <SearchBar
            allowClear
            placeholder={t('workspaceSetting.labels.filterPlaceholder')}
            style={{ maxWidth: 240 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <DropdownMenu items={scopeMenuItems}>
            <Button icon={ListFilterIcon}>{scopeLabel(scope)}</Button>
          </DropdownMenu>
        </Flexbox>
        {canManage ? (
          newLabelButton
        ) : (
          <Tooltip title={manageBlockedReason ?? t('workspaceSetting.labels.manageBlocked')}>
            {newLabelButton}
          </Tooltip>
        )}
      </Flexbox>
      {!isInit && isLoading ? (
        <SkeletonList rows={4} />
      ) : error && !isInit ? (
        // A failed load must not read as "you have no labels" — the two look
        // identical here and lead the user to create duplicates of labels that
        // already exist.
        <Flexbox align={'center'} gap={12} paddingBlock={40}>
          <Empty description={t('workspaceSetting.labels.loadFailed')} />
          <Button onClick={() => mutate()}>{t('retry', { ns: 'common' })}</Button>
        </Flexbox>
      ) : visibleLabels.length === 0 ? (
        <Empty
          style={{ paddingBlock: 40 }}
          description={
            keyword.trim()
              ? t('workspaceSetting.labels.filterEmpty')
              : scope === 'archived'
                ? t('workspaceSetting.labels.archivedEmpty')
                : t('workspaceSetting.labels.empty')
          }
        />
      ) : (
        <Flexbox gap={2}>
          <LabelTableHeader />
          {visibleLabels.map(renderRow)}
        </Flexbox>
      )}
    </Flexbox>
  );
});

WorkspaceLabelsContent.displayName = 'WorkspaceLabelsContent';

export default WorkspaceLabelsContent;
