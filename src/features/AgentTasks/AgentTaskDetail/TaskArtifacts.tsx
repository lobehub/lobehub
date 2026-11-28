import type { TaskDetailWorkspaceNode } from '@lobechat/types';
import {
  ActionIcon,
  Block,
  Collapsible,
  confirmModal,
  cssVar,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Tag,
  Text,
} from '@lobehub/ui';
import { cssVar as sxVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FileLock2Icon, FileTextIcon, MoreHorizontal, Package, Trash } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openDocumentModal } from '@/features/DocumentModal/loader';
import Time from '@/features/Home/components/Time';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import TaskSectionHeader from './TaskSectionHeader';

// One bordered list with hairline rows, like the acceptance checklist, instead
// of a stack of separately outlined cards.
const styles = stylex.create({
  divided: {
    borderBlockStartColor: sxVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
  },
  list: {
    borderColor: sxVar.colorBorderSecondary,
    borderRadius: sxVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    borderRadius: 0,
  },
});

const flattenWorkspace = (nodes: TaskDetailWorkspaceNode[]): TaskDetailWorkspaceNode[] =>
  nodes.flatMap((node) => [
    node,
    ...(node.children?.length ? flattenWorkspace(node.children) : []),
  ]);

const ArtifactCard = memo<{ divided: boolean; node: TaskDetailWorkspaceNode }>(
  ({ divided, node }) => {
    const { t } = useTranslation('chat');
    const unpinDocument = useTaskStore((s) => s.unpinDocument);
    const activeTaskId = useTaskStore(taskDetailSelectors.activeTaskId);
    // Tombstone: the viewer lost access to the pinned document (switched back
    // to private by its owner). The server strips title/metadata; clicking
    // through still works — the document preview renders its own 404 terminal.
    const inaccessible = !!node.inaccessible;
    const title = inaccessible
      ? t('taskDetail.artifactInaccessible')
      : node.title || t('taskDetail.untitled');
    const sizeLabel =
      node.size == null ? undefined : t('taskDetail.artifactSize', { value: node.size });

    const handleDelete = useCallback(() => {
      const taskId = node.sourceTaskId ?? activeTaskId;
      if (!taskId) return;
      confirmModal({
        content: t('taskDetail.artifactMenu.deleteConfirm.content'),
        okButtonProps: { danger: true },
        okText: t('taskDetail.artifactMenu.deleteConfirm.ok'),
        onOk: () => unpinDocument(taskId, node.documentId),
        title: t('taskDetail.artifactMenu.deleteConfirm.title'),
      });
    }, [activeTaskId, node.documentId, node.sourceTaskId, t, unpinDocument]);

    const menuItems = useMemo<DropdownItem[]>(
      () => [
        {
          danger: true,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('taskDetail.artifactMenu.delete'),
          onClick: handleDelete,
        },
      ],
      [handleDelete, t],
    );

    return (
      <Block
        clickable
        horizontal
        align="center"
        className={stylex.props(styles.row, divided && styles.divided).className}
        gap={10}
        paddingBlock={8}
        paddingInline={12}
        variant="borderless"
        onClick={() => void openDocumentModal(node.documentId)}
      >
        <Icon
          color={cssVar.colorTextSecondary}
          icon={inaccessible ? FileLock2Icon : FileTextIcon}
          size={{ size: 18, strokeWidth: 1.5 }}
          style={{ flexShrink: 0 }}
        />
        <Text
          ellipsis
          style={{ flex: 1, minWidth: 0 }}
          type={inaccessible ? 'secondary' : undefined}
        >
          {title}
        </Text>
        {sizeLabel && (
          <Text fontSize={12} style={{ flexShrink: 0 }} type="secondary">
            {sizeLabel}
          </Text>
        )}
        {node.sourceTaskIdentifier && (
          <Tag size="small" style={{ flexShrink: 0 }}>
            {node.sourceTaskIdentifier}
          </Tag>
        )}
        {node.createdAt && <Time date={node.createdAt} />}
        <DropdownMenu items={menuItems}>
          <ActionIcon
            icon={MoreHorizontal}
            size="small"
            onClick={(e) => {
              e.stopPropagation();
            }}
          />
        </DropdownMenu>
      </Block>
    );
  },
);

const TaskArtifacts = memo(() => {
  const { t } = useTranslation('chat');
  const workspace = useTaskStore(taskDetailSelectors.activeTaskWorkspace);
  const [isExpanded, setIsExpanded] = useState(true);

  const items = useMemo(
    () =>
      [...flattenWorkspace(workspace)].sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      }),
    [workspace],
  );

  if (items.length === 0) return null;

  return (
    <Flexbox gap={8}>
      <TaskSectionHeader
        count={items.length}
        icon={Package}
        isOpen={isExpanded}
        title={t('taskDetail.artifacts')}
        onToggle={() => setIsExpanded((prev) => !prev)}
      />
      <Collapsible open={isExpanded}>
        <div {...stylex.props(styles.list)}>
          {items.map((node, index) => (
            <ArtifactCard divided={index > 0} key={node.documentId} node={node} />
          ))}
        </div>
      </Collapsible>
    </Flexbox>
  );
});

export default TaskArtifacts;
