'use client';

import { Center, Empty, Flexbox, Icon, type IconProps, Skeleton, Tag, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  BoxesIcon,
  ClipboardListIcon,
  FileTextIcon,
  FolderGit2Icon,
  GitBranchIcon,
  LaptopIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { getAllWorkSummaries } from '@/features/Conversation/store/slices/data/workSummaries';
import WorkSummaryCard from '@/features/Work/WorkSummaryCard';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { dbMessageSelectors } from '@/store/chat/selectors';
import { useFetchGitAheadBehind, useFetchGitBranch, useReviewPatches } from '@/store/device';

import ProgressSection from '../ProgressSection';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow-y: auto;
    padding-block: 8px 12px;
    padding-inline: 8px 12px;
  `,
  changeAdditions: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorSuccess};
  `,
  changeDeletions: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorError};
  `,
  error: css`
    min-height: 112px;
  `,
  icon: css`
    flex-shrink: 0;
    margin-block-start: 1px;
    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    cursor: pointer;

    min-height: 40px;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: 6px;

    transition: background-color 0.12s ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  rowStatus: css`
    cursor: default;

    &:hover {
      background: transparent;
    }
  `,
  rowStatusPrimary: css`
    font-weight: 400 !important;
    color: ${cssVar.colorTextSecondary} !important;
  `,
  sectionHeader: css`
    padding-block: 4px 6px;
    padding-inline: 10px;
  `,
  sectionTitle: css`
    font-size: 10.5px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.08em;
  `,
  skeleton: css`
    padding-block: 4px;
    padding-inline: 10px;
  `,
  stats: css`
    flex-shrink: 0;
  `,
}));

interface OverviewProps {
  active: boolean;
  deviceId?: string;
  onOpenTab: (tab: string) => void;
  repoType?: string;
  workingDirectory?: string;
}

const pathBasename = (path: string) => path.replaceAll('\\', '/').split('/').findLast(Boolean);

const OverviewRowLead = ({ children, icon }: { children: ReactNode; icon: IconProps['icon'] }) => (
  <Flexbox horizontal align={'flex-start'} flex={1} gap={10} style={{ minWidth: 0 }}>
    <Icon className={styles.icon} icon={icon} size={17} />
    {children}
  </Flexbox>
);

