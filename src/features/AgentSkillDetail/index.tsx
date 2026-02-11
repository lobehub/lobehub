'use client';

import type { SkillResourceTreeNode } from '@lobechat/types';
import { Flexbox, Tag } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import { memo, useMemo, useState } from 'react';

import { useToolStore } from '@/store/tool';

import ContentViewer from './ContentViewer';
import FileTree from './FileTree';

const styles = createStaticStyles(({ css, cssVar }) => ({
  divider: css`
    flex-shrink: 0;
    width: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  left: css`
    overflow-y: auto;
    flex-shrink: 0;
    width: 240px;
    padding: 8px;
  `,
  meta: css`
    flex-shrink: 0;
    padding: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  metaLabel: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  name: css`
    font-size: 18px;
    font-weight: 600;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
  right: css`
    overflow-y: auto;
    flex: 1;
    padding-block: 16px;
    padding-inline: 8px;
  `,
}));

interface AgentSkillDetailProps {
  skillId: string;
}

const buildContentMap = (nodes: SkillResourceTreeNode[]): Record<string, string> => {
  const map: Record<string, string> = {};
  const walk = (items: SkillResourceTreeNode[]) => {
    for (const node of items) {
      if (node.type === 'file' && node.content !== undefined) {
        map[node.path] = node.content;
      } else if (node.children) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return map;
};

const AgentSkillDetail = memo<AgentSkillDetailProps>(({ skillId }) => {
  const [selectedFile, setSelectedFile] = useState('SKILL.md');
  const { data, isLoading } = useToolStore((s) => s.useFetchAgentSkillDetail)(skillId);

  const skillDetail = data?.skillDetail;
  const resourceTree = data?.resourceTree ?? [];
  const contentMap = useMemo(() => buildContentMap(resourceTree), [resourceTree]);

  if (isLoading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 16 }} />;

  const author = skillDetail?.manifest?.author;
  const version = skillDetail?.manifest?.version;

  return (
    <Flexbox style={{ height: 600, overflow: 'hidden' }}>
      {skillDetail && (
        <div className={styles.meta}>
          <Flexbox align={'center'} gap={8} horizontal>
            <span className={styles.name}>{skillDetail.name}</span>
            {version && <Tag size={'small'}>v{version}</Tag>}
          </Flexbox>
          <Flexbox gap={12} horizontal style={{ marginTop: 8 }}>
            {author && (
              <span className={styles.metaLabel}>
                {author.url ? (
                  <a href={author.url} rel="noopener noreferrer" target="_blank">
                    {author.name}
                  </a>
                ) : (
                  author.name
                )}
              </span>
            )}
            <span className={styles.metaLabel}>
              {dayjs(skillDetail.createdAt).format('YYYY-MM-DD')}
            </span>
          </Flexbox>
        </div>
      )}
      <Flexbox horizontal style={{ flex: 1, overflow: 'hidden' }}>
        <div className={styles.left}>
          <FileTree
            onSelectFile={setSelectedFile}
            resourceTree={resourceTree}
            selectedFile={selectedFile}
          />
        </div>
        <div className={styles.divider} />
        <div className={styles.right}>
          <ContentViewer
            contentMap={contentMap}
            selectedFile={selectedFile}
            skillDetail={skillDetail}
          />
        </div>
      </Flexbox>
    </Flexbox>
  );
});

AgentSkillDetail.displayName = 'AgentSkillDetail';

export default AgentSkillDetail;
