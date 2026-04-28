import type { TaskDetailWorkspaceNode } from '@lobechat/types';
import {
  ActionIcon,
  Block,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Tag,
  Text,
} from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import { FileTextIcon, MoreHorizontal, Package, Trash } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import AccordionArrowIcon from '../shared/AccordionArrowIcon';

const flattenWorkspace = (nodes: TaskDetailWorkspaceNode[]): TaskDetailWorkspaceNode[] =>
  nodes.flatMap((node) => [
    node,
    ...(node.children?.length ? flattenWorkspace(node.children) : []),
  ]);

const ArtifactCard = memo<{ node: TaskDetailWorkspaceNode }>(({ node }) => {
  const { t } = useTranslation('chat');
  const { modal } = App.useApp();
  const openPageModal = useTaskStore((s) => s.openPageModal);
  const unpinDocument = useTaskStore((s) => s.unpinDocument);
  const activeTaskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const title = node.title || 'Untitled';
  const sizeLabel =
    node.size == null ? undefined : t('taskDetail.artifactSize', { value: node.size });

  const handleDelete = useCallback(() => {
    const taskId = node.sourceTaskId ?? activeTaskId;
    if (!taskId) return;
    modal.confirm({
      centered: true,
      content: t('taskDetail.artifactMenu.deleteConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('taskDetail.artifactMenu.deleteConfirm.ok'),
      onOk: () => unpinDocument(taskId, node.documentId),
      title: t('taskDetail.artifactMenu.deleteConfirm.title'),
      type: 'error',
    });
  }, [activeTaskId, modal, node.documentId, node.sourceTaskId, t, unpinDocument]);

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
      gap={10}
      paddingBlock={8}
      paddingInline={12}
      variant="outlined"
      onClick={() => openPageModal(node.documentId)}
    >
      <Icon
        color={cssVar.colorTextSecondary}
        icon={FileTextIcon}
        size={{ size: 18, strokeWidth: 1.5 }}
        style={{ flexShrink: 0 }}
      />
      <Text ellipsis style={{ flex: 1, minWidth: 0 }}>
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
});

const TaskArtifacts = memo(() => {
  const { t } = useTranslation('chat');
  const workspace = useTaskStore(taskDetailSelectors.activeTaskWorkspace);
  const [isExpanded, setIsExpanded] = useState(true);

  const items = useMemo(() => flattenWorkspace(workspace), [workspace]);

  if (items.length === 0) return null;

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align="center" justify="space-between">
        <Block
          clickable
          horizontal
          align="center"
          gap={8}
          paddingBlock={4}
          paddingInline={8}
          style={{ cursor: 'pointer', width: 'fit-content' }}
          variant="borderless"
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          <Icon color={cssVar.colorTextDescription} icon={Package} size={16} />
          <Text color={cssVar.colorTextSecondary} fontSize={13} weight={500}>
            {t('taskDetail.artifacts')}
          </Text>
          <Tag size="small">{items.length}</Tag>
          <AccordionArrowIcon isOpen={isExpanded} style={{ color: cssVar.colorTextDescription }} />
        </Block>
      </Flexbox>
      {isExpanded && (
        <Flexbox gap={8} paddingInline={12}>
          {items.map((node) => (
            <ArtifactCard key={node.documentId} node={node} />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default TaskArtifacts;
