'use client';

import { type SkillResourceTreeNode } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { ActionIcon, createStaticStyles, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { DotIcon, ExternalLinkIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MarketSkillIcon from '@/components/MarketSkillIcon';
import PublishedTime from '@/components/PublishedTime';
import { ArticleSkeleton } from '@/components/Skeleton';
import SkillAvatar from '@/components/SkillAvatar';
import FileTree, { FileTreeSkeleton } from '@/features/FileTree';
import { useToolStore } from '@/store/tool';
import { densityVars } from '@/styles/densityVars';

import ContentViewer from './ContentViewer';
import { GitHubSkillUpdate, hasGitHubSource } from './GitHubSkillUpdate';

const styles = createStaticStyles(({ css, cssVar }) => ({
  description: css`
    overflow: hidden;

    margin: 0;

    font-size: 12px;
    line-height: 16px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  /**
   * Two stacked lines whose combined height matches the 40px avatar on the
   * left, so the header block reads as one row aligned with the icon instead of
   * a loose paragraph hanging beside it.
   */
  headerText: css`
    overflow: hidden;
    height: 40px;
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
    padding: ${densityVars.cardPadding};
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  name: css`
    font-size: ${densityVars.pageTitleFontSize};
    font-weight: 500;
    line-height: 20px;
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

const buildContentMap = (nodes: SkillResourceTreeNode[] = []): Record<string, string> => {
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
  const resourceTree = data?.resourceTree;
  const contentMap = useMemo(() => buildContentMap(resourceTree), [resourceTree]);

  if (isLoading) {
    return (
      <Flexbox style={{ height: '100%', overflow: 'hidden' }}>
        <div className={styles.meta}>
          <ArticleSkeleton rows={1} style={{ margin: 0 }} title={220} />
        </div>
        <Flexbox horizontal style={{ flex: 1, overflow: 'hidden' }}>
          <div className={styles.left}>
            <FileTreeSkeleton rows={9} />
          </div>
          <div className={styles.divider} />
          <div className={styles.right}>
            <ArticleSkeleton rows={8} style={{ padding: 16 }} />
          </div>
        </Flexbox>
      </Flexbox>
    );
  }

  const version = skillDetail?.manifest?.version;
  const description = skillDetail?.description || skillDetail?.manifest?.description;
  const repository = skillDetail?.manifest?.repository;
  const sourceUrl = skillDetail?.manifest?.sourceUrl;

  return (
    <Flexbox style={{ height: '100%', overflow: 'hidden' }}>
      {skillDetail && (
        <div className={styles.meta}>
          <Flexbox horizontal align={'center'} gap={12}>
            {skillDetail.source === 'market' ? (
              <MarketSkillIcon
                fallback={<SkillAvatar size={40} />}
                identifier={skillDetail.identifier}
                name={skillDetail.name}
                size={40}
              />
            ) : (
              <SkillAvatar size={40} />
            )}
            <Flexbox className={styles.headerText} flex={1} justify={'space-between'}>
              <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                <Flexbox horizontal align={'center'} className={styles.description} gap={4}>
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
                    template={'MMM DD, YYYY'}
                  />
                </Flexbox>
                {(repository || sourceUrl) && (
                  <Flexbox horizontal align={'center'} gap={2} style={{ flexShrink: 0 }}>
                    {repository && (
                      <a href={repository} rel="noreferrer" target={'_blank'}>
                        <ActionIcon
                          fill={cssVar.colorTextDescription}
                          icon={Github}
                          size={'small'}
                          title={t('agentSkillDetail.repository')}
                        />
                      </a>
                    )}
                    {sourceUrl && (
                      <a href={sourceUrl} rel="noreferrer" target={'_blank'}>
                        <ActionIcon
                          icon={ExternalLinkIcon}
                          size={'small'}
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
          {hasGitHubSource(skillDetail) && (
            <Flexbox horizontal align="center" gap={8} wrap="wrap">
              {skillDetail.upstream && (
                <Text ellipsis fontSize={12} type="secondary">
                  {skillDetail.upstream.owner}/{skillDetail.upstream.repo}
                  {skillDetail.upstream.path && '/' + skillDetail.upstream.path}
                  {' @ '}
                  {skillDetail.upstream.ref === skillDetail.upstream.installedCommit
                    ? skillDetail.upstream.installedCommit.slice(0, 7)
                    : skillDetail.upstream.ref}
                </Text>
              )}
              <GitHubSkillUpdate skill={skillDetail} />
            </Flexbox>
          )}
        </div>
      )}
      <Flexbox horizontal style={{ flex: 1, overflow: 'hidden' }}>
        <div className={styles.left}>
          <FileTree
            resourceTree={resourceTree || []}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
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
