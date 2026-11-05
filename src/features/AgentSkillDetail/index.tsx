'use client';

import { type SkillResourceTreeNode } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { DotIcon, ExternalLinkIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PublishedTime from '@/components/PublishedTime';
import { ArticleSkeleton } from '@/components/Skeleton';
import SkillAvatar from '@/components/SkillAvatar';
import FileTree, { FileTreeSkeleton } from '@/features/FileTree';
import { useToolStore } from '@/store/tool';

import ContentViewer from './ContentViewer';

const styles = stylex.create({
  description: {
    overflow: 'hidden',
    margin: '0',
    fontSize: '13px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  divider: {
    flexShrink: 0,
    width: '1px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  left: { overflowY: 'auto', flexShrink: 0, width: '240px', padding: '8px' },
  meta: {
    flexShrink: 0,
    padding: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  name: { fontSize: '16px', fontWeight: 500, lineHeight: 1.4, color: cssVar.colorText },
  right: { containerType: 'size', overflow: 'auto', flex: '1' },
});

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
        <div {...stylex.props(styles.meta)}>
          <ArticleSkeleton rows={1} style={{ margin: 0 }} title={220} />
        </div>
        <Flexbox horizontal style={{ flex: 1, overflow: 'hidden' }}>
          <div {...stylex.props(styles.left)}>
            <FileTreeSkeleton rows={9} />
          </div>
          <div {...stylex.props(styles.divider)} />
          <div {...stylex.props(styles.right)}>
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
        <div {...stylex.props(styles.meta)}>
          <Flexbox horizontal align={'center'} gap={12}>
            <SkillAvatar size={40} />
            <Flexbox flex={1} gap={4} style={{ overflow: 'hidden' }}>
              <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                <Flexbox
                  horizontal
                  align={'center'}
                  className={stylex.props(styles.description).className}
                  gap={4}
                >
                  <span {...stylex.props(styles.name)}>{skillDetail.name}</span>
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
              {description && <p {...stylex.props(styles.description)}>{description}</p>}
            </Flexbox>
          </Flexbox>
        </div>
      )}
      <Flexbox horizontal style={{ flex: 1, overflow: 'hidden' }}>
        <div {...stylex.props(styles.left)}>
          <FileTree
            resourceTree={resourceTree || []}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
          />
        </div>
        <div {...stylex.props(styles.divider)} />
        <div {...stylex.props(styles.right)} key={selectedFile}>
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