const Overview = memo<OverviewProps>(
  ({ active, deviceId, onOpenTab, repoType, workingDirectory }) => {
    const { t } = useTranslation('chat');
    const isHetero = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
    const topicId = useChatStore((s) => s.activeTopicId);
    const threadId = useChatStore((s) => s.activeThreadId);
    const works = useChatStore((s) =>
      getAllWorkSummaries(dbMessageSelectors.activeDbMessages(s), threadId),
    );

    const gitPath = active && repoType ? workingDirectory : undefined;
    const {
      data: branchData,
      error: branchError,
      isLoading: branchLoading,
      mutate: mutateBranch,
    } = useFetchGitBranch(deviceId, gitPath);
    const {
      data: aheadBehind,
      error: aheadBehindError,
      mutate: mutateAheadBehind,
    } = useFetchGitAheadBehind(deviceId, gitPath);
    const {
      data: reviewData,
      error: reviewError,
      isLoading: reviewLoading,
      mutate: mutateReview,
    } = useReviewPatches(gitPath, 'unstaged', undefined, deviceId, active);

    const changeStats = useMemo(() => {
      const patches = [
        ...(reviewData?.patches ?? []),
        ...(reviewData?.submodules ?? []).flatMap((submodule) => submodule.patches),
      ];

      return patches.reduce(
        (stats, patch) => ({
          additions: stats.additions + (patch.additions ?? 0),
          deletions: stats.deletions + (patch.deletions ?? 0),
          files: stats.files + 1,
        }),
        { additions: 0, deletions: 0, files: 0 },
      );
    }, [reviewData]);

    const gitError = branchError || aheadBehindError || reviewError;
    const isGitLoading = branchLoading || reviewLoading;
    const visibleWorks = works.slice(0, 3);
    const directoryName = workingDirectory ? pathBasename(workingDirectory) : undefined;

    const retryGit = async () => {
      await Promise.all([mutateBranch(), mutateAheadBehind(), mutateReview()]);
    };

    return (
      <Flexbox className={styles.body} gap={14}>
        <Flexbox>
          <Flexbox
            horizontal
            align={'center'}
            className={styles.sectionHeader}
            justify={'space-between'}
          >
            <span className={styles.sectionTitle}>{t('workingPanel.overview.environment')}</span>
            {workingDirectory && (
              <Tag size={'small'}>
                {deviceId
                  ? t('workingPanel.overview.execution.device')
                  : t('workingPanel.overview.execution.local')}
              </Tag>
            )}
          </Flexbox>

          <Flexbox
            horizontal
            align={'flex-start'}
            className={styles.row}
            gap={10}
            onClick={workingDirectory ? () => onOpenTab('files') : undefined}
          >
            <OverviewRowLead icon={workingDirectory ? FolderGit2Icon : LaptopIcon}>
              <Flexbox flex={1} style={{ minWidth: 0 }}>
                <Text ellipsis weight={500}>
                  {directoryName || t('workingPanel.overview.workspace.empty')}
                </Text>
                <Text ellipsis color={cssVar.colorTextTertiary} fontSize={12}>
                  {workingDirectory || t('workingPanel.overview.workspace.emptyDesc')}
                </Text>
              </Flexbox>
            </OverviewRowLead>
          </Flexbox>

          {repoType && workingDirectory && isGitLoading ? (
            <div className={styles.skeleton}>
              <Skeleton active paragraph={{ rows: 2 }} title={false} />
            </div>
          ) : gitError ? (
            <Center className={styles.error} gap={8}>
              <Text type={'danger'}>{t('workingPanel.overview.environmentError')}</Text>
              <Button icon={RefreshCwIcon} size={'small'} onClick={retryGit}>
                {t('retry', { ns: 'common' })}
              </Button>
            </Center>
          ) : repoType && workingDirectory ? (
            <>
              <Flexbox
                horizontal
                align={'flex-start'}
                className={cx(styles.row, styles.rowStatus)}
                gap={10}
              >
                <OverviewRowLead icon={GitBranchIcon}>
                  <Flexbox flex={1}>
                    <Text className={styles.rowStatusPrimary}>
                      {t('workingPanel.overview.branch')}
                    </Text>
                  </Flexbox>
                </OverviewRowLead>
                <Flexbox horizontal align={'center'} className={styles.stats} gap={6}>
                  <Text ellipsis fontSize={12} style={{ maxWidth: 128 }}>
                    {branchData?.branch || t('workingPanel.overview.branch.detached')}
                  </Text>
                  {!!aheadBehind?.ahead && <Tag size={'small'}>↑{aheadBehind.ahead}</Tag>}
                  {!!aheadBehind?.behind && <Tag size={'small'}>↓{aheadBehind.behind}</Tag>}
                </Flexbox>
              </Flexbox>
              <Flexbox
                horizontal
                align={'flex-start'}
                className={styles.row}
                gap={10}
                onClick={() => onOpenTab('review')}
              >
                <OverviewRowLead icon={ClipboardListIcon}>
                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Text weight={500}>{t('workingPanel.overview.changes')}</Text>
                    <Text color={cssVar.colorTextTertiary} fontSize={12}>
                      {changeStats.files
                        ? t('workingPanel.overview.changes.files', { count: changeStats.files })
                        : t('workingPanel.overview.changes.clean')}
                    </Text>
                  </Flexbox>
                </OverviewRowLead>
                {changeStats.files > 0 && (
                  <Flexbox horizontal className={styles.stats} gap={8}>
                    <span className={styles.changeAdditions}>+{changeStats.additions}</span>
                    <span className={styles.changeDeletions}>−{changeStats.deletions}</span>
                  </Flexbox>
                )}
              </Flexbox>
            </>
          ) : null}
        </Flexbox>

        <ProgressSection />

        {visibleWorks.length > 0 && (
          <Flexbox>
            <Flexbox
              horizontal
              align={'center'}
              className={styles.sectionHeader}
              justify={'space-between'}
            >
              <span className={styles.sectionTitle}>{t('workingPanel.overview.outputs')}</span>
              <Button size={'small'} type={'text'} onClick={() => onOpenTab('works')}>
                {t('workingPanel.overview.viewAll')}
              </Button>
            </Flexbox>
            {visibleWorks.map((work) => (
              <WorkSummaryCard item={work} key={work.id} variant={'inline'} />
            ))}
          </Flexbox>
        )}

        <Flexbox>
          <Flexbox
            horizontal
            align={'center'}
            className={styles.sectionHeader}
            justify={'space-between'}
          >
            <span className={styles.sectionTitle}>{t('workingPanel.overview.resources')}</span>
          </Flexbox>
          <Flexbox
            horizontal
            align={'flex-start'}
            className={styles.row}
            gap={10}
            onClick={() => onOpenTab('skills')}
          >
            <OverviewRowLead icon={SkillsIcon}>
              <Flexbox flex={1}>
                <Text weight={500}>{t('workingPanel.resources.filter.skills')}</Text>
                <Text color={cssVar.colorTextTertiary} fontSize={12}>
                  {t('workingPanel.overview.skills.desc')}
                </Text>
              </Flexbox>
            </OverviewRowLead>
          </Flexbox>
          {!isHetero && (
            <Flexbox
              horizontal
              align={'flex-start'}
              className={styles.row}
              gap={10}
              onClick={() => onOpenTab('documents')}
            >
              <OverviewRowLead icon={FileTextIcon}>
                <Flexbox flex={1}>
                  <Text weight={500}>{t('workingPanel.resources.filter.documents')}</Text>
                  <Text color={cssVar.colorTextTertiary} fontSize={12}>
                    {t('workingPanel.overview.documents.desc')}
                  </Text>
                </Flexbox>
              </OverviewRowLead>
            </Flexbox>
          )}
        </Flexbox>

        {!topicId && visibleWorks.length === 0 && !workingDirectory && (
          <Empty
            description={t('workingPanel.overview.empty')}
            icon={BoxesIcon}
            title={t('workingPanel.overview.emptyTitle')}
          />
        )}
      </Flexbox>
    );
  },
);

Overview.displayName = 'WorkingSidebarOverview';

export default Overview;
