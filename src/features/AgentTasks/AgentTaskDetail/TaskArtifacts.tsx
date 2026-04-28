import type { TaskDetailWorkspaceNode } from '@lobechat/types';
import { Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Package } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import AccordionArrowIcon from '../shared/AccordionArrowIcon';

const formatSizeValue = (size: number): string =>
  size < 1000 ? String(size) : `${(size / 1000).toFixed(1)}k`;

const flattenWorkspace = (nodes: TaskDetailWorkspaceNode[]): TaskDetailWorkspaceNode[] =>
  nodes.flatMap((node) => [
    node,
    ...(node.children?.length ? flattenWorkspace(node.children) : []),
  ]);

const ArtifactCard = memo<{ node: TaskDetailWorkspaceNode }>(({ node }) => {
  const { t } = useTranslation('chat');
  const openPageDrawer = useTaskStore((s) => s.openPageDrawer);
  const title = node.title || 'Untitled';
  const sizeLabel =
    node.size == null
      ? undefined
      : t('taskDetail.artifactSize', { value: formatSizeValue(node.size) });
  const fileName = title.includes('.') ? title : `${title}.md`;

  return (
    <Block
      clickable
      horizontal
      align="center"
      gap={12}
      paddingBlock={12}
      paddingInline={12}
      variant="outlined"
      onClick={() => openPageDrawer(node.documentId)}
    >
      <FileIcon fileName={fileName} size={32} />
      <Flexbox flex={1} gap={2} style={{ minWidth: 0, overflow: 'hidden' }}>
        <Text ellipsis>{title}</Text>
        <Flexbox horizontal align="center" gap={6}>
          {sizeLabel && (
            <Text fontSize={12} type="secondary">
              {sizeLabel}
            </Text>
          )}
          {node.sourceTaskIdentifier && (
            <Tag size="small" style={{ flexShrink: 0 }}>
              {node.sourceTaskIdentifier}
            </Tag>
          )}
        </Flexbox>
      </Flexbox>
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
