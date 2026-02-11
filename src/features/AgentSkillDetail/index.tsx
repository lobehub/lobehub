'use client';

import type { SkillResourceTreeNode } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { ActionIcon, Avatar, Flexbox, Icon } from '@lobehub/ui';
import { Skeleton } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { DotIcon, ExternalLinkIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PublishedTime from '@/components/PublishedTime';
import { useToolStore } from '@/store/tool';

import ContentViewer from './ContentViewer';
import FileTree from './FileTree';

const styles = createStaticStyles(({ css, cssVar }) => ({
  description: css`
    overflow: hidden;

    margin: 0;

    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
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
  name: css`
    font-size: 16px;
    font-weight: 500;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
  right: css`
    container-type: size;
    overflow: auto;
    flex: 1;
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
  const { t } = useTranslation('setting');
  const [selectedFile, setSelectedFile] = useState('SKILL.md');
  const { data, isLoading } = useToolStore((s) => s.useFetchAgentSkillDetail)(skillId);

  const skillDetail = data?.skillDetail;
  const resourceTree = data?.resourceTree ?? [];
  const contentMap = useMemo(() => buildContentMap(resourceTree), [resourceTree]);

  if (isLoading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 16 }} />;

  const version = skillDetail?.manifest?.version;
  const description = skillDetail?.description || skillDetail?.manifest?.description;
  const repository = skillDetail?.manifest?.repository;
  const sourceUrl = skillDetail?.manifest?.sourceUrl;

  return (
    <Flexbox style={{ height: '100%', overflow: 'hidden' }}>
      {skillDetail && (
        <div className={styles.meta}>
          <Flexbox align={'center'} gap={12} horizontal>
            <Avatar avatar={'🧩'} shape={'square'} size={40} />
            <Flexbox flex={1} gap={4} style={{ overflow: 'hidden' }}>
              <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
                <Flexbox align={'center'} className={styles.description} gap={4} horizontal>
                  <span className={styles.name}>{skillDetail.name}</span>
                  {version && (
                    <>
                      <Icon icon={DotIcon} />
                      <span>v{version}</span>
                    </>
                  )}
                  <Icon icon={DotIcon} />
                  {t('agentSkillDetail.updatedAt')}{' '}
                  <PublishedTime
                    date={new Date(skillDetail.updatedAt).toISOString()}
                    showPrefix={false}
                    template={'MMM DD, YYYY'}
                  />
                </Flexbox>
                {(repository || sourceUrl) && (
                  <Flexbox align={'center'} gap={2} horizontal style={{ flexShrink: 0 }}>
                    {repository && (
                      <a href={repository} rel="noreferrer" target={'_blank'}>
                        <ActionIcon
                          fill={cssVar.colorTextDescription}
                          icon={Github}
                          title={t('agentSkillDetail.repository')}
                        />
                      </a>
                    )}
                    {sourceUrl && (
                      <a href={sourceUrl} rel="noreferrer" target={'_blank'}>
                        <ActionIcon
                          icon={ExternalLinkIcon}
                          title={t('agentSkillDetail.sourceUrl')}
                        />
                      </a>
                    )}
                  </Flexbox>
                )}
              </Flexbox>
              {description && <p className={styles.description}>{description}</p>}
            </Flexbox>
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
        <div className={styles.right} key={selectedFile}>
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
