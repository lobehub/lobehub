'use client';

import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { Steps } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import CateTag from '@/app/[variants]/(main)/memory/features/CateTag';
import DetailLoading from '@/app/[variants]/(main)/memory/features/DetailLoading';
import DetailPanel from '@/app/[variants]/(main)/memory/features/DetailPanel';
import HashTags from '@/app/[variants]/(main)/memory/features/HashTags';
import HighlightedContent from '@/app/[variants]/(main)/memory/features/HighlightedContent';
import ProgressIcon from '@/app/[variants]/(main)/memory/features/ProgressIcon';
import SourceLink from '@/app/[variants]/(main)/memory/features/SourceLink';
import Time from '@/app/[variants]/(main)/memory/features/Time';
import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useQueryState } from '@/hooks/useQueryParam';
import { useUserMemoryStore } from '@/store/userMemory';
import { LayersEnum } from '@/types/userMemory';

import ExperienceDropdown from './ExperienceDropdown';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    font-size: 14px;
    line-height: 1.8;
    color: ${cssVar.colorText};
    white-space: pre-wrap;
  `,
  stepsContainer: css`
    .ant-steps-item-content {
      min-height: auto;
    }

    .ant-steps-item-description {
      padding-block-end: 16px !important;
    }
  `,
}));

const ExperienceRightPanel = memo(() => {
  const { t } = useTranslation('memory');
  const [experienceId] = useQueryState('experienceId', { clearOnDefault: true });
  const useFetchMemoryDetail = useUserMemoryStore((s) => s.useFetchMemoryDetail);

  const { data: experience, isLoading } = useFetchMemoryDetail(experienceId, LayersEnum.Experience);

  if (!experienceId) return null;

  let content;
  if (isLoading) content = <DetailLoading />;
  if (experience) {
    content = (
      <>
        <CateTag cate={experience.type} />
        <Text
          as={'h1'}
          fontSize={20}
          weight={'bold'}
          style={{
            lineHeight: 1.4,
            marginBottom: 0,
          }}
        >
          {experience.title}
        </Text>
        <Flexbox horizontal align="center" gap={16} justify="space-between">
          <ProgressIcon
            showInfo
            format={(percent) => `${t('filter.sort.scoreConfidence')}: ${percent}%`}
            percent={(experience.scoreConfidence ?? 0) * 100}
          />
        </Flexbox>
        <Flexbox horizontal align="center" gap={16} justify="space-between">
          <SourceLink source={experience.source} />
          <Time capturedAt={experience.capturedAt || experience.updatedAt || experience.createdAt} />
        </Flexbox>

        {experience.keyLearning && (
          <HighlightedContent>{experience.keyLearning}</HighlightedContent>
        )}

        <Steps
          className={styles.stepsContainer}
          current={null as any}
          direction="vertical"
          size="small"
          items={[
            {
              description: <HighlightedContent>{experience.situation}</HighlightedContent>,
              icon: (
                <Avatar
                  shadow
                  avatar={'S'}
                  shape={'square'}
                  size={24}
                  style={{
                    border: `1px solid ${cssVar.colorBorderSecondary}`,
                  }}
                />
              ),
              title: (
                <Text as={'h4'} fontSize={12} type={'secondary'} weight={500}>
                  {t('experience.steps.situation')}
                </Text>
              ),
            },
            {
              description: <HighlightedContent>{experience.reasoning}</HighlightedContent>,
              icon: (
                <Avatar
                  shadow
                  avatar={'T'}
                  shape={'square'}
                  size={24}
                  style={{
                    border: `1px solid ${cssVar.colorBorderSecondary}`,
                  }}
                />
              ),
              title: (
                <Text as={'h4'} fontSize={12} type={'secondary'} weight={500}>
                  {t('experience.steps.task')}
                </Text>
              ),
            },
            {
              description: <HighlightedContent>{experience.action}</HighlightedContent>,
              icon: (
                <Avatar
                  shadow
                  avatar={'A'}
                  shape={'square'}
                  size={24}
                  style={{
                    border: `1px solid ${cssVar.colorBorderSecondary}`,
                  }}
                />
              ),
              title: (
                <Text as={'h4'} fontSize={12} type={'secondary'} weight={500}>
                  {t('experience.steps.action')}
                </Text>
              ),
            },
            {
              description: <HighlightedContent>{experience.possibleOutcome}</HighlightedContent>,
              icon: (
                <Avatar
                  shadow
                  avatar={'R'}
                  shape={'square'}
                  size={24}
                  style={{
                    border: `1px solid ${cssVar.colorBorderSecondary}`,
                  }}
                />
              ),
              title: (
                <Text as={'h4'} fontSize={12} type={'secondary'} weight={500}>
                  {t('experience.steps.result')}
                </Text>
              ),
            },
          ]}
        />

        <HashTags hashTags={experience.tags} />
      </>
    );
  }

  return (
    <DetailPanel
      header={{
        right: experienceId ? (
          <ExperienceDropdown id={experienceId} size={DESKTOP_HEADER_ICON_SIZE} />
        ) : undefined,
      }}
    >
      {content}
    </DetailPanel>
  );
});

export default ExperienceRightPanel;
