'use client';

import { Flexbox, Icon, MaterialFileTypeIcon, Text } from '@lobehub/ui';
import { type GetProps, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { createStaticStyles } from 'antd-style';
import { ChevronDown } from 'lucide-react';
import qs from 'query-string';
import { type Key, memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import Title from '../../../../components/Title';
import { useDetailContext } from '../DetailProvider';

type DirectoryTreeProps = GetProps<typeof Tree.DirectoryTree>;

interface TreeNode {
  children: Map<string, TreeNode>;
  key: string;
  name: string;
}

const createNode = (name: string, key: string): TreeNode => ({
  children: new Map(),
  key: key || '/',
  name,
});

export const styles = createStaticStyles(({ css, cssVar }) => ({
  tree: css`
    .ant-tree-node-content-wrapper {
      overflow: hidden;
      display: flex;
      gap: 4px;
      align-items: center;

      color: ${cssVar.colorTextSecondary};
    }

    .ant-tree-title {
      overflow: hidden;
      display: block;
      line-height: 1.2;
    }

    .ant-tree-switcher {
      display: flex;
      align-items: center;
      justify-content: center;

      margin-inline-end: 0;

      color: ${cssVar.colorTextDescription};
    }
  `,
}));

const sortNodes = (nodes: TreeNode[]) =>
  [...nodes].sort((a, b) => {
    const aIsFolder = a.children.size > 0;
    const bIsFolder = b.children.size > 0;
    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

const toTreeData = (node: TreeNode): DataNode => {
  const children = sortNodes([...node.children.values()]).map(toTreeData);
  const isFolder = children.length > 0;
  return {
    children: isFolder ? children : undefined,
    icon: (
      <MaterialFileTypeIcon
        fallbackUnknownType={false}
        filename={node.name}
        size={20}
        type={isFolder ? 'folder' : 'file'}
      />
    ),
    key: node.key,
    title: <Text ellipsis>{node.name}</Text>,
  };
};

const FileTree = memo(() => {
  const { t } = useTranslation('discover');
  const { resources = {} } = useDetailContext();
  const { pathname, search } = useLocation();
  const [expand, setExpand] = useState<Key[]>([]);
  const detailLink = useMemo(
    () =>
      qs.stringifyUrl({
        query: {
          ...Object.fromEntries(new URLSearchParams(search).entries()),
          activeTab: 'resources',
        },
        url: pathname,
      }),
    [pathname, search],
  );

  const treeData = useMemo(() => {
    const root = createNode('root', '/');
    const entries = Object.entries((resources || {}) as Record<string, unknown>);

    // 至少包含主文件，避免出现空树
    if (!entries.some(([path]) => path.toLowerCase() === 'skill.md')) {
      entries.push(['SKILL.md', {}]);
    }

    for (const [filePath] of entries) {
      const parts = filePath.split('/').filter(Boolean);
      let current = root;
      let currentPath = '';

      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        if (!current.children.has(part)) {
          current.children.set(part, createNode(part, currentPath));
        }
        current = current.children.get(part)!;
      }
    }

    return sortNodes([...root.children.values()]).map(toTreeData);
  }, [resources]);

  const onSelect: DirectoryTreeProps['onSelect'] = (keys) => {
    setExpand((prevState) => {
      if (prevState.includes(keys[0])) {
        return prevState.filter((key) => key !== keys[0]);
      } else {
        return [...prevState, keys[0]];
      }
    });
  };

  const onExpand: DirectoryTreeProps['onExpand'] = (keys) => {
    setExpand(keys);
  };

  return (
    <Flexbox gap={12}>
      <Title more={t('skills.details.sidebar.details')} moreLink={detailLink}>
        {t('skills.details.sidebar.files')}
      </Title>
      <Tree
        showIcon
        showLine
        className={styles.tree}
        defaultExpandAll={Object.entries(resources || {})?.length <= 10}
        expandedKeys={expand}
        switcherIcon={<Icon icon={ChevronDown} size={14} />}
        treeData={treeData}
        onExpand={onExpand}
        onSelect={onSelect}
      />
    </Flexbox>
  );
});

export default FileTree;
