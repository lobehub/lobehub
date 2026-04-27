import type { TaskDetailWorkspaceNode } from '@lobechat/types';
import { Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { ConfigProvider, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { cssVar } from 'antd-style';
import { ChevronDown, FileText, FolderClosed, Package } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { styles } from '../shared/style';

const formatSize = (size?: number | null): string | undefined => {
  if (size == null) return undefined;
  if (size < 1000) return `${size} chars`;
  return `${(size / 1000).toFixed(1)}k chars`;
};

const ArtifactTitle = memo<{ node: TaskDetailWorkspaceNode }>(({ node }) => {
  const isFolder = (node.children?.length ?? 0) > 0;
  const sizeLabel = formatSize(node.size);

  return (
    <Flexbox
      horizontal
      align="center"
      gap={8}
      style={{ lineHeight: 1, minWidth: 0, overflow: 'hidden', width: '100%' }}
    >
      <Icon
        color={cssVar.colorTextDescription}
        icon={isFolder ? FolderClosed : FileText}
        size={14}
        style={{ flex: 'none' }}
      />
      <Text ellipsis fontSize={13} style={{ flex: 1, minWidth: 0 }}>
        {node.title || 'Untitled'}
      </Text>
      {sizeLabel && (
        <Text style={{ color: cssVar.colorTextQuaternary, flex: 'none', fontSize: 12 }}>
          {sizeLabel}
        </Text>
      )}
      {node.sourceTaskIdentifier && (
        <Tag size="small" style={{ flexShrink: 0 }}>
          {node.sourceTaskIdentifier}
        </Tag>
      )}
    </Flexbox>
  );
});

const toTreeData = (nodes: TaskDetailWorkspaceNode[]): DataNode[] =>
  nodes.map((node) => ({
    children: node.children?.length ? toTreeData(node.children) : undefined,
    key: node.documentId,
    title: <ArtifactTitle node={node} />,
  }));

const TaskArtifacts = memo(() => {
  const { t } = useTranslation('chat');
  const workspace = useTaskStore(taskDetailSelectors.activeTaskWorkspace);
  const [isExpanded, setIsExpanded] = useState(true);

  const treeData = useMemo(() => toTreeData(workspace), [workspace]);

  if (workspace.length === 0) return null;

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
          <Tag size="small">{workspace.length}</Tag>
          <Icon
            color={cssVar.colorTextDescription}
            icon={ChevronDown}
            size={14}
            style={{
              transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 200ms',
            }}
          />
        </Block>
      </Flexbox>
      {isExpanded && (
        <ConfigProvider theme={{ components: { Tree: { titleHeight: 32 } } }}>
          <Tree
            blockNode
            defaultExpandAll
            showLine
            className={styles.subtaskTree}
            selectable={false}
            switcherIcon={<Icon icon={ChevronDown} size={14} />}
            treeData={treeData}
          />
        </ConfigProvider>
      )}
    </Flexbox>
  );
});

export default TaskArtifacts;
