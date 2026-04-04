'use client';

import { type SkillResourceTreeNode } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { ActionIcon, Avatar, Flexbox, Icon, MaterialFileTypeIcon, Text } from '@lobehub/ui';
import { Button, Skeleton } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { DotIcon, ExternalLinkIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import PublishedTime from '@/components/PublishedTime';
import { useDiscoverStore } from '@/store/discover';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';
import { type DiscoverSkillDetail as DiscoverSkillDetailType } from '@/types/discover';

import ContentViewer from '../../../AgentSkillDetail/ContentViewer';
import FileTree from '../../../AgentSkillDetail/FileTree';

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
  resourceInfo: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;
    justify-content: center;

    height: 100%;

    color: ${cssVar.colorTextSecondary};
  `,
  right: css`
    container-type: size;
    overflow: auto;
    flex: 1;
  `,
}));

interface MarketSkillDetailProps {
  identifier: string;
}

const buildMarketResourceTree = (
  resources?: DiscoverSkillDetailType['resources'],
): { name: string; path: string; type: 'file' }[] => {
  if (!resources) return [];
  return Object.keys(resources)
    .sort()
    .map((path) => ({
      name: path.split('/').pop() || path,
      path,
      type: 'file' as const,
    }));
};

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

const formatSize = (size?: number) => {
  if (typeof size !== 'number') return '--';
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  return (size / (1024 * 1024)).toFixed(1) + ' MB';
};

const MarketSkillDetail = memo<MarketSkillDetailProps>(({ identifier }) => {
  const { t } = useTranslation('setting');
  const [selectedFile, setSelectedFile] = useState('SKILL.md');

  // Market data (always fetched for header info + icon)
  const useFetchSkillDetail = useDiscoverStore((s) => s.useFetchSkillDetail);
  const { data, isLoading } = useFetchSkillDetail({ identifier });

  // Installed skill data (for full file content)
  const installedSkill = useToolStore(agentSkillsSelectors.getAgentSkillByIdentifier(identifier));
  const { data: installedData } = useToolStore((s) => s.useFetchAgentSkillDetail)(
    installedSkill?.id,
  );

  const installedResourceTree = useMemo(
    () => installedData?.resourceTree ?? [],
    [installedData?.resourceTree],
  );
  const installedContentMap = useMemo(
    () => buildContentMap(installedResourceTree),
    [installedResourceTree],
  );
  const hasInstalledContent = installedResourceTree.length > 0;

  // Use installed resource tree if available, otherwise fall back to market metadata
  const resourceTree = useMemo(
    () => (hasInstalledContent ? installedResourceTree : buildMarketResourceTree(data?.resources)),
    [hasInstalledContent, installedResourceTree, data?.resources],
  );

  if (isLoading || !data) {
    return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 16 }} />;
  }

  const { name, icon, version, description, homepage, github, resources } = data;
  const repoUrl = homepage || github?.url;

  const getFileLink = (filePath: string) => {
    if (!repoUrl) return;
    return urlJoin(repoUrl, filePath);
  };

  // Use installed skill content for SKILL.md if available, otherwise market content
  const skillDetailForViewer = {
    content: installedData?.skillDetail?.content || data.content,
  } as any;

  const renderContent = () => {
    if (selectedFile === 'SKILL.md') {
      return (
        <ContentViewer
          contentMap={installedContentMap}
          selectedFile={selectedFile}
          skillDetail={skillDetailForViewer}
        />
      );
    }

    // If installed, use ContentViewer with full content
    if (hasInstalledContent && installedContentMap[selectedFile] !== undefined) {
      return (
        <ContentViewer
          contentMap={installedContentMap}
          selectedFile={selectedFile}
          skillDetail={skillDetailForViewer}
        />
      );
    }

    // Not installed or no content: show metadata + link
    const resource = resources?.[selectedFile];
    const fileLink = getFileLink(selectedFile);

    return (
      <div className={styles.resourceInfo}>
        <MaterialFileTypeIcon filename={selectedFile} size={64} type={'file'} />
        <Text style={{ fontSize: 16 }} weight={500}>
          {selectedFile}
        </Text>
        <Text type={'secondary'}>{formatSize(resource?.size)}</Text>
        {fileLink && (
          <a href={fileLink} rel="noreferrer" target={'_blank'}>
            <Button icon={<Icon icon={ExternalLinkIcon} />} type={'primary'}>
              {t('agentSkillDetail.sourceUrl')}
            </Button>
          </a>
        )}
      </div>
    );
  };

  return (
    <Flexbox style={{ height: '100%', overflow: 'hidden' }}>
      <div className={styles.meta}>
        <Flexbox horizontal align={'center'} gap={12}>
          <Avatar avatar={icon || name} shape={'square'} size={40} style={{ flex: 'none' }} />
          <Flexbox flex={1} gap={4} style={{ overflow: 'hidden' }}>
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Flexbox horizontal align={'center'} className={styles.description} gap={4}>
                <span className={styles.name}>{name}</span>
                {version && (
                  <>
                    <Icon icon={DotIcon} />
                    <span>v{version}</span>
                  </>
                )}
                <Icon icon={DotIcon} />
                {t('agentSkillDetail.updatedAt')}{' '}
                <PublishedTime date={data.updatedAt} template={'MMM DD, YYYY'} />
              </Flexbox>
              <Flexbox horizontal align={'center'} gap={2} style={{ flexShrink: 0 }}>
                {github?.url && (
                  <a href={github.url} rel="noreferrer" target={'_blank'}>
                    <ActionIcon
                      fill={cssVar.colorTextDescription}
                      icon={Github}
                      title={t('agentSkillDetail.repository')}
                    />
                  </a>
                )}
                {homepage && (
                  <a href={homepage} rel="noreferrer" target={'_blank'}>
                    <ActionIcon icon={ExternalLinkIcon} title={t('agentSkillDetail.sourceUrl')} />
                  </a>
                )}
              </Flexbox>
            </Flexbox>
            {description && <p className={styles.description}>{description}</p>}
          </Flexbox>
        </Flexbox>
      </div>
      <Flexbox horizontal style={{ flex: 1, overflow: 'hidden' }}>
        <div className={styles.left}>
          <FileTree
            resourceTree={resourceTree}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
          />
        </div>
        <div className={styles.divider} />
        <div className={styles.right} key={selectedFile}>
          {renderContent()}
        </div>
      </Flexbox>
    </Flexbox>
  );
});

MarketSkillDetail.displayName = 'MarketSkillDetail';

export default MarketSkillDetail;
