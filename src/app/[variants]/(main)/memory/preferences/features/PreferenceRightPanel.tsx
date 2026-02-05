'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { BotIcon } from 'lucide-react';
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

import PreferenceDropdown from './PreferenceDropdown';

const styles = createStaticStyles(({ css, cssVar }) => ({
  suggestionsTitle: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const PreferenceRightPanel = memo(() => {
  const { t } = useTranslation('memory');
  const [preferenceId] = useQueryState('preferenceId', { clearOnDefault: true });
  const useFetchMemoryDetail = useUserMemoryStore((s) => s.useFetchMemoryDetail);

  const { data: preference, isLoading } = useFetchMemoryDetail(preferenceId, LayersEnum.Preference);

  if (!preferenceId) return null;

  let content;
  if (isLoading) content = <DetailLoading />;
  if (preference) {
    content = (
      <>
        <CateTag cate={preference.type} />
        <Text
          as={'h1'}
          fontSize={20}
          weight={'bold'}
          style={{
            lineHeight: 1.4,
            marginBottom: 0,
          }}
        >
          {preference.title || preference.type || t('preference.defaultType')}
        </Text>
        <Flexbox horizontal align="center" gap={16} justify="space-between">
          <ProgressIcon
            showInfo
            format={(percent) => `${t('filter.sort.scorePriority')}: ${percent}%`}
            percent={(preference.scorePriority ?? 0) * 100}
          />
        </Flexbox>
        <Flexbox horizontal align="center" gap={16} justify="space-between">
          <SourceLink source={preference.source} />
          <Time capturedAt={preference.capturedAt || preference.updatedAt || preference.createdAt} />
        </Flexbox>

        {preference.conclusionDirectives && (
          <HighlightedContent>{preference.conclusionDirectives}</HighlightedContent>
        )}

        {preference.suggestions && (
          <Block gap={8} padding={16} variant={'filled'}>
            <Flexbox horizontal align={'center'} className={styles.suggestionsTitle} gap={6}>
              <Icon icon={BotIcon} size={16} />
              <span>{t('preference.suggestions')}</span>
            </Flexbox>
            <HighlightedContent>{preference.suggestions}</HighlightedContent>
          </Block>
        )}

        <HashTags hashTags={preference.tags} />
      </>
    );
  }

  return (
    <DetailPanel
      header={{
        right: preferenceId ? (
          <PreferenceDropdown id={preferenceId} size={DESKTOP_HEADER_ICON_SIZE} />
        ) : undefined,
      }}
    >
      {content}
    </DetailPanel>
  );
});

export default PreferenceRightPanel;
